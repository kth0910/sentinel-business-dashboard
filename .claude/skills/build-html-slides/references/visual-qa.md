# Visual QA Checklist

Use this checklist while inspecting the rendered slides selected by `validation-contract.md`. Mode, profile, reviewer-count, and finalization rules do not live here.

## Hierarchy And Story

- The opening establishes a clear promise or stake.
- Each slide has one primary claim and an obvious reading order.
- Evidence appears close to the claim it supports.
- Specialist depth arrives when the audience has a reason to care.
- The closing resolves the opening and leaves a decision, takeaway, or next action.

## Composition

- Judge whether the slide is presentation-ready, attractive, readable, and intentional as a whole. Pass once hierarchy, spacing, balance, contrast, typography, imagery, and motion cues are coherent. Do not fail a sound slide for preference-only polish, a small spacing alternative, or a different equally valid style.
- The rendered theme, surface, cover grammar, type character, palette roles, and component language visibly follow the locked `design-contract.json`; no unselected named theme has been spliced in.
- Layout families vary without breaking the theme system.
- `data-composition-family` matches what the slide visibly does. Three consecutive slides do not repeat one family, and generic card-grid/component-wall/dashboard layouts do not exceed two per ten.
- The composition does not look trapped inside one large panel.
- Repeated cards, decorative chips, and labels have a real information job.
- Intentional whitespace reads as hierarchy, not missing work.
- Large cards and panels contain enough information or visual evidence to justify their area; short copy is not stranded inside tall empty boxes.
- Empty outlines, low-contrast placeholder-like shapes, and equal-height sparse cards do not make the slide look unfinished.
- Dense slides have enough separation for scanning and comparison.

## Typography

- Titles fit without awkward single-character wraps or stranded punctuation.
- Display titles and quotes do not leave one or two Korean characters, sentence endings such as `다.`, or closing punctuation alone on the final line.
- Multiline display glyphs have visible separation; no row intersects the glyphs above or below it even when the element itself remains in bounds.
- Body text remains readable on the logical 1280×720 canvas.
- Korean and Latin glyphs look compatible.
- Numerals, punctuation, units, and table alignment are consistent.
- Long text stays inside its intended box, column, cell, badge, button, or safe region.
- Long identifiers and code remain inside their nearest painted parent; viewport containment alone does not pass.
- Footer text, captions, and sources remain clear of the persistent navigation panel.

## Imagery

- The deck's medium matches the subject. Physical industries, products, facilities, equipment, people, experiments, organisms, tissue, and clinical or laboratory phenomena receive enough sourced real-world or scientific imagery to establish the subject; charts and SVGs do not replace seeing the thing itself.
- Unless the brief explicitly required pure HTML or no photography, an image-free chapter reflects a documented semantic choice after relevant visual discovery rather than convenience or an unattempted search.
- The cover or opening sequence visually establishes a materially observable subject unless confidentiality, availability, or a deliberate abstract communication job justifies another approach.
- Data-heavy slides may remain chart-first, but the overall sequence still has image-led context and chapter rhythm when the subject benefits from it.
- Official marks retain aspect ratio and clear space.
- Key visuals use `contain` when faces, products, title art, UI, diagrams, or edges matter.
- Decorative `cover` crops do not remove meaningful content.
- Raster assets are sharp enough at the actual full-size presentation capture and stored as WebP. Converting a small or damaged JPEG to WebP does not improve it.
- Product packaging, faces, screenshots, diagrams, and embedded labels retain crisp edges and readable detail. Reject obvious thumbnails, prior upscales, blur, ringing, mosquito noise, block artifacts, banding, and over-compression.
- Prefer at least 1.25 source pixels per maximum rendered device pixel. Treat less than 1.0 as blocking unless an irreplaceable user-supplied historical asset is explicitly marked, disclosed, and presented small enough to look intentional.
- Reused imagery serves a different narrative role and does not look like filler.
- Sources, credits, signatures, and watermarks remain accurate.
- Each meaningful image visibly matches the subject and narrative claim of its slide; filenames, alt text, captions, folders, and search tags are not proof.
- Named characters and people match a separate official/authoritative reference, including the intended costume, age, form, and distinguishing traits. Uncertain identity is a failure.
- Every apparent media slot is finished. Labels such as `PLACE NOTE`, dummy/temporary art, empty image frames, and repeated generic substitute graphics fail when the slide promises a real place, product, person, character, venue, or event image.
- Judge the visible subject separately from the raster canvas. Large intrinsic white or transparent margins that make the subject look tiny are a composition failure even when `object-fit: contain` passes.
- Compare repeated image frames as a family. One unusually tall, wide, or whitespace-heavy asset must not push a shared grid track, divider, caption, or label out of alignment.

For games and animation, inspect official key art, wallpapers, title art, screenshots, and creator-hosted fan work against spoiler boundaries and distribution rights. Public or commercial decks require verified reuse rights or safer replacements.

## Layers And Contrast

