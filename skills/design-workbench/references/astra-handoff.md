# Astra design handoff

Use this when the supervising model is not verifiably Astra. Select the available `gpt-6-astra` model explicitly when spawning the design task. Do not select the default worker and merely put the word “Astra” in its prompt. Do not use a model alias unless the environment establishes its mapping.

## Supply enough context to design

Give Astra:

- The user's brief and exact relevant feedback, target screen/device, shared content/data, and actual reference assets available locally.
- The conversation language and the authored content language separately. Preserve existing content and notes unless translation is requested; the workbench's GUI locale is independent.
- The ownership boundary: preview output files and permitted runtime changes; other writers and forbidden files.
- The current session on follow-up, including adopted ID, active review candidate, all adjusted values, notes, and the earlier direction to preserve.
- The file contract from `workshop.md`; every direction has its own `index.html` and `style.css`; `controls.json` is optional. Explicitly state parameter mode: **none** by default, or **requested** with the exact controls. For none, use `tokens: {}`, omit `sources.controls`, and do not design control bindings. Assign the variant directories explicitly. Read the current session for user adjustments, and keep authored files separate from saved state.
- For image-led work, the proactive generation workflow in [image-assets.md](image-assets.md), supplied assets, and owned asset destinations. Ask Astra to generate and integrate useful imagery, including supporting images where needed. If its image tool is unavailable, return actionable asset requests early for the supervisor to execute, then integrate the returned files.
- Acceptance: genuinely different initial directions with equal content and viewport, readable comparison, usable focus/tweaks, preserved adjustments, and author provenance.
- Verification commands and a first-return cutoff appropriate to the scope. Request an early concise progress message before a long implementation.

Example task skeleton (fill in actual paths and the real brief):

```text
You are Astra and own the visual design for this workshop.
Create three distinct screen directions using this shared content: ...
Target viewport/device and primary action: ...
Desired feel/references and constraints: ...
Image roles, supplied assets, and owned asset paths: ...
Owned output paths: ...
Forbidden paths and other writers: ...
Parameter mode: none (default), or requested: ...
Use the workbench schema at ...; author A/index.html and A/style.css
(and the assigned B/C or derivative directories). Do not rewrite the shared
workbench to make an ordinary design. Preserve session adjustments and baselines.
In none mode, use tokens: {}, omit sources.controls, and skip parameter planning,
controls.json, and control-specific verification. In requested mode, declare only
the requested useful controls following parameters.md; preserve the current look.
No arbitrary scripts or external calls.
For image-led work, follow image-assets.md: generate real image assets and embed
compact previews. If you cannot call the image tool, return prompts and intended
slots early so the supervisor can supply the files. Final image roles must be
integrated or explicitly reported as blocked; placeholders are not completion.
Do not delegate design to another model.
Return design rationale, actual written files, schema details, verification,
and remaining limitations. Preserve user state. No commit/push/deploy.
```

For a targeted revision, ask for the one derivative requested. Do not ask for three new unrelated directions. A saved spacing value or wording preference is part of the input, not something to rediscover from an older screenshot.

## Keep authorship auditable

Record `gpt-6-astra` as the design model only after a real invocation, with the task identifier or other tool-provided receipt, authored paths, and what the supervisor subsequently changed. Preserve the difference between designer, implementer, and reviewer. Hand off this information alongside the session; do not inflate a metadata label into a verified model receipt.

If Astra is unavailable or interrupted, report whether design files exist and which parts are verified. Keep useful outputs and the brief. Do not switch to Luna to make the visual decisions. A supervisor may repair plumbing, but a new visual direction requires Astra or an explicit user-approved change of ownership.
