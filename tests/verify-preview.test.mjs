import assert from 'node:assert/strict';
import test from 'node:test';
import { findChrome, parseArgs, summarize, SAVED } from '../skills/design-workbench/scripts/verify_preview.mjs';

test('parseArgs accepts a loopback URL and defaults', () => {
  const o = parseArgs(['--url', 'http://127.0.0.1:8787/designs/abc']);
  assert.equal(o.width, 1440);
  assert.equal(o.height, 900);
  assert.equal(o.mutate, true);
  assert.equal(o.controls, 4);
  assert.equal(o.library, true);
  assert.equal(o.expectKind, null);
});

test('parseArgs reads library options', () => {
  const o = parseArgs(['--url', 'http://127.0.0.1:8787/designs/x', '--expect-kind', 'component', '--no-library']);
  assert.equal(o.expectKind, 'component');
  assert.equal(o.library, false);
  assert.throws(() => parseArgs(['--url', 'http://127.0.0.1:1/', '--expect-kind', 'page']), /expect-kind/);
});

test('parseArgs handles options and rejects bad input', () => {
  const o = parseArgs(['--url', 'http://localhost:8765/', '--viewport', '390x844', '--controls', '0', '--no-mutate', '--lang', 'en']);
  assert.deepEqual([o.width, o.height, o.controls, o.mutate, o.lang], [390, 844, 0, false, 'en']);
  assert.throws(() => parseArgs([]), /--url is required/);
  assert.throws(() => parseArgs(['--url', 'https://example.com/']), /loopback/);
  assert.throws(() => parseArgs(['--url', 'http://127.0.0.1:1/', '--viewport', '1440']), /viewport/);
  assert.throws(() => parseArgs(['--url', 'http://127.0.0.1:1/', '--controls', '99']), /controls/);
  assert.throws(() => parseArgs(['--url', 'http://127.0.0.1:1/', '--lang', 'fr']), /lang/);
  assert.throws(() => parseArgs(['--url', 'http://127.0.0.1:1/', '--bogus']), /Unknown argument/);
});

test('findChrome prefers CHROME_PATH and fails clearly', () => {
  assert.equal(findChrome({ CHROME_PATH: '/x/chrome' }, (p) => p === '/x/chrome'), '/x/chrome');
  assert.throws(() => findChrome({}, () => false), /CHROME_PATH/);
});

test('save status matches both UI languages', () => {
  assert.ok(SAVED.test('保存済み'));
  assert.ok(SAVED.test('Saved'));
  assert.ok(!SAVED.test('保存中…'));
  assert.ok(!SAVED.test('Saving'));
});

test('summarize reports failures and the screenshot location', () => {
  const opts = { width: 1440, height: 900, mutate: true };
  const r = summarize({ checks: [{ name: 'a', ok: true, detail: '' }, { name: 'b', ok: false, detail: 'why' }], shots: ['x.png'], out: '/tmp/o', ms: 1500 }, opts);
  assert.equal(r.failed, 1);
  assert.match(r.text, /FAIL {2}b — why/);
  assert.match(r.text, /FAIL: 1\/2 checks in 1\.5s/);
  assert.match(r.text, /\/tmp\/o/);
});
