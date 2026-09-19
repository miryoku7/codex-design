# Japanese and English workshops / 日英の制作

Use the same workflow and saved-state contract in both languages. The skill's English instructions are shared operating rules; they do not require an English conversation. `agents/openai.yaml` contains one bilingual launcher prompt, not separate locale-specific settings.

## Invocation examples / 依頼例

| Task / 目的 | 日本語 | English |
| --- | --- | --- |
| Start / 新規制作 | `$design-workbench 家計簿アプリのホームを3案作って。まず希望を聞いて。` | `$design-workbench Create three home screen directions for a budgeting app. Ask about my preferences first.` |
| Revise / 派生案 | `保存したメモを読み、Aを残して余白を広げたA2を作って。` | `Read my saved notes. Keep A and create A2 with more space.` |
| Save / 保存 | `この作品を家計簿プロジェクトの画面として保存して。` | `Save this work as a screen in the Budgeting project.` |
| Mixed languages / 言語を分ける | `説明は日本語で、画面の文章は英語にして。` | `Explain in English, but keep the screen copy in Japanese.` |

## Language decisions / 言語の決め方

- **Conversation / 会話:** Follow the latest explicit language request, then the language of the user's message. Do not ask again when it is already clear. 最新の明示指定を優先し、なければ依頼文の言語を使います。
- **GUI / 操作画面:** Use the 日本語 / English selector. The saved browser choice takes priority over supported browser languages; the fallback is Japanese. The choice is stored per origin, so the library and a standalone server on another port can differ. 保存済みの選択を優先し、別ポートの単独起動には引き継がれません。
- **Authored content / 制作物:** Preserve the existing language unless translation is part of the brief. New work follows the requested content language, otherwise the conversation language. A Japanese demo is sample content, not a language preference. 作品名・本文・調整項目名・メモ・キットのルールは自動翻訳しません。
- **Handoff / 引き継ぎ:** Tell Astra both the conversation and content languages. Explain the result in the conversation language while preserving IDs, paths, code, and user-authored text. 会話言語で結果を伝え、ID・パス・コード・利用者の文章は保持します。

GUI switching must not create a saved-state update. Translating an existing design is a content revision: follow the ordinary snapshot and derivative workflow, preserve the original, and use the latest library export/revision when applicable. 表示言語だけを変える操作では作品を保存し直しません。作品自体の翻訳は、元を残した通常の派生案制作として扱います。

## GUI vocabulary / 画面の用語

| 日本語 | English | Meaning / 意味 |
| --- | --- | --- |
| プロジェクト | Project | A group of saved works / 作品の所属 |
| 未分類 | Unassigned | Works without a project / 所属未指定 |
| 画面 | Screen | A complete screen work / 画面全体の作品 |
| コンポーネント | Component | A static component work / 静的な部品の作品 |
| 比較 | Compare | View directions together / 案を並べて見る |
| 採用 | Adopt | Select the handoff direction / 引き継ぐ案を選ぶ |
| デザインキット | Design kit | Versioned tokens, rules, and examples / 版を持つトークン・ルール・実例 |

GUI translations are maintained in `assets/workbench/i18n.js`. Keep commands and machine-readable API/CLI fields locale-independent; do not translate schema keys or filenames. `npm run check:i18n` from the repository root checks GUI dictionary coverage. It does not grade prose quality or prove the skill was executed successfully in another Codex installation.
