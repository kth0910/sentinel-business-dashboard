# Theme Playbook

## Theme inference

Read `theme-taxonomy.md`, `theme-gallery.md`, `theme-typography.md`, and `../scripts/theme_registry.json`. Read `designer-reference-sources.md` when credited external design work would materially improve the direction. First classify the six selector axes: job, evidence, density, emotional register, surface family, and focal anchor. Then define the styling contract: three mood adjectives; display and body typography; generated semantic color-token pairs; shape language; media treatment; and motion character.

The gallery headings and registry theme names are the only named selector directions. Use the exact capitalization below:

| Named direction | Best for | Visual grammar |
|---|---|---|
| Destination Magazine | consumer travel guides, itineraries, city and food recommendations | destination-derived color, cover hierarchy, editorial photography, routes, practical metadata |
| Mission Control | infrastructure operations, engineering response, security operations | dark operational canvas, system boundaries, event timelines, status used semantically |
| Product Keynote | product and feature storytelling | authentic product hero, benefit sequence, proof, lineup, offer |
| Scientific Atlas | research, mechanisms, specimens, climate, space | calibrated plates, labeled scale, evidence detail, uncertainty |
| Playful Modular | workshops, participatory learning, onboarding | modular exercises, quizzes, numbered steps, expressive chapter color |
| Keynote Minimal Full-Bleed | launches, premium reveals, vision | one authentic artifact, one short message, extreme negative space |
| Portfolio Casebook | project and case-study proof | problem/response/outcome, artifact evidence, decision rationale, measured result |
| Sports Broadcast | sports, esports, results, event statistics | score ribbon, matchup split, stat comparison, momentum timeline |
| Clinical Clarity | patient communication, clinical operations, medical education | care pathway, protocol sequence, handoff, plain-language safety |
| Fashion Lookbook | collections, styling, beauty, visual merchandising | full-look hero, silhouette sequence, material detail, lineup |
| Civic Service | resident services, benefits, permits, community guidance | eligibility path, service journey, deadline and next action |
| Event Wayfinding | conferences, festivals, expos, venue orientation | venue map, zone code, schedule, route and accessibility |
| Crafted Modern | craft, interiors, maker brands, material-led hospitality | object isolation, tactile detail, measured process, provenance |
| Kinetic Type | event identity, campaigns, openings, announcements | oversized type, directional rhythm, timed reveal, decisive reset |
| Travel Editorial Collage | regional journeys, photo essays, Japan travel narratives | one dominant place image, subordinate detail crops, route metadata, literary editorial pacing |
| Protocol Proof | zero-knowledge proofs, cryptographic protocols, trust and security mechanisms | direct claim, single proof diagram, party/path color roles, mono protocol labels |
| Pop Culture Scrapbook | single-act profiles, comeback guides, fan editorials, music promotion | authentic hero photo, saturated campaign field, paper frame, visible credits, one hand-drawn accent |
| Technical Conference | technical shares, engineering seminars, DevOps studies, architecture talks | stage-readable title, event signal, literal system or artifact anchor, session metadata |
| Research Report Editorial | annual reports, whitepapers, research findings, formal technical reports | publication grid, lead finding, factual anchor, compact sources, conclusion-led charts |

These are routing hints, not topic mappings. A topic may support several valid directions depending on all six axes, and the best answer may be a bespoke unnamed contract. Never convert bespoke vocabulary into a selector name, splice unselected named directions after locking, or turn signature-slide lists into mandatory checklists.

## Anti-convergence routing

Technical is a subject domain, not an art direction. Do not automatically route AI, infrastructure, testing, local-model, semiconductor, MSA, Kubernetes, networking, or architecture decks to the same near-black console treatment.

Before locking the theme:

1. When a gallery or recent related decks are available, inspect three to five cover thumbnails and write an avoid list across six recent-signature dimensions: surface, title anchor, hero form, type character, accent strategy, and cover family.
2. Resolve the workspace and run:

   ```bash
   WORKSPACE="$(node scripts/render_slides.js --workspace-dir OUTPUT.html)"
   python3 scripts/select_visual_direction.py \
     --title "Exact deck title" \
     --audience "Primary audience" \
     --job "explain" \
     --evidence "mixed" \
     --density "editorial-medium" \
     --emotional-register "calm" \
     --surface-family "paper-editorial" \
     --focal-anchor "artifact" \
     --output "$WORKSPACE/drafts/design-contract.json"
   ```