- Media remains behind titles, labels, sources, and controls.
- Annotation, caveat, source, footnote, and footer bands remain visually reserved. No card, panel, frame, background surface, or transformed box crosses their boundary, even when the text inside both elements remains readable.
- Inspect the last content row against every protected bottom rail and inspect the main reading column against every protected side rail. A stepped or staggered card pattern is not intentional if its painted box enters the rail.
- When a media-layer image and content-layer card form one visual frame, annotate the exact pair with matching `data-frame-id` and `data-frame-for` values. Their rendered left, top, right, and bottom edges must match within the automation tolerance at every checked profile.
- The renderer also compares repeated class names mirrored across direct `.slide-media` and `.slide-content` layers. A substantial overlap with mismatched edges is a blocking layer-registration defect even when both rectangles remain inside the slide.
- Use `data-overlap-intent="hero-underlay|text-on-image|edge-bleed|decorative-bleed"` only on the exact intentionally mismatched elements. Broad ancestor exemptions and invented values do not pass.
- Text does not straddle incompatible light/dark regions without a stable scrim or backing.
- On gradients, image-backed text, and hard split backgrounds, trace the visible color boundary and confirm it does not cut through text, labels, badges, icons, rules, or meaningful shapes. A deterministic warning is unresolved until the required AI warning review records this pixel-level result.
- Selector-generated semantic color tokens remain paired foreground/background roles. No slide or component uses a foreground-only or background-only override.
- The rendered contrast gate—not source-token inspection—blocks ordinary text and controls below 4.5:1 and large display text below 3:1 at the final painted pixels.
- Decorative shapes do not create accidental tangencies or obscure hierarchy.
- Dividers, card edges, captions, and labels remain visually separate from imagery. A product or screenshot crossing a divider or entering its caption region is blocking occlusion even when no DOM bounding box leaves the slide.

## Geometry And Runtime

- The canonical 1280×720 stage is used without exception and remains centered and visible at each retained profile, including Chromium page scale 1.5 with a measured 1280×720 `visualViewport`.
- No text, logo, image, badge, diagram, or control crosses the stage.
- No stack, grid, diagram, or framed composition has collapsed, merged into another region, lost its intended spacing, or produced a zero-size/near-zero-size visible element.
- Diagram arrows point from the stated source to the stated destination, terminate on the intended node, avoid label collisions, and agree with the narrated flow. A geometrically neat but semantically reversed connector fails.
- Navigation order and page counter match the runtime contract.
- Current page, separator, total, and icons are geometrically centered.
- Hash navigation, direct page input, arrows, Page Up/Down, Home/End, fullscreen, edge clicks, and print behavior pass `validate_browser_e2e.js`, not only source-string checks.
- Final HTML retains authored motion and reduced-motion support.

## Evidence And Locale

- Dates, prices, availability, regulation, schedules, and product names match the target market.
- Sources are visible or recorded where the audience needs confidence.
- Caveats and assumptions are not hidden by the visual treatment.
- Presenter notes add delivery guidance rather than repeating slide copy.

## Blocking Defects

- cropped or stretched meaningful imagery;
- tofu boxes, replacement characters, mojibake, missing icon glyphs, broken ligatures, or visibly malformed Korean/Latin text;
- text outside a box or safe area;
- orphaned final-line characters or punctuation, colliding text rows, overlapping text regions, or copy covered by navigation;
- unreadable contrast or foreground media over copy;
- media/content frames that visibly belong together but diverge, allowing imagery to escape a card, divider, caption, or mask;
- broken/missing local assets;
- visibly blurry, thumbnail-sized, previously upscaled, or heavily compressed raster imagery, regardless of file extension or nominal dimensions;
- generic starter styling or repeated default composition;
- amateur, approximate, unverifiable, or decorative maps and illustrations that are weaker than a sourced photograph, authoritative map, or image-free composition;
- the same underlying photograph reused through another crop, resize, recompression, recolor, or re-encode without an explicit subordinate continuity role;
- silent divergence from the locked visual direction, including a palette/component hybrid relabeled as a new theme;
- repeated incident-dashboard/component-wall density outside an exact dashboard evidence slide;
- a report-like, image-starved treatment of a materially observable subject despite suitable factual imagery being reasonably available;
- wrong region, unsupported factual claims, or misleading provenance;
- wrong character/person, wrong variant, unverifiable identity, or thematically inappropriate imagery;
- any visible placeholder or generic replacement graphic standing in for missing factual or subject-specific media;
- an unconsidered generic font stack or typography that conflicts with the subject, language, or audience;
- stale captures presented as current evidence.
- reversed or ambiguously terminated arrows, connector-label collisions, collapsed stacks/grids, merged shapes, or broken spatial relationships;
- a reviewer FAIL replaced with PASS without a new render and independent inspection of the new capture hashes;
- synthetic or bulk-generated visual observations and reviewer identities that do not correspond to actual inspection.
- review manifests populated by helper scripts instead of structured findings returned after opening every assigned full-size capture.
