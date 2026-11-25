# Presentation Quality Bar

Use this reference before storyboarding and again during visual review. It captures the reusable qualities of strong product, entertainment, and technical decks without copying any one deck.

## What strong decks do

- Use the title form that fits the communication job. A slide may state a claim, decision, concrete question, instruction, topic/action label, or transition. Technical sharing does not need a forced aphorism on every slide.
- Build visual rhythm. Alternate image-led, statement, evidence, process, comparison, and decision slides instead of repeating one card grid.
- Make imagery carry meaning. Product shots prove the object, screenshots prove the experience, people create stakes, and generated scenes establish atmosphere or a chapter change.
- Use one art direction across many compositions. Typography, color roles, line weight, radii, image treatment, and source treatment stay coherent while layouts change.
- Design the ending. The last slide resolves the opening promise and leaves one useful action or memorable statement.
- Design the opening with equal intent. Slide 1 makes the named subject, promise, and visual world recognizable before the audience starts reading body copy.
- Give the opening one unmistakable hero hierarchy. A multi-image cover still needs one dominant anchor; equal-weight collage tiles are not a substitute for a point of view.
- Integrate evidence. Sources, dates, caveats, and provenance belong to the composition rather than appearing as an afterthought.
- Route the story for the room. Common stakes and decision context arrive before specialist depth unless technical detail is itself the decision; every named audience sees why the next section matters.
- Keep technical headlines concrete and economical. A short question such as `곡선은 왜 늘어났나` or `파라미터를 왜 의심하나` passes when its object is clear in the slide and surrounding section. A metaphor may support the subtitle; it must not replace the literal subject in a technical share or seminar.
- For direct-technical decks, use noun phrases and compact comparison labels for configuration, architecture, field-reference, and comparison slides. Three consecutive `-다` titles or declarative sentences on more than 40% of the deck are a copy-system defect, not a consistent voice.

## Storyboard contract

Before writing HTML, use the locked research brief's slide-role table with: slide number, primary and secondary audience, incoming question, answer, evidence IDs, `so what`, next question, decision job, detail level, why this information belongs now, composition family, dominant visual, and transition from the previous slide. The exactly one pre-authoring editorial review owns analytical sufficiency and story continuity; final visual review must not reopen or repeat it.

For an 8-15 slide deck, normally use at least five composition families from this list:

1. Brand or cinematic cover
2. Thesis or oversized statement
3. Editorial split with meaningful image
4. Full-bleed image with a text-safe field
5. Metric, price, or single-number proof
6. Comparison, matrix, or short table
7. Process, timeline, architecture, or causal diagram
8. Gallery, lineup, or annotated screenshot
9. Chapter break, quote, or tonal reset
10. Audience fit, decision, recommendation, or closing action

Do not use the same dominant composition on three consecutive slides. Do not use a generic card grid more than twice in a 10-slide deck unless the subject is explicitly a catalog or dashboard. Change the information shape, not only the background color.

Declare the dominant layout on every slide with `data-composition-family`. A slide that literally
shows a real dashboard as evidence may use `data-dashboard-intent="evidence"`; that local exception
does not turn dashboard panels, cards, chips, and status badges into the deck-wide design system.

## Imagery expectations

