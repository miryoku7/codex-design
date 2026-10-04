---
name: design-workbench
description: Have Astra design screens, landing pages, or components with generated image assets, compare and tweak them in a browser, and resume saved works from a Design Library. Use for design exploration before implementation, in Japanese or English. 日本語・英語で画面や部品の案を制作・比較・調整する。
---

# Design Workbench

Turn “show me a few directions” into an Astra-led browser workshop. Astra owns the design; the workbench supplies consistent comparison, focus, live controls, saved feedback, and export. Use the user's language.

## Language / 言語

Use the user's latest requested conversation language (Japanese or English); otherwise continue in the language of their request. Explain questions, comparisons, save/conflict messages, and handoffs in that language. Do not infer the conversation language from an existing Japanese sample or the browser setting. Read [references/language.md](references/language.md) for bilingual invocation examples and terminology when guiding either workflow.

The GUI has its own 日本語 / English selector, shared by the library, kits, and workbench on the same origin. A saved choice takes priority over browser languages; unsupported languages fall back to Japanese. Switching it does not translate saved works or change their revision. Keep the language of authored copy, variant names, control labels, notes, and kit rules unless the user requests a translation. If a user asks for an English screen in a Japanese conversation, conduct the conversation in Japanese and have Astra author the screen in English. Include both languages explicitly in the Astra handoff. CLI commands, IDs, paths, and schema keys stay unchanged.

日本語の依頼には日本語で、英語の依頼には英語で応答します。会話の言語、GUIの表示言語、制作する作品の言語は別々に扱います。既存作品やメモを、表示言語の切り替えだけで翻訳・上書きしません。

Image generation is part of design authorship. For landing pages and other image-led work, proactively create and integrate useful photos, illustrations, and supporting assets; do not wait for the user to say “use imagegen.” Read [references/image-assets.md](references/image-assets.md) when planning that work, before authoring the layout.

For saved works in the Codex Design library, read [references/library.md](references/library.md). Library snapshots and local author files are explicit working copies: export the latest saved design before revising it and push with its revision receipt. Do not assume browser adjustments in the library have already reached an older local directory.

For a project with a selected design kit, or requests to create, revise, export, or reuse a kit, read [references/kits.md](references/kits.md). Read the pinned version's tokens, rules, and real examples before Astra designs; project selection alone does not apply styles to new or existing source files.

## Required design ownership

Use **Astra (`gpt-6-astra`)** for the workshop's design work: visual concepts, composition, typography, color, actual HTML/CSS, useful tweak controls, and subsequent design revisions. A different model must not make a design first and merely ask Astra to approve it. Do not delegate this work to Luna.

If the current model is verifiably Astra, it may author designs directly. Otherwise dispatch a bounded Astra task with the model explicitly selected; read [references/astra-handoff.md](references/astra-handoff.md) for the handoff. If Astra is not callable, explain the limitation and preserve the brief. Do not silently substitute a model or label another model's output Astra. A fallback requires the user's explicit choice.

The supervisor handles scope, interview, persistence, integration, and verification. It can fix mechanical defects without re-authoring Astra's design. Route substantive visual corrections back to Astra. For this workflow, other-model implementation delegation also needs the user's explicit permission; a general cheap-worker default does not override the Astra requirement.

Record the actual design author and the dispatch evidence with the session. Generated provenance fields alone are not evidence that a model was used.

## 1. Start with a short conversation

Read what the user has already told you. Ask the most useful missing question first, usually “何の画面を、誰が使うために作りますか？” Then clarify the target device/framework, most important content/action, and desired feel or reference. Ask one question at a time; do not repeat supplied information or make a long intake form mandatory.

If taste is unclear, offer to discover it through three visual directions. “おまかせ” is sufficient to proceed with stated assumptions. A reference is evidence about preferences, not permission to copy assets or a reason to force every aspect of its style. If the user asks to start immediately, use supplied content and reasonable defaults.

Record the brief in the session. For an existing product, inspect its relevant screen and design constraints before proposing changes. Keep the preview work scoped separately from product implementation.

When evolving an existing product, read [references/product-handoff.md](references/product-handoff.md) to connect the chosen design to its existing components and layout rules. If the user identifies a preferred existing screen, record that screen and its current source as the baseline; preserve that preference when extracting shared rules.

For a component workshop, identify the component, its intended container size, and the states that matter (such as long content, missing image, or selected). Use the same content/state across design directions. Author a static HTML/CSS component at a useful viewport; do not surround every component with a fictional full screen. A separate screen work can show its usage context, but saved works do not automatically share live component code. The library's `component` kind does not execute the project's React code or provide Storybook integration.

When saving to the library, carry forward the user's project and screen/component intent through [references/library.md](references/library.md). An authoring directory and a library project are different objects; do not infer that creating local files registered a project or saved a library work.

