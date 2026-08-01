# Design QA

## Comparison target

- Source visual truth: `/Users/nurmuhammad/Downloads/Texnomart Brend Taklifnomasi/Udevs Hamkorlik Taklifi.dc.html`.
- Source captures: `tmp/ui-reference/page-01.png` through `tmp/ui-reference/page-10.png`.
- Rendered implementation: `tmp/ui-implementation/after.html`.
- Implementation captures: `tmp/ui-implementation/after-01.png` through `tmp/ui-implementation/after-10.png`.
- Side-by-side comparisons: `tmp/ui-comparison/page-01-comparison.png` through `tmp/ui-comparison/page-10-comparison.png`.
- Page-3 user-feedback comparison: `tmp/ui-comparison/page-03-feedback-comparison.png`.
- Page-3 focused gateway/end-event comparison: `tmp/ui-comparison/page-03-feedback-focus-comparison.png`.
- Browser: the user's installed Google Chrome, device scale factor 1.
- State: Russian 10-page marketplace proposal, static Udevs theme.
- Reference pages render at approximately 1123 × 794 CSS px (A4 landscape). Generated pages retain the renderer's required 1440 × 960 CSS px contract. Full views were fit-normalized into equal comparison panes without cropping.

## Findings

- No actionable P0, P1, or P2 visual differences remain.
- [Resolved P1 · layout] Page 3 gateway diamond was clipped by the node wrapper. The gateway now renders outside the wrapper bounds and remains fully visible in the combined comparison.
- [Resolved P1 · color and shape] Page 3 used heavy black partner/exception paths and an optically clipped end-event ring. Partner and exception routes now use distinct slate-blue tokens; the end event uses a clean blue double ring and one merged inbound marker.
- [Resolved P1 · copy placement] The page-3 `Исключение` caption touched the gateway and its vertical route. It now sits in a compact white capsule below the diamond, masking the connector behind it while remaining inside the node's QA bounds.
- [Resolved P1 · content hierarchy] Page 1 now uses the project name in the top-left header and the reference cover title/decision-document/description hierarchy.
- [Resolved P1 · colors] The generated pages no longer inherit the dark blue screenshot wash. Cover, white-content, and soft-content pages use source-captured one-tone reference backgrounds.
- [Resolved P1 · layout] Page 4 architecture changed from a left-labelled table to the reference's centered five-layer vertical stack with compact nodes and simple inter-layer arrows.
- [Resolved P1 · layout] Page 6 uses the reference dependency summary, grouped rounded rows, three-column alignment, and status pills.
- [Resolved P1 · page 8] The original rounded-card UI and four summary metrics were restored. The table content now follows the requested commercial model: employee, quantity, active months, monthly rate, role amount, and an exact reconciled team total.
- [Resolved P1 · page 10] The cumulative-payment column was removed. The remaining payment, share, and amount headers now use exactly the same three grid tracks as every payment row.
- [Resolved P1 · page 7] The function schedule now contains only block, task, subtask, and delivery-window data. The pricing total and planning-scenario banner are removed.
- [Resolved P1 · page 7] The 12-row truncation was removed end to end. A 14-row Russian render and a 24-row dense render both fit the fixed page body without overflow.
- [Resolved P1 · page 7] The deadline column shows one task-specific duration (`2 нед.`, `3 нед.`, and so on), with an AI-assisted delivery factor and explicit supplied effort taking precedence.
- [Resolved P1 · page 7] The `СРОК` header and every duration value share the same 110 px grid column and exact horizontal center.
- [Resolved P1 · page 2] The product-map canvas now uses the full available 1296 × 646 px area. A map with up to 16 terminal rows / 42 semantic nodes stays on one readable page; a continuation is created only beyond that capacity.
- [Resolved P1 · PDF export] V5 no longer returns an HTML file for downstream browser printing. It creates the PDF in Chromium with the fixed 15 × 10 in page contract, exact print colors, zero margins, and background printing; the resulting PDF is then raster-checked and atomically promoted for download.
- Typography now follows the reference hierarchy: Sora for display text and Work Sans for body and metadata. Both font families are embedded in the generated HTML.
- The palette now uses `#1A54FE` as the primary blue, `#0A0A0F` for ink, `#6B6B6B` for secondary text, `#F7F8FC` for soft surfaces, and `#E4E9F7` for rules.
- Page shells match the reference's compact uppercase header, small page counter, short blue title rule, generous white space, subtle blue grid/haze, and restrained borders and shadows.
- Cover, product map, BPMN, architecture, org chart, client dependencies, budget, team, roadmap, and payment views use the matching reference treatment for their respective cards, tables, diagrams, summary blocks, and totals.
- Client dependency state pills are localized and preserve their existing readiness data attributes.
- [P3] The reference uses A4 landscape while the production renderer has a locked 3:2 page contract. The 3:2 geometry was intentionally preserved because the requested change is UI-only.
- [P3] Text and diagram geometry differ where the generated proposal contains different semantic data from the static reference.

