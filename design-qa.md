# Design QA

## Comparison target

- Source visual truth: `/Users/nurmuhammad/Downloads/Texnomart Brend Taklifnomasi/Udevs Hamkorlik Taklifi.dc.html`.
- Source captures: `tmp/ui-reference/page-01.png` through `tmp/ui-reference/page-10.png`.
- Rendered implementation: `tmp/ui-implementation/after.html`.
- Implementation captures: `tmp/ui-implementation/after-01.png` through `tmp/ui-implementation/after-10.png`.
- Side-by-side comparisons: `tmp/ui-comparison/page-01-comparison.png` through `tmp/ui-comparison/page-10-comparison.png`.
- Browser: the user's installed Google Chrome, device scale factor 1.
- State: Russian 10-page marketplace proposal, static Udevs theme.
- Reference pages render at approximately 1123 × 794 CSS px (A4 landscape). Generated pages retain the renderer's required 1440 × 960 CSS px contract. Full views were fit-normalized into equal comparison panes without cropping.

## Findings

- No actionable P0, P1, or P2 visual differences remain.
- [Resolved P1 · layout] Page 3 gateway diamond was clipped by the node wrapper. The gateway now renders outside the wrapper bounds and remains fully visible in the combined comparison.
- [Resolved P1 · content hierarchy] Page 1 now uses the project name in the top-left header and the reference cover title/decision-document/description hierarchy.
- [Resolved P1 · colors] The generated pages no longer inherit the dark blue screenshot wash. Cover, white-content, and soft-content pages use source-captured one-tone reference backgrounds.
- [Resolved P1 · layout] Page 4 architecture changed from a left-labelled table to the reference's centered five-layer vertical stack with compact nodes and simple inter-layer arrows.
- [Resolved P1 · layout] Page 6 uses the reference dependency summary, grouped rounded rows, three-column alignment, and status pills.
- [Resolved P1 · layout] Page 8 uses fixed compact table rows, the reference column proportions, metric cards, peak-month emphasis, and solid-blue total row.
- Typography now follows the reference hierarchy: Sora for display text and Work Sans for body and metadata. Both font families are embedded in the generated HTML.
- The palette now uses `#1A54FE` as the primary blue, `#0A0A0F` for ink, `#6B6B6B` for secondary text, `#F7F8FC` for soft surfaces, and `#E4E9F7` for rules.
- Page shells match the reference's compact uppercase header, small page counter, short blue title rule, generous white space, subtle blue grid/haze, and restrained borders and shadows.
- Cover, product map, BPMN, architecture, org chart, client dependencies, budget, team, roadmap, and payment views use the matching reference treatment for their respective cards, tables, diagrams, summary blocks, and totals.
- Client dependency state pills are localized and preserve their existing readiness data attributes.
- [P3] The reference uses A4 landscape while the production renderer has a locked 3:2 page contract. The 3:2 geometry was intentionally preserved because the requested change is UI-only.
- [P3] Text and diagram geometry differ where the generated proposal contains different semantic data from the static reference. No generation or business logic was changed to force a visual-only match.

## Full-view comparison evidence

- All ten source pages and all ten implementation pages were captured from the same proposal state.
- Every source/implementation pair was placed together in a single normalized comparison image before judging fidelity.
- Cover and content backgrounds preserve the same faint grid, upper-right blue haze, lower blue wash, and bottom blue edge.
- Dense pages retain the source's light table treatment, while the total and peak rows use the same solid-blue emphasis.

## Focused region evidence

- Cover: title hierarchy, eyebrow, supporting copy, metric cards, and decorative field.
- Page 3 process: gateway diamond, exception caption, lane boundaries, and right-side return route.
- Page 4 architecture: five centered layer headings, variable-width nodes, application-core emphasis, and vertical arrows.
- Page 6 dependencies: summary metrics, grouped white rows, column alignment, and blue waiting pills.
- Page 8 team table: card density, header alignment, fixed row rhythm, highlighted month, and total row.
- Commercial pages: thin rules, compact columns, blue total rows, rounded payment stages, and large blue grand total.

## Comparison history

1. Initial implementation had oversized dashboard-like framing, fallback system fonts, heavier cards, and inconsistent commercial-page emphasis.
2. The visual layer was replaced with the reference typography, palette, spacing, surface, and emphasis system while keeping page kinds, page count, content model, calculations, and visualization semantics unchanged.
3. Visual review found an English `Waiting` pill on the Russian page; the presentation label was localized.
4. DOM QA found a four-pixel payment-total overflow caused by the display-font line box; its line height was corrected without changing payment data.
5. User review found a clipped page-3 diamond, incorrect page-1 header/copy hierarchy, blue page wash, and reference drift on pages 4, 6, and 8.
6. The visual shell, architecture geometry, dependency layout, and team table density were corrected without changing proposal data, calculations, page selection, or generation semantics.
7. All ten source/implementation pairs were re-captured and reviewed after the focused fixes.

## Runtime and QA checks

- Generated page count: 10 / 10.
- Semantic visualizations: 4 / 4.
- UI hard-check: 10 / 10 pages passed.
- DOM blockers: 0.
- DOM errors: 0.
- DOM warnings: 0.
- Font resolution: Sora and Work Sans loaded from embedded assets; no fallback was used.
- No clipping, overflow, broken-image, shell-order, or page-geometry findings remain.

final result: passed
