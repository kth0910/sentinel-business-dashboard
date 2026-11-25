# Cover Design Contract

Treat slide 1 as the highest-priority art-direction decision in the deck. The cover must establish subject identity, audience promise, and visual tone within roughly three seconds. It is not a generic title page and must not be the least-developed slide because the body took longer.

## Plan Before Building

Before implementing the cover, write a private one-line brief containing:

- the literal subject, product, place, person, event, or decision the audience must recognize;
- the opening promise or tension that makes the next slide worth seeing;
- one dominant visual anchor;
- display-type character and title line count;
- composition direction, focal point, and required safe area;
- any logo, date, presenter, confidentiality, or source metadata that genuinely belongs.

Consider at least two materially different cover directions in planning, such as full-bleed editorial image versus contained object composition, or cinematic scene versus typographic thesis. Choose the direction that best fits the audience and subject. This comparison does not require two finished renders.

When recent related covers are available, the two candidates must also differ from the dominant recent signature on at least three of these axes: surface, title anchor, hero form, type character, accent strategy, and spatial composition. Recoloring the same layout does not count. Use `scripts/select_visual_direction.py` before drafting candidates.

Use the selector ranking as a candidate set, not an automatic aesthetic verdict. Judge each candidate against the actual subject, purpose, audience, language, evidence, and authentic assets. If a non-primary registered theme is stronger, lock it with `--select-theme` and state the reason; do not create an unregistered hybrid.

Do not place model name, reasoning effort, agent identity, validation mode, slide count, or generation metadata in a decorative cover badge unless the user asked for operational metadata or the presentation is specifically about that model/evaluation. Production-process labels make unrelated decks look like one generated series.

## Visual Standard

- Make the named subject a first-glance signal. Use its literal name or offer as the primary title; put explanatory value in supporting copy.
- Give the cover one dominant focal hierarchy: subject or key visual first, title immediately legible, secondary metadata quiet.
- Make meaningful use of the frame. As a review heuristic, title, visual anchor, and essential metadata should normally occupy or visually control roughly 60–85% of the safe area. A deliberately isolated artifact or full-bleed image may exceed or undercut that range, but an empty half-frame with only a small title is unfinished, not minimal.
- For an existing physical, observable, branded, entertainment, travel, scientific, or person-led subject, use the strongest accurate official, supplied, licensed, or sourced visual as the identity anchor. Do not replace it with generated lookalike art, generic geometry, a chart, or an empty mood field.
- Generated scenery, texture, or conceptual art may support the cover when it cannot be mistaken for the real subject. It may lead only for an abstract thesis, confidential system, or clearly hypothetical scenario with no honest documentary referent.
- Use logos, posters, title art, products, screenshots, diagrams, and character compositions with `contain` or a deliberately protected foreground. A covered backdrop may support them, but must not crop the identifying edges.
- For abstract or confidential topics, earn a typographic or diagrammatic cover with a distinctive thesis, composition, and visual system. A large empty rectangle with a title is not a concept.
- Avoid dashboards, repeated card grids, agenda lists, multi-column reports, and oversized rounded title panels on slide 1 unless the format itself is the subject.
- A collage needs a hierarchy: one dominant image plus at most two clearly subordinate crops is a strong default. Three or more equal-weight images usually read as a gallery, not a cover concept.
- Keep the title to a deliberate one-to-three-line composition where possible. Fix copy width, line breaks, type size, or font choice when Korean endings, punctuation, proper nouns, or brand names wrap awkwardly.
- Keep navigation, credits, logos, and source metadata outside the title and focal-image safety zones.

## Cover Review Gate

In Full Validation, the renderer treats slide 1 as visual-critical. AI must open every generated profile for the cover and review it as a cover, not merely as a slide whose elements fit inside bounds. Quick Draft still gives the cover the strongest authoring attention, but performs no render or AI review.

Slide 1 has six additional required review checks whenever its current scope is not navigation-only:

- `cover_focal_hierarchy`: one dominant anchor wins immediately; equal-weight mosaics and card walls fail unless the subject itself is a catalog;
- `cover_subject_clarity`: the named subject and opening promise are recognizable without reading body-sized copy;
- `cover_art_direction`: the composition is topic-specific, integrated, and at least as intentional as the strongest body slide;
- `cover_distinctiveness`: the cover does not repeat a recent or generic generated-series signature across surface, title anchor, hero form, typography, and metadata;
- `cover_title_readability`: the full title remains deliberate and legible at normal, short, and zoom150;
- `cover_surface_integrity`: every gradient, image-backed field, or hard color split preserves stable contrast, and no color boundary cuts through a glyph, label, badge, or meaningful shape without a continuous backing.

After the first settled render, open the cover at full size and perform a dedicated refinement pass before ordinary slides. Check authentic subject recognition, focal crop, image resolution, title line composition, display/body contrast, color integration, depth and edge treatment, logo and metadata placement, source treatment, and navigation clearance. On any gradient, image-backed, or split background, trace each visible color boundary from edge to edge and confirm it does not pass through title glyphs, labels, badges, rules, icons, or foreground shapes unless one continuous scrim or backing keeps the object visually whole. Resolve weak details before reviewing ordinary slides; the cover should feel at least as intentional as the strongest body slide.

Fail the cover when any of these is true:

- the named subject is ambiguous or visually subordinate;
- an existing named subject is represented only by generated or generic imagery without an authentic identity anchor;
- the title could belong to an unrelated generic deck;
- the key visual is weak, irrelevant, blurry, visibly upscaled, or incorrectly cropped;
- a logo, face, product edge, title art, map, or identifying feature is cut off;
- title wrapping, contrast, or hierarchy fails at normal, short, or zoom150;
- the composition looks like an unfinished placeholder, empty panel, dashboard, or body slide;
- three or more equal-weight images compete without a clear hero, or a collage substitutes quantity for a cover concept;
- a technical cover repeats the dark-field, left-title, right-orbit/boxed-diagram, top-model-badge signature without a subject-specific reason;
- generation metadata or a model/effort badge competes with the actual subject;
- persistent navigation competes with the title, credit, logo, or key visual;
- the opening promise and the next slide have no coherent handoff.

Do not approve the cover only because geometry passes. If slide 1 is merely acceptable while the rest of the deck is art-directed, revise it before delivery. A validation deadline never waives this gate. After the 60-minute deck deadline, stop every other lane and use only the slide-1 cover rescue and `cover-verify` closeout. A missing, pending, or failed cover review—especially an unresolved surface warning—blocks approval and deployment.
