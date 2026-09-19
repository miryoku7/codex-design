import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { checkRepository, validateCatalogs, readCatalog, scanJavaScript } from '../scripts/check-i18n.mjs';

const source = readFileSync(new URL('../skills/design-workbench/assets/workbench/i18n.js', import.meta.url), 'utf8');
function runtime({ saved, languages = ['ja-JP'], blocked = false, document } = {}) {
  const storage = new Map(saved === undefined ? [] : [['codex-design.locale', saved]]);
  const context = vm.createContext({ navigator: { languages }, document, Intl,
    localStorage: { getItem: key => { if (blocked) throw new Error('disabled'); return storage.get(key); }, setItem: (key, value) => { if (blocked) throw new Error('disabled'); storage.set(key, value); } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  });
  vm.runInContext(source, context);
  return { i18n: context.DesignI18n, storage };
}

test('repository translations have complete keys, placeholders and marked UI text', () => {
  assert.deepEqual(checkRepository().errors, []);
});

test('coverage rejects missing, empty, duplicate and mismatched translations', () => {
  assert.match(validateCatalogs({ ja: { a: '{name}', b: 'B' }, en: { a: '{other}', b: '', c: 'C' } }).join('\n'), /Placeholder mismatch/);
  assert.match(validateCatalogs({ ja: { a: 'A' }, en: {} }).join('\n'), /en: missing/);
  assert.throws(() => readCatalog('const catalogs={ja:{a:"A",a:"B"},en:{a:"A"}};', 'catalogs'), /duplicate/);
  const catalogs = { ja: { known: 'こんにちは {name}' }, en: { known: 'Hello {name}' } };
  const bad = scanJavaScript('I.msg("missing"); I.msg("known"); node("p","help","Untranslated help"); label.textContent = `保存 ${name}`;', 'fixture.js', catalogs);
  assert.match(bad.errors.join('\n'), /Unknown translation key/);
  assert.match(bad.errors.join('\n'), /Missing interpolation name/);
  assert.match(bad.errors.join('\n'), /Untranslated UI literal/);
  assert.match(bad.errors.join('\n'), /Japanese template/);
  assert.match(scanJavaScript('I?.msg("missing");', 'fixture.js', catalogs).errors.join('\n'), /Unknown translation key/);
  assert.deepEqual(scanJavaScript('I.text(label,I.msg("known",{name:user.name}));', 'fixture.js', catalogs).errors, []);
});

test('locale resolution uses saved choice, supported browser languages, then Japanese', () => {
  assert.equal(runtime({ saved: 'ja', languages: ['en-US'] }).i18n.getLocale(), 'ja');
  assert.equal(runtime({ saved: 'en', languages: ['ja-JP'] }).i18n.getLocale(), 'en');
  assert.equal(runtime({ saved: 'invalid', languages: ['fr-FR', 'en-GB'] }).i18n.getLocale(), 'en');
  assert.equal(runtime({ languages: ['de-DE'] }).i18n.getLocale(), 'ja');
  assert.equal(runtime({ blocked: true, languages: ['en-US'] }).i18n.getLocale(), 'en');
  const { i18n, storage } = runtime();
  i18n.setLocale('en');
  assert.equal(storage.get('codex-design.locale'), 'en');
  i18n.setLocale('unsupported');
  assert.equal(i18n.getLocale(), 'en');
  assert.doesNotThrow(() => runtime({ blocked: true }).i18n.setLocale('en'));
});

test('HTML coverage catches unmarked text and accessible attributes, with explicit exceptions', () => {
  const directory = mkdtempSync(join(process.env.AGENT_TMP_DIR || tmpdir(), 'i18n-html-'));
  try {
    const file = join(directory, 'fixture.html');
    writeFileSync(file, '<p>Untranslated help</p><input placeholder="検索"><button aria-label="Close">×</button><p data-i18n="known"></p><code data-i18n-ignore="CLI example">python3 tool.py</code>');
    const [result] = JSON.parse(execFileSync('python3', [fileURLToPath(new URL('../scripts/check-i18n-html.py', import.meta.url)), file], { encoding: 'utf8' }));
    assert.equal(result.errors.length, 3);
    assert.match(result.errors.join('\n'), /unmarked text: Untranslated help/);
    assert.match(result.errors.join('\n'), /unmarked placeholder/);
    assert.match(result.errors.join('\n'), /unmarked aria-label/);
    assert.deepEqual(result.keys, ['known']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('HTML coverage rejects duplicated locale text and attributes even with an ignore marker', () => {
  const directory = mkdtempSync(join(process.env.AGENT_TMP_DIR || tmpdir(), 'i18n-html-'));
  try {
    const file = join(directory, 'fixture.html');
    writeFileSync(file, '<p data-i18n="known">訳文</p><span data-i18n="known" data-i18n-ignore="example">Copy</span><input placeholder="Search" data-i18n-placeholder="search"><button aria-label="Close" data-i18n-aria-label="close" title="Close" data-i18n-title="close"></button><meta content="Description" data-i18n-content="description"><p data-i18n="known"> </p><input data-i18n-placeholder="search"><select aria-label="Language" data-i18n-ignore="language autonyms"><option lang="ja">日本語</option><option lang="en">English</option></select>');
    const [result] = JSON.parse(execFileSync('python3', [fileURLToPath(new URL('../scripts/check-i18n-html.py', import.meta.url)), file], { encoding: 'utf8' }));
    assert.equal(result.errors.length, 6);
    assert.equal(result.errors.filter(error => error.includes('duplicated localized text')).length, 2);
    for (const attribute of ['placeholder', 'aria-label', 'title', 'content']) {
      assert.ok(result.errors.some(error => error.includes(`duplicated localized ${attribute}`)), attribute);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('portable kit renderer loads without the application locale runtime', () => {
  const context = vm.createContext({ window: {} });
  const preview = readFileSync(new URL('../skills/design-workbench/assets/workbench/preview.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => vm.runInContext(preview, context));
  assert.equal(typeof context.window.DesignPreview.frameDocument, 'function');
  assert.equal(context.window.DesignPreview.TOKEN_DEFS.length, 6);
});

test('bindings change chrome in place and preserve authored text, children and form values', () => {
  const listeners = {};
  const document = { readyState: 'loading', documentElement: { setAttribute(name, value) { this[name] = value; } }, querySelectorAll: () => [], addEventListener: (name, fn) => { listeners[name] = fn; }, dispatchEvent: () => {} };
  const { i18n } = runtime({ document });
  function element() {
    return { isConnected: true, nodeType: 1, firstChild: null, value: '未保存 draft', removeAttribute() {}, setAttribute(name, value) { this[name] = value; },
      set textContent(value) { this.firstChild = { data: value, parentNode: this }; },
      get textContent() { return this.firstChild?.data || ''; },
    };
  }
  const button = element(), authored = element();
  i18n.text(button, i18n.msg('create.project'));
  const textNode = button.firstChild;
  const child = { text: 'nested control' }; button.child = child;
  i18n.text(authored, '作品の日本語');
  i18n.setLocale('en');
  assert.equal(button.textContent, 'Create project');
  assert.equal(button.firstChild, textNode);
  assert.equal(button.child, child);
  assert.equal(button.value, '未保存 draft');
  assert.equal(authored.textContent, '作品の日本語');
  assert.equal(document.documentElement.lang, 'en');
  i18n.setLocale('ja');
  assert.equal(button.textContent, i18n.catalogs.ja['create.project']);
});
