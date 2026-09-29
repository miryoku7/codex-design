// 追跡ファイルの衛生検査。公開してよい状態（この環境に依存しない・大きなバイナリや秘密が無い）かを確かめる。
// ローカルとCIで同じ結果になるよう、Gitの追跡ファイルだけを対象にする。
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MAX_BYTES = 1_000_000;
export const FORBIDDEN_PATH = /(^|\/)(\.design-workbench|\.wrangler|node_modules|\.generated|dist)\/|(^|\/)\.env(\.[^/]*)?$|(^|\/)\.dev\.vars(\.[^/]*)?$|\.log$|\.DS_Store$/;
export const ALLOWED_PATH = /(^|\/)(\.env\.example|\.dev\.vars\.example)$/;
// 個人の環境に固有のパス（macOS / Linux / Windows のホーム配下）
export const MACHINE_PATH = new RegExp(['/Users/[A-Za-z0-9._-]+', '/home/[A-Za-z0-9._-]+', 'C:\\\\Users\\\\[A-Za-z0-9._-]+'].join('|'));
const SKIP_CONTENT = /(^package-lock\.json$|\.(png|jpe?g|gif|webp|woff2?|ico|pdf)$|^tests\/(policy|check-repo)\.test\.mjs$|^scripts\/check-repo\.mjs$)/;

export function inspect(files, { read = (f) => readFileSync(f), size = (f) => statSync(f).size } = {}) {
  const problems = [];
  for (const f of files) {
    if (FORBIDDEN_PATH.test(f) && !ALLOWED_PATH.test(f)) problems.push(`${f}: 追跡してはいけないファイル`);
    let bytes = 0;
    try { bytes = size(f); } catch { continue; }
    if (bytes > MAX_BYTES) problems.push(`${f}: ${(bytes / 1e6).toFixed(1)}MB（上限1MB。縮小するか、PRで理由を説明してください）`);
    if (SKIP_CONTENT.test(f) || bytes > 5_000_000) continue;
    const text = read(f).toString('utf8');
    if (text.includes('\u0000')) continue;
    const m = text.match(MACHINE_PATH);
    if (m) problems.push(`${f}: この環境に固有のパスが含まれています（${m[0]}）`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const problems = inspect(files);
  if (problems.length) {
    console.error(`リポジトリの検査に失敗しました:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  console.log(`repo hygiene: OK (${files.length} files)`);
}
