// Isolated real-D1 + standalone servers for managed-browser i18n QA.
// Run after npm run prepare-assets, with TMPDIR pointing at owned scratch.
import { build } from 'esbuild';
import { readFile, readdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const directory = await mkdtemp(join(tmpdir(), 'codex-i18n-'));
const output = join(directory, 'worker.mjs');
await build({ entryPoints: ['src/index.ts'], outfile: output, bundle: true, format: 'esm', target: 'es2022', platform: 'browser' });
const assets = resolve('.generated');
const options = convertV4MiniflareOptions({
  name: 'i18n-browser-test', modules: true, script: await readFile(output, 'utf8'),
  compatibilityDate: '2026-09-10', compatibilityFlags: ['nodejs_compat'],
  bindings: { LOCAL_ONLY: 'true' }, d1Databases: { DB: 'i18n-browser-test' }, host: '127.0.0.1', port: 0,
  serviceBindings: { ASSETS: async request => {
    const pathname = new URL(request.url).pathname;
    const file = resolve(assets, `.${pathname}`);
    if (!file.startsWith(assets + sep)) return new Response('Not found', { status: 404 });
    try {
      return new Response(await readFile(file), { headers: {
        'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      } });
    } catch { return new Response('Not found', { status: 404 }); }
  } },
});
options.resourcePersistencePath = join(directory, 'd1');
options.logRequests = false;
const mf = new Miniflare(options);
let standalone;
async function stop() { standalone?.kill('SIGTERM'); await mf.dispose(); process.exit(0); }
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
try {
  const db = await mf.getD1Database('DB');
  for (const file of (await readdir('migrations')).filter(file => file.endsWith('.sql')).sort()) {
    await db.batch((await readFile(join('migrations', file), 'utf8')).split(';').filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  }
  const url = (await mf.ready).origin;
  async function post(path, body) {
    const response = await mf.dispatchFetch(new URL(path, url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return response.json();
  }
  const project = await post('/api/projects', { name: '読書 / Reading' });
  const emptyProject = await post('/api/projects', { name: 'Empty / 空のプロジェクト' });
  const state = JSON.parse(await readFile('tests/fixtures/project-component.json', 'utf8'));
  const component = await post('/api/designs', { state, projectId: project.id, kind: 'component' });
  const screen = await post('/api/designs', { state: { ...state, title: 'Reading screen / 読書画面' }, kind: 'screen' });
  const prepared = await post('/api/kits/prepare', { name: '読書キット / Reading kit', sources: [{ designId: component.id, variantId: 'A', revision: component.revision }], locale: 'en' });
  const kit = await post('/api/kits', { content: prepared.content, locale: 'en' });
  await post(`/api/kits/${kit.id}/versions`, { revision: kit.revision, content: { ...prepared.content, description: 'Second version / 第2版' }, summary: 'Spacing study' });
  const session = join(directory, 'standalone');
  execFileSync('python3', ['skills/design-workbench/scripts/init_session.py', '--output', session]);
  standalone = spawn('python3', ['-u', '-c', 'import sys;sys.path.insert(0,"skills/design-workbench/scripts");from serve import create_server;from pathlib import Path;s=create_server(Path(sys.argv[1]),0);print(s.server_address[1],flush=True);s.serve_forever()', session], { stdio: ['ignore', 'pipe', 'inherit'] });
  const standalonePort = await new Promise((resolvePort, reject) => {
    standalone.stdout.once('data', data => resolvePort(Number(String(data).trim())));
    standalone.once('error', reject);
    standalone.once('exit', code => reject(new Error(`Standalone exited: ${code}`)));
  });
  const fixture = { url, standalone: `http://127.0.0.1:${standalonePort}`, project: project.id, emptyProject: emptyProject.id, component: component.id, screen: screen.id, kit: kit.id, directory };
  await writeFile(join(directory, 'fixture.json'), JSON.stringify(fixture, null, 2));
  console.log(JSON.stringify(fixture));
} catch (error) { standalone?.kill('SIGTERM'); await mf.dispose(); throw error; }
