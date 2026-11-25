# Theme Taxonomy

Choose the communication job before choosing a visual style. A topic can support several directions; the six explicit selector axes decide which one fits. Every named direction in this file must use the exact spelling from `../scripts/theme_registry.json` and `theme-gallery.md`.

## Route By Communication Job

| Communication job | Strong starting directions | Composition bias | Avoid |
|---|---|---|---|
| Executive decision, recommendation, board update | Consulting Precision, Swiss Signal, Data Newsroom | action-title grid, one-chart argument, decision matrix, implication strip | generic corporate card wall, decorative dashboards |
| Evidence, market analysis, public policy, research | Research Report Editorial, Data Newsroom, Scientific Atlas, Consulting Precision | headline + evidence, protected source/annotation rail, methodology reset | sources floating over content, charts without a conclusion |
| Comparison, tension, migration, before/after | Duotone Split, Swiss Signal, Blueprint Workshop | hard split, paired evidence, transition axis, choice table | fake symmetry when the options are not comparable |
| Product launch, feature reveal, vision | Keynote Minimal Full-Bleed, Product Keynote, Soft Kinetic | one dominant artifact, short claim, full-bleed reset, staged reveal | feature-card walls, generic gradients, several competing heroes |
| System explanation, architecture, hardware | Technical Conference, Isometric Systems, Blueprint Workshop, Mission Control | exploded system, layered topology, interface detail, failure sequence | decorative pseudo-3D, one unreadable mega-diagram |
| Cryptographic proof, protocol security, trust mechanism | Protocol Proof, Blueprint Workshop, Scientific Atlas | claim and verifier path, party/commitment map, boundary, worked proof | abstract metaphor without the actual protocol, unreadable glowing labels |
| Teaching, onboarding, workshop | Playful Modular, Clinical Clarity, Civic Service | question opener, numbered sequence, worked example, recap board | childish decoration for adult audiences |
| Brand statement, culture, manifesto | Typographic Editorial Poster, Editorial Culture, Neo Brutalist | type-as-image, cutout evidence, asymmetric poster, section inversion | copying a recognizable masthead or campaign |
| Wellness, food, sustainability, community | Organic Material, Soft Kinetic, Documentary Photo Essay | honest close-up photography, material detail, human sequence | beige-only mood boards, anonymous lifestyle stock |
| Archive, history, collection | Museum Catalog, Documentary Photo Essay, Editorial Culture | accession plate, chronology, detail study, testimony | luxury clichés and tiny metadata |
| Sports, esports, event results and statistics | Sports Broadcast, Data Newsroom, Duotone Split | score ribbon, matchup split, stat comparison, momentum timeline | fake live status, unsupported rankings, ticker overload |
| Patient guidance, clinical operations, medical education | Clinical Clarity, Documentary Photo Essay, Scientific Atlas | care pathway, protocol steps, patient-facing explainer, handoff | research-plate styling by reflex, alarmist color |
| Fashion, styling, collection launch | Fashion Lookbook, Editorial Culture, Keynote Minimal Full-Bleed | full-look hero, silhouette lineup, material detail, campaign reset | generic luxury clichés, crops that remove the garment |
| Public service, resident guidance, civic accountability | Civic Service, Consulting Precision, Event Wayfinding | eligibility path, service journey, deadline map, next action | bureaucratic jargon, hidden eligibility limits |
| Venue orientation, conference or festival navigation | Event Wayfinding, Sports Broadcast, Retro Future | venue map, zone code, now/next schedule, route sequence | color-only directions, tiny times, ungrounded maps |
| Portfolio, case study, project proof | Portfolio Casebook, Editorial Culture, Consulting Precision | problem/response/outcome, artifact hero, process evidence, result | context-free mockups, thumbnail walls, inflated outcomes |
| Craft, interiors, maker and material-led product | Crafted Modern, Organic Material, Museum Catalog | object isolation, tactile detail, maker process, provenance | beige-only styling, fake handmade texture |
| Event identity, campaign opening, high-energy announcement | Kinetic Type, Typographic Editorial Poster, Retro Future | oversized type, timed reveal, manifesto beat, decisive reset | motion-dependent meaning, constant volume, display paragraphs |
| Entertainment, game, narrative event | Cinematic Noir, Retro Future, Riso Zine | key-visual cover, chapter card, lineup, countdown | effect-heavy factual slides and cropped identity anchors |
| Developer study, technical sharing, engineering conference | Technical Conference, Swiss Signal, Isometric Systems, Blueprint Workshop | event signal, literal system anchor, stage-readable title, mechanism sequence | fake console chrome, model badges, repeated status cards |
| Regional photo journey and travel-memory publication | Travel Editorial Collage, Destination Magazine, Documentary Photo Essay | dominant place image, subordinate detail crops, route metadata, editorial sequence | generic Japan motifs, equal-weight photo mosaic, fake notebook clutter |
| Single-act music profile, comeback, fan editorial | Pop Culture Scrapbook, Editorial Culture, Riso Zine | authentic hero photo, campaign field, paper frame, quotes, credits | generated artists, random stickers, anonymous equal photo tiles |
| Annual report, whitepaper, formal findings publication | Research Report Editorial, Data Newsroom, Consulting Precision | publication cover, lead finding, methodology/source band, evidence spreads | corporate card wall, oversized empty panels, footnote-gray caveats |

## Classify On Six Axes

Record one choice for each axis and pass it explicitly to the selector before implementation. These values are semantic inputs, not text searched for raw keywords:

