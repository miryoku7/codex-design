import { Hono, type Context } from 'hono';
import { ID_PATTERN, InvalidInput, MAX_BODY_BYTES, mergeMutable, object, preview, requiredString, validateSession, type Session } from './session';
import { registerKitRoutes } from './kit-routes';

type AppEnv = { Bindings: Env };
type AppContext = Context<AppEnv>;
interface DesignRow {
  id: string; title: string; state_json: string; favorite: number;
  created_at: string; updated_at: string; revision: string;
  project_id: string | null; kind: 'screen' | 'component';
}
interface ProjectRow {
  id: string; name: string; created_at: string; updated_at: string; revision: string;
  design_count: number; screen_count: number; component_count: number;
  kit_id: string | null; kit_version: number | null;
}
const projectSelect = `SELECT p.*, pk.kit_id, pk.version AS kit_version, COUNT(d.id) AS design_count,
  COALESCE(SUM(d.kind = 'screen'), 0) AS screen_count,
  COALESCE(SUM(d.kind = 'component'), 0) AS component_count
  FROM projects p LEFT JOIN designs d ON d.project_id = p.id LEFT JOIN project_kits pk ON pk.project_id = p.id`;
const app = new Hono<AppEnv>();
const newId = () => crypto.randomUUID().replaceAll('-', '');
const libraryMetadata = (row: DesignRow) => ({ projectId: row.project_id, kind: row.kind });
const responseState = (row: DesignRow) => ({ state: validateSession(JSON.parse(row.state_json)), revision: row.revision, library: libraryMetadata(row) });
const responseProject = (row: ProjectRow) => ({
  id: row.id, name: row.name, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
  designCount: row.design_count, screenCount: row.screen_count, componentCount: row.component_count,
  kit: row.kit_id === null ? null : { kitId: row.kit_id, version: row.kit_version },
});

app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (c.env.LOCAL_ONLY === 'true' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    return c.json({ error: 'forbidden_host', message: 'This library accepts local requests only.' }, 403);
  }
  if (c.req.header('Host') && c.req.header('Host') !== url.host) return c.json({ error: 'forbidden_host' }, 403);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  if (url.pathname.startsWith('/api/')) {
    c.header('Cache-Control', 'no-store');
    const origin = c.req.header('Origin');
    if ((origin && origin !== url.origin) || c.req.header('Sec-Fetch-Site') === 'cross-site') {
      return c.json({ error: 'forbidden_origin', message: 'Cross-origin API requests are not allowed.' }, 403);
    }
  }
  await next();
});

async function payload(c: AppContext): Promise<Record<string, unknown>> {
  if (c.req.header('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new InvalidInput('Content-Type must be application/json');
  const contentLength = c.req.header('Content-Length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) throw new InvalidInput('Request body is too large');
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw new InvalidInput('A JSON request body is required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new InvalidInput('Request body is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let result: unknown;
  try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); }
  catch { throw new InvalidInput('Request body must be valid UTF-8 JSON'); }
  object(result, 'payload');
  return result;
}
function revision(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 32 || !/^[0-9a-f]{32}$/.test(value)) throw new InvalidInput('revision must be the current opaque library revision');
  return value;
}
function pathId(c: AppContext, entity = 'design'): string {
  const id = c.req.param('id');
  if (!id || !ID_PATTERN.test(id)) throw new InvalidInput(`Invalid ${entity} id`);
  return id;
}
function projectId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new InvalidInput('projectId must be a valid project id or null');
  return value;
}
function designKind(value: unknown): DesignRow['kind'] {
  if (value !== 'screen' && value !== 'component') throw new InvalidInput('kind must be screen or component');
  return value;
}
async function findProject(c: AppContext, id: string): Promise<ProjectRow | null> {
  return c.env.DB.prepare(`${projectSelect} WHERE p.id = ? GROUP BY p.id`).bind(id).first<ProjectRow>();
}
function missingProject(c: AppContext) { return c.json({ error: 'not_found', message: 'Project not found.' }, 404); }
async function findRow(c: AppContext, id: string): Promise<DesignRow | null> {
  return c.env.DB.prepare('SELECT * FROM designs WHERE id = ?').bind(id).first<DesignRow>();
}
function missing(c: AppContext) { return c.json({ error: 'not_found', message: 'Design not found.' }, 404); }
async function conflict(c: AppContext, id: string) {
  const current = await findRow(c, id);
  if (!current) return missing(c);
  return c.json({ error: 'revision_conflict', message: 'This design changed. Load the current version before saving.', ...responseState(current) }, 409);
}
function serialized(state: Session): string {
  validateSession(state);
  const json = JSON.stringify(state);
  if (new TextEncoder().encode(json).byteLength > MAX_BODY_BYTES) throw new InvalidInput('Session is too large');
  return json;
}

