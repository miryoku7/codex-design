import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMessage } from '../scripts/check-commit-message.mjs';
import { inspect, MAX_BYTES } from '../scripts/check-repo.mjs';

test('conventional subjects pass', () => {
  assert.deepEqual(checkMessage('feat(kits): add kit export\n\nWhy this matters.'), []);
  assert.deepEqual(checkMessage('docs: update README'), []);
  assert.deepEqual(checkMessage('fix!: drop legacy session format'), []);
});

test('merge, revert and fixup subjects are exempt', () => {
  assert.deepEqual(checkMessage('Merge branch "x"'), []);
  assert.deepEqual(checkMessage('Revert "feat: x"'), []);
  assert.deepEqual(checkMessage('fixup! feat: x'), []);
});

test('bad subjects are reported', () => {
  assert.equal(checkMessage('Add a thing').length, 1);
  assert.ok(checkMessage('feat: ' + 'x'.repeat(80)).some((p) => p.includes('72')));
  assert.ok(checkMessage('feat: done.').some((p) => p.includes('ピリオド')));
  assert.ok(checkMessage('feat: x\nbody without blank line').some((p) => p.includes('空行')));
});

test('AI as co-author is rejected but Assisted-by is allowed', () => {
  assert.ok(checkMessage('feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>').length > 0);
  assert.ok(checkMessage('feat: x\n\nco-authored-by: Codex <bot@openai.com>').length > 0);
  assert.deepEqual(checkMessage('feat: x\n\nCo-authored-by: Alice Doe <alice@example.com>'), []);
  assert.deepEqual(checkMessage('feat: x\n\nAssisted-by: Claude Code'), []);
});

test('repo hygiene flags machine paths, big files and forbidden paths', () => {
  const files = { 'ok.md': 'hello', 'bad.md': 'see ' + '/Users/' + 'someone/x', 'big.bin': 'x', '.design-workbench/a.json': '{}', '.env.example': 'A=' };
  const sizes = { 'big.bin': MAX_BYTES + 1 };
  const problems = inspect(Object.keys(files), { read: (f) => files[f], size: (f) => sizes[f] ?? files[f].length });
  assert.equal(problems.length, 3);
  assert.ok(problems.some((p) => p.startsWith('bad.md')));
  assert.ok(problems.some((p) => p.startsWith('big.bin')));
  assert.ok(problems.some((p) => p.startsWith('.design-workbench')));
});
