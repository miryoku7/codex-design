# Generated images in the workshop

Use this for image-led designs, especially LPs, campaigns, product introductions,
and editorial pages. Read it during composition planning so the imagery shapes
the design from the beginning. Astra owns the asset direction and prompts as
well as the surrounding HTML/CSS.

## Plan useful assets and make them

Identify each image's purpose, placement, subject, aspect ratio, and relation to
the copy. Keep this in brief working notes; it is not a separate approval gate.
An LP can use a person presenting the service in its hero, a supporting scene
showing the experience, and an isolated product or illustration explaining a
benefit. Make the assets the content needs, including several distinct images
when useful. Do not cap generation at a single hero or add images just to meet
a quota. Reuse suitable user-provided or already generated assets.

Use the available `imagegen` skill and built-in image generation tool. Generate
the individual usable assets, not only a flattened screenshot of the whole LP.
Keep page copy, buttons, and factual diagrams in editable HTML/CSS or native
vector components as appropriate. Generic symbols and gradient placeholders
do not replace a planned photo or illustration.

Prompts should connect the subject to the page: audience, action or pose, setting,
light, palette, crop, focal point, negative space for copy, and any transparency
needed. For example, describe a fictional service guide naturally introducing
the experience, positioned to leave room for the actual HTML heading. Use
consistent art direction across supporting images. When revising a generated
person or product, supply the previous image as a reference/edit target through
the tool's supported mechanism and state what must stay consistent.

Generated people can illustrate a service; do not invent a real staff identity,
customer testimonial, endorsement, or documentary product evidence. Label
fictional/sample content where it could otherwise be mistaken for a real claim.
Preserve provided real product details and identity requirements.

When design is delegated, pass this reference and the generation requirement in
the Astra handoff. If that Astra session cannot call image generation, it should
return a concise asset request with prompts, dimensions, intended slots, and
owned destinations early. The supervisor executes those requests with the
available tool and gives Astra the resulting paths for integration. A child
session lacking the tool is not evidence that the parent lacks it. Do not leave
the final design at the prompt/placeholder stage.

If the tool is unavailable or fails, preserve the layout and asset requests,
report which images are still missing, and follow the imagegen skill's fallback
rules. Do not silently switch to a paid API/CLI path or claim generation happened.

## Preserve originals and embed preview images

Copy selected tool outputs to the workshop's durable directory, for example:

```text
.design-workbench/service-lp/
  session.json
  assets/
    hero-guide-v1.png
    service-scene-v1.png
    hero-guide-preview.webp
    service-scene-preview.webp
    asset-notes.md
  A/index.html
  A/style.css
  A/controls.json
```

Never leave a referenced asset only in the tool output directory or disposable
scratch. Keep originals intact; save revisions and compact preview derivatives
with distinct filenames. In `asset-notes.md`, record actual tool use, prompts,
original/preview paths, and which variants/elements consume each image. Do not
add an invented asset manifest to `session.json`: the runtime has no such asset
storage contract. Preserve these files with the source snapshot before revisions.

The current sandbox iframe accepts **`data:` images only** (`img-src data:` in
`assets/workbench/preview.js`). Relative image paths, host filesystem paths,
external URLs, and blob URLs do not work as preview image sources. Merely placing
a file in `assets/` does not serve it or make the CLI embed it automatically.
Embed the compact preview file as a MIME-correct base64 data URI in the variant's
HTML `<img src="data:image/webp;base64,…">` or CSS `url("data:image/webp;base64,…")`.
Use a real encoded image, not the ellipsis in this example. Add meaningful alt
text for content images and empty alt text for decorative ones. Keep crop and
layout responsive. Do not relax the CSP, enable preview scripts, or add remote
storage for an ordinary design task.

Budget the encoded data before integration. Current limits are:

- Each variant's HTML and CSS: at most 300,000 characters each, including images.
- A source file read by the Python runtime: at most 1,200,000 bytes.
- A library API request: at most 1,500,000 bytes for the entire JSON envelope.

Base64 adds roughly one third to the binary size. Repeated assets across A/B/C
count again in the portable session. Use suitably sized, compressed preview
images and leave room for markup, other variants, and saved state. Check the
current validators in `scripts/serve.py`, the repository's `src/session.ts`, and
`scripts/library.py` if these limits change. Check the assembled session with
the existing hydration/validation functions and measure the actual encoded
request before import/push. If imagery will not fit at an acceptable preview
quality, report that concrete limit; do not silently discard required assets,
raise storage limits, or describe an unsaved work as saved.

The library stores embedded HTML/CSS images with its snapshot. Import/export,
duplicate, and push do **not** bundle arbitrary `assets/` files or
`asset-notes.md`. On a new export-based revision, preserve/copy the original asset
directory explicitly without replacing the freshly exported source or revision
receipt. If only the library snapshot survives, embedded previews remain usable,
but do not claim the full-resolution originals were recovered. Include originals
and asset notes separately when handing the design to the product project.

## Verify the integrated result

Inspect generated files, then the actual rendered design. Check subject quality,
hands and face when present, consistent imagery, useful crop at desktop/mobile
widths, and copy contrast. Revise a specific defect with a targeted generation
or edit; do not regenerate acceptable assets on every spacing adjustment.

Verify that image loading survives save/reopen and the intended portable or
library export. Use an isolated copy for persistence checks and preserve notes,
adjustments, reset values, and adoption state. Report generated filenames and
their placements, tool or size limitations, and the viewports actually checked.
Generation, integration, successful persistence, and user adoption are separate
facts. Finish when the planned useful assets are integrated and verified.