3. Pass the six semantic axes as structured values. The selector reads registry metadata; bounded subject phrases may strengthen a match, but do not use raw keywords, substrings, title nouns, or audience nouns as the routing rule.
4. Pass a recently repeated selection with `--avoid-theme "Theme"` or `--avoid-cover "cover-family"`. The script keeps the same semantic brief stable while distributing neighboring briefs across different visual systems.
5. Treat the primary and alternatives as candidates. Use design judgment across subject, purpose, audience, language, evidence, and authentic assets, then lock the strongest registered direction. A non-primary choice requires its exact `--select-theme` and a concrete `--selection-reason`; never hand-edit the generated contract.
6. Preserve the returned surface, title anchor, hero form, type direction, palette direction, and semantic color-token pairs together. Changing cyan to orange on the same dark left-title/right-diagram cover is not a new theme. Importing Mission Control's charcoal/safety-orange/component language into Swiss Signal is a theme change, not a harmless accent.
7. Reject the recurring signatures `dark-console-left-title-right-orbit` and `incident-dashboard-card-wall` unless the subject literally requires a control-room or dashboard evidence view.

For a run of related technical decks, aim for at least three surface families and four cover families before repeating one. Suitable named directions include Swiss Signal, Blueprint Workshop, Data Newsroom, Neo Brutalist, Product Keynote, Playful Modular, Isometric Systems, and Mission Control. Only Mission Control is a default dark operational canvas.

### Related direction routing

- **Bright Learning vs Playful Modular:** Bright Learning is informal vocabulary for calm, step-led instruction, not a registry theme. Select Playful Modular when participation, quizzes, exercises, or modular learning are central.
- **Editorial Field Guide vs Field Notes:** Editorial Field Guide is informal vocabulary, not a registry theme. Select Field Notes only for first-person observation and field evidence. Route interpretation, caveats, and definitions by their actual communication job and evidence medium.
- **Product Keynote vs Keynote Minimal Full-Bleed:** Product Keynote supports a feature/proof/lineup/offer sequence. Keynote Minimal Full-Bleed supports one dominant authentic artifact and one short message per beat.
- **Clinical Clarity vs Scientific Atlas:** Clinical Clarity serves patients, care teams, care pathways, clinical operations, and medical teaching. Scientific Atlas serves research evidence, specimens, mechanisms, calibrated scales, and uncertainty.
- **Technical Conference vs Mission Control:** Technical Conference serves a talk, workshop, or study group and should read clearly from a stage. Mission Control serves literal operations, incidents, and monitoring. Engineering as a topic noun does not justify an operational dashboard.
- **Protocol Proof vs Blueprint Workshop:** Protocol Proof explains claims, parties, commitments, trust boundaries, and verification. Blueprint Workshop explains an implementation, assembly, or revision plan.
- **Research Report Editorial vs Data Newsroom vs Consulting Precision:** Research Report Editorial is a publication and reading system; Data Newsroom is a finding-led evidence story; Consulting Precision is a recommendation and decision system.

### Retired directions

`Margin Commentary` and `Spatial Interface` are retired and must not be selected, imitated, or restored under a new label. `Systems Blueprint` is not a registry theme; never invent or announce it as a named direction. Use the selector's remaining registered themes or a clearly unnamed bespoke contract.

### Idol routing

Treat idol presentations as different editorial jobs rather than one visual genre:

| Communication job | Possible direction | Typical treatment |
|---|---|---|
| Multi-group generation guide, lineup overview, or listening map | Idol Editorial Index | authentic photo index, chronology, profile spreads, source labels, act-specific accent shifts |
| Single-act personality, fandom, relationship, or meme guide | Pop Culture Scrapbook, Editorial Culture, Riso Zine, Playful Modular, or an unnamed bespoke fan-zine contract | closer photography, quotes, artifacts, fan-language rhythm, scrapbook cues only when they serve the story |
| Premium comeback, concept launch, or sales promotion | Pop Culture Scrapbook, Editorial Culture, Product Keynote, Cinematic Noir, or a bespoke brand direction | official key art, campaign hierarchy, dramatic reveal, concise benefit or concept claims |
| History, legacy, archive, or industry analysis | Museum Catalog, Documentary Photo Essay, Data Newsroom, or a bespoke research direction | chronology, archival evidence, dated captions, comparisons, restrained interpretation |