## 2. Generate comparable directions

Read [references/workshop.md](references/workshop.md) for session setup and iteration mechanics. Use the bundled runtime for presentation. It runs locally without Superpowers, Figma, or an API key; Astra execution comes from the host's model/delegation capability and must be verified separately.

Default to three genuinely different compositions using the SAME content and values. Change hierarchy, layout, density, typography, and how the main information is presented. Three palette swaps are not three directions. Adapt fidelity to the question. Label sample data as sample data and use the user's actual content when available.

Assign stable IDs such as A/B/C and short names explaining their intent. Keep rationale outside the mock screen. Avoid decorative metrics, unsolicited explanatory prose, or a generic dashboard when the task is a list, form, or editorial screen.

### Create the imagery the design needs

For a new LP, campaign, product introduction, or editorial page, include image generation in the initial production pass unless the user requests an image-free direction or suitable supplied assets already cover the need. Astra decides the visual roles and prompts: for example, a person introducing the service in the hero, a scene showing its use, and a product cutout or explanatory illustration further down the page. Generate multiple assets when those distinct roles improve the page; one decorative hero is not a ceiling. Keep the asset plan brief and proceed without a separate permission question for routine generation within the brief.

Use the available `imagegen` skill and built-in image generation tool. Generate actual assets and wire them into the HTML/CSS before presenting a finished direction. Do not stop at prompts, empty image slots, CSS silhouettes, emoji, or a suggestion to add photos later. Keep headlines, buttons, and other editable UI in HTML/CSS rather than rasterizing the entire page. Reuse suitable generated assets across A/B/C when comparing layouts; generate a different treatment when the visual direction calls for it.

For text-only adjustments, utility forms, or small controls, preserve the task's scope; do not add unrelated imagery. For image-led work, skipping generation needs a concrete reason such as supplied assets, an explicit preference, or an unavailable tool. Report tool unavailability and unfinished image roles instead of silently treating placeholders as finished. Follow [image-assets.md](references/image-assets.md) for tool handoff, durable originals, embedded previews, and size checks.

Initial generation is **design-only by default**: do not plan, author, or verify adjustment parameters unless the user explicitly requests them in the first pass. Do not ask a parameter-setup question before showing the designs. Let Astra author `A/index.html` and `A/style.css`, then B/C or derivative IDs. Use `tokens: {}` and omit `sources.controls`; `controls.json` is optional. Read [references/parameters.md](references/parameters.md) when controls are requested initially or later. Read the file contract in [references/workshop.md](references/workshop.md). Keep authored markup, styling, and control definitions separate from the session's saved user adjustments. Ordinary design work edits these files; it does not require changing the shared renderer or demo generator. The renderer must not inject a subject-specific component kit that forces every direction into the same look. Keep equal viewport and content conditions across directions; choose viewport dimensions for the target product rather than forcing every task into a phone screen.

When controls are requested, every advertised tweak must visibly affect the intended element. Prefer a few meaningful controls (e.g. information density, heading scale, chart treatment, composition) to a universal wall of settings. Respect the sandbox: no scripts, external requests, or product navigation inside preview fragments. The workshop is for visual design; test real application behavior later in the target framework.

## 3. Compare and tweak in the browser

Start the local server with the session path. Verify HTTP access and the rendered screen before giving a working-preview claim. Share the actual URL and explain the next decision in one sentence. Use a browser tool to open it when available.

Keep the designs as the main stage. Move the brief and infrequent controls out of the way after the interview. Compare, inspect, tweak, and adopt are different actions: viewing or adjusting an option must not silently adopt it. In focus mode, keep the relevant controls beside the visible preview. Do not accept a tiny unreadable thumbnail as proof that a design is reviewable.

Let the user compare, focus one option, write notes, and select a preferred option. Only variants with declared parameters expose adjustment controls; parameter-free variants still support notes, adoption, persistence, and export. The user can ask for controls at any time, for example “Aに見出しサイズと余白の調整を追加して” / “Add heading-size and spacing controls to A.” Controls update the preview immediately and save to the session file. Explain that saved notes are read on your next conversation turn: there is no background AI responding to them.

Treat “A is close” as a direction, not final acceptance. Stop generating unrelated alternatives once a direction has been chosen. Keep the approved composition and adjust the requested aspects. Do not let a preference from another project dictate this project's style.

## 4. Iterate from the saved state

On every follow-up, read the current session and the relevant variant's source files from disk before editing. Combine the user's latest words with selectedId, adjusted tokens, and variant notes. If they conflict, follow explicit latest instructions and explain the resulting change briefly.

