import type { Context, Hono } from 'hono';
import { InvalidInput, requiredString, validateSession } from './session';
import { exportKit, kitId, kitVersion, preparedContent, validateKitContent, validateSource, type KitContent, type KitExample, type KitVersion } from './kits';

type AppEnv = { Bindings: Env };
type Ctx = Context<AppEnv>;
interface KitRow { id: string; name: string; description: string; revision: string; latest_version: number; created_at: string; updated_at: string; version_count?: number }
interface VersionRow { kit_id: string; version: number; content_json: string; summary: string; created_at: string }
interface Dependencies<P> {
  payload(c: Ctx): Promise<Record<string, unknown>>;
  revision(value: unknown): string;
  newId(): string;
  findProject(c: Ctx, id: string): Promise<P | null>;
  responseProject(row: P): object;
}
const summary = (row: KitRow) => ({ id: row.id, name: row.name, description: row.description, revision: row.revision, latestVersion: row.latest_version, versionCount: row.version_count ?? row.latest_version, updatedAt: row.updated_at });
const savedVersion = (row: VersionRow): KitVersion => ({ kitId: row.kit_id, version: row.version, createdAt: row.created_at, summary: row.summary, content: JSON.parse(row.content_json) as KitContent });
const missing = (c: Ctx, entity: string) => c.json({ error: 'not_found', message: `${entity} not found.` }, 404);
async function findKit(c: Ctx, id: string) { return c.env.DB.prepare('SELECT * FROM design_kits WHERE id = ?').bind(id).first<KitRow>(); }
async function versionDetail(c: Ctx, id: string, version: number) { return c.env.DB.prepare('SELECT * FROM design_kit_versions WHERE kit_id = ? AND version = ?').bind(id, version).first<VersionRow>(); }
async function detail(c: Ctx, id: string) {
  const rows = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM design_kits WHERE id = ?').bind(id),
    c.env.DB.prepare('SELECT version, created_at, summary FROM design_kit_versions WHERE kit_id = ? ORDER BY version DESC').bind(id),
    c.env.DB.prepare('SELECT v.* FROM design_kit_versions v JOIN design_kits k ON k.id = v.kit_id AND k.latest_version = v.version WHERE k.id = ?').bind(id),
  ]);
  const row = rows[0].results[0] as unknown as KitRow | undefined;
  if (!row) return null;
  const content = savedVersion(rows[2].results[0] as unknown as VersionRow).content;
  return { ...summary(row), versions: (rows[1].results as Record<string, unknown>[]).map((item) => ({ version: item.version as number, createdAt: item.created_at as string, summary: item.summary as string })), content };
}
async function conflict(c: Ctx, id: string) {
  const current = await detail(c, id);
  return current ? c.json({ error: 'revision_conflict', message: 'This kit changed. Load the latest version before adding a version.', ...current }, 409) : missing(c, 'Kit');
}
function versionPath(c: Ctx): number {
  const value = c.req.param('version');
  if (!value || !/^[1-9][0-9]*$/.test(value)) throw new InvalidInput('Invalid version');
  return kitVersion(Number(value));
}

