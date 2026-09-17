# Design Library integration

Use this when the user wants to save, browse, favorite, duplicate, or resume designs in the Codex Design library. The standalone file workbench remains available when this optional app is absent. The library is a Hono/Workers app using local D1 during development; invoking this workflow does not authorize cloud resource creation or deployment.

## Two explicit working copies

A library work is one session, including its variants, notes, adoption and adjustments. D1 owns the current library snapshot. The local v2 directory owns its file-based authoring copy. Do not pretend the two stores update each other automatically.

- Import a local project to create a library work. Preserve the existing files.
- Open a library work to compare and tweak its D1 snapshot.
- Before Astra revises a saved library work, export its latest state into a new local directory. This includes the user's current adjustments and a revision receipt.
- Astra edits that directory's HTML/CSS/controls and necessary metadata. Use the existing local preview if helpful.
- Push the result with its recorded library revision. If the library changed meanwhile, reconcile from the latest state and retain the local draft; never bypass the conflict by grabbing a fresh revision and blindly resending.
- A library duplicate gets a new identity and independent state. Do not treat duplication or an active preview as adoption.

The local CLI lives in the application repository at `scripts/library.py`; it is separate from the bundled skill scripts. Resolve the repository from this installed skill's real path when it belongs to Codex Design. If the CLI is absent, use the standalone session workflow and explain that library integration is unavailable there.

## Local commands

The library opens with projects. Each project contains screen and component works; older and unassigned works remain under 未分類. Before import, list projects and use the stable ID of the intended project. If the user has named a new project as the destination, creating that project is part of saving the work. If the destination is ambiguous, ask one short question or explicitly save unassigned when the user permits it. Do not silently choose a similarly named project or scan unrelated repositories. Project membership and kind are library metadata, separate from session source and adjustments.

For component work, pass `--kind component`; screen work uses `--kind screen` (the default). Pass `--project PROJECT_ID` for the chosen destination. The library UI can later change the membership and kind without changing the design itself. Export records the current library metadata in the receipt; source push preserves the library membership and kind, including for old receipts. Changing membership advances the design revision, so a previously exported draft may conflict.

Run from the Codex Design repository while `npm run dev` is serving the local library:

```sh
python3 scripts/library.py projects list
python3 scripts/library.py projects create "読書アプリ"
python3 scripts/library.py import .design-workbench/homepage --project PROJECT_ID --kind screen
python3 scripts/library.py import .design-workbench/result-card --project PROJECT_ID --kind component
python3 scripts/library.py export DESIGN_ID .design-workbench/homepage-edit
python3 scripts/library.py push .design-workbench/homepage-edit
```

Use the actual ID printed by import or shown in the work URL. Import reads the source directory without changing it. Export creates a new v2 directory and a `.library.json` receipt containing the destination and revision; it refuses an existing destination. Push uses that receipt to identify the saved work and its expected revision, then updates the receipt after a successful save. The CLI is local-only in this version. The default base URL is `http://127.0.0.1:8787`.

An import without `--project` remains in 未分類. After saving, verify the returned work ID in its project's list and the intended screen/component filter. Report both the work URL and its project; a running standalone workbench URL alone is not a library-save result.

A favorite or browser adjustment also advances the revision. A conflicting push preserves the draft; export the latest work to another directory and reconcile the intended changes before pushing again. Never edit the receipt solely to force a stale draft through.

## Acceptance

Check the actual library URL, saved title and representative preview. On continuing an existing work, verify current notes and adjustment values before editing. A successful API response does not replace visual review. Keep private source files, revision receipts, and D1 development state out of Git. Retain author provenance through imports, exports and duplicates.
