# From an adopted design to product components

Use when evolving an existing product or handing an adopted design to application implementation. Scale the handoff to the requested change. A small component revision can use a short mapping in the existing task document; it does not require a new design system, gallery, dependency, or repository-wide migration.

## Establish the source and scope

Inspect the current product's shared components, token definitions, layout conventions, and the screens that consume them. Read the actual markup and styles as well as the visual reference. Check opt-in classes, style import order and page-specific overrides when they can alter the same component.

Record the user's chosen baseline: a saved variant and revision, a pinned kit version, or an existing product screen with source revision and viewport. Preserve any explicit preference for shape, depth, density, or composition. Do not silently replace it with another project's conventions. If a library source is involved, follow the existing export/revision procedure before editing it.

Name the routes/components being changed and the representative existing consumers that may be affected. Inspect enough to identify conflicts without expanding a local request into a redesign of every page. Surface an unresolved conflict with an approved rule; otherwise use the existing authorization and make routine implementation choices.

## Separate shared rules from screen composition

Astra identifies the reusable decisions supported by the adopted design:

- Roles of primary actions, secondary actions, navigation links, filters and view switches.
- Component sizes, density variants, typography, geometry and feedback states relevant to this change.
- Layout rules such as container width, gutters, heading rhythm and side content, with their responsive behavior.
- Content-specific composition that should remain local to the screen.

Equivalent roles should use the same rules. A compact control or a different layout can be appropriate when its purpose and applicable context are explicit. Similar colors alone do not establish consistency, and identical layouts are not required for different kinds of content.

## Map design intent to real implementation

Include a compact mapping in the product's existing design or task record:

| Role / adopted element | Product source | Treatment | Consumers and acceptance |
| --- | --- | --- | --- |
| Search submission | Existing action component and stylesheet | Reuse, change, or add an explicit variant | Named search routes; keyboard, narrow viewport, normal and disabled states when applicable |
| Category selection | Existing link/radio/tab component | Preserve native semantics and URL state | Selected/unselected, long labels, relevant screen widths |

Use actual source paths and component APIs for the current project, and identify intentional exceptions. Reuse existing components where they fit. If several screens need a shared change, implement it once and migrate the named consumers; avoid independent copies that only share a name or token palette. When removing a legacy rule, check its remaining consumers. Do not attach global overrides that silently restyle unrelated screens.

Keep real component code, tokens and implementation usage rules in the product repository, with a clear authoritative location. A kit is versioned design context; it is not a second live implementation. Cross-reference these sources instead of copying rules into competing documents.

For a shared-component rollout, use an existing component gallery or create a small project-local example when it materially improves review. It must render the same components the product imports. Follow the project's policy for developer-only surfaces. A separate static workbench example is useful design evidence, but does not prove that framework components or product states work.

## Verify the handoff in the product

Compare representative consumers at equal viewport sizes and equivalent states. Inspect screenshots for shape, spacing, typography, emphasis and clipping; inspect computed styles when CSS inheritance or overrides are in question. Exercise relevant hover, focus, selected, disabled and long-content states. Check semantic behavior: native form submission, URL conditions, keyboard access, navigation and responsive behavior should survive the refactor.

Record which consumers use the shared source, the compared viewports/states, intentional differences, and any routes outside the completed migration. Tests and build success support functional acceptance; they do not replace cross-screen visual review. A claimed shared fix should be visible through the real component in more than an isolated mockup.

Keep design adoption, implementation verification and publication separate. This handoff does not add approval gates or authorize commits, deployment, external writes, or broader migrations beyond the user's existing instructions.
