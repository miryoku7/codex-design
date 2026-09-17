# ローカルデザインライブラリ

承認の根拠: ユーザーは「一覧・お気に入り・複製して再開」の提案に同意し、このディレクトリのgit initと製品化を依頼した。2026-09-10。

## 目的と体験

サイトの入口で保存済みのデザインを眺め、開くと既存の比較・調整画面へ戻れる。ライブラリの1作品は1セッション（A/B/Cや派生案、ブリーフ、採用、調整、メモを含む）。サムネイルには採用案、なければ表示中または先頭の案を使う。作品にお気に入りを付け、絞り込める。複製は元を保持した独立セッションを作り、新しい作品として開く。

## 構成

2026-09-10の追加指定により、Hono + Cloudflare Workers + D1を採用。まずWranglerのローカルD1で完成させる。Workerがライブラリと各作品のworkbenchを同じoriginで提供する。D1には作品のinline snapshotと名前、お気に入り、更新時刻、revisionを保存する。HTML/CSS/controlsを直接編集する既存v2ファイル形式とPythonの単一セッション起動は維持する。ローカルCLIでファイル作品を取り込み、最新版を新しいディレクトリへ取り出し、編集後はrevisionを確認して反映する。双方向の無条件な自動同期は行わない。

取り込みは明示的に行い、QA用セッションや未登録の私的ディレクトリを勝手に一覧化しない。初回は同梱サンプルで登録を試せる。スキルで新規セッションを作った際はライブラリへの登録手順を使う。

## 保存と複製

お気に入りと状態更新はrevisionを確認してD1へ保存し、複数タブで競合しても黙って上書きしない。複製は有効な最新状態を読んでからD1に独立したsnapshotを作る。ファイルとしての取り出しは別操作で、新しいディレクトリに生成する。元のHTML/CSS・調整・メモ・採用は保持し、新しいセッションIDと作品名を持つ。元ファイルや既存の複製先を上書きしない。Workerはホストの任意ファイルを読まない。CLIのファイル読み書きは既存のパス・symlink拒否とno-overwrite規則に従う。外部originの変更要求は拒否する。

## 見た目

Astraがライブラリの構成・HTML/CSS・操作を制作する。作品のプレビューを主役とし、今の白・スレートの作業台と自然につなぐ。意味のない統計や説明文を増やさない。検索とお気に入りの絞り込み、作品を開く操作、複製が分かる。デスクトップと狭い画面、キーボード操作で利用できる。

## 境界と検証

ローカル保存が対象。クラウド同期、公開、ログイン、課金、削除はこの機能の対象外。Gitやリモート資源への操作は、その作業に対する明示的な依頼に従う。

既存19テストを維持し、登録・一覧・お気に入り永続化・複製独立性・競合・入力/パス拒否をテストする。ブラウザでは一覧→お気に入り→複製→調整→一覧へ戻る→再開を確認し、現用作品のデータが保持されることを照合する。

## API契約

- `GET /api/designs` → `{designs:[{id,title,favorite,updatedAt,variantCount,selectedId,revision,preview:{variant,viewport}}]}`。previewは採用案、なければ表示中/先頭の案。
- `POST /api/designs` `{state,title?}` → `{id,url,revision}`。stateは参照を展開したinline v1。
- `GET /api/designs/:id/state` → `{state,revision}`。
- `POST /api/designs/:id/state` `{state,revision}` → `{state,revision}`。ブラウザ可変状態だけ更新。
- `POST /api/designs/:id/favorite` `{favorite,revision}` → `{id,revision,favorite}`。
- `POST /api/designs/:id/duplicate` `{title?,revision}` → `{id,url,revision}`。元の状態は不変、複製は独立。
- `PUT /api/designs/:id/source` `{state,revision}` → `{state,revision}`。明示的な制作ファイル反映。
- revision不一致は409と現在のstate/revision。入力不正400、存在しない作品404。
- `/` はライブラリ、`/designs/:id` は作業台。workbench assetsは `/workbench/`。

ローカルD1を作り、デプロイはしない。クラウド公開には認証等の設計が別途必要だが、APIとDBはWorkersへ移せる構造にする。
