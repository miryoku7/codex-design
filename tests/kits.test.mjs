import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

function fixture() {
  const tokens = { accent: '#345678', background: '#ffffff', text: '#123456', spacing: 24, fontSize: 16, radius: 8 };
  return {
    version: 1, id: 'source', title: 'キットの元', brief: { purpose: '', audience: '', platform: '', mood: '', avoid: '' },
    selectedId: 'B', viewport: { width: 720, height: 600, preset: 'custom' },
    variants: ['A', 'B'].map((id) => ({
      id, name: `案${id}`, rationale: '保存した実例', html: `<main style="padding:var(--spacing)">${id}</main>`, css: 'main{color:var(--accent);font-size:var(--heading-size)}',
      tokens: { ...tokens, spacing: id === 'A' ? 36 : 40 }, baselineTokens: { ...tokens },
      tweaks: [
        { id: 'heading', label: '見出しサイズ', type: 'range', min: 10, max: 80, default: 24, unit: 'px', cssVar: '--heading-size' },
        { id: 'opacity', label: '濃度', type: 'range', min: 0, max: 1, step: 0.1, default: 0.5, cssVar: '--opacity' },
        { id: 'art', label: '図の表示', type: 'toggle', default: true, attribute: 'data-art' },
        { id: 'ink', label: '見出し色', type: 'color', default: '#aabbcc', cssVar: '--heading-color' },
        { id: 'font', label: '書体', type: 'select', default: 'serif', cssVar: '--title-font-family', options: [{ value: 'serif', label: '明朝' }, { value: 'sans-serif', label: 'ゴシック' }] },
      ],
      tweakValues: { heading: 56, opacity: 0.8, art: false, ink: '#fedcba', font: 'sans-serif' },
      baselineTweakValues: { heading: 32, opacity: 0.5, art: true, ink: '#abcdef', font: 'serif' }, notes: `残すメモ${id}`,
    })),
  };
}

