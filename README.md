# Codex Design

**Astraが作ったデザインを、保存して育てる作業場。** プロジェクトごとに画面とコンポーネントを探し、比較・微調整・複製を行い、Codex Skillから制作を続けます。

アプリはHono / Cloudflare Workers / D1で構成し、まずローカルD1で動かします。Skill本体は [skills/design-workbench/SKILL.md](skills/design-workbench/SKILL.md)。HTML・CSSを直接編集する単独ワークベンチも利用できます。

MITライセンスのローカルアプリ＋Codex Skillです。OpenAIの公式製品ではありません。ソース一式を取得して使う構成で、npmパッケージとしての公開や共有サーバーでの運用は対象にしていません。

GUIは日本語・英語に対応しています。画面上部の「日本語 / English」で切り替えると、同じブラウザ・同じオリジンのライブラリ、キット、比較・調整画面に引き継がれます。初回はブラウザの対応言語を使い、対応言語がなければ日本語になります。別ポートの単独ワークベンチは別の設定です。作品名・本文・メモ・独自の調整項目・保存済みキットは自動翻訳しません。

操作画面の文言は日英の辞書で管理します。HTMLには翻訳キーを置き、選択言語の文言を適用してから画面を表示するため、英語設定時に日本語の操作画面が先に出ることはありません。

The GUI supports Japanese and English. Use the language selector in the header; your choice is remembered for that origin. Saved design content stays in its original language. The Codex Skill accepts requests in either language: [bilingual examples and language rules](skills/design-workbench/references/language.md).

アプリ、Skill、CLI、テスト、文書を同じリポジトリで管理します。リポジトリのルートから起動・検証し、アプリとSkillを一緒に更新してください。ライブラリのコードは `src/`・`web/`、制作手順と単独ワークベンチは `skills/design-workbench/` にあります。

## 必要な環境

| 使いたい機能 | 必要なもの |
| --- | --- |
| 同梱サンプルの比較・調整・書き出し | Python 3.11以上とブラウザ |
| プロジェクト別のライブラリ保存 | 上記に加えてNode.js 22以上、npm、初回の依存ダウンロード用ネットワーク |
| Skillから新しいデザインを制作 | ローカルファイルとコマンドを扱えるCodex、および `gpt-6-astra` を実行できる環境 |
| Skillから画像を生成 | 上記に加えて、ホスト側の画像生成ツールと `imagegen` Skill |

ローカルアプリとサンプルは、Codex・モデルの実行環境がなくても使えます。Cloudflareへのログイン、リモートD1の作成、アプリへのAPIキー設定は不要です。モデルの利用資格・料金・画像生成機能はホスト側の環境に依存し、このソースの配布には含まれません。Astraを呼べない場合、同梱Skillによるデザイン制作は停止します。