1. **Job** (`--job`): decide, explain, compare, prove, teach, launch, document, or inspire.
2. **Evidence** (`--evidence`): `quantitative`, `sourced-text`, `authentic-photography`, `artifact-ui`, `diagram`, or `mixed`.
3. **Density** (`--density`): `sparse-keynote`, `editorial-medium`, `analytical-dense`, or `operational-dense`.
4. **Emotional register** (`--emotional-register`): urgent, calm, premium, playful, provocative, documentary, or institutional.
5. **Surface family** (`--surface-family`): `open-light`, `open-dark`, `paper-editorial`, `full-bleed-image`, `technical-canvas`, or `split-field`.
6. **Focal anchor** (`--focal-anchor`): `headline`, `artifact`, `person-place`, `chart`, `system`, `comparison-axis`, or `annotation`.

The selector reads these structured values against `theme_registry.json` as its primary signal.
Bounded subject phrases may disambiguate neighboring candidates, but unbounded title, audience, or
topic keyword matching must not decide the route. Two decks that differ only in color while keeping
the same composition, focal anchor, type character, media treatment, and surface grammar are still
the same design direction.

## Distinguish Related Directions

- **Bright Learning vs Playful Modular:** Bright Learning is informal routing vocabulary for calm, step-led instruction, not a registry theme. Playful Modular is the named selector theme when quizzes, participation, modular exercises, or expressive chapter color are central.
- **Editorial Field Guide vs Field Notes:** Editorial Field Guide is informal routing vocabulary, not a registry theme. Field Notes is for first-person observation, field evidence, routes, and specimens. Interpretation and caveats do not define a standalone visual theme.
- **Product Keynote vs Keynote Minimal Full-Bleed:** Product Keynote supports a feature/proof/lineup/offer sequence. Keynote Minimal Full-Bleed supports one dominant authentic artifact and one short message per beat.
- **Clinical Clarity vs Scientific Atlas:** Clinical Clarity serves patients, care teams, clinical operations, safety, and medical education. Scientific Atlas serves research evidence, specimens, mechanisms, calibrated scales, and uncertainty.
- **Technical Conference vs Mission Control:** Technical Conference is stage-first communication for a talk, workshop, or study. Mission Control is an operational system for incidents, monitoring, and response.
- **Protocol Proof vs Blueprint Workshop:** Protocol Proof explains claims, parties, commitments, trust boundaries, and verification. Blueprint Workshop explains an implementation, assembly, or revision plan.
- **Research Report Editorial vs Data Newsroom vs Consulting Precision:** Research Report Editorial is a durable publication; Data Newsroom is a finding-led evidence story; Consulting Precision is a recommendation and decision system.
- **Travel Editorial Collage vs Destination Magazine:** Travel Editorial Collage is a slower photographic journey or memory publication; Destination Magazine is a practical leisure guide with recommendations, routes, and useful trip metadata.
- **Pop Culture Scrapbook vs Idol Editorial Index:** Pop Culture Scrapbook is for one act or campaign; Idol Editorial Index is for multi-act orientation, chronology, comparison, and curation.

`Margin Commentary` and `Spatial Interface` are retired directions. `Systems Blueprint` is an invalid invented alias. Do not select, imitate, or reintroduce any of the three names.

## Reusable Composition Families

Use these as structural vocabulary, not templates:

- **Action-title grid**: a conclusion headline across the top, disciplined columns below, and a fixed source caption.
- **Asymmetric diagonal grid**: one dominant anchor and a directional reading path; keep alignment deliberate and accessible.
- **Bento anchor**: one large evidence module plus smaller supporting modules; do not make every module equal.
- **Editorial margin rail**: the main argument occupies the reading column while source, caveat, definition, or commentary lives in a reserved side or bottom rail.
- **Section inversion**: switch from light to dark, image to paper, or sparse to dense at a narrative boundary while preserving type and spacing tokens.
- **Split-screen hero**: two fields express a real tension, choice, or before/after relationship.
- **Typographic hero**: type carries the visual weight; one authentic image or artifact may support it, but cards do not.
- **Exploded spatial system**: components separate in depth to reveal topology, sequence, or ownership; labels stay anchored and readable.

Whitespace is part of each composition, not a goal on its own. Sparse keynote pacing is appropriate for an intentional reveal, vision, quote, or chapter. Ordinary technical, report, workshop, and evidence slides should normally let meaningful content control roughly 55–85% of the safe frame; large empty panels and half-blank covers are under-composed unless a full-bleed image or isolated artifact deliberately owns the field.

## Protected Annotation Rails

Annotation, caveat, source, footnote, and footer bands are reserved layout regions, not decorative overlays.

- Mark a custom rail with `data-protected-region="annotation|caveat|source|footnote|footer"`.
- Reserve its row or column in grid/flex/normal flow before placing cards.
- Do not stagger adjacent cards with `transform: translateY(...)`, `top`, or negative margins when the shifted box can enter a protected rail.
- Use `data-protected-overlap-ok` only for a deliberate underlay that remains legible and is visually inspected. It is not a geometry repair.

## Borrowing Boundary

This taxonomy incorporates transferable, clean-room design principles from the MIT-licensed [oh-my-design](https://github.com/3x-haust/oh-my-design) composition vocabulary and [slides-grab](https://github.com/NomaDamas/slides-grab) style/slide-role catalog. It does not copy their runtime, templates, generated decks, or repository-specific orchestration.