Preserve the previous version as a snapshot of the session AND its referenced source files before structural edits. Create stable derivative IDs and directories such as A2/A3 with a short rationale describing what changed. Retain the parent option and carry over its adjusted tokens. Keep selectedId unchanged until the user selects the derivative or explicitly asks to adopt it; show the new ID as the next review candidate. Do not reset the user's choices by regenerating the entire session. If needed, remove older comparison options only after keeping an archive.

For “add parameters” requests, follow [references/parameters.md](references/parameters.md): add only the requested controls to the existing variant, preserving its appearance, notes, adoption, and saved values. A control-only addition does not require a new composition or three new directions. Simple changes use existing tweaks. Structural requests such as “総評文はいらない” or “グラフが欲しい” go back to Astra with the latest saved state to create a derivative. Do not imply that a notes field or color slider already performs arbitrary element editing. For new control types, extend and verify the runtime only when the user needs them.

After updating, verify the actual browser refresh and save status. If simultaneous browser/server edits conflict, preserve both versions and reconcile; never silently overwrite the user's unsaved draft.

## 5. Hand off a chosen result

Selection is a preference, not authorization to publish or evidence that product implementation is complete. When the user is ready to implement, capture the selected ID, final HTML, tokens, brief, notes, remaining decisions, and the acceptance viewport. Use the runtime exports and add implementation-specific notes as needed.

For Expo, translate CSS intent into React Native layout/styles and native controls rather than embedding the HTML. For web, follow the target project's component and token conventions. Use the selected screen as visual acceptance evidence, and separately verify accessibility, responsive behavior, interaction, and real data in the target implementation.

For product implementation, include the scoped component mapping from [product-handoff.md](references/product-handoff.md): what is reused, changed, added, or intentionally different, with actual source paths and representative consuming screens. A selected kit or a visually similar screenshot does not establish that the application uses shared components.

For a shareable visual record, use the workbench PDF action for the displayed option or all comparison options, then save through the browser print dialog. Explain which options and adjustment state were exported; PDF does not replace editable sources or establish adoption.

Include generated asset files, their usage mapping and prompts, and any remaining sample imagery in the handoff. Library exports preserve images embedded in HTML/CSS, but do not bundle the separate original image files; carry those originals forward explicitly.

Report what was actually verified: skill structure, local preview behavior, product implementation, and publication are separate outcomes. Leave the local preview running while the user reviews; retain its process handle and explain how to stop it. Never commit, deploy, or publish just because the design was selected.

## Visual acceptance before presenting

**Verify in one command, not a chain of browser steps.** Every extra step costs a model round trip, and hand-written browser scripts were the largest single time cost of a run. After the preview (or the saved library work) is up, run once:

```bash
node "$SKILL_DIR/scripts/verify_preview.mjs" --url <preview or library design URL> --viewport <WxH of the target>
```

It writes screenshots of the compare view and every direction, checks page overflow and clipped design content, exercises each direction's range controls (its own tweaks, then the base colors and sizes) from the keyboard (value changes, the preview visibly changes, focus stays, save status returns to saved, value restored), checks that a change survives a reload, reports console errors, and, for a library work, confirms it is listed in its project. Pass `--expect-kind component` (or `screen`) after saving to the library so the kind is checked too. Parameter-free variants are valid: the verifier checks the declared range count, skips absent controls, and still checks rendering. Do not add parameters just to satisfy verification. A declared control that changes nothing in the preview fails the run: fix the design instead of working around it. Add `--no-mutate` for a read-only pass (for example on a design the user is actively adjusting). It takes about 20-30 seconds: run it in the foreground with the shell tool's wait/yield time set to at least 90 seconds so the whole result comes back in one call; do not start it in the background and poll. Its `verify-report.json` is the record of the reviewed viewport; do not also hand-write a verification document. Do not re-run it after a fix unless the design or its controls changed. Do not add hand-written browser checks on top of a passing run; if a check you need is missing, say so rather than improvising a script. Fall back to manual browser checks only when Node 22+ or Chrome is unavailable, and say so.

The script does not judge design quality. Look at its screenshots once, in a single pass, before presenting.

Inspect screenshots at the intended viewport, not just the DOM or test output. The user must be able to see the meaningful difference between directions, read the important content, and adjust a focused design while it remains visible. Check clipping, accidental wrapping, distracting tool chrome, and whether declared controls work without losing keyboard focus. Save the reviewed viewport and concrete findings. Functional tests passing does not establish design quality. Astra revises visual failures; the user decides whether to adopt the result.

For changes to shared product UI, compare the affected screens with a representative existing consumer at the same viewport and relevant states. Record whether equivalent actions use the same component rules, including any explicit size or density variants.

For generated imagery, inspect the actual composition at desktop and mobile widths: subject and hands, crop and focal point, copy legibility, and continuity between assets. Confirm the images load after save/reopen and remain in the intended export. Report which assets were generated and where they are used; a successful tool call alone is not integration evidence.