Do not select Idol Editorial Index merely because an idol appears. Preserve the act's own visual identity and let the audience, purpose, evidence, and available photography determine the final system.

### Travel routing

Treat travel as a set of editorial jobs, not one visual theme:

| Communication job | Primary direction | Typical treatment |
|---|---|---|
| Leisure guide, itinerary, city or food recommendations | Destination Magazine | travel-magazine cover hierarchy, destination photography, editorial spreads, route and practical-info modules |
| Regional photo journey, city-to-village narrative, or travel memory publication | Travel Editorial Collage | one dominant place image, one or two detail crops, literary serif/sans contrast, compact route metadata, warm publication pacing |
| Premium hotel, resort, ryokan, wellness stay | Soft Kinetic or Museum Catalog | quiet image-led pacing, material and service details, elegant but readable typography |
| Expedition, ecology, research trip, first-person observations | Field Notes | field evidence, annotated maps, observation-to-insight sequence, restrained notebook cues |
| Reportage, oral history, heritage, community story | Documentary Photo Essay | full-frame documentary photography, place/date slugs, testimony, map interludes |
| Tourism campaign or destination launch | Destination Magazine or Product Keynote | aspirational hero imagery, memorable claims, seasonal reasons to visit, decisive closing |

For an ordinary Tokyo, Kyoto, Osaka, or regional Japan guide, start from Destination Magazine. Use Travel Editorial Collage when the promise is a photographic city-to-village journey, memory publication, or slower regional narrative. Infer the palette from the actual season and photographs. A contemporary city guide may use bold grotesk display type, while a heritage-focused guide may use a serif/sans contrast; Japanese travel does not automatically mean dark green, off-white, a red sun, fake calligraphy, or ornamental Japanese glyphs.

### Technical sharing and conference routing

Use Technical Conference for a developer study, engineering seminar, architecture talk, or technical sharing session when the audience needs a stage-readable narrative rather than an operator console. The cover combines an event signal with one literal system, artifact, interface, or diagram anchor. Keep session, speaker, date, and organization metadata compact. Use Mission Control only when the evidence is truly operational; use Blueprint Workshop for implementation plans; use Protocol Proof for cryptographic claims and verification.

### Report routing

Use Research Report Editorial when the deck should behave like a durable publication: annual report, whitepaper, research findings, technical report, or formal board research. Lead with the report subject or main finding, use a publication grid, preserve methodology and source bands, and keep body slides information-rich without filling them with equal cards. Use Data Newsroom for a shorter evidence story and Consulting Precision for a recommendation or decision.

## Theme contract

Record this compact internal spec before implementation:

```text
Mood: precise / urgent / humane
Type: heavy Korean sans display + readable sans body + mono metadata
Palette pairs: dark field/on-dark field; paper/on-paper; safety orange/on-safety orange; mint status/on-mint status
Shape: thin boundaries, square cards, rounded image masks only
Media: documentary WebP photography + editable SVG systems diagrams
Motion: short directional fades; chapter images settle more slowly
```

The selector generates semantic color tokens as foreground/background pairs. Use both members of the selected pair on every surface and component; never override only the foreground or only the background. Do not select a theme by swapping color tokens on the starter template. Change typography, spacing, image treatment, composition families, source treatment, and motion together.

## Visual rhythm

Plan the sequence as a set of spreads, not isolated pages.

- Open with identity and a promise.
- Follow with a thesis or tension slide that makes the audience care.
- Alternate evidence-heavy and image-led slides so the deck can breathe.
- Insert a chapter break, quote, or surface reset before attention drops.
- Place the densest diagram or table after its context has been established.
- End by resolving the opening promise, not by repeating a generic thank-you page.
- Avoid three consecutive slides with the same dominant grid. A color change alone does not create rhythm.
- Declare each slide's dominant family with `data-composition-family`. Generic card-grid, component-wall, and dashboard families may occupy at most two slides per ten. A literal dashboard evidence slide may carry `data-dashboard-intent="evidence"`; the rest of the deck may not inherit that component density.

For a typical 8-15 slide deck, use at least five composition families from `quality-bar.md`. Promotional and narrative decks should normally include a cover, editorial split, full-bleed or contained key visual, lineup/gallery, decision slide, and designed closing. Technical decks should normally include a stakes image, system context, process or loop, failure/timeline, authority or comparison, and roadmap/closing.

