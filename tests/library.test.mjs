import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { execFileSync } from 'node:child_process';

const tokens = { accent: '#345678', background: '#ffffff', text: '#123456', spacing: 24, fontSize: 16, radius: 8 };
const definitions = [
  { id: 'size', label: '見出し', type: 'range', default: 32, min: 24, max: 48, step: 1, cssVar: '--heading-size', unit: 'px' },
  { id: 'color', label: '色', type: 'color', default: '#abcdef', cssVar: '--heading-color' },
  { id: 'density', label: '余白', type: 'select', default: 'wide', attribute: 'data-density', options: [{ value: 'wide', label: '広い' }, { value: 'compact', label: '狭い' }] },
  { id: 'art', label: '図', type: 'toggle', default: true, attribute: 'data-art' },
];
function fixture() {
  return {
    version: 1, id: 'source-session', title: '記録のデザイン',
    brief: { purpose: '読む', audience: '個人', platform: 'web', mood: '', avoid: '' },
    selectedId: 'B', view: { mode: 'focus', activeId: 'A' }, viewport: { width: 390, height: 760, preset: 'mobile' },
    designer: { model: 'gpt-6-astra', role: 'design-author' },
    variants: ['A', 'B'].map((id) => ({
      id, name: `案${id}`, rationale: '構成を比べる', html: `<main><h1>${id}</h1></main>`, css: 'main { color: var(--accent) }',
      tokens: { ...tokens, spacing: 28 }, baselineTokens: { ...tokens }, tweaks: structuredClone(definitions),
      tweakValues: { size: 40, color: '#fedcba', density: 'compact', art: false },
      baselineTweakValues: { size: 32, color: '#abcdef', density: 'wide', art: true }, notes: `残したいメモ${id}`,
    })),
  };
}

