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
npm test
python3 skills/design-workbench/scripts/test_runtime.py
git diff --check
```

テストは一時ディレクトリのD1とサンプルを使います。現用の `.wrangler/` や作品をテスト用に消去・上書きしないでください。変更したJavaScriptには `node --check ファイル名` を実行します。UIを変更した場合は `npm run prepare-assets` の後に実ブラウザで対象の画面とviewportを確認し、テストの成功と見た目の採用を区別して報告してください。

## 保存と配布の境界

保存・複製・移行を変更する場合は、元作品、初期値、メモ、採用状態、競合時の下書きが保たれることを検証します。プレビューのsandboxや外部通信の制限を緩める変更は、通常の見た目調整と分けて提案してください。

`.env*`、`.dev.vars*`、認証情報、個人パス、作品、DBを含めないでください。第三者のコードや素材を追加する場合は出所・ライセンス・必要な表示を添え、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を更新します。依存を変えた場合はlockfileも更新します。

このプロジェクトへの提供物は、提供する権限があり、[MIT License](LICENSE) で配布できる内容にしてください。ローカルの検証は、リモート資源の作成・データ移行・デプロイの許可を含みません。
