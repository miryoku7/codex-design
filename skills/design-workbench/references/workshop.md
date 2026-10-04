# Local workshop

## Layout and launch

Resolve `SKILL_DIR` to the directory containing this SKILL.md. Choose a project-local session directory such as `.design-workbench/homepage`; keep private briefs and exports out of version control unless the user chooses otherwise.

```sh
python3 "$SKILL_DIR/scripts/init_session.py" --output .design-workbench/homepage
python3 "$SKILL_DIR/scripts/serve.py" --project .design-workbench/homepage --port 8765
```

The initializer creates the fictional exhibition-guide example to demonstrate the controls. Have Astra replace its brief and variants with task-specific content before presenting it as the user's product design. It must not overwrite an existing session. For this skill's own demo, keep the example clearly identified. Use a fresh session directory for a new brief; retain prior sessions and their user feedback.

Use the execution tool's persistent process/session mechanism. Keep the returned process handle; stop it with Ctrl-C when review is finished. The server binds only to 127.0.0.1. If the port is occupied, choose another port and report the actual one; do not stop an unknown process. A sandbox listener failure is not proof of a host failure: retry the smallest authorized host launch if needed.

## Data contract

New sessions use file-backed **version 2**. A session directory is a small editable project:

```text
homepage/
  session.json
  A/
    index.html
    style.css
    controls.json  # optional; created only when parameters are requested
  B/...
  C/...
```

The authored source of each design lives in its HTML/CSS files and optional controls file. Initial generation defaults to `tokens: {}` with no `sources.controls`; no parameter definitions or bindings are required. See [parameters.md](parameters.md) for the minimal manifest and later additions. `session.json` owns the brief, variant metadata, source references, adopted/viewed IDs, notes, current adjustment values, and reset baselines. Read both layers on continuation. Do not copy HTML/CSS into a v2 session or write the browser's hydrated API response directly to disk.

For generated imagery, follow [image-assets.md](image-assets.md): keep original files under the session's `assets/`, embed compact `data:` images in HTML/CSS, and check the source/session size limits. The preview does not load relative or external image URLs, and library exports do not bundle the separate asset directory.

A v2 variant retains `id`, `name`, `rationale`, optional `summary`/`designer`, and saved state. The example below has requested parameters; for the default parameter-free variant use the minimal example in `parameters.md`:

```json
{
  "id": "A",
  "name": "読む本を中心に",
  "rationale": "進行中の本を一番大きく配置",
  "sources": {
    "html": "A/index.html",
    "css": "A/style.css",
    "controls": "A/controls.json"
  },
  "tokens": {
    "accent": "#31594a", "background": "#faf9f5", "text": "#242925",
    "spacing": 24, "fontSize": 16, "radius": 12
  },
  "baselineTokens": {
    "accent": "#31594a", "background": "#faf9f5", "text": "#242925",
    "spacing": 24, "fontSize": 16, "radius": 12
  },
  "tweakValues": {"headingSize": 32},
  "baselineTweakValues": {"headingSize": 32},
  "notes": ""
}
```

When parameters are requested, `A/controls.json` declares author defaults and the requested controls useful for this design:

```json
{
  "version": 1,
  "tokens": {
    "accent": "#31594a", "background": "#faf9f5", "text": "#242925",
    "spacing": 24, "fontSize": 16, "radius": 12
  },
  "tweaks": [{
    "id": "headingSize", "label": "見出しサイズ", "type": "range",
    "default": 32, "min": 24, "max": 48, "step": 1,
    "cssVar": "--heading-size", "unit": "px"
  }]
}
```

For example, `index.html` contains `<main><h1>読書の記録</h1></main>` and `style.css` contains `main{padding:var(--spacing)}h1{font-size:var(--heading-size);color:var(--accent)}`. Both HTML fragments and complete documents are supported; complete documents retain their HTML/body attributes, title, and embedded styles after sanitization. Author HTML/CSS directly with normal multiline editing. The runtime loads the declared stylesheet; an external stylesheet link is not required. Each preview is isolated from the shell and the other variants.

Use semantic markup and inline SVG for illustrations/charts. Scripts, embeds, external fonts/images, navigation, and native API simulations remain outside this static preview contract. Check that larger text and longer content do not clip. The common renderer provides basic CSS defaults and the declared variables, without a subject-specific component kit.

Initialize both current and reset values when creating a variant. Existing saved values take precedence over author defaults; changing source files must not erase user adjustments. New control IDs can obtain missing values from their defaults. When removing a control or narrowing its accepted values, reconcile the corresponding saved current/reset values explicitly; invalid state must be reported rather than silently discarded. Keep notes as plain text. Brief fields may be empty during the interview.

Top-level fields are `version: 2`, `id`, `title`, `brief: {purpose,audience,platform,mood,avoid}`, `selectedId`, `variants`, and optional `viewport`, `view`, `sample`, `designer`. Source paths are relative to the session directory and must stay inside it; use dedicated variant directories and no symlinks. The server reads authored files but browser saves only update session state. It includes source edits in revision checks, so a stale browser save cannot overwrite a newer design.

Choose the preview viewport for the actual target. Compare all directions at equal dimensions and clearly distinguish a scaled overview from native-size inspection. The browser's outer dimensions are not the iframe viewport. In focused inspection, keep the visible design and its controls together. Record the viewport with the final design.

`viewport.width` accepts integer 240–2560 and `height` 320–2160. `preset` is `mobile`, `tablet`, `desktop`, or `custom`. `view.mode` is `compare` or `focus`; `view.activeId` is the displayed/adjusted variant. `selectedId` is the adopted variant and may remain null throughout exploration. Changing the active view or tweaking its values does not imply adoption.