以下のコマンドはmacOS/Linuxのシェル向けです。Windowsでの導入は未検証です。最初にソース一式を取得・展開し、`package.json` があるディレクトリをターミナルで開いてください。まず見た目を試すなら[サンプルを起動](#サンプルを起動)、保存して使うなら次の手順へ進みます。

## ライブラリを起動

次のコマンドで依存を固定バージョンからインストールし、ローカルのD1と開発サーバーを起動します。

```sh
npm ci
npm run db:migrate
npm run dev
```

ライブラリは `http://127.0.0.1:8787/`。入口でプロジェクトを作成・選択し、その中の作品を「画面」「コンポーネント」で絞り込めます。作品を開くと比較・調整画面へ移り、戻れば所属一覧から続きを再開できます。作品はA/B/Cや派生案を含む1セッションです。お気に入り、名前での検索、独立した複製も利用できます。

新規ライブラリは空です。サーバーを起動したまま別のターミナルで同じディレクトリを開き、同梱サンプルを取り込むと比較・保存を試せます。

```sh
python3 skills/design-workbench/scripts/init_session.py --output .design-workbench/first-demo
python3 scripts/library.py import .design-workbench/first-demo
```

ブラウザを再読み込みして「未分類」の作品を開きます。`first-demo` がすでにある場合は別の出力名を使ってください。終了はサーバー側のターミナルで `Ctrl-C`。次回は `npm run dev` で保存した作品から再開できます。

既存作品と所属を指定せず保存した作品は「未分類」にあります。作品の所属と種類、プロジェクト名は後から変更できます。所属や種類を変えても、保存したデザイン・調整値・メモ・採用状態は変わりません。更新時は `npm run db:migrate` でローカルDBの追加移行を適用してください。

- `src/`：Hono APIとD1の保存処理。
- `web/`：Astraが制作するライブラリ画面。
- `migrations/`：D1のスキーマ。
- `skills/design-workbench/`：制作スキルと共通ワークベンチ。
- `.wrangler/`：Gitに含めないローカルDB。
- `.design-workbench/`：Gitに含めない制作用ファイル。

D1内の保存作品とローカル制作用ファイルは、明示的に取り込み・取り出し・反映します。既存ファイルがライブラリのブラウザ調整と自動同期されるわけではありません。

既存の制作ファイルをライブラリへ保存します。サーバーを起動したまま、別のターミナルで実行します。

```sh
python3 scripts/library.py import .design-workbench/astra-demo
```

プロジェクトを指定する場合は `--project PROJECT_ID`、コンポーネントなら `--kind component` を付けます。`PROJECT_ID` はプロジェクトURL `/projects/…` のIDです。

```sh
python3 scripts/library.py projects list
python3 scripts/library.py projects create "読書アプリ"
python3 scripts/library.py import .design-workbench/result-card --project PROJECT_ID --kind component
```

保存した作品をAstraに作り直してもらう場合は、最新版を新しいディレクトリに取り出して編集し、反映します。

```sh
python3 scripts/library.py export DESIGN_ID .design-workbench/next-edit
# Astraがnext-edit内の各案のHTML・CSS・controlsを編集
python3 scripts/library.py push .design-workbench/next-edit
```

`DESIGN_ID` は保存時に表示されるIDです。既存の制作ディレクトリは上書きせず、同時更新があれば反映を止めて知らせます。普段はCodexに「ライブラリのこの作品を元に修正して」と頼めば、この手順を進めます。

## 使い方

### Codex Skillを登録

ソースディレクトリを残したまま、ユーザー用のSkillディレクトリへリンクします。ライブラリのCLIもこのリポジトリにあるため、Skillだけをコピーせずソース一式を保持してください。下のコマンドは既存の同名エントリがあれば停止し、上書きしません。

リポジトリのルートで実行します。

```sh
python3 - <<'PY'
from pathlib import Path

source = Path("skills/design-workbench").resolve()
if not (source / "SKILL.md").is_file() or not Path("scripts/library.py").is_file():
    raise SystemExit("Run this command from the Codex Design repository root.")
target = Path.home() / ".agents/skills/design-workbench"
if target.exists() or target.is_symlink():
    raise SystemExit(f"Already exists; inspect it before changing: {target}")
target.parent.mkdir(parents=True, exist_ok=True)
target.symlink_to(source, target_is_directory=True)
print(f"Installed: {target} -> {source}")
PY
```

Codexで `$design-workbench` が候補に出ることを確認します。表示されなければCodexを再起動してください。読み込み先とsymlinkの仕様は[OpenAIのSkillドキュメント](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)を参照してください。すでに別の読み込み先へ登録済みなら、二重登録せずそのリンクを使います。

ライブラリを起動した状態で、Codexに次のように依頼します。

> $design-workbench 家計簿アプリのホームを考えたい。まず希望を聞いて、Astraが制作する3案を比較できるようにして。

ライブラリにも残すなら「この3案を家計簿プロジェクトの画面として保存して」と続けます。比較用のローカルファイルとライブラリへの保存は別の操作です。

目的や好みがまだ曖昧なら会話から始めます。内容が決まっていれば、その情報をAstraへ渡して比較案を作ります。表示・調整する案と採用する案を分けて扱い、比較時は3案を広く、調整時は1案を大きく表示します。

保存した後、Codexに「Aが近い。保存した内容を読んで、総評文を外したA2を作って」と伝えると、元の案と調整を残して派生案を作る流れです。メモ欄からAIが自動で動く機能はありません。

カードやボタン単体も「このプロジェクトのカードを3案、コンポーネントとして保存して」と依頼できます。Astraが部品のHTML/CSSと比較に適した表示サイズを制作し、既存の調整機能で確認します。現状は静的な試作で、プロジェクトのReactコンポーネントを直接実行する機能やStorybook連携はありません。部品を使った画面は別作品として保存でき、自動的なコード共有や変更の伝播は行いません。

LPや商品紹介など画像が活きる制作では、Skillは画像生成を標準の工程として扱います。たとえば、サービスを紹介する人物、利用シーン、商品の切り抜き、説明イラストを構成に合わせて自発的に生成し、実際のHTML/CSSへ組み込みます。画像生成を毎回指定する必要はありません。提供済みの素材や画像なしの指定は尊重し、ヒーローだけでなく本文の素材も必要に応じて作ります。

生成画像の原本は制作ディレクトリに保存し、プレビューには軽量な画像を埋め込みます。ライブラリは埋め込み画像を保持しますが、原本ファイルは別途引き継ぎます。現在の容量制限と具体的な制作手順は [画像素材のSkill参照文書](skills/design-workbench/references/image-assets.md) にあります。

## デザインキットを使い回す

「デザインキット」には色・寸法・書体のトークン、使い方のルール、画面やコンポーネントの実例を保存します。ライブラリの「デザインキット」から元の作品と案を選び、内容を確認して保存します。基準になる案の宣言済み値を取り込み、使い分けや配置のルールはブラウザで編集するか、CodexからAstraに整理を依頼できます。

キットの変更は新しい版として保存し、以前の版と比較できます。プロジェクトでは使うキットと版を選択します。新しい版ができても選択中の版は変わらず、既存作品のソースも自動では書き換わりません。

他のプロジェクトで「このキットで設定画面を3案作って」と依頼すると、Skillが選択中の版のトークン・ルール・実例をAstraに渡します。色だけでなく、文字組みや部品の使い方も制作に反映します。

```sh
python3 scripts/library.py kits list
python3 scripts/library.py kits show KIT_ID --version 1
python3 scripts/library.py projects kit PROJECT_ID
python3 scripts/library.py projects use-kit PROJECT_ID KIT_ID --version 1 --revision PROJECT_REVISION
python3 scripts/library.py kits export KIT_ID NEW_DIRECTORY --version 1
```

exportは新規ディレクトリにkit.json、tokens.css、GUIDE.md、実例を出力します。ブラウザからもまとめて持ち出せます。実際のReactコンポーネントをインストールするnpmパッケージではありません。

キットの内容をAstraに編集してもらう場合は、`kits show`で取得したcontentを別ファイルに保存し、`kits version KIT_ID CONTENT_JSON --revision KIT_REVISION --summary "変更内容"`で新しい版を作ります。古いrevisionでの保存は拒否されるので、最新内容と下書きを照合してください。詳細な制作・再利用の手順は [キットのSkill参照文書](skills/design-workbench/references/kits.md) にあります。

## デザインと枠組みの役割

- **Astra**: 案の構成、配色、文字組み、HTML/CSS、その案で役立つ調整項目、フィードバックを受けた派生案を制作します。Lunaにデザインを委譲しません。
- **ワークベンチ**: 同じ内容・表示幅での比較、拡大と調整、案の採用、保存と競合処理、書き出しを共通化します。題材固有の見た目は各案に持たせます。
- **監督役**: 会話、Astraへの依頼、成果の統合、保存状態と実ブラウザの検証を担当します。モデルの呼び出し実績と成果物を照合し、単なるメタデータをAstra制作の証拠にはしません。

Astraを利用できない環境では、その状態を伝えて止めます。別モデルへの無断の代替はしません。ローカル画面の起動にAPIキーは不要ですが、デザイン制作にはホスト側でAstraを実行できる必要があります。

## サンプルを起動

Python 3.11以上が必要です。外部パッケージ、APIキー、クラウドへのデプロイは不要です。

```sh
python3 skills/design-workbench/scripts/init_session.py --output .design-workbench/astra-demo
python3 skills/design-workbench/scripts/serve.py --project .design-workbench/astra-demo --port 8765
```

ブラウザで `http://127.0.0.1:8765` を開きます。サンプルは架空の展覧会ガイド「よりみち」で、同じ展示データを異なる構成で比較します。サーバーは `Ctrl-C` で終了します。既存セッションの初期化は上書きせず終了するため、新版を試すときは新しい出力ディレクトリを指定してください。

## 保存と引き継ぎ

- 各案の `A/index.html`・`A/style.css`・`A/controls.json` をAstraが編集します。B/Cや派生案A2も、それぞれのディレクトリを持ちます。
- `session.json` にはブリーフ、案の名前とファイル参照、選択、調整値、初期値、感想を保存します。ブラウザ操作でデザインのソースファイルは書き換わりません。
- 案ごとの宣言から調整パネルを作り、色・数値・選択肢などの操作を即時反映します。
- PDFは表示中の1案、または全案の比較資料として出力できます。JSONはHTML/CSSも含む持ち運び用、Markdownは採用した案の実装への引き継ぎ用に書き出せます。
- 構造変更はAstraが各案のファイルを更新し、ワークベンチが読み込みます。通常のデザイン制作で比較画面や保存処理を編集する必要はありません。プレビュー内の要素をドラッグするエディタや、任意の文言の直接編集はこの版の対象外です。
- Expoに採用する場合は、選んだ見た目をReact Nativeのコンポーネントに移します。プレビューでの確認と実機確認は別です。

### PDFで持ち出す

ワークベンチの「PDF」から、表示中の1案または全案を選んで印刷用の画面を開きます。ブラウザの印刷画面で保存先を「PDFに保存」にすると、共有用のPDFになります。単体の対象は採用案ではなく現在表示・調整している案です。全案の出力では、案の名前を付けて1案ずつページを分けます。作品の幅と高さに合わせた用紙サイズを使うため、長いLPは縦長のPDFになります。背景のグラフィックを有効、ヘッダーとフッターを無効にし、倍率100%で保存してください。

出力には現在の色・文字サイズ・調整値と埋め込み画像を使います。PDFを作っても採用状態や作品の保存内容は変更しません。固定配置、画面の高さに依存するレイアウト、内部スクロール、印刷専用CSSは元の表示と異なる場合があるため、保存前に印刷プレビューを確認してください。PDFは見た目を共有するための形式で、再編集や原本画像の引き継ぎにはJSON・HTML/CSSと素材ファイルを使ってください。

このワークベンチはVisual Companionの「会話とブラウザ比較を往復する」進め方を参考にした独立した実装です。Superpowersのインストール先や内部ファイルには依存しません。

既存のJSON内蔵形式も読み込めます。ファイル形式へ変換するときは、ブラウザの保存完了を確認してそのセッションのサーバーを停止し、次を実行してから再起動します。

```sh
python3 skills/design-workbench/scripts/migrate_session.py --project .design-workbench/astra-demo
```

変換前のJSONをバックアップし、調整値・初期値・採用・メモを引き継ぎます。既存の案ディレクトリは上書きしません。ファイルの契約と派生案の作り方は [workshop.md](skills/design-workbench/references/workshop.md) にあります。

## 検証

```sh
npm run typecheck
npm run check:i18n
npm test
python3 skills/design-workbench/scripts/test_runtime.py
```

ローカルD1で保存・お気に入り・複製・競合とCLI連携をテストします。画面変更時にはブラウザで一覧からの再開、比較、個別調整、再読み込み、リセット、書き出しを確認します。

`web/` や共通ワークベンチのassetsを編集した後は、起動中でも `npm run prepare-assets` で表示用ファイルを更新できます。制作用の各案ファイルを編集する場合は、ファイル用プレビューまたはライブラリのexport/push手順を使います。

制作モデルと実際の検証結果は [VERIFICATION.md](VERIFICATION.md) に記録します。

## 更新・バックアップ・削除

更新前にサーバーを終了し、`.wrangler/`（ライブラリDB）と `.design-workbench/`（制作用ファイル・画像原本）を両方バックアップします。これらはGitで保存されません。他の場所へ出力した作品や画像も別途保管してください。ソースを更新したら `npm ci` → `npm run db:migrate` → `npm run dev` の順で起動します。DB移行後の古い版への巻き戻しは未検証です。

Skillのリンクは同じソースディレクトリへの更新を反映します。ソースを移動した場合はリンク先を確認して登録し直してください。登録解除は、自分で作った `~/.agents/skills/design-workbench` がsymlinkであることを確認して、そのリンクだけを削除します。アプリを削除する場合も、先に作品とDBを退避してください。

## ライセンスと参加

本リポジトリのコード、文書、Skill、同梱サンプルには [MIT License](LICENSE) を適用します。依存ライブラリには各ライブラリのライセンスが適用されます。[第三者ソフトウェアの情報](THIRD_PARTY_NOTICES.md)を参照してください。利用者が持ち込む作品・素材や生成物に、本リポジトリのライセンスが自動的に適用されるわけではありません。

変更の提案と検証方法は [CONTRIBUTING.md](CONTRIBUTING.md)、ソースの配布範囲とアーカイブ作成手順は [docs/oss-distribution.md](docs/oss-distribution.md) にあります。
