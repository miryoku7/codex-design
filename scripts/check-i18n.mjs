import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse } from 'acorn';
import { transformSync } from 'esbuild';

export const root = fileURLToPath(new URL('../', import.meta.url));
const workbench = 'skills/design-workbench/assets/workbench/';
export const placeholders = value => [...new Set([...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();
const string = node => node?.type === 'Literal' && typeof node.value === 'string';
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) value.forEach(item => walk(item, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

export function validateCatalogs(catalogs) {
  const errors = [];
  if (!catalogs?.ja || !catalogs?.en) return ['Both ja and en catalogs are required'];
  const keys = new Set([...Object.keys(catalogs.ja), ...Object.keys(catalogs.en)]);
  for (const key of keys) {
    for (const locale of ['ja', 'en']) if (typeof catalogs[locale][key] !== 'string' || !catalogs[locale][key].trim()) errors.push(`${locale}: missing or empty ${key}`);
    if (typeof catalogs.ja[key] === 'string' && typeof catalogs.en[key] === 'string' && JSON.stringify(placeholders(catalogs.ja[key])) !== JSON.stringify(placeholders(catalogs.en[key]))) errors.push(`Placeholder mismatch: ${key}`);
  }
  return errors;
}

// Read only literal object data; do not execute frontend code to inspect catalogs.
export function readCatalog(source, variable, filename = 'catalog.js') {
  const code = filename.endsWith('.ts') ? transformSync(source, { loader: 'ts' }).code : source;
  const tree = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  let found;
  function literal(node) {
    if (string(node)) return node.value;
    if (node.type !== 'ObjectExpression') throw new Error(`${filename}: catalog must contain literal objects and strings`);
    const result = {};
    for (const property of node.properties) {
      if (property.type !== 'Property' || property.computed) throw new Error(`${filename}: unsupported catalog property`);
      const name = property.key.name ?? property.key.value;
      if (!name || Object.hasOwn(result, name)) throw new Error(`${filename}: duplicate or unsupported key ${name}`);
      result[name] = literal(property.value);
    }
    return result;
  }
  walk(tree, node => { if (node.type === 'VariableDeclarator' && node.id.name === variable) found = literal(node.init); });
  if (!found) throw new Error(`${filename}: ${variable} not found`);
  return found;
}

const invariant = /^(?:Codex Design|Design Workbench|Astra|Aa|HTML|CSS|JSON|PDF|MD|px|rem|em|%|On|Off|[A-C]|\s*)$/;
const humanText = value => /[A-Za-z\u3040-\u30ff\u3400-\u9fff]/u.test(value) && !invariant.test(value);
export function scanJavaScript(source, filename, catalogs) {
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const errors = [], references = new Set();
  const report = (node, message) => errors.push(`${filename}:${node.loc.start.line}: ${message}`);
  const checkKey = (node, key, params) => {
    references.add(key);
    if (!Object.hasOwn(catalogs.ja, key) || !Object.hasOwn(catalogs.en, key)) report(node, `Unknown translation key: ${key}`);
    else if (params === undefined || params.type === 'ObjectExpression') {
      const supplied = new Set(params?.properties.map(prop => prop.key?.name ?? prop.key?.value) || []);
      for (const name of placeholders(catalogs.ja[key])) if (!supplied.has(name)) report(node, `Missing interpolation ${name} for ${key}`);
    }
  };
  const checkSink = node => {
    if (string(node) && humanText(node.value)) report(node, `Untranslated UI literal: ${node.value}`);
  };
  function visit(node) {
    if (string(node) && /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(node.value)) report(node, `Japanese literal outside catalog: ${node.value.slice(0, 90)}`);
    if (node.type === 'TemplateElement' && /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(node.value.cooked)) report(node, `Japanese template outside catalog: ${node.value.cooked.slice(0, 90)}`);
    if (node.type === 'CallExpression') {
      const callee = source.slice(node.callee.start, node.callee.end).replaceAll('?.', '.');
      if (/^(?:I\.|DesignI18n\.|window\.DesignI18n\.)?(?:t|msg)$/.test(callee) && string(node.arguments[0])) checkKey(node, node.arguments[0].value, node.arguments[1]);
      if (callee === 'node') checkSink(node.arguments[2]);
      if (callee === 'I.text') checkSink(node.arguments[1]);
      if (callee === 'I.attr') checkSink(node.arguments[2]);
      if (callee.endsWith('.setAttribute') && ['title', 'aria-label', 'placeholder'].includes(node.arguments[0]?.value)) checkSink(node.arguments[1]);
    }
    if (node.type === 'AssignmentExpression' && node.operator === '=' && /\.(?:textContent|innerText|title|placeholder)$/.test(source.slice(node.left.start, node.left.end))) checkSink(node.right);
    if (node.type === 'NewExpression' && node.callee.name === 'Option') checkSink(node.arguments?.[0]);
  }
  walk(tree, visit);
  return { errors, references };
}

export function checkRepository(base = root) {
  const errors = [];
  const catalog = readCatalog(readFileSync(resolve(base, workbench + 'i18n.js'), 'utf8'), 'catalogs');
  errors.push(...validateCatalogs(catalog));
  const server = readCatalog(readFileSync(resolve(base, 'src/i18n.ts'), 'utf8'), 'kitMessages', 'src/i18n.ts');
  errors.push(...validateCatalogs(server).map(error => `Server: ${error}`));
  const scripts = [...readdirSync(resolve(base, 'web')).filter(name => name.endsWith('.js')).map(name => 'web/' + name), workbench + 'app.js', workbench + 'preview.js'];
  for (const file of scripts) errors.push(...scanJavaScript(readFileSync(resolve(base, file), 'utf8'), file, catalog).errors);
  const htmlFiles = [...readdirSync(resolve(base, 'web')).filter(name => name.endsWith('.html')).map(name => 'web/' + name), workbench + 'index.html'];
  const html = JSON.parse(execFileSync('python3', [resolve(root, 'scripts/check-i18n-html.py'), ...htmlFiles.map(file => resolve(base, file))], { encoding: 'utf8' }));
  for (const result of html) {
    errors.push(...result.errors.map(error => `${relative(base, result.path)}: ${error}`));
    for (const key of result.keys) if (!Object.hasOwn(catalog.ja, key) || !Object.hasOwn(catalog.en, key)) errors.push(`${relative(base, result.path)}: Unknown translation key: ${key}`);
  }
  return { errors, keys: Object.keys(catalog.ja).length, serverKeys: Object.keys(server.ja).length, files: scripts.length + htmlFiles.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkRepository();
  if (result.errors.length) { console.error(result.errors.join('\n')); process.exitCode = 1; }
  else console.log(`i18n coverage: ${result.keys} GUI + ${result.serverKeys} server keys, ja/en parity and ${result.files} source files checked.`);
}
