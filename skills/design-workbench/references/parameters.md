# Optional parameters / 調整パラメータ

Initial creation defaults to **no parameters**. Author the HTML/CSS at the requested viewport first; skip parameter planning, bindings, `controls.json`, and adjustment tests. Do not defer real imagery or other requested design content. Parameters are opt-in, either in the initial request or at any later turn.

初回はデザインだけを作ります。「最初から見出しサイズを調整したい」と指定された場合だけ一緒に作成します。後から「Aに余白と見出しサイズの調整を追加して」「Add heading-size controls to A」と依頼できます。追加はCodexとの会話から行い、ブラウザのメモだけではAIは動きません。

## Minimal variant

Use the existing v2 session envelope from `workshop.md`. A parameter-free variant needs only these fields; the initializer's bundled example remains a control demonstration and must be replaced for real work:

```json
{
  "id": "A",
  "name": "Editorial",
  "rationale": "Lead with the story",
  "sources": {"html": "A/index.html", "css": "A/style.css"},
  "tokens": {},
  "notes": ""
}
```

Omit `sources.controls`, `baselineTokens`, `tweakValues`, and `baselineTweakValues` when unnecessary. Empty objects are also valid. The preview retains its common CSS defaults; Astra styles the design directly. No adjustment inputs or reset action appear. Comparison, focus, notes, adoption, JSON/HTML/CSS/PDF export, library import/export, and duplication remain available. Existing parameterized sessions retain their controls.

## Add controls later

1. Read the latest saved state and HTML/CSS. For library works, export the latest revision into a fresh directory using `library.md`; preserve `.library.json` and never force its revision. For standalone works, wait for the browser to be saved. Snapshot the manifest and referenced files before editing.
2. Dispatch Astra with **parameter mode: requested**, the exact variant and controls, current appearance and values, and owned paths. Add controls to that variant; retain its ID, other variants, notes, selection, and existing values. If a new composition is requested too, use the ordinary derivative workflow.
3. Create `A/controls.json` and add `"controls": "A/controls.json"` to `sources`. For a design-specific control, keep `tokens: {}` in the controls file and session. Declare `version: 1` and `tweaks` as in `workshop.md`. Replace only the target CSS value with the binding, using the currently displayed value as its default so adding the control preserves the appearance. Initialize the new ID in `tweakValues` and `baselineTweakValues`; preserve every existing entry. For base controls, initialize the complete six-token set and its reset baseline from the current design, and wire all six visibly. Do not create unrequested base controls.
4. Validate and refresh. Library works use conditional `push`; standalone source/manifest edits participate in revision checks. A stale browser save must conflict. Keep an unsaved draft and reconcile it rather than overwriting source or control definitions.
5. Verify the requested controls visibly change only the intended variant, save/reload persists the values, and reset restores the values at addition while preserving notes and adoption. The usual preview verifier exercises declared ranges; color/select/toggle controls require their corresponding verification when requested. Report any verification boundary.

Removing controls or narrowing values requires explicit reconciliation of live and reset state. Do not silently discard saved adjustments. Parameter-free designs have no declared kit tokens; add the relevant tokens before using one as the basis of a token kit.
