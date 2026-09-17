# Codex Design

ローカルで使うデザイン制作・比較・保存アプリと、それを操作するCodex Skillのmonorepo。アプリ・Skill・CLI・テスト・文書を一緒に管理する。

## 読み順

1. `README.md`
2. 現在の機能に対応する `docs/superpowers/specs/` の設計
3. `skills/design-workbench/SKILL.md` と必要な参照文書
4. 実装と `VERIFICATION.md`

## 制作の所有権

- デザイン、HTML/CSS、調整項目、派生案はAstra (`gpt-6-astra`) が制作する。Lunaに代替しない。実際のモデル指定と担当を記録する。
- 監督役は会話、スコープ、統合、Git、文書、最終検証を担当する。一般的な安価モデルへの委譲規則で、このプロジェクトの指定を上書きしない。
- 通常のデザイン制作は各セッションの案ディレクトリにある `index.html`・`style.css`・`controls.json` を編集する。共有ランタイムを案ごとに変更しない。

## データと変更境界

- `.design-workbench/` はユーザーの作品・調整・メモ・履歴。Gitに含めない。テストで現用作品を変更せず、一時コピーを使う。
- v2のsessionはメタデータとユーザー状態を持ち、HTML/CSS/controlsは参照ファイルを正本とする。APIの展開済みデータをsession.jsonへそのまま保存しない。
- ライブラリのD1 snapshotとローカルv2ディレクトリは別の作業コピー。ライブラリの最新版を新規ディレクトリへexportしてから修正し、`.library.json` のrevisionでpushする。競合時にreceiptを書き換えて強制反映しない。
- 派生案は元を残す。構造変更の前にはsessionと参照ファイルの両方を保存する。
- 静的プレビューはsandbox iframe。外部通信や任意スクリプトを有効化する変更は通常の見た目調整に含めない。
- このディレクトリは独立したGitルート。上位ディレクトリが別のリポジトリでも、変更はこのリポジトリ内で扱う。commit/push/remote作成/deployは明示依頼時のみ。
- Cloudflareを使う実装でも、ローカル検証とリモートD1・本番への操作は分ける。リモート資源作成・移行・公開には個別の明示許可が必要。

## 検証

- ライブラリ: `npm run typecheck`、`npm test`（実際のローカルD1とCLI連携）。テスト用DBは一時ディレクトリへ分離する。
- 起動: `npm run db:migrate`（localのみ）→ `npm run dev`。`web/` や共通assetsを編集中の既存サーバーへ反映するには `npm run prepare-assets` を再実行する。
- 既存ランタイム: `python3 skills/design-workbench/scripts/test_runtime.py`
- 変更したJavaScript: `node --check <file>`
- UI変更は対象viewportの実ブラウザで確認する。テストPASSとデザイン採用は別の事実として記録する。
- 保存・複製・移行では、元作品の保持、リセット値、メモ、採用状態、同時更新の競合を確認する。