After a verified invocation, store `designer: {"model": "gpt-6-astra", "role": "design-author"}` at session level and on the authored variants. Preserve provenance on derivatives and keep a separate dispatch receipt as explained in `astra-handoff.md`.

## Design-specific controls

Base `tokens` may be `{}` (no base controls) or the existing complete six-token set. Only declare the six-token set when all its controls are useful and wired to the design. Astra optionally declares `tweaks` in each `controls.json`, with current values in the session variant’s `tweakValues` and reset values in `baselineTweakValues`. The browser API hydrates these definitions into `variant.tweaks`. Every control has a stable `id` and a short user-facing `label`. Use either `cssVar` (a CSS custom-property name) or `attribute` (a safe data-attribute name), never both. Values are applied on the iframe's `document.documentElement`.

A select uses `options: [{"value": "compact", "label": "コンパクト"}, {"value": "spacious", "label": "ゆったり"}]`. Its CSS could respond to `:root[data-density="compact"]` or to a declared CSS variable. The values must correspond to real CSS behavior, not controls that only update a form field.

Supported `type` values:

| Type | Value and definition |
| --- | --- |
| `range` | Numeric `default`, `min`, `max`, optional positive `step`; CSS-variable bindings can append `unit` (`px`, `rem`, `em`, `%`, `deg`, or empty). |
| `color` | Six-digit hexadecimal `default` and value. |
| `select` | String `default`/value from 2–12 declared `{value,label}` options. |
| `toggle` | Boolean `default`/value; attribute bindings become strings `"true"` / `"false"` for CSS selectors. |

Read the current schema validation in `scripts/serve.py` before adding a new control definition; unsupported definitions must not silently appear as working controls. Keep controls few and useful for the direction, initialize both live and reset values, and include definitions plus values in exports. Preserve other directions' values when editing one.

## Revisions

Before an agent edit, read the saved state and confirm the browser says saved. Preserve a dated snapshot of the session and all referenced variant files outside the active working files. Read and retain runtime baseline values so reset remains meaningful. For a derivative, give it a new ID and its own initial token baseline rather than accidentally reusing the original option's reset values.

Use atomic replacements when saving source files and valid session JSON. Do not edit while a browser draft is unsaved. The runtime's conflict handling is a safety net; it is not a reason to run independent writers on the same file. After changing the session, verify the browser actually shows the new ID and content.

Exports are portable copies, not a second source of truth. Always read session.json and its referenced variant files on resuming an active workshop. Notes do not automatically trigger an agent. The next user message, such as “保存した内容からA2を作って”, is the continuation signal.

JSON exports the whole hydrated session as portable inline version 1, removing source references so it can be used without the original directories. The handoff export uses the adopted variant even when another option is currently displayed. The individual HTML/CSS exports use the displayed variant. CSS export includes root-attribute requirements; full HTML is the simplest self-contained reproduction. Preview scripts remain disabled, so in-preview search/save buttons are static representations. A tweak rebuilds the iframe and resets its internal scroll position; this version does not provide element-level editing or scroll-preserving live DOM updates.

PDF output offers the currently displayed variant or all variants in source order. It uses the live adjustment values and embedded images without adopting an option or mutating the session. Open the PDF print view, then choose the browser's Save as PDF destination with backgrounds on, headers/footers off, and 100% scale. Each variant occupies one custom-sized page at the design width; long pages produce a tall PDF. Fixed/vh-based layouts, internal scrolling, and authored print CSS can differ from the screen, so inspect the print preview. This is a visual sharing format; keep JSON/HTML/CSS and original asset files for editable handoff. Browser print settings and successful creation of a PDF are separate from saving the workshop state.

For changes to the bundled demonstration only, edit `scripts/build_example.py` and regenerate `assets/workbench/example/session.json` together with its A/B/C source files. The generator must not overwrite active workshop sessions. For an actual user workshop, Astra edits its variant files and necessary session metadata rather than modifying the global demo generator.

## Existing sessions and migration

Inline version 1 sessions remain supported. Convert an existing session with:

```sh
python3 "$SKILL_DIR/scripts/migrate_session.py" --project .design-workbench/homepage
```

Wait until the browser says saved and stop that session's server before migration. The migrator snapshots the original inline session, preserves current values, persisted reset baselines, notes and selection, and creates the variant files without overwriting existing directories. Very old sessions may have reset baselines only in browser storage; the CLI cannot recover those values, so capture them before migrating when the original reset state matters. Restart the server using the same project directory after migration and reload its browser tabs. A migration is not a request to generate new designs or reset choices. Keep other sessions unchanged.

## Acceptance checks

1. Same content and values across initial directions, with a meaningful composition difference.
2. Compare and focus views usable at the intended viewport; focused design and its controls visible together, brief not dominating the canvas.
3. Parameter-free designs have no adjustment inputs or reset button. When parameters are declared, a tweak changes its own option, leaving other options intact.
4. Adopted selection, active review option, brief, notes, viewport, and values survive a reload; reset returns to that option's baseline without silently adopting it.
5. JSON and handoff export contain the selected direction and final values.
6. External session changes become visible without silently losing a browser draft.
7. Actual Astra invocation is recorded separately from self-reported model labels; rendered screenshots satisfy the visual criteria in SKILL.md.

Checks 2–4 can be exercised with one command: `node "$SKILL_DIR/scripts/verify_preview.mjs" --url <preview URL>` (see SKILL.md, Visual acceptance). It covers viewport screenshots, keyboard control changes with focus and save status, and reload persistence; it does not cover checks 1, 5, 6 or 7.

For a new runtime version run `python3 "$SKILL_DIR/scripts/test_runtime.py"`. Structure validation alone does not establish these browser behaviors.
