# プロジェクト別ライブラリとコンポーネント

2026-09-10。画面とコンポーネントの両方をライブラリで扱う提案を受け、ユーザーが対応を依頼し、プロジェクト別の一覧を指定した。既存の制作・比較・採用の流れを維持して入口と保存分類を拡張する。

## 操作

入口 `/` はプロジェクト一覧。名前と保存された画面・コンポーネントの件数を示し、空のプロジェクトも作れる。プロジェクト内 `/projects/:id` は作品一覧で、すべて・画面・コンポーネント、検索、お気に入りで絞り込む。プロジェクト名は変更できる。

既存作品は未分類 `/unassigned` に残す。作品の所属プロジェクトと種類は一覧から変更でき、未分類へ戻せる。作品URLは変えず、作業台から所属一覧へ戻る。所属変更はデザインの内容・採用・調整・メモを変えない。複製は所属と種類を引き継ぎ、独立した作品となる。

コンポーネントはカードやボタンなどの静的なHTML/CSS試作。既存の複数案・調整・viewport指定を利用して単体を表示する。保存した種類の変更でviewportや制作ソースを勝手に変更しない。実際のReactコンポーネント実行、Storybook連携、画面から部品を自動抽出する機能、部品の更新を使用画面へ自動伝播する機能は含めない。画面中での使用例はAstraが別の画面作品として制作できるが、自動的な参照関係はこの版では持たない。

## 保存と互換性

新しい `projects` テーブルにID・名前・作成/更新日時・revisionを保存。`designs` にnullable `project_id` と `kind`（screen/component、初期値screen）を追加する。既存のstate_jsonとrevisionは移行時に書き換えない。プロジェクトの削除、ディレクトリの走査・自動登録、現用作品の所属の推測は行わない。

所属/種類はセッションのHTML/CSSやユーザー調整とは別のライブラリメタデータ。source/state更新で保持する。既存のライブラリrevisionを所属/種類変更にも使い、古いブラウザやCLIからの保存を409で拒否する。外部キーとAPI入力検証で存在しないプロジェクトへの所属を拒否する。

CLIのimportはプロジェクトIDと種類を指定できる。exportのreceiptにライブラリメタデータを記録し、pushは所属を維持する。旧receiptと指定なしのimportも使える。Skillは保存先を確認し、明示されたプロジェクトへ登録する。ライブラリ作品とローカル制作用ファイルの明示的なimport/export/push契約は維持する。

## API

- `GET /api/projects` → `{projects:[{id,name,revision,createdAt,updatedAt,designCount,screenCount,componentCount}]}`。
- `POST /api/projects` `{name}` → プロジェクト。`PATCH /api/projects/:id` `{name,revision}` → 名前更新。古いrevisionは409。
- `GET /api/designs` の各作品に `projectId` と `kind` を追加。任意のquery `projectId=<id>|unassigned`、`kind=screen|component`。queryなしは従来どおり全件。
- `POST /api/designs` に任意の `projectId`、`kind` を追加。省略時は未分類の画面。
- state取得・保存応答に `library:{projectId,kind}` を追加。既存state構造は変えない。
- `PATCH /api/designs/:id/metadata` `{revision,projectId,kind}` → `{id,revision,projectId,kind}`。所属と種類を一度に条件付き更新。

## 所有権と検証

Astra `gpt-6-astra` が制作を担当する。保存・移行・CLIとテスト、一覧・作業台・見た目の変更を役割に応じて分担し、監督役は設計記録、Skill、統合と最終検証を担当する。既存のiframeを保持する振る舞いを維持する。

独立した一時D1で移行前作品の保持、プロジェクト作成/改名、所属/種類の変更と絞り込み、複製、競合、CLIの往復を検証。typecheck、API/CLIテストと既存runtimeテストを実行する。ブラウザは1440×1000と390×844で一覧→プロジェクト→コンポーネント→比較/調整→戻るを確認する。現用D1の移行前後は作品データを読み取り照合し、QA作品を混ぜない。クラウド操作・commit・pushは行わない。