## Full-view comparison evidence

- All ten source pages and all ten implementation pages were captured from the same proposal state.
- Every source/implementation pair was placed together in a single normalized comparison image before judging fidelity.
- Cover and content backgrounds preserve the same faint grid, upper-right blue haze, lower blue wash, and bottom blue edge.
- Dense pages retain the source's light table treatment, while the total and peak rows use the same solid-blue emphasis.

## Focused region evidence

- Cover: title hierarchy, eyebrow, supporting copy, metric cards, and decorative field.
- Page 3 process: gateway diamond, exception caption, lane boundaries, and right-side return route.
- Page 3 focused region: black-to-slate route treatment, gateway-caption clearance, merged end-event arrow, and complete double-ring visibility.
- Page 4 architecture: five centered layer headings, variable-width nodes, application-core emphasis, and vertical arrows.
- Page 6 dependencies: summary metrics, grouped white rows, column alignment, and blue waiting pills.
- Page 8 team table: restored rounded role rows, aligned quantity/month/rate/amount columns, four summary cards, and a solid-blue reconciled total row.
- Commercial pages: thin rules, compact columns, blue total rows, rounded payment stages, and large blue grand total.

## Comparison history

1. Initial implementation had oversized dashboard-like framing, fallback system fonts, heavier cards, and inconsistent commercial-page emphasis.
2. The visual layer was replaced with the reference typography, palette, spacing, surface, and emphasis system while keeping page kinds, page count, content model, calculations, and visualization semantics unchanged.
3. Visual review found an English `Waiting` pill on the Russian page; the presentation label was localized.
4. DOM QA found a four-pixel payment-total overflow caused by the display-font line box; its line height was corrected without changing payment data.
5. User review found a clipped page-3 diamond, incorrect page-1 header/copy hierarchy, blue page wash, and reference drift on pages 4, 6, and 8.
6. The visual shell, architecture geometry, dependency layout, and team table density were corrected without changing proposal data, calculations, page selection, or generation semantics.
7. All ten source/implementation pairs were re-captured and reviewed after the focused fixes.
8. A second page-3 review found heavy black exception styling, stacked inbound markers at the end event, and a caption touching the gateway route.
9. Partner/risk colors were softened, duplicate end-event markers were visually merged, the ring received safe overflow, and the exception caption received an isolated capsule.
10. Full-page and focused before/after comparisons were captured; DOM QA returned 10/10 UI pages with zero blockers, errors, or warnings.
11. The page-7 follow-up removed pricing-only UI, lifted the 12-function cap, and replaced row-index month buckets with concrete AI-assisted task durations.
12. The page-2 product-map wrapper was expanded to the available page body and its segmentation threshold was recalibrated to the rendered geometry, eliminating the mostly empty continuation page.
13. The page-8 follow-up replaced the rounded card matrix with a native `table / thead / tbody / tfoot` structure matching the user-provided plain-table reference and recolored its green accent to the Udevs primary blue.
14. The user clarified that the reference described the content model, not the UI. The native table was therefore reverted to the prior card UI, while its columns and calculations were changed to employee, quantity, months, monthly rate, and amount.
15. The page-10 follow-up removed the cumulative column and compensated for the one-pixel row border in the header padding, producing zero-pixel left, right, and center alignment deltas across all three columns.
16. Download testing exposed that V5 stopped after print-media DOM validation and returned `proposal.html`; PDF appearance therefore depended on the end user's print settings. Deterministic Chromium PDF creation, post-render G5/G6 validation, G7 promotion, and a ready artifact record were restored.
17. The PDF text audit was aligned with the current page-7 and page-8 contracts: the function page verifies block/task/subtask/deadline content without removed pricing columns, and the team page verifies the visible FTE-month total without requiring the removed peak-FTE metric.
18. The roadmap follow-up replaced the vertically stacked `number / label / period` cells with a compact horizontal grid, expanded the table into the unused 84 px of page-body height, and raised the synchronized roadmap capacity from 7 to 14 workstreams per page.

## Runtime and QA checks