- Promotional, entertainment, travel, lifestyle, portfolio, and product decks: use meaningful raster imagery across most of the story.
- Unless the user explicitly requests pure HTML or an image-free treatment, perform relevant photo/factual-image discovery before deciding that a deck or chapter should contain no photography. Use only images that earn their place; omit them when they add no information.
- Technical, strategy, market, industrial, and research decks: read `media-strategy.md`. When the subject is physical or observable, combine diagrams and data layouts with sourced product, facility, equipment, infrastructure, microscopy, pathology, medical, laboratory, field, or other subject-specific imagery that establishes what the audience is discussing.
- Full Validation must improve image relevance, provenance, crop, resolution, and captions; it must not remove useful subject imagery merely to make the deck easier to verify.
- A 12-20 slide physical-subject deck often needs four to eight distinct visual anchors across the cover, chapters, major entities, and key mechanisms. Treat this as a planning range, not a quota.
- Use distinct assets for distinct narrative jobs. A different crop of the same image is not a new visual idea.
- Prefer no visual to a weak one. Reject amateur or unverifiable maps, decorative pseudo-diagrams, generic illustrations, and generated filler that communicate less than a sourced photograph or a clean image-free composition.
- Convert every raster deliverable asset to WebP before referencing it in HTML. Keep SVG for logos, icons, and editable vector diagrams.
- Avoid low-resolution thumbnails, screenshots with unreadable embedded text, generic stock filler, and decorative images that do not support the slide claim.
- Reject images that do not visibly match the named subject. Character/person decks require canonical-reference comparison as defined in `identity-review.md`; metadata and source tags alone are insufficient.
- Reject generated media used as an authentic depiction of an existing person, group, released game, product, place, event, artwork, interface, or documentary result. Generated atmosphere may support a factual slide but cannot occupy its subject, evidence, or identity role.
- Reject unfinished media slots. A label such as `PLACE NOTE`, an empty image frame, a repeated geometric fallback, or generic art standing in for an expected real place/product/person/event image is a blocking placeholder, not intentional visual variety.

## Composition checks

- The eye should find the claim first, evidence second, and source or caveat last.
- Use scale contrast: at least one dominant element per slide. Avoid five equally loud cards.
- Let image crops, diagonal fields, rules, and whitespace create direction. Do not solve every layout with centered content.
- Use deliberate asymmetry when it improves energy, but keep alignment lines obvious.
- Keep sources and controls quiet but readable. They must not compete with the headline or collide with the main composition.
- Use surface changes as chapter punctuation, not random decoration.
- Judge container occupancy, not only alignment. Large panels containing a few words, short bullets floating at the top of tall cards, and empty decorative rectangles are unfinished compositions. Use open layout or add evidence instead of enlarging the box.

## Anti-regression rubric

Score each dimension from 0 to 3 on rendered slides.

| Dimension | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| Story | rendered order breaks the locked question chain | understandable list | locked arc remains coherent on slides | memorable argument with payoff |
| Art direction | default template | colors changed only | cohesive system | distinctive, topic-specific visual world |
| Layout rhythm | one repeated layout | minor variation | several useful families | deliberate pacing and chapter resets |
| Typography | cramped or generic | readable | strong hierarchy | expressive and language-aware |
| Imagery | subject unseen, absent, or filler | sparse, repetitive, or wrong medium | subject-appropriate real/scientific/diagram coverage | narrative, sourced, well-cropped, varied, and evidentially clear |
| Composition | clipped/underfilled/overfull | mechanically aligned | balanced | confident focal hierarchy and movement |
| Evidence | rendered claims detach from the locked ledger | present but weak | locked evidence is integrated visibly | evidence strengthens the visual argument |
| Presentation utility | broken or awkward | functional | smooth controls and notes | rehearsal-ready and audience-aware |

This rubric is used only in Full Validation. After the render/fix loop is settled, run `--phase finalize-prepare` and score exactly once. Require at least 20/24 with every dimension at least 2. Record all eight dimensions, the calculated total, a stable independent editor `reviewer_ref`, concrete notes, and the three weakest slides (or every slide when fewer than three) in `review.json`. Complete only the generated risk-based cross-review batches, then run `--phase finalize-verify`. Quick Draft does not calculate this score. A passing structural validator does not compensate for a failing visual score.

## Blocking quality failures

Use a material-defect threshold. Once a slide is readable, coherent, attractive, topic-appropriate, and free of the failures below, pass it and move on. Preference-only polish, tiny spacing alternatives, or another equally valid style may be noted but must not trigger another repair loop.