app.get('/api/projects', async (c) => {
  const { results } = await c.env.DB.prepare(`${projectSelect} GROUP BY p.id ORDER BY p.updated_at DESC, p.id`).all<ProjectRow>();
  return c.json({ projects: results.map(responseProject) });
});

app.post('/api/projects', async (c) => {
  const body = await payload(c);
  requiredString(body.name, 'name', 300);
  const id = newId();
  const now = new Date().toISOString();
  await c.env.DB.prepare('INSERT INTO projects (id, name, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?)')
    .bind(id, body.name.trim(), now, now, newId()).run();
  return c.json(responseProject((await findProject(c, id))!), 201);
});

app.patch('/api/projects/:id', async (c) => {
  const id = pathId(c, 'project');
  const body = await payload(c);
  const expected = revision(body.revision);
  requiredString(body.name, 'name', 300);
  const saved = await c.env.DB.prepare('UPDATE projects SET name = ?, updated_at = ?, revision = ? WHERE id = ? AND revision = ? RETURNING id')
    .bind(body.name.trim(), new Date().toISOString(), newId(), id, expected).first<{ id: string }>();
  const current = await findProject(c, id);
  if (!current) return missingProject(c);
  if (!saved) return c.json({ error: 'revision_conflict', message: 'This project changed. Load the current version before saving.', ...responseProject(current) }, 409);
  return c.json(responseProject(current));
});

