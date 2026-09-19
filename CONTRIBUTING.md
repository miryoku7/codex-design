# 開発に参加する

Codex Designは、ローカルでデザインを比較・調整・保存するアプリとCodex Skillです。まず [README](README.md) の手順で起動してください。変更は、対象となる問題、変更後の振る舞い、検証結果を添えて提案してください。個人の作品やDBを再現用データとして公開せず、架空の最小サンプルを使います。

## 変更する場所

- アプリの保存・API: `src/`、`migrations/`、`scripts/library.py`
- ライブラリ画面: `web/`
- 比較・調整の共通画面: `skills/design-workbench/assets/workbench/`
- 制作の進め方: `skills/design-workbench/SKILL.md` と `references/`
- 個別の作品: `.design-workbench/`。Gitへ含めません。

このリポジトリでAIにデザインやHTML/CSSを制作させる場合は [AGENTS.md](AGENTS.md) のAstra担当方針に従い、実際に使用したモデルを記録します。表示や制作方針を変える提案では、意図と対象画面を明記してください。

## 検証

リポジトリのルートで実行します。

```sh
npm ci
npm run typecheck
npm run check:i18n
npm test
python3 skills/design-workbench/scripts/test_runtime.py
git diff --check
```

テストは一時ディレクトリのD1とサンプルを使います。現用の `.wrangler/` や作品をテスト用に消去・上書きしないでください。変更したJavaScriptには `node --check ファイル名` を実行します。UIを変更した場合は `npm run prepare-assets` の後に実ブラウザで対象の画面とviewportを確認し、テストの成功と見た目の採用を区別して報告してください。

## 翻訳の追加と検査

GUIの辞書は `skills/design-workbench/assets/workbench/i18n.js`、キットの初期文言と書き出し説明は `src/i18n.ts` にあります。両言語のキーと `{name}` などの埋め込み値を揃えてください。HTMLは `data-i18n` と属性用の `data-i18n-aria-label`・`data-i18n-placeholder` 等を使い、翻訳する本文・属性値は空にします。たとえば `<button data-i18n="create.project"></button>` とし、HTML側に日本語や英語の控えを置きません。動的文言は `DesignI18n.msg` と `text`・`attr` で接続します。利用者の作品や入力値を翻訳関数へキーとして渡さないでください。

初期HTMLは `data-i18n-pending` と `inert` で操作画面を隠し、言語に依存しない `Codex Design` の表示だけを出します。辞書の初期化で保存済み設定またはブラウザ言語を解決し、本文・アクセシビリティ属性・`lang` を適用してから画面を表示します。アプリはJavaScriptが必要です。辞書スクリプトが読み込めない場合は初期表示に留まり、ラベルのない操作画面は公開しません。

`npm run check:i18n` はキー欠落・空訳・埋め込み値の不一致、未登録キーの参照、静的HTMLの未指定文言と属性、翻訳キーを付けたHTMLへの本文・属性値の重複記載、JavaScriptの日本語直書きと代表的な表示先への英語直書きを検査します。意味や自然さ、任意の変数を経由する動的文言までは判定できません。独自の表示処理を加えた際は検査対象も更新し、両言語でブラウザ確認してください。ブランド名・単位・言語名は限定した例外です。HTMLの特殊な固定内容には理由付きの `data-i18n-ignore` を使えますが、翻訳キーのある箇所への重複記載は許可しません。

ブラウザ検証は `npm run prepare-assets` → `node tests/i18n.browser.mjs` で作る一時DBとサンプルを使います。出力したfixture情報とスクリーンショットの保存先を `tests/i18n.browser.js` の第2引数へ渡し、管理ブラウザの `run-code --filename` から実行します。このスクリプトは検証作品のメモ・採用を変更するため、通常利用のサーバーでは実行しません。単独ワークベンチの言語設定は、別ポートのためライブラリとは独立です。

同じfixtureを使う `tests/i18n-startup.browser.js` は辞書の読み込みを保留して初期画面を調べ、読み込み再開後の最初の表示が日英それぞれの選択に一致することを確認します。読み込み失敗時に操作画面が隠れたままであることも検査します。

## 保存と配布の境界

保存・複製・移行を変更する場合は、元作品、初期値、メモ、採用状態、競合時の下書きが保たれることを検証します。プレビューのsandboxや外部通信の制限を緩める変更は、通常の見た目調整と分けて提案してください。

`.env*`、`.dev.vars*`、認証情報、個人パス、作品、DBを含めないでください。第三者のコードや素材を追加する場合は出所・ライセンス・必要な表示を添え、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を更新します。依存を変えた場合はlockfileも更新します。

このプロジェクトへの提供物は、提供する権限があり、[MIT License](LICENSE) で配布できる内容にしてください。ローカルの検証は、リモート資源の作成・データ移行・デプロイの許可を含みません。