- The output still looks like the starter template.
- The rendered deck does not follow the locked `design-contract.json`, silently changes the selected theme, or combines another named direction's palette and component language without rerunning the selector.
- Three or more consecutive slides share the same dominant layout.
- Generic card-grid, component-wall, or dashboard composition exceeds two slides per ten, excluding only exact dashboard evidence slides.
- A product, game, place, person, or event deck relies mainly on text and generic cards.
- A materially observable industry, product chain, facility, device, experiment, biological phenomenon, or research modality is shown almost entirely through text, tables, charts, and generic SVGs even though suitable subject imagery is reasonably available.
- A custom map or illustration is geographically or semantically unverifiable, visibly amateur, decorative rather than informative, or weaker than an available sourced image or image-free composition. Remove it instead of awarding credit for visual variety.
- The same underlying photograph appears as multiple crops, resolutions, recompressions, recolors, or re-encodes without the explicit subordinate continuity exception.
- A rendered slide contains oversized low-information surfaces or decorative empty boxes that are not justified by a hero, chapter, comparison, interaction, or fixed-format visual.
- The cover lacks a clear first-glance identity signal for the named subject, looks like a generic title template, uses a weak or irrelevant visual, traps the title in an oversized empty panel, treats several images as equally loud collage tiles without a hero, or crops an identifying feature. A technically valid but merely acceptable cover does not pass when the body is more art-directed.
- A run of related decks repeats the same surface, title anchor, hero geometry, type treatment, and metadata badge while changing only the title or accent color.
- A cover promotes model, reasoning-effort, agent, validation, or generation metadata that the audience did not request and that is not the presentation subject.
- The deck has no designed closing payoff.
- A named mixed audience receives a generic topic order, or must endure specialist detail before understanding the shared stakes, decision, or relevance.
- A technical-share, seminar, workshop, runbook, or training headline hides the literal object and question/action behind a metaphor, aphorism, or vague tension even though a shorter concrete question, topic/action label, or result/boundary title is available.
- A direct-technical deck repeats declarative sentence endings on three consecutive slides or uses them on more than 40% of titles instead of mixing concise questions, labels, comparisons, and noun phrases.
- A slide's visible `<h1>` or `<h2>` differs from its `data-title`, causing notes, navigation metadata, and rendered copy to describe different headings.
- Raster assets are not WebP, except that SVG remains preferred for true vector content.
- Reviewers approve from HTML source without inspecting settled rendered slides.
- Full Validation lacks all-slide AI coverage, required adaptive profiles, review-batch membership, concrete observations, stable reviewer references, or passing change-type verdicts.
- Full Validation review fields were filled by a bulk-edit helper or otherwise lack an actual full-size capture inspection. Schema-valid declarations do not prove visual review.
- Full Validation omits any slide generated in the risk-based `cross_review_batches`, adds unbound substitute records, or uses a cross-reviewer from the primary-reviewer set.
- A named character/person slide lacks grounded identity targets, cue-based identity verdicts, or uses the wrong subject or variant.
- Any slide contains a visible placeholder, temporary/dummy asset, empty media promise, or generic substitute graphic where the composition claims a real subject image. One occurrence blocks delivery regardless of the numeric score.
- Typography remains the neutral runtime-shell stack, bare `system-ui`, or an unrelated generic face instead of a deliberate language- and topic-appropriate display/body system.
- A display title or quote strands one or two Korean characters or punctuation on its final line, uses line-height that makes rendered glyph rows collide, overlaps another text region, or is covered by persistent navigation.
- Any rendered text contains tofu, replacement characters, mojibake, malformed icons, or broken glyph shaping.
- A gradient, image-backed field, or hard color split crosses text, labels, badges, or meaningful shapes without stable backing, or its required AI warning review is missing.
- A diagram arrow points in the wrong direction, lands on the wrong node, obscures a label, or contradicts the narrated flow.
- A grid, stack, diagram, frame, or text region visibly collapses, merges, overlaps, or loses its intended spatial relationship.
- Text or an unbroken label leaves its nearest painted parent card, panel, badge, chip, code box, or cell even when the text remains inside the overall slide.