export function registerKitRoutes<P>(app: Hono<AppEnv>, deps: Dependencies<P>) {
  app.get('/api/kits', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT k.*, (SELECT COUNT(*) FROM design_kit_versions v WHERE v.kit_id = k.id) AS version_count FROM design_kits k ORDER BY updated_at DESC, id').all<KitRow>();
    return c.json({ kits: results.map(summary) });
  });
  app.post('/api/kits/prepare', async (c) => {
    const body = await deps.payload(c);
    if ('name' in body) requiredString(body.name, 'name', 300);
    if (!Array.isArray(body.sources) || !body.sources.length || body.sources.length > 24) throw new InvalidInput('sources must contain 1 to 24 explicit design variants');
    const sources = body.sources.map(validateSource);
    if (new Set(sources.map((source) => `${source.designId}/${source.variantId}`)).size !== sources.length) throw new InvalidInput('sources must not repeat a design variant');
    // All snapshots are read in one transaction, so a prepare cannot mix saved revisions.
    const rows = await c.env.DB.batch(sources.map((source) => c.env.DB.prepare('SELECT id, state_json, revision, kind FROM designs WHERE id = ?').bind(source.designId)));
    for (const [index, source] of sources.entries()) {
      const row = rows[index].results[0] as Record<string, unknown> | undefined;
      if (row && row.revision !== source.revision) return c.json({ error: 'revision_conflict', message: 'A source design changed. Reload and select the current source.', designId: source.designId, revision: row.revision }, 409);
    }
    const examples: KitExample[] = [];
    for (const [index, source] of sources.entries()) {
      const row = rows[index].results[0] as Record<string, unknown> | undefined;
      if (!row) return missing(c, 'Source design');
      const state = validateSession(JSON.parse(String(row.state_json)));
      const variant = state.variants.find((item) => item.id === source.variantId);
      if (!variant) return missing(c, 'Source variant');
      examples.push({ id: `example-${index + 1}`, name: Array.from(`${state.title} / ${variant.name}`).slice(0, 300).join(''), kind: row.kind as 'screen' | 'component', source, variant: structuredClone(variant), viewport: structuredClone(state.viewport ?? { width: 390, height: 760, preset: 'mobile' }) });
    }
    return c.json({ content: preparedContent(body.name, examples) });
  });
  app.post('/api/kits', async (c) => {
    const body = await deps.payload(c);
    const content = validateKitContent(body.content);
    const id = deps.newId(); const now = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO design_kits (id, name, description, revision, latest_version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)').bind(id, content.name, content.description, deps.newId(), now, now),
      c.env.DB.prepare('INSERT INTO design_kit_versions (kit_id, version, content_json, summary, created_at) VALUES (?, 1, ?, ?, ?)').bind(id, JSON.stringify(content), '初版', now),
    ]);
    return c.json((await detail(c, id))!, 201);
  });
  app.get('/api/kits/:id', async (c) => {
    const kit = await detail(c, kitId(c.req.param('id')));
    return kit ? c.json(kit) : missing(c, 'Kit');
  });
  app.post('/api/kits/:id/versions', async (c) => {
    const id = kitId(c.req.param('id')); const body = await deps.payload(c);
    const expected = deps.revision(body.revision);
    const content = validateKitContent(body.content);
    requiredString(body.summary, 'summary', 1000);
    const next = deps.newId(); const now = new Date().toISOString();
    // Only a winning CAS can insert its new version; losers produce no orphan rows.
    const results = await c.env.DB.batch([
      c.env.DB.prepare('UPDATE design_kits SET name = ?, description = ?, revision = ?, latest_version = latest_version + 1, updated_at = ? WHERE id = ? AND revision = ? RETURNING id').bind(content.name, content.description, next, now, id, expected),
      c.env.DB.prepare('INSERT INTO design_kit_versions (kit_id, version, content_json, summary, created_at) SELECT id, latest_version, ?, ?, ? FROM design_kits WHERE id = ? AND revision = ?').bind(JSON.stringify(content), body.summary.trim(), now, id, next),
    ]);
    return results[0].results.length ? c.json((await detail(c, id))!, 201) : conflict(c, id);
  });
  app.get('/api/kits/:id/versions/:version', async (c) => {
    const row = await versionDetail(c, kitId(c.req.param('id')), versionPath(c));
    return row ? c.json(savedVersion(row)) : missing(c, 'Kit version');
  });
  app.get('/api/kits/:id/versions/:version/export', async (c) => {
    const row = await versionDetail(c, kitId(c.req.param('id')), versionPath(c));
    if (!row) return missing(c, 'Kit version');
    const runtimeUrl = new URL('/workbench/preview.js', c.req.url);
    const legacyUrl = new URL('/workbench/legacy-v1.css', c.req.url);
    const [runtime, legacy] = await Promise.all([c.env.ASSETS.fetch(new Request(runtimeUrl)), c.env.ASSETS.fetch(new Request(legacyUrl))]);
    if (!runtime.ok || !legacy.ok) throw new Error('Preview runtime assets are unavailable');
    return c.json(await exportKit(savedVersion(row), await runtime.text(), await legacy.text()));
  });
  app.patch('/api/projects/:id/kit', async (c) => {
    const id = kitId(c.req.param('id'), 'projectId'); const body = await deps.payload(c);
    const expected = deps.revision(body.revision);
    const clear = body.kitId === null && body.version === null;
    const selectedId = clear ? null : kitId(body.kitId);
    const selectedVersion = clear ? null : kitVersion(body.version);
    if (!await deps.findProject(c, id)) return missing(c, 'Project');
    if (!clear && !await versionDetail(c, selectedId!, selectedVersion!)) return missing(c, 'Kit version');
    const next = deps.newId();
    const selection = clear
      ? c.env.DB.prepare('DELETE FROM project_kits WHERE project_id = ? AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND revision = ?)').bind(id, id, next)
      : c.env.DB.prepare('INSERT INTO project_kits (project_id, kit_id, version) SELECT id, ?, ? FROM projects WHERE id = ? AND revision = ? ON CONFLICT(project_id) DO UPDATE SET kit_id = excluded.kit_id, version = excluded.version').bind(selectedId, selectedVersion, id, next);
    const results = await c.env.DB.batch([
      c.env.DB.prepare('UPDATE projects SET revision = ?, updated_at = ? WHERE id = ? AND revision = ? RETURNING id').bind(next, new Date().toISOString(), id, expected), selection,
    ]);
    const current = (await deps.findProject(c, id))!;
    return results[0].results.length ? c.json(deps.responseProject(current)) : c.json({ error: 'revision_conflict', message: 'This project changed. Load the current version before selecting a kit.', ...deps.responseProject(current) }, 409);
  });
  app.get('/api/projects/:id/kit', async (c) => {
    const id = kitId(c.req.param('id'), 'projectId');
    if (!await deps.findProject(c, id)) return missing(c, 'Project');
    const row = await c.env.DB.prepare('SELECT v.* FROM project_kits p JOIN design_kit_versions v ON v.kit_id = p.kit_id AND v.version = p.version WHERE p.project_id = ?').bind(id).first<VersionRow>();
    return c.json({ projectId: id, kit: row ? { kitId: row.kit_id, version: row.version, content: savedVersion(row).content } : null });
  });
  app.get('/kits', async (c) => {
    const url = new URL('/kits.html', c.req.url);
    return c.env.ASSETS.fetch(new Request(url, c.req.raw));
  });
  app.get('/kits/:id', async (c) => {
    if (!await findKit(c, kitId(c.req.param('id')))) return missing(c, 'Kit');
    return c.env.ASSETS.fetch(new Request(new URL('/kits.html', c.req.url), c.req.raw));
  });
}
