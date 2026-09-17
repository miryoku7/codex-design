import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, '.generated');
// This directory is generated exclusively from checked-in public assets.
await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'workbench'), { recursive: true });
for (const entry of await readdir(join(root, 'web'), { withFileTypes: true })) {
  if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
  await cp(join(root, 'web', entry.name), join(output, entry.name), { recursive: true });
}
const workbench = join(root, 'skills/design-workbench/assets/workbench');
for (const entry of await readdir(workbench, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:html|css|js)$/.test(entry.name)) continue;
  const target = join(output, 'workbench', entry.name);
  if (entry.name === 'index.html') {
    const html = await readFile(join(workbench, entry.name), 'utf8');
    await writeFile(target, html.replace(/((?:src|href)=["'])(?:\.\/)?(styles\.css|preview\.js|app\.js)(["'])/g, '$1/workbench/$2$3'));
  } else {
    await cp(join(workbench, entry.name), target);
  }
}
console.log('Prepared library and workbench assets in .generated/');
