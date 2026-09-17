/** Actual local D1 server owned only by test_library_cli.py. */
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const directory = process.argv[2];
if (!directory) throw new Error('A temporary test directory is required');
const scriptPath = join(directory, 'cli-worker.mjs');
await build({ entryPoints: ['src/index.ts'], outfile: scriptPath, bundle: true, format: 'esm', target: 'es2022', platform: 'browser' });
const options = convertV4MiniflareOptions({
  name: 'cli-test', modules: true, script: await readFile(scriptPath, 'utf8'), compatibilityDate: '2026-09-10', compatibilityFlags: ['nodejs_compat'],
  bindings: { LOCAL_ONLY: 'true' }, d1Databases: { DB: 'cli-test-library' }, host: '127.0.0.1', port: 0,
  serviceBindings: { ASSETS: async (request) => {
    const path = new URL(request.url).pathname;
    if (!['/workbench/preview.js', '/workbench/legacy-v1.css'].includes(path)) return new Response('Not found', { status: 404 });
    return new Response(await readFile(`skills/design-workbench/assets${path}`, 'utf8'));
  } },
});
options.resourcePersistencePath = join(directory, 'd1');
options.logRequests = false;
const mf = new Miniflare(options);
async function stop() { await mf.dispose(); process.exit(0); }
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
process.stdin.resume();
process.stdin.once('end', stop);
try {
  const db = await mf.getD1Database('DB');
  for (const filename of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    const migration = await readFile(join('migrations', filename), 'utf8');
    await db.batch(migration.split(';').filter((sql) => sql.trim()).map((sql) => db.prepare(sql)));
  }
  console.log(JSON.stringify({ url: (await mf.ready).origin }));
} catch (error) {
  await mf.dispose();
  throw error;
}