test('library API uses persistent local D1 and conditional SQL writes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-library-test-'));
  const scriptPath = join(directory, 'worker.mjs');
  await build({ entryPoints: ['src/index.ts'], outfile: scriptPath, bundle: true, format: 'esm', target: 'es2022', platform: 'browser' });
  const options = convertV4MiniflareOptions({
    name: 'library-test', modules: true, script: await readFile(scriptPath, 'utf8'), compatibilityDate: '2026-09-10', compatibilityFlags: ['nodejs_compat'],
    bindings: { LOCAL_ONLY: 'true' }, d1Databases: { DB: 'test-library' }, host: '127.0.0.1', port: 0,
  });
  // Miniflare 5 stores all resources beneath one explicit persistence directory.
  options.resourcePersistencePath = join(directory, 'd1');
  let mf = new Miniflare(options);
  async function request(method, path, payload, headers = {}) {
    const result = await mf.dispatchFetch(new URL(path, await mf.ready), {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      ...(payload === undefined ? {} : { body: typeof payload === 'string' ? payload : JSON.stringify(payload) }),
    });
    return { status: result.status, body: await result.json(), headers: result.headers };
  }
  const create = (state = fixture(), metadata = {}) => request('POST', '/api/designs', { state, ...metadata });
  const read = (id) => request('GET', `/api/designs/${id}/state`);
  try {
    const database = await mf.getD1Database('DB');
    const migrations = (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort();
    const applyMigration = async (filename) => {
      const sql = await readFile(join('migrations', filename), 'utf8');
      await database.batch(sql.split(';').filter((statement) => statement.trim()).map((statement) => database.prepare(statement)));
    };
    await applyMigration(migrations[0]);
    const legacy = { ...fixture(), id: 'legacy-design' };
    const legacyJson = `${JSON.stringify(legacy, null, 2)}\n`;
    await database.prepare('INSERT INTO designs (id, title, state_json, favorite, created_at, updated_at, revision) VALUES (?, ?, ?, 1, ?, ?, ?)')
      .bind(legacy.id, legacy.title, legacyJson, '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z', 'a'.repeat(32)).run();
    const legacyBefore = await database.prepare('SELECT * FROM designs WHERE id = ?').bind(legacy.id).first();
    for (const filename of migrations.slice(1)) await applyMigration(filename);

    await t.test('additive migrations preserve populated legacy snapshots byte-for-byte and leave them unassigned', async () => {
      const after = await database.prepare('SELECT * FROM designs WHERE id = ?').bind(legacy.id).first();
      assert.deepEqual(after, { ...legacyBefore, project_id: null, kind: 'screen' });
      const loaded = await read(legacy.id);
      assert.deepEqual(loaded.body, { state: legacy, revision: legacyBefore.revision, library: { projectId: null, kind: 'screen' } });
      assert.deepEqual((await request('GET', '/api/projects')).body, { projects: [] });
      assert.equal((await request('GET', '/api/designs?projectId=unassigned&kind=screen')).body.designs[0].id, legacy.id);
      assert.equal((await database.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
      await assert.rejects(database.prepare("UPDATE designs SET project_id = 'missing' WHERE id = ?").bind(legacy.id).run(), /FOREIGN KEY/);
      await assert.rejects(database.prepare("UPDATE designs SET kind = 'unknown' WHERE id = ?").bind(legacy.id).run(), /CHECK/);
    });

    await t.test('projects include empty projects, rename conditionally, and count and filter screens/components independently', async () => {
      const empty = await request('POST', '/api/projects', { name: ' 空のプロジェクト ' });
      assert.equal(empty.status, 201);
      assert.equal(empty.body.name, '空のプロジェクト');
      assert.match(empty.body.id, /^[0-9a-f]{32}$/);
      assert.deepEqual([empty.body.designCount, empty.body.screenCount, empty.body.componentCount], [0, 0, 0]);
      const project = (await request('POST', '/api/projects', { name: '記録アプリ' })).body;
      const screen = (await create(fixture(), { projectId: project.id })).body;
      const component = (await create(fixture(), { projectId: project.id, kind: 'component' })).body;
      const unassigned = (await create(fixture(), { kind: 'component' })).body;
      const listed = (await request('GET', '/api/projects')).body.projects;
      const counted = listed.find((row) => row.id === project.id);
      assert.deepEqual([counted.designCount, counted.screenCount, counted.componentCount], [2, 1, 1]);
      assert.equal(listed.find((row) => row.id === empty.body.id).designCount, 0);
      assert.equal((await request('GET', `/api/designs?projectId=${empty.body.id}`)).body.designs.length, 0);
      const all = (await request('GET', `/api/designs?projectId=${project.id}`)).body.designs;
      assert.deepEqual(all.map((row) => row.id).sort(), [screen.id, component.id].sort());
      assert.ok(all.every((row) => row.projectId === project.id));
      assert.equal((await request('GET', `/api/designs?projectId=${project.id}&kind=screen`)).body.designs[0].id, screen.id);
      assert.equal((await request('GET', `/api/designs?projectId=${project.id}&kind=component`)).body.designs[0].id, component.id);
      assert.ok((await request('GET', '/api/designs?projectId=unassigned&kind=component')).body.designs.some((row) => row.id === unassigned.id));
      assert.ok((await request('GET', '/api/designs?kind=component')).body.designs.every((row) => row.kind === 'component'));
      const renamed = await request('PATCH', `/api/projects/${project.id}`, { name: '新しい名前', revision: project.revision });
      assert.equal(renamed.status, 200);
      assert.notEqual(renamed.body.revision, project.revision);
      assert.equal(renamed.body.createdAt, project.createdAt);
      assert.equal(renamed.body.designCount, 2);
      const stale = await request('PATCH', `/api/projects/${project.id}`, { name: '古い変更', revision: project.revision });
      assert.equal(stale.status, 409);
      assert.equal(stale.body.name, renamed.body.name);
      assert.equal(stale.body.revision, renamed.body.revision);
      assert.equal((await read(screen.id)).body.revision, screen.revision);
      assert.equal((await read(component.id)).body.revision, component.revision);
      const concurrent = await Promise.all(['one', 'two'].map((name) => request('PATCH', `/api/projects/${project.id}`, { name, revision: renamed.body.revision })));
      assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);
    });

    await t.test('metadata moves and unassigns atomically, duplicates retain it, and source/browser saves cannot overwrite it', async () => {
      const first = (await request('POST', '/api/projects', { name: '最初' })).body;
      const second = (await request('POST', '/api/projects', { name: '移動先' })).body;
      const created = (await create()).body;
      const initial = (await read(created.id)).body;
      const assigned = await request('PATCH', `/api/designs/${created.id}/metadata`, { revision: initial.revision, projectId: first.id, kind: 'component' });
      assert.equal(assigned.status, 200);
      assert.deepEqual(assigned.body, { id: created.id, revision: assigned.body.revision, projectId: first.id, kind: 'component' });
      assert.notEqual(assigned.body.revision, initial.revision);
      const current = (await read(created.id)).body;
      assert.deepEqual(current.state, initial.state);
      assert.deepEqual(current.library, { projectId: first.id, kind: 'component' });
      const stale = await request('PATCH', `/api/designs/${created.id}/metadata`, { revision: initial.revision, projectId: null, kind: 'screen' });
      assert.equal(stale.status, 409);
      assert.deepEqual(stale.body.library, current.library);
      assert.deepEqual(stale.body.state, current.state);
      assert.equal(stale.body.revision, current.revision);
      assert.equal((await request('PUT', `/api/designs/${created.id}/source`, { revision: initial.revision, state: initial.state })).status, 409);
      const duplicate = (await request('POST', `/api/designs/${created.id}/duplicate`, { revision: current.revision })).body;
      assert.deepEqual((await read(duplicate.id)).body.library, current.library);
      let latest = current;
      for (const [method, route] of [['POST', 'state'], ['PUT', 'source']]) {
        const state = structuredClone(latest.state);
        state.variants[0].notes = `Saved via ${route}`;
        const saved = await request(method, `/api/designs/${created.id}/${route}`, { revision: latest.revision, state, projectId: second.id, kind: 'screen', library: { projectId: null, kind: 'screen' } });
        assert.equal(saved.status, 200);
        assert.deepEqual(saved.body.library, current.library);
        assert.equal(saved.body.state.variants[0].notes, state.variants[0].notes);
        latest = saved.body;
      }
      const moved = await request('PATCH', `/api/designs/${created.id}/metadata`, { revision: latest.revision, projectId: second.id, kind: 'screen' });
      assert.equal(moved.status, 200);
      let counts = (await request('GET', '/api/projects')).body.projects;
      assert.equal(counts.find((row) => row.id === first.id).componentCount, 1);
      assert.equal(counts.find((row) => row.id === second.id).screenCount, 1);
      const unassigned = await request('PATCH', `/api/designs/${created.id}/metadata`, { revision: moved.body.revision, projectId: null, kind: 'component' });
      assert.equal(unassigned.status, 200);
      assert.deepEqual((await read(created.id)).body.library, { projectId: null, kind: 'component' });
      assert.deepEqual((await read(created.id)).body.state, latest.state);
      counts = (await request('GET', '/api/projects')).body.projects;
      assert.equal(counts.find((row) => row.id === second.id).designCount, 0);
      const concurrent = await Promise.all([
        request('PATCH', `/api/designs/${created.id}/metadata`, { revision: unassigned.body.revision, projectId: first.id, kind: 'screen' }),
        request('PUT', `/api/designs/${created.id}/source`, { revision: unassigned.body.revision, state: latest.state }),
      ]);
      assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);
      const conflictBody = concurrent.find((result) => result.status === 409).body;
      assert.deepEqual(conflictBody.library, (await read(created.id)).body.library);
      assert.equal(conflictBody.revision, (await read(created.id)).body.revision);
    });

    await t.test('invalid project ids, kinds, filters, and incomplete metadata are refused without writes', async () => {
      const created = (await create()).body;
      const initial = (await read(created.id)).body;
      for (const metadata of [{ projectId: 3 }, { projectId: '' }, { projectId: '../bad' }, { kind: null }, { kind: ['screen'] }, { kind: 'unknown' }]) {
        assert.equal((await create(fixture(), metadata)).status, 400);
      }
      assert.equal((await create(fixture(), { projectId: 'missing' })).status, 404);
      for (const query of ['projectId=', 'projectId=..%2Fbad', 'kind=', 'kind=unknown', 'projectId=unassigned&projectId=missing', 'kind=screen&kind=component']) {
        assert.equal((await request('GET', `/api/designs?${query}`)).status, 400);
      }
      assert.equal((await request('GET', '/api/designs?projectId=missing')).status, 404);
      for (const metadata of [{ projectId: null }, { kind: 'screen' }, { projectId: {}, kind: 'screen' }, { projectId: null, kind: false }]) {
        assert.equal((await request('PATCH', `/api/designs/${created.id}/metadata`, { revision: initial.revision, ...metadata })).status, 400);
      }
      assert.equal((await request('PATCH', `/api/designs/${created.id}/metadata`, { revision: initial.revision, projectId: 'missing', kind: 'component' })).status, 404);
      assert.deepEqual((await read(created.id)).body, initial);
      for (const name of ['', ' ', null, [], '名'.repeat(301)]) assert.equal((await request('POST', '/api/projects', { name })).status, 400);
      assert.equal((await request('PATCH', '/api/projects/missing', { name: '名前', revision: initial.revision })).status, 404);
      assert.equal((await request('PATCH', '/api/projects/%2Fbad', { name: '名前', revision: initial.revision })).status, 400);
    });
    await t.test('import gets a new portable identity; list chooses adopted, then active, then first preview', async () => {
      const original = fixture();
      const created = await create(original);
      assert.equal(created.status, 201);
      assert.match(created.body.id, /^[0-9a-f]{32}$/);
      assert.notEqual(created.body.id, original.id);
      const loaded = await read(created.body.id);
      assert.deepEqual(loaded.body.state, { ...original, id: created.body.id });
      const listed = await request('GET', '/api/designs');
      const row = listed.body.designs.find((row) => row.id === created.body.id);
      assert.equal(row.revision, created.body.revision);
      assert.equal(row.variantCount, 2);
      assert.equal(row.preview.variant.id, 'B');
      assert.deepEqual(row.preview.viewport, original.viewport);
      const noAdoption = fixture(); noAdoption.selectedId = null; noAdoption.view.activeId = 'B'; delete noAdoption.viewport;
      const second = await create(noAdoption);
      const noView = fixture(); noView.selectedId = null; delete noView.view;
      const third = await create(noView);
      const all = (await request('GET', '/api/designs')).body.designs;
      assert.equal(all.find((row) => row.id === second.body.id).preview.variant.id, 'B');
      assert.deepEqual(all.find((row) => row.id === second.body.id).preview.viewport, { width: 390, height: 760, preset: 'mobile' });
      assert.equal(all.find((row) => row.id === third.body.id).preview.variant.id, 'A');
      assert.equal(listed.headers.get('Cache-Control'), 'no-store');
    });

    await t.test('favorite persists over runtime restart and invalidates stale state/favorite/duplicate writes', async () => {
      const { body: created } = await create();
      const before = (await read(created.id)).body;
      const favorite = await request('POST', `/api/designs/${created.id}/favorite`, { favorite: true, revision: before.revision });
      assert.equal(favorite.status, 200);
      assert.notEqual(favorite.body.revision, before.revision);
      assert.deepEqual((await read(created.id)).body.state, before.state);
      await mf.dispose(); mf = new Miniflare(options);
      const row = (await request('GET', '/api/designs')).body.designs.find((row) => row.id === created.id);
      assert.equal(row.favorite, true);
      assert.equal(row.revision, favorite.body.revision);
      for (const [route, payload] of [
        ['favorite', { favorite: false, revision: before.revision }],
        ['state', { state: before.state, revision: before.revision }],
        ['duplicate', { revision: before.revision }],
      ]) {
        const conflict = await request('POST', `/api/designs/${created.id}/${route}`, payload);
        assert.equal(conflict.status, 409);
        assert.equal(conflict.body.error, 'revision_conflict');
        assert.equal(conflict.body.revision, row.revision);
        assert.deepEqual(conflict.body.state, before.state);
      }
    });

    await t.test('duplicate preserves source/reset/current/adoption/notes and remains independent', async () => {
      const { body: original } = await create();
      const before = (await read(original.id)).body;
      const duplicate = await request('POST', `/api/designs/${original.id}/duplicate`, { revision: before.revision, title: '別の作品' });
      assert.equal(duplicate.status, 201);
      assert.notEqual(duplicate.body.id, original.id);
      const copy = (await read(duplicate.body.id)).body;
      assert.deepEqual(copy.state, { ...before.state, id: duplicate.body.id, title: '別の作品' });
      assert.deepEqual((await read(original.id)).body, before);
      const changed = structuredClone(copy.state);
      changed.variants[0].tokens.spacing = 40;
      changed.variants[0].notes = '複製だけのメモ';
      changed.variants[0].html = 'Browser cannot edit author content';
      changed.variants[0].baselineTokens.spacing = 99;
      changed.variants[0].baselineTweakValues.size = 45;
      changed.variants[0].name = 'Browser cannot rename metadata';
      const saved = await request('POST', `/api/designs/${duplicate.body.id}/state`, { state: changed, revision: copy.revision });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.state.variants[0].tokens.spacing, 40);
      assert.equal(saved.body.state.variants[0].notes, '複製だけのメモ');
      assert.equal(saved.body.state.variants[0].html, copy.state.variants[0].html);
      assert.deepEqual(saved.body.state.variants[0].baselineTokens, copy.state.variants[0].baselineTokens);
      assert.deepEqual(saved.body.state.variants[0].baselineTweakValues, copy.state.variants[0].baselineTweakValues);
      assert.equal(saved.body.state.variants[0].name, copy.state.variants[0].name);
      assert.deepEqual((await read(original.id)).body, before);
      const longTitle = fixture(); longTitle.title = '🎨'.repeat(300);
      const long = (await create(longTitle)).body;
      const longCopy = await request('POST', `/api/designs/${long.id}/duplicate`, { revision: long.revision });
      assert.equal(longCopy.status, 201);
      assert.equal(Array.from((await read(longCopy.body.id)).body.state.title).length, 300);
    });

    await t.test('two concurrent saves result in one success and a conflict; SQL prevents silent overwrites', async () => {
      const { body: created } = await create();
      const before = (await read(created.id)).body;
      const outcomes = await Promise.all(['one', 'two'].map((note) => {
        const state = structuredClone(before.state); state.variants[0].notes = note;
        return request('POST', `/api/designs/${created.id}/state`, { state, revision: before.revision });
      }));
      assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), [200, 409]);
      const success = outcomes.find((outcome) => outcome.status === 200).body;
      const failure = outcomes.find((outcome) => outcome.status === 409).body;
      assert.deepEqual((await read(created.id)).body, success);
      assert.equal(failure.revision, success.revision);
      assert.deepEqual(failure.state, success.state);
    });

    await t.test('source replacement is explicit, conditional and validated', async () => {
      const { body: created } = await create();
      const before = (await read(created.id)).body;
      const authored = structuredClone(before.state);
      authored.variants[0].html = '<main>新しい制作</main>';
      authored.variants[0].baselineTokens.spacing = 20;
      const updated = await request('PUT', `/api/designs/${created.id}/source`, { state: authored, revision: before.revision });
      assert.equal(updated.status, 200);
      assert.deepEqual(updated.body.state, authored);
      assert.equal((await request('PUT', `/api/designs/${created.id}/source`, { state: before.state, revision: before.revision })).status, 409);
      const invalid = structuredClone(authored); invalid.variants[0].tweaks[0].max = 10;
      assert.equal((await request('PUT', `/api/designs/${created.id}/source`, { state: invalid, revision: updated.body.revision })).status, 400);
      assert.deepEqual((await read(created.id)).body, updated.body);
    });

    await t.test('schema matches Python control/type bounds and rejects source references, invalid JSON and oversized input', async () => {
      const invalidMutations = [
        (state) => { state.version = 2; },
        (state) => { state.variants[0].sources = { html: '../secret.html' }; },
        (state) => { state.variants[0].tokens.accent = 'red'; },
        (state) => { state.variants[0].html = 42; },
        (state) => { state.variants[0].css = 'a'.repeat(300001); },
        (state) => { state.variants[0].tweakValues.unknown = true; },
        (state) => { state.variants[0].tweakValues.size = 999; },
        (state) => { state.variants[0].tweaks[0].attribute = 'data-also'; },
        (state) => { state.variants[0].tweaks[0].step = null; },
        (state) => { state.variants[0].tweaks[0].unit = null; },
        (state) => { state.variants[0].tweaks = null; },
        (state) => { state.variants[0].notes = null; },
        (state) => { state.id += '\n'; },
        (state) => { state.variants[0].tokens.accent += '\n'; },
        (state) => { state.variants[0].tweaks[0].cssVar += '\n'; },
        (state) => { state.view.mode = ['focus']; },
        (state) => { state.viewport.preset = ['mobile']; },
        (state) => { state.selectedId = 'unknown'; },
        (state) => { state.viewport.width = 239; },
      ];
      const before = (await request('GET', '/api/designs')).body.designs.length;
      const invalidStates = invalidMutations.map((mutate) => { const state = fixture(); mutate(state); return state; });
      const pythonResult = execFileSync('python3', ['-c', [
        'import json, sys',
        'sys.path.insert(0, "skills/design-workbench/scripts")',
        'from serve import validate_session',
        'results = []',
        'for state in json.load(sys.stdin):',
        '    try:',
        '        validate_session(state)',
        '        results.append(True)',
        '    except ValueError:',
        '        results.append(False)',
        'print(json.dumps(results))',
      ].join('\n')], { input: JSON.stringify([fixture(), ...invalidStates]), encoding: 'utf8' });
      assert.deepEqual(JSON.parse(pythonResult), [true, ...invalidStates.map(() => false)]);
      for (const state of invalidStates) assert.equal((await create(state)).status, 400);
      assert.equal((await request('POST', '/api/designs', '{bad')).status, 400);
      assert.equal((await request('POST', '/api/designs', JSON.stringify({ state: fixture() }).replace('"version":1', '"extension":1e400,"version":1'))).status, 400);
      assert.equal((await request('POST', '/api/designs', ' '.repeat(1_500_001))).status, 400);
      assert.equal((await request('POST', '/api/designs', { state: fixture() }, { 'Content-Type': 'text/plain' })).status, 400);
      assert.equal((await request('GET', '/api/designs')).body.designs.length, before);
    });

    await t.test('foreign Origin, cross-site browser context and nonlocal Host are refused; missing ids return 404', async () => {
      assert.equal((await request('POST', '/api/designs', { state: fixture() }, { Origin: 'https://outside.example' })).status, 403);
      assert.equal((await request('POST', '/api/designs', { state: fixture() }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
      assert.equal((await mf.dispatchFetch('http://rebinding.example/api/designs')).status, 403);
      assert.equal((await request('GET', '/api/designs/missing/state')).status, 404);
      assert.equal((await request('GET', '/api/designs/%2Fetc/state')).status, 400);
      assert.equal((await request('POST', '/api/designs/missing/favorite', { favorite: true, revision: 'a'.repeat(32) })).status, 404);
    });
  } finally {
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
