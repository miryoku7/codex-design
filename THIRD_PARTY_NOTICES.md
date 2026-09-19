# Third-party software and assets

Codex Designの独自コード、文書、Skill、同梱サンプルは [MIT License](LICENSE) で提供します。第三者のソフトウェアの権利・ライセンスを置き換えるものではありません。

## ソース配布と依存パッケージ

配布対象はソースと `package-lock.json` です。`node_modules/`、Workersの実行バイナリ、ビルド済みバンドルは同梱しません。利用者が `npm ci` で依存を取得します。各パッケージのライセンス原文・著作権表示は取得したパッケージに含まれています。

2026-09-17時点のlockfileで確認した直接依存は次のとおりです。更新時はlockfileと実際の配布物を再確認してください。

| パッケージ | 固定バージョン | 用途 | パッケージのライセンス表示 |
| --- | --- | --- | --- |
| hono | 4.13.7 | アプリのAPI | MIT |
| @cloudflare/workers-types | 5.20260910.1 | 開発用の型定義 | MIT OR Apache-2.0 |
| esbuild | 0.28.2 | テスト用のバンドル | MIT |
| acorn | 8.15.0 | 翻訳漏れ検査のJavaScript構文解析（2026-09-19追加） | MIT |
| miniflare | 5.20260908.0-alpha | ローカルWorkers/D1 | MIT |
| typescript | 7.0.2 | 型検査 | Apache-2.0 |
| wrangler | 4.130.0 | ローカル開発・DB移行 | MIT OR Apache-2.0 |

これは直接依存の一覧で、推移依存すべてのライセンス原文を集約したものではありません。推移依存には `sharp`（Apache-2.0）、`@img/sharp-libvips-*`（LGPL-3.0-or-later）、複数ライセンスを併記するプラットフォーム用パッケージも含まれます。バイナリ、コンテナ、依存入りアーカイブなどへ配布形式を変える場合は、実際に含めるパッケージの告知・ソース提供等の条件を改めて確認してください。本書だけでそれらの条件を満たすとはしていません。

## Hono

Honoの著作権表示とMITライセンスを以下に保持します。

```text
MIT License

Copyright (c) 2021 - present, Yusuke Wada and Hono contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## サンプルと制作素材

同梱サンプル「よりみち」は架空の展覧会ガイドです。Git追跡対象に写真・フォントのバイナリはありません。利用者の作品、入力画像、生成画像の原本、ローカルDBはソース配布の対象外です。デモを追加する場合は、素材の出所と配布できる条件を確認し、必要な表示も同梱してください。

## 参考にした取り組み

比較画面と会話を往復する制作手順はSuperpowersのVisual Companionを参考にしています。本リポジトリでは独立したランタイムとして実装しており、Superpowersを同梱したりインストール先からコードを読み込んだりしません。参考にしたことは、第三者コードをそのまま再配布できる根拠にはしません。
