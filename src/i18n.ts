import { InvalidInput } from './session';

export type Locale = 'ja' | 'en';
/** Locale only controls newly generated system text, never saved authored content. */
export function locale(value: unknown): Locale {
  if (value === undefined) return 'ja';
  if (value !== 'ja' && value !== 'en') throw new InvalidInput('locale must be ja or en');
  return value;
}

export const kitMessages = {
  ja: {
    accent: '操作と強調に使う色', background: '画面の背景色', text: '本文の文字色',
    spacing: '基本の余白', fontSize: '本文の文字サイズ', radius: '基本の角丸',
    newKit: '新しいデザインキット', initialVersion: '初版',
    rules: '## 基準\n\n最初に選んだ実例の調整後の値と、型を確認できる CSS 変数をトークンの初期値にしています。\n\n## 使い方\n\n実例の構成・余白・文字組みを参照し、このキットの役割と使い分けを編集してください。レイアウトの共通ルールや構成の抽出は、実例を確認して Astra または利用者が記述します。\n\n属性や型を特定できない調整は実例に保持しています。トークンを使わず固定値で書かれた箇所には自動反映されません。',
    preview: '安全なプレビュー', source: '保存したソース', provenance: '出典', tokens: 'トークン', examples: '実例',
    guide: 'preview.html はそのままブラウザで開けます。保存時の調整値へキットのトークンを重ね、sandbox 内で表示します。任意スクリプト・外部通信は無効です。variant.json は調整後の値とリセット値を含む元の静的ソースです。\n\nkit.json は kits create の入力として読み込めます。別のキットの version 1 として登録され、既存キット・作品・プロジェクトは更新しません。トークンの利用箇所への移植は利用先で行います。',
  },
  en: {
    accent: 'Color for actions and emphasis', background: 'Screen background color', text: 'Body text color',
    spacing: 'Base spacing', fontSize: 'Body text size', radius: 'Base corner radius',
    newKit: 'New design kit', initialVersion: 'Initial version',
    rules: '## Basis\n\nInitial tokens use the adjusted values from the first selected example and CSS variables with known types.\n\n## Usage\n\nRefer to the examples for composition, spacing, and typography, then edit the role and usage of this kit. Astra or the user should review the examples and describe shared layout and composition rules.\n\nAttribute controls and adjustments with unknown types remain in the examples. Tokens do not automatically replace hardcoded values.',
    preview: 'Safe preview', source: 'Saved source', provenance: 'Source', tokens: 'Tokens', examples: 'Examples',
    guide: 'Open preview.html directly in a browser. It overlays kit tokens on the saved adjustments and renders inside a sandbox. Authored scripts and external requests are disabled. variant.json preserves the original static source, adjusted values, and reset values.\n\nUse kit.json as input to kits create. This creates version 1 of a separate kit; existing kits, works, and projects remain unchanged. Integrate tokens explicitly in the destination project.',
  },
} satisfies Record<Locale, Record<string, string>>;
