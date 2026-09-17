# 再利用するデザインキット

2026-09-10。ユーザーは「キット作成・選択・持ち出し」を先に揃え、トークン・部品・配置ルール・実例をまとめて別プロジェクトで利用する方針に同意した。保存した版を固定し、更新前後の比較も含む。npmパッケージや実Reactコンポーネント共有はこの版の対象外。

## 体験

ライブラリから「デザインキット」を開く。既存の画面/コンポーネントとその案を明示的に選び、基準になる案の宣言済みトークンと調整値を読み込む。名前、説明、トークン、使い方を確認・編集してv1として保存する。選んだ案のソースと表示サイズは実例として複製し、元作品との自動同期は行わない。

AstraはSkill経由で実例を読み、意味のあるトークン名・使い分け・配置ルール・避けたい表現を整理できる。ブラウザやAPIによる取り込みは宣言済み値の取得であり、AIによるデザイン分析とは表示しない。元の6トークンだけに限定せず、型付きの独自トークンを保存できる。

キット詳細では色、寸法、書体、実例、ルールを確認する。編集結果は新しい版として保存し、既存版は上書きしない。2つの版を選ぶと値やルールの差分と、それぞれの版のトークンを反映した実例を比較できる。トークンに結び付いていないハードコード値が自動で変わるとは扱わない。

各プロジェクトはキットと版を選択・解除できる。v2の作成でv1利用中のプロジェクトを更新しない。選択は今後の制作に渡すデザイン文脈であり、保存済み作品を一括書き換えない。

持ち出しはkit.json、tokens.css、GUIDE.mdと実例をまとめたファイル群。ブラウザはまとめてダウンロードし、CLIは新規ディレクトリに展開する。外部サービスや実行コードに依存せず実例を確認できることを検証する。プレビューのsandboxとCSPを維持する。

## データ

KitContentは `formatVersion:1`、name、description、tokens、rules、examplesを持つ。tokensはname/type/value/descriptionの配列。nameは先頭`--`なしのCSS変数名、typeはcolor/dimension/number/fontFamily。値は型検証し任意CSS注入を拒否する。examplesはid/name/kind/source/variant/viewportを持つ。sourceに元designId/variantId/revisionを記録し、実際のHTML/CSS/調整値をsnapshotとして保持する。

キット本体と不変のバージョンをD1に保存する。新バージョン保存はキットrevisionの条件付き更新と版追加を原子的に実施し、競合時に孤立した版を残さない。プロジェクトの選択版もproject revisionで競合確認する。既存designs/projectsの旧列を移行で変更しない。

## APIとCLI

- `GET /api/kits`、`POST /api/kits {content}`、`GET /api/kits/:id`。
- `POST /api/kits/prepare {name?,sources:[{designId,variantId,revision}]}` は保存せず `{content}` を返す。元revision不一致は409。
- `POST /api/kits/:id/versions {revision,content,summary}` は新しい版を作成。
- `GET /api/kits/:id/versions/:version` と `/export` で版を取得。exportはfilenameとpath/contentのファイル配列。
- projects応答は `kit:{kitId,version}|null` を追加。`PATCH /api/projects/:id/kit {revision,kitId,version}` で選択/解除。`GET /api/projects/:id/kit` で選択中の完全な内容を取得。
- CLI: `kits list/prepare/create/show/version/export`、`projects kit/use-kit/clear-kit`。export先やprepare出力は既存パスを上書きしない。既存CLI import/export/pushは維持する。

## 制作と検証

Astra `gpt-6-astra` が保存・CLI・テスト、UIとプレビュー体験を制作する。監督役はSkill/文書・統合・移行前後照合・最終ブラウザ検証を担当する。既存のプロジェクト分類とiframeを保持する振る舞いを維持する。

一時D1でソース取得、型検証、v1/v2不変性、同時更新409、固定版の維持、exportと再利用、パス拒否をテスト。PC1440×1000と390×844で作成→確認→新しい版→比較→持ち出し→プロジェクト選択を検証する。現用D1は整合したバックアップ後にローカル追加移行のみ適用する。QA作品を現用に混ぜず、commit/push/deployは行わない。