app.get('/api/designs', async (c) => {
  const params = new URL(c.req.url).searchParams;
  const clauses: string[] = [];
  const values: string[] = [];
  for (const key of ['projectId', 'kind']) {
    if (params.getAll(key).length > 1) throw new InvalidInput(`${key} must be specified once`);
  }
  if (params.has('projectId')) {
    const filter = params.get('projectId');
    if (filter === 'unassigned') clauses.push('project_id IS NULL');
    else {
      const id = projectId(filter)!;
      if (!await findProject(c, id)) return missingProject(c);
      clauses.push('project_id = ?'); values.push(id);
    }
  }
  if (params.has('kind')) { clauses.push('kind = ?'); values.push(designKind(params.get('kind'))); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const { results } = await c.env.DB.prepare(`SELECT * FROM designs${where} ORDER BY updated_at DESC, id`).bind(...values).all<DesignRow>();
  return c.json({ designs: results.map((row) => {
    const { state } = responseState(row);
    return { id: row.id, title: row.title, ...libraryMetadata(row), favorite: Boolean(row.favorite), updatedAt: row.updated_at, variantCount: state.variants.length, selectedId: state.selectedId ?? null, revision: row.revision, preview: preview(state) };
  }) });
});

app.post('/api/designs', async (c) => {
  const body = await payload(c);
  const state = structuredClone(validateSession(body.state));
  const assignedProject = 'projectId' in body ? projectId(body.projectId) : null;
  const kind = 'kind' in body ? designKind(body.kind) : 'screen';
  if (assignedProject !== null && !await findProject(c, assignedProject)) return missingProject(c);
  if ('title' in body) { requiredString(body.title, 'title', 300); state.title = body.title; }
  state.id = newId();
  const nextRevision = newId();
  const now = new Date().toISOString();
  await c.env.DB.prepare('INSERT INTO designs (id, title, state_json, favorite, created_at, updated_at, revision, project_id, kind) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)')
    .bind(state.id, state.title, serialized(state), now, now, nextRevision, assignedProject, kind).run();
  return c.json({ id: state.id, url: `/designs/${state.id}`, revision: nextRevision }, 201);
});

app.get('/api/designs/:id/state', async (c) => {
  const row = await findRow(c, pathId(c));
  return row ? c.json(responseState(row)) : missing(c);
});

async function saveState(c: AppContext, source: boolean) {
  const id = pathId(c);
  const body = await payload(c);
  const expected = revision(body.revision);
  const row = await findRow(c, id);
  if (!row) return missing(c);
  if (row.revision !== expected) return conflict(c, id);
  const current = responseState(row).state;
  const state = source ? structuredClone(validateSession(body.state)) : mergeMutable(current, body.state);
  state.id = id;
  const nextRevision = newId();
  const saved = await c.env.DB.prepare('UPDATE designs SET title = ?, state_json = ?, updated_at = ?, revision = ? WHERE id = ? AND revision = ? RETURNING *')
    .bind(state.title, serialized(state), new Date().toISOString(), nextRevision, id, expected).first<DesignRow>();
  return saved ? c.json(responseState(saved)) : conflict(c, id);
}
app.post('/api/designs/:id/state', (c) => saveState(c, false));
app.put('/api/designs/:id/source', (c) => saveState(c, true));

app.patch('/api/designs/:id/metadata', async (c) => {
  const id = pathId(c);
  const body = await payload(c);
  const expected = revision(body.revision);
  const assignedProject = projectId(body.projectId);
  const kind = designKind(body.kind);
  const current = await findRow(c, id);
  if (!current) return missing(c);
  if (current.revision !== expected) return conflict(c, id);
  if (assignedProject !== null && !await findProject(c, assignedProject)) return missingProject(c);
  const saved = await c.env.DB.prepare('UPDATE designs SET project_id = ?, kind = ?, updated_at = ?, revision = ? WHERE id = ? AND revision = ? RETURNING *')
    .bind(assignedProject, kind, new Date().toISOString(), newId(), id, expected).first<DesignRow>();
  return saved ? c.json({ id, revision: saved.revision, ...libraryMetadata(saved) }) : conflict(c, id);
});

app.post('/api/designs/:id/favorite', async (c) => {
  const id = pathId(c);
  const body = await payload(c);
  const expected = revision(body.revision);
  if (typeof body.favorite !== 'boolean') throw new InvalidInput('favorite must be a boolean');
  const nextRevision = newId();
  const saved = await c.env.DB.prepare('UPDATE designs SET favorite = ?, updated_at = ?, revision = ? WHERE id = ? AND revision = ? RETURNING *')
    .bind(Number(body.favorite), new Date().toISOString(), nextRevision, id, expected).first<DesignRow>();
  return saved ? c.json({ id, revision: saved.revision, favorite: Boolean(saved.favorite) }) : conflict(c, id);
});

app.post('/api/designs/:id/duplicate', async (c) => {
  const id = pathId(c);
  const body = await payload(c);
  const expected = revision(body.revision);
  const row = await findRow(c, id);
  if (!row) return missing(c);
  if (row.revision !== expected) return conflict(c, id);
  const state = responseState(row).state;
  if ('title' in body) { requiredString(body.title, 'title', 300); state.title = body.title; }
  else state.title = `${Array.from(state.title).slice(0, 295).join('')} のコピー`;
  state.id = newId();
  const nextRevision = newId();
  const now = new Date().toISOString();
  // The conditional INSERT ties this snapshot to the exact source revision.
  const saved = await c.env.DB.prepare('INSERT INTO designs (id, title, state_json, favorite, created_at, updated_at, revision, project_id, kind) SELECT ?, ?, ?, 0, ?, ?, ?, project_id, kind FROM designs WHERE id = ? AND revision = ? RETURNING id')
    .bind(state.id, state.title, serialized(state), now, now, nextRevision, id, expected).first<{ id: string }>();
  return saved ? c.json({ id: saved.id, url: `/designs/${saved.id}`, revision: nextRevision }, 201) : conflict(c, id);
});

registerKitRoutes(app, { payload, revision, newId, findProject, responseProject });
app.all('/api/*', (c) => c.json({ error: 'not_found', message: 'API route not found.' }, 404));
app.get('/projects/:id', async (c) => {
  if (!await findProject(c, pathId(c, 'project'))) return missingProject(c);
  const url = new URL(c.req.url);
  url.pathname = '/index.html';
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
});
app.get('/designs/:id', async (c) => {
  if (!await findRow(c, pathId(c))) return missing(c);
  const url = new URL(c.req.url);
  url.pathname = '/workbench/index.html';
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
});
app.get('*', (c) => {
  const url = new URL(c.req.url);
  if (url.pathname === '/' || url.pathname === '/unassigned') url.pathname = '/index.html';
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
});
app.onError((error, c) => {
  if (error instanceof InvalidInput) return c.json({ error: 'invalid_payload', message: error.message }, 400);
  console.error(JSON.stringify({ event: 'library_request_failed', name: error.name }));
  return c.json({ error: 'internal_error', message: 'The library could not complete this request.' }, 500);
});

export default app;