Sparse keynote pacing is a specific narrative choice, not the default definition of good design. On ordinary body slides, use roughly 55–85% of the safe frame for meaningful content as a visual review heuristic; a cover normally lets title, visual anchor, and essential metadata occupy or control roughly 60–85%. Prefer open alignment, evidence, images, diagrams, rules, captions, and annotations over large underfilled containers.

## Financial and stablecoin visuals

For banking, payments, stablecoins, treasury, reserve, or settlement topics:

- Separate user funds, issuer reserves, operating funds, custodians, banks, blockchains, and merchants as labeled boundaries rather than merging them into a generic network.
- Show money movement with directional verbs and name the asset, unit, network, timing, and settlement destination when known.
- Distinguish issuer disclosure, third-party attestation, audit, regulatory status, and onchain evidence. Do not use these terms interchangeably.
- Date every balance, reserve, market, yield, transaction, adoption, and availability figure. Never fabricate a live ticker or imply live data from a static source.
- Use tabular numerals and paired semantic color roles: verified/backed/complete, transfer/settlement, dependency/pending, and loss/breach/depeg/blocking risk each use the generated background together with its generated foreground. Do not set a status foreground or background alone.
- Use official token and institution marks only when sourced. A generic coin or chain glyph must not masquerade as a real asset.
- Present depeg, liquidity, custody, smart-contract, counterparty, operational, and regulatory risks in the same visual system as benefits. Never imply guaranteed value, redemption, yield, or returns beyond the cited terms.

## Matching a reference

Extract the stage and margin proportions, typography contrast, color roles, layout families, line weights, radii, texture, image treatment, transition behavior, and control placement. Rebuild cleanly in UTF-8. Do not inherit malformed HTML, mojibake, inaccessible controls, overflowing absolute layouts, or brittle paths.

## Editorial mixed-surface pattern

For a theme like the trust-boundary reference:

- Use the canonical 1280×720 logical stage without exception, including poster-like typography, and fit it with the visualViewport-based scaling rules in `style-presets.md`.
- Alternate paper, dark, forest, and tinted wash surfaces.
- Pair an elegant serif display face with strong sans-serif utility text.
- Use mint for safe/approved states and orange/coral for gates or warnings.
- Favor thin borders, large statements, matrices, numbered annotations, and full-width flow diagrams.
- Add subtle CSS grain only when it remains legible and cheap to render.
- Include print CSS that reveals slides sequentially and hides navigation.

## Image composition

- Hero image: reserve 35–55% negative space for HTML title copy.
- Split slide: use 40/60 or 50/50; direct the subject’s gaze or motion toward the text.
- Full bleed: add a controlled overlay or gradient scrim and verify contrast at the busiest crop.
- Card thumbnails: keep aspect ratios and focal positions consistent.
- Convert every raster asset to WebP before placing it in the deck. Keep SVG for true vector logos, icons, and diagrams.
- Never stretch images. Use `object-fit: cover` only for decorative or safely croppable fields, explicit aspect ratios, and per-image `object-position`.
- Keep decorative art out of the reading order with empty `alt`; give informative images concise meaningful alternatives.

## Default-template escape check

Before the first render, confirm that `assets/runtime-shell.html` supplied only the runtime and did not become the deck's art direction.

- No demo copy remains.
- The demo dark-blue/purple palette is gone unless the topic independently calls for it.
- The three-card sample is not the dominant layout.
- No large sparse card or placeholder-like empty shape remains; every large surface carries proportionate information or a deliberate visual role.
- No `PLACE NOTE`, image-here label, temporary/dummy media, empty frame, or generic replacement graphic remains. If a promised factual image is unavailable, redesign the composition instead of styling the missing slot.
- Display and body fonts were deliberately selected for this subject and writing system; the neutral runtime-shell font stack is no longer the art direction.
- At least five composition families are visible in the storyboard.
- The cover and closing are designed for this subject.
- The deck's visual identity is recognizable with the text blurred.
- The cover does not repeat the recent dark-console/left-title/right-orbit signature merely because the subject is technical.
- Model name, reasoning effort, agent identity, validation mode, and generation metadata are absent from the cover unless the user requested them or the deck is specifically about that model or evaluation run.
