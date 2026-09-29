// commitメッセージの規則を検査する。ローカルの commit-msg フックとCIの両方から使う。
//   node scripts/check-commit-message.mjs <メッセージファイル>   （フック）
//   node scripts/check-commit-message.mjs --range <base>..<head>  （CI・手動）
//   node scripts/check-commit-message.mjs --title "<PRタイトル>"    （CI。squash mergeではタイトルがcommitの1行目になる）
// 規則の説明は CONTRIBUTING.md の「Gitと履歴の規則」。
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TYPES = ['feat', 'fix', 'docs', 'test', 'refactor', 'perf', 'build', 'ci', 'chore', 'revert'];
const SUBJECT = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9-]*\\))?!?: \\S.*$`);
const AI_NAMES = /(claude|anthropic|codex|openai|chatgpt|gpt-?\d|copilot|gemini|cursor|devin|aider|windsurf)/i;

export function checkMessage(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n').filter((l) => !l.startsWith('#'));
  const subject = (lines[0] || '').trim();
  const problems = [];
  if (/^(Merge |Revert "|fixup! |squash! )/.test(subject)) return problems;
  if (!SUBJECT.test(subject)) {
    problems.push(`1行目は「type(scope): 要約」の形にしてください（type: ${TYPES.join(', ')}）: "${subject}"`);
  }
  if (subject.length > 72) problems.push(`1行目は72文字以内にしてください（現在${subject.length}文字）`);
  if (/\.$/.test(subject)) problems.push('1行目の末尾にピリオドを付けないでください');
  if (lines.length > 1 && lines[1].trim() !== '') problems.push('1行目と本文の間に空行を入れてください');
  for (const line of lines) {
    if (/^co-authored-by:/i.test(line.trim()) && AI_NAMES.test(line)) {
      problems.push(`AIをCo-Authored-Byにしないでください（使ったツールを記す場合は "Assisted-by: ツール名" を使います）: "${line.trim()}"`);
    }
  }
  return problems;
}

function main(argv) {
  const [a, b] = argv;
  if (a === '--title') {
    const problems = checkMessage(b || '');
    if (problems.length) {
      console.error(`PRタイトルが規則に合いません:\n  - ${problems.join('\n  - ')}`);
      process.exit(1);
    }
    console.log('PR title: OK');
    return;
  }
  if (a === '--range') {
    const out = execFileSync('git', ['log', '--format=%H%x1f%B%x1e', b], { encoding: 'utf8' });
    let bad = 0;
    for (const rec of out.split('\x1e')) {
      const [sha, ...msg] = rec.trim().split('\x1f');
      if (!sha) continue;
      const problems = checkMessage(msg.join('\x1f'));
      if (problems.length) {
        bad++;
        console.error(`${sha.slice(0, 8)}\n  - ${problems.join('\n  - ')}`);
      }
    }
    if (bad) process.exit(1);
    console.log('commit messages: OK');
    return;
  }
  if (!a) {
    console.error('使い方: check-commit-message.mjs <ファイル> | --range <base>..<head>');
    process.exit(2);
  }
  const problems = checkMessage(readFileSync(a, 'utf8'));
  if (problems.length) {
    console.error(`commitメッセージの規則に合いません（CONTRIBUTING.md「Gitと履歴の規則」）:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