- Generated page count: 10 / 10.
- Semantic visualizations: 4 / 4.
- UI hard-check: 10 / 10 pages passed.
- DOM blockers: 0.
- DOM errors: 0.
- DOM warnings: 0.
- Font resolution: Sora and Work Sans loaded from embedded assets; no fallback was used.
- No clipping, overflow, broken-image, shell-order, or page-geometry findings remain.
- Latest page-7 runtime check: 14 rows, 5 columns, concrete 2–5 week estimates, exact deadline-column alignment, no scenario banner, no pricing total, and `scrollHeight === clientHeight`.
- Dense page-7 stress check: 24 rows, 0 text below 8 px, and no body/table overflow.
- Latest page-2 runtime check: 34 nodes and 33 edges fit one 1296 × 646 px canvas, minimum node font 11 px, zero node overflow, and no continuation page; the proposal remains 10 pages total.
- Latest page-8 runtime check: 7 role rows allocate a `$100 000` budget across 15.875 FTE-months; row amounts reconcile to 10,000,000 minor units exactly, with zero body/table overflow and no Chrome console errors.
- Latest page-10 runtime check: 3 headers and 3 row cells share identical track boundaries; all measured alignment deltas are 0 px, `Накопительно` is absent, and the page body does not overflow.
- Latest download check: `tmp/ui-implementation/fixed-download.pdf` contains 10 / 10 pages at 1080 × 720 pt (15 × 10 in), rasterizes to 1440 × 960 px at 96 dpi, and passes G0–G5 plus G7 with zero blockers, errors, or warnings; G6 correctly skips because no visual reference was supplied for that generation request.
- PDF spot review: rasterized pages 2, 3, 8, and 10 preserve the same map, BPMN, team-table, and payment-table geometry as their validated browser render, including the complete end-event ring and all page backgrounds.

## Roadmap compaction evidence

- Source visual truth: `/private/tmp/kp-sync-ru-workspace/KP-20260801-E32E540C2AD9/qa/pdf-render/render/page-11.png` (7 workstreams, stacked metadata, 42 px unused above and below the roadmap layout).
- Rendered implementation: `/private/tmp/kp-roadmap-compact-final-ru-workspace/KP-20260801-538B30F35127/qa/pdf-render/render/page-11.png` (14 workstreams, horizontal metadata, full-height table).
- Viewport and state: both captures are 1800 × 1200 rasterizations of the same 1440 × 960 CSS px Russian marketplace proposal state.
- The source and implementation captures were opened together in one comparison input before the final judgment.
- `01 · Каталог · Н2–Н4` now stays in one grid row. Long labels may wrap inside the middle label track instead of being clipped; the number and period remain in their fixed horizontal columns.
- The roadmap body now uses all 710 px available height. Header, chart, gate area, and disclosure retain the existing UI language, colors, typography, rounded geometry, and timeline scale.
- The 28 canonical marketplace workstreams render as 14 + 14 across two pages instead of 7 + 7 + 7 + 7 across four pages, with exact ID coverage and no duplication.
- A second `uz-Latn` smoke render covered 33 workstreams as 11 + 11 + 11. Its deliberately long first label wrapped safely; DOM and raster QA reported zero clipping, overflow, blockers, errors, or warnings.
- Russian final sample: `/private/tmp/kp-roadmap-compact-final-ru.pdf` — 13 pages, QA `PASS`.
- Automated checks: Node 22 unit `PASS`; Node 22 PDF smoke `PASS`; Russian full proposal QA `PASS`; visual QA 13 / 13 pages, zero hard defects and zero warnings.
- Findings: no actionable P0, P1, or P2 visual differences remain for the requested roadmap compaction.

## Page-8 corrected content-model evidence

- Source content truth: user-attached 1958 × 766 px cost-table example in the current request; the conversation attachment does not expose a local filesystem path.
- Browser-rendered implementation: `tmp/ui-implementation/after-08.png`.
- Viewport: 1440 × 960 CSS px, device scale factor 1, Google Chrome.
- State: Russian three-month staffing plan with 7 roles and a `$100 000` brief budget.
- Full-view evidence: the restored summary cards and rounded rows remain inside the 1296 × 710 px body and preserve the existing page-shell rhythm.
- Focused evidence: the five requested columns are visible in order — `Сотрудник`, `Количество`, `Месяцы`, `Ставка в месяц`, `Сумма` — followed by one solid-blue team total.
- Typography: Sora remains on role labels and totals; Work Sans remains on headers and numeric values. No wrapping, clipping, or fallback font was observed.
- Spacing: the prior 48 px card-row rhythm is restored and all seven roles plus the total fit without overflow.
- Image/asset fidelity: the source contains no imagery or icons, so no generated or substitute assets are required.
- Copy/content: quantities use peak FTE; active months equal FTE-months divided by quantity; the blended monthly rate comes from total budget divided by aggregate FTE-months; role amounts are distributed proportionally and rounded with exact minor-unit reconciliation.
- Findings: no actionable P0, P1, or P2 differences remain. The rate is explicitly calculated from the supplied total because no independent role-rate card exists in the source data.

final result: passed