test('versioned Design Kits preserve source snapshots, immutable versions and explicit project pins in real D1', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-kits-test-'));
  const scriptPath = join(directory, 'worker.mjs');
  await build({ entryPoints: ['src/index.ts'], outfile: scriptPath, bundle: true, format: 'esm', target: 'es2022', platform: 'browser' });
  const options = convertV4MiniflareOptions({
    name: 'kits-test', modules: true, script: await readFile(scriptPath, 'utf8'), compatibilityDate: '2026-09-10', compatibilityFlags: ['nodejs_compat'],
    bindings: { LOCAL_ONLY: 'true' }, d1Databases: { DB: 'kits-test' }, host: '127.0.0.1', port: 0,
    serviceBindings: { ASSETS: async (request) => {
      const path = new URL(request.url).pathname;
      if (['/workbench/preview.js', '/workbench/legacy-v1.css'].includes(path)) return new Response(await readFile(`skills/design-workbench/assets${path}`, 'utf8'));
      return new Response(`asset:${path}`);
    } },
  });
  options.resourcePersistencePath = join(directory, 'd1');
  const mf = new Miniflare(options);
  const db = await mf.getD1Database('DB');
  async function request(method, path, body) {
    const response = await mf.dispatchFetch(new URL(path, await mf.ready), { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  const createDesign = async (state = fixture(), kind = 'screen') => (await request('POST', '/api/designs', { state, kind })).body;
  const recipe = (design, variantId = 'A') => ({ sources: [{ designId: design.id, variantId, revision: design.revision }] });
  const prepare = async (design, variantId = 'A') => (await request('POST', '/api/kits/prepare', recipe(design, variantId))).body.content;
  const allDesigns = () => db.prepare('SELECT * FROM designs ORDER BY id').all();
  try {
    const migrations = (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort();
    const apply = async (file) => db.batch((await readFile(join('migrations', file), 'utf8')).split(';').filter((sql) => sql.trim()).map((sql) => db.prepare(sql)));
    await apply(migrations[0]); await apply(migrations[1]);
    await db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?)').bind('old-project', '以前のプロジェクト', 'created', 'updated', 'b'.repeat(32)).run();
    await db.prepare('INSERT INTO designs (id,title,state_json,favorite,created_at,updated_at,revision,project_id,kind) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)')
      .bind('old-design', '旧作品', `${JSON.stringify(fixture(), null, 2)}\n`, 'created', 'updated', 'a'.repeat(32), 'old-project', 'component').run();
    const oldProjects = (await db.prepare('SELECT * FROM projects').all()).results;
    const oldDesigns = (await allDesigns()).results;
    for (const migration of migrations.slice(2)) await apply(migration);

    await t.test('migration adds separate tables without changing any prior design or project columns', async () => {
      assert.deepEqual((await allDesigns()).results, oldDesigns);
      assert.deepEqual((await db.prepare('SELECT * FROM projects').all()).results, oldProjects);
      assert.equal((await request('GET', '/api/projects')).body.projects[0].kit, null);
      assert.deepEqual((await request('GET', '/api/projects/old-project/kit')).body, { projectId: 'old-project', kit: null });
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
    });

    const design = await createDesign();
    const component = await createDesign(fixture(), 'component');
    let content;
    await t.test('prepare uses explicit variants and current values, preserves reset, attributes, notes and provenance, and performs no writes', async () => {
      const before = (await allDesigns()).results;
      const response = await request('POST', '/api/kits/prepare', { name: '記録のキット', sources: [...recipe(design).sources, ...recipe(component, 'B').sources] });
      assert.equal(response.status, 200);
      content = response.body.content;
      const source = (await request('GET', `/api/designs/${design.id}/state`)).body.state;
      assert.equal(content.name, '記録のキット');
      assert.deepEqual(content.examples.map((item) => [item.source.variantId, item.kind]), [['A', 'screen'], ['B', 'component']]);
      assert.deepEqual(content.examples[0].source, recipe(design).sources[0]);
      assert.deepEqual(content.examples[0].variant, source.variants[0]);
      assert.deepEqual(content.examples[0].viewport, source.viewport);
      assert.equal(content.tokens.find((item) => item.name === 'spacing').value, '36px');
      assert.equal(content.tokens.find((item) => item.name === 'heading-size').value, '56px');
      assert.equal(content.tokens.find((item) => item.name === 'opacity').value, 0.8);
      assert.equal(content.tokens.find((item) => item.name === 'heading-color').value, '#fedcba');
      assert.equal(content.tokens.find((item) => item.name === 'title-font-family').value, 'sans-serif');
      assert.ok(!content.tokens.some((item) => item.name === 'art'));
      assert.deepEqual((await allDesigns()).results, before);
      assert.deepEqual((await request('GET', '/api/kits')).body, { kits: [] });
      for (const bad of [{ sources: [] }, { sources: [{ designId: design.id, revision: design.revision }] }, { sources: [recipe(design).sources[0], recipe(design).sources[0]] }]) assert.equal((await request('POST', '/api/kits/prepare', bad)).status, 400);
      assert.equal((await request('POST', '/api/kits/prepare', recipe(design, 'missing'))).status, 404);
      assert.equal((await request('POST', '/api/kits/prepare', { sources: [{ ...recipe(design).sources[0], designId: 'missing' }] })).status, 404);
      const stale = await request('POST', '/api/kits/prepare', { sources: [recipe(design).sources[0], { ...recipe(component).sources[0], revision: '0'.repeat(32) }] });
      assert.equal(stale.status, 409);
      assert.equal(stale.body.designId, component.id);
      assert.equal((await request('POST', '/api/kits/prepare', { sources: [{ ...recipe(design).sources[0], variantId: 'missing' }, { ...recipe(component).sources[0], revision: '0'.repeat(32) }] })).status, 409);
      assert.deepEqual((await request('GET', '/api/kits')).body, { kits: [] });
    });

    let kit; let pinned;
    const project = (await request('POST', '/api/projects', { name: '利用先' })).body;
    await t.test('create version 1 and pin a project without touching source designs', async () => {
      const before = (await allDesigns()).results;
      const response = await request('POST', '/api/kits', { content });
      assert.equal(response.status, 201); kit = response.body;
      assert.equal(kit.latestVersion, 1); assert.equal(kit.versions.length, 1);
      assert.deepEqual(kit.content, content);
      const result = await request('PATCH', `/api/projects/${project.id}/kit`, { revision: project.revision, kitId: kit.id, version: 1 });
      assert.equal(result.status, 200); pinned = result.body;
      assert.deepEqual(pinned.kit, { kitId: kit.id, version: 1 });
      assert.notEqual(pinned.revision, project.revision);
      assert.deepEqual((await request('GET', `/api/projects/${project.id}/kit`)).body, { projectId: project.id, kit: { kitId: kit.id, version: 1, content } });
      assert.deepEqual((await allDesigns()).results, before);
    });

    await t.test('concurrent version writers have one winner, no orphan version, old content bytes and project v1 pin remain unchanged', async () => {
      const before = await db.prepare('SELECT * FROM design_kit_versions WHERE kit_id = ? AND version = 1').bind(kit.id).first();
      const beforeDesigns = (await allDesigns()).results;
      const outcomes = await Promise.all(['#ff0000', '#0000ff'].map((color) => {
        const next = structuredClone(content); next.tokens[0].value = color; next.rules = '新しい余白と構成のルール';
        return request('POST', `/api/kits/${kit.id}/versions`, { revision: kit.revision, content: next, summary: `強調色を${color}へ` });
      }));
      assert.deepEqual(outcomes.map((result) => result.status).sort(), [201, 409]);
      kit = outcomes.find((result) => result.status === 201).body;
      assert.equal(kit.latestVersion, 2); assert.equal(kit.versions.length, 2);
      assert.equal(outcomes.find((result) => result.status === 409).body.revision, kit.revision);
      assert.deepEqual(await db.prepare('SELECT * FROM design_kit_versions WHERE kit_id = ? AND version = 1').bind(kit.id).first(), before);
      assert.deepEqual((await request('GET', `/api/kits/${kit.id}/versions/1`)).body.content, content);
      assert.deepEqual((await request('GET', `/api/projects/${project.id}/kit`)).body.kit, { kitId: kit.id, version: 1, content });
      assert.deepEqual((await allDesigns()).results, beforeDesigns);
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM design_kit_versions WHERE kit_id = ?').bind(kit.id).first()).n, 2);
      assert.equal((await request('PUT', `/api/kits/${kit.id}/versions/1`, { content })).status, 404);
      assert.equal((await request('DELETE', `/api/kits/${kit.id}/versions/1`)).status, 404);
    });

    await t.test('pin switching and clearing are conditional; cross-kit or invalid version pairs are refused', async () => {
      const second = (await request('POST', '/api/kits', { content })).body;
      const original = (await request('GET', `/api/projects/${project.id}/kit`)).body;
      const designsBefore = (await allDesigns()).results;
      for (const selection of [{ kitId: null, version: 1 }, { kitId: kit.id, version: null }, { kitId: '../bad', version: 1 }, { kitId: kit.id, version: 0 }, { kitId: kit.id, version: '1' }]) {
        assert.equal((await request('PATCH', `/api/projects/${project.id}/kit`, { revision: pinned.revision, ...selection })).status, 400);
      }
      assert.equal((await request('PATCH', `/api/projects/${project.id}/kit`, { revision: pinned.revision, kitId: second.id, version: 2 })).status, 404);
      assert.equal((await request('PATCH', `/api/projects/${project.id}/kit`, { revision: project.revision, kitId: kit.id, version: 2 })).status, 409);
      assert.deepEqual((await request('GET', `/api/projects/${project.id}/kit`)).body, original);
      await assert.rejects(db.prepare('UPDATE project_kits SET kit_id = ?, version = 2 WHERE project_id = ?').bind(second.id, project.id).run(), /FOREIGN KEY/);
      const switched = await request('PATCH', `/api/projects/${project.id}/kit`, { revision: pinned.revision, kitId: second.id, version: 1 });
      assert.equal(switched.status, 200);
      const concurrent = await Promise.all([
        request('PATCH', `/api/projects/${project.id}/kit`, { revision: switched.body.revision, kitId: null, version: null }),
        request('PATCH', `/api/projects/${project.id}`, { revision: switched.body.revision, name: '同時更新' }),
      ]);
      assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);
      const current = (await request('GET', '/api/projects')).body.projects.find((item) => item.id === project.id);
      const cleared = await request('PATCH', `/api/projects/${project.id}/kit`, { revision: current.revision, kitId: null, version: null });
      assert.equal(cleared.status, 200); assert.equal(cleared.body.kit, null);
      assert.equal((await request('GET', `/api/projects/${project.id}/kit`)).body.kit, null);
      assert.deepEqual((await allDesigns()).results, designsBefore);
    });

    await t.test('token scalars, source provenance and complete examples are validated before any version write', async () => {
      const before = await db.prepare('SELECT * FROM design_kit_versions ORDER BY kit_id, version').all();
      const invalid = [
        (copy) => { copy.tokens[0].value = '#fff; } body {color:red'; },
        (copy) => { copy.tokens[0].value = 'url(https://example.com)'; },
        (copy) => { copy.tokens[0].name = '--color'; },
        (copy) => { copy.tokens[0].name = 'ink\n'; },
        (copy) => { copy.tokens.push(copy.tokens[0]); },
        (copy) => { copy.tokens[0] = { name: 'size', type: 'dimension', value: 'calc(1px + 2px)', description: '' }; },
        (copy) => { copy.tokens[0] = { name: 'family', type: 'fontFamily', value: 'serif; color:red', description: '' }; },
        (copy) => { copy.tokens[0] = { name: 'n', type: 'number', value: '1e400', description: '' }; },
        (copy) => { copy.examples[0].id = '../escape'; },
        (copy) => { copy.examples[0].source.variantId = 'C'; },
        (copy) => { copy.examples[0].source.revision = 'stale'; },
        (copy) => { delete copy.examples[0].viewport; },
        (copy) => { copy.examples[0].variant.tweakValues.heading = 100; },
        (copy) => { copy.examples = []; },
      ];
      for (const mutate of invalid) {
        const copy = structuredClone(content); mutate(copy);
        assert.equal((await request('POST', `/api/kits/${kit.id}/versions`, { revision: kit.revision, content: copy, summary: 'invalid' })).status, 400);
      }
      assert.deepEqual(await db.prepare('SELECT * FROM design_kit_versions ORDER BY kit_id, version').all(), before);
      const expanded = structuredClone(content);
      expanded.tokens.push({ name: 'font-family', type: 'fontFamily', value: '"Hiragino Sans", sans-serif', description: '日本語フォント' });
      assert.equal((await request('POST', '/api/kits', { content: expanded })).status, 201);
    });

    await t.test('export includes portable provenance, matching token overlay and a hash-CSP viewer with sandboxed author content', async () => {
      const hostile = structuredClone(content);
      hostile.examples[0].variant.html = '<html style="--accent:#000000"><head><style>main {color:var(--accent)}</style></head><body><main>Preview</main><script>window.AUTHOR_RAN=true</script><img src=x onerror="alert(1)"></body></html>';
      hostile.tokens[0].value = '#abcdef';
      const saved = (await request('POST', '/api/kits', { content: hostile })).body;
      const exported = await request('GET', `/api/kits/${saved.id}/versions/1/export`);
      assert.equal(exported.status, 200);
      const files = new Map(exported.body.files.map((file) => [file.path, file.content]));
      const manifest = JSON.parse(files.get('kit.json'));
      assert.equal(manifest.format, 'codex-design-kit'); assert.equal(manifest.version, 1); assert.equal(manifest.kitId, saved.id);
      assert.deepEqual(manifest.content, hostile);
      assert.match(files.get('tokens.css'), /--accent: #abcdef;/);
      assert.match(files.get('GUIDE.md'), new RegExp(design.revision));
      assert.deepEqual(JSON.parse(files.get('examples/example-1/variant.json')), hostile.examples[0]);
      const html = files.get('examples/example-1/preview.html');
      assert.match(html, /<iframe sandbox=""/);
      assert.ok(!html.includes('<script>window.AUTHOR_RAN'));
      const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
      const hash = createHash('sha256').update(script).digest('base64');
      assert.ok(html.includes(`script-src 'sha256-${hash}'`));
      assert.match(script, /frameDocument\(example.variant, .*tokens\)/s);
      assert.match(script, /function sanitizeTree/);
      assert.ok([...files.keys()].every((path) => !path.includes('..') && !path.startsWith('/')));
      const roundtrip = await request('POST', '/api/kits', { content: manifest.content });
      assert.equal(roundtrip.status, 201);
      assert.deepEqual(roundtrip.body.content, hostile);
      assert.notEqual(roundtrip.body.id, saved.id);
      assert.equal((await request('GET', `/api/kits/${saved.id}/versions/2/export`)).status, 404);
      assert.equal(await (await mf.dispatchFetch(new URL('/kits', await mf.ready))).text(), 'asset:/kits.html');
      assert.equal(await (await mf.dispatchFetch(new URL(`/kits/${saved.id}`, await mf.ready))).text(), 'asset:/kits.html');
    });
  } finally {
    await mf.dispose(); await rm(directory, { recursive: true, force: true });
  }
});
