# 日英GUIのブラウザ確認 — 2026-09-19

Chrome、デスクトップ1440×1000／モバイル390×844。管理ブラウザと検証専用D1・同梱サンプルを使用しました。日本語の作品名、本文、独自調整項目、英語で作成したキットのルールなどは保存済みの内容なので、GUIの言語を切り替えても保持しています。

掲載画像は、HTMLの重複文言を除去して辞書へ一本化した後に再撮影しました。初期表示は別途、辞書の読み込みを意図的に遅延・失敗させるブラウザ試験で確認しています。

| 画面 | 日本語 | English |
| --- | --- | --- |
| ライブラリ／desktop | [表示](ja-library-desktop.png) | [View](en-library-desktop.png) |
| ライブラリ／mobile | [表示](ja-library-mobile.png) | [View](en-library-mobile.png) |
| 比較・調整／desktop | [表示](ja-workbench-desktop.png) | [View](en-workbench-desktop.png) |
| 比較・調整／mobile | [表示](ja-workbench-mobile.png) | [View](en-workbench-mobile.png) |
| キット上部／desktop | [表示](ja-kit-desktop.png) | [View](en-kit-desktop.png) |
| キット上部／mobile | [表示](ja-kit-mobile.png) | [View](en-kit-mobile.png) |
| キット実例／desktop | [表示](ja-kit-preview-desktop.png) | [View](en-kit-preview-desktop.png) |
| キット実例／mobile | [表示](ja-kit-preview-mobile.png) | [View](en-kit-preview-mobile.png) |

キットは画面外iframeの全ページ撮影を避け、上部と実例が見える位置で分けて撮影しました。横はみ出しがなく、両言語で操作名を読み取れること、作品のプレビューが描画されることを確認しています。比較・調整のmobileは採用・メモ保存後、desktopは保存操作前の状態です。

操作・保存・競合・検査コマンドの結果と未検証範囲は [VERIFICATION.md](../../../VERIFICATION.md) にあります。GUIの制作は `gpt-6-astra` / `medium`、起動タスク `/root/astra_i18n_gui`。見た目の採用は利用者の判断です。
