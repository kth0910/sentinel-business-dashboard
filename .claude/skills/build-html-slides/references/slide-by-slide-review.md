# Slide-By-Slide Review

Read `validation-contract.md` first. That file decides which slides and profiles require AI inspection. This file explains how to inspect them and fill `review.json` without overstating evidence.

## Before Vision

This procedure applies to Full Validation. Run the renderer and do not open captures while `automation_gate.status` is failing. Fix text bounds, control geometry, image load/aspect/resolution, or other deterministic failures first. Quick Draft does not create captures or enter this procedure.

Every slide retains all canonical captures. Only slides listed in `review_batches` require AI review.

## Batch Procedure

For each generated batch of at most four slides. Keep the batch intact in one vision call; do not open one call per slide or per image:

1. Open exactly the full-size PNGs listed in each slide's `required_ai_profiles`. When `identity_required` is true, also open every local `identity_targets[].reference_path`.
2. Inspect the images, not only HTML source, a contact sheet, or DOM metrics.
3. Inspect cross-layer relationships: look for imagery or structural boxes crossing dividers, labels, captions, copy, controls, card edges, or protected annotation/caveat/source/footer rails even when every element remains inside the slide bounds. Compare the top and bottom edges of repeated media/card pairs rather than checking only containment. Check whether the visible subject—not the raster canvas—occupies a useful share of its frame.
4. Keep one concrete observation and one verdict per slide, even when several profiles were opened.
5. Copy `required_ai_profiles` to `inspected_profiles` only after actual inspection.
6. Fill only the checks required by `review_scope`. Complete each `identity_review` entry from pixel comparison, never from labels or filenames. Resolve every `required_warning_ids` entry exactly once in `warning_reviews`; use the warning's profile, inspect the pixels, and record a concrete observation rather than restating the warning text.
7. Record a readable reviewer label and stable run-specific `reviewer_ref`.

Copy reviewer fields only from the structured result of the inspection that opened those capture paths. Do not create or run a helper script that invents reviewer identities, copies required profiles into inspected profiles, writes slide observations, turns every check into PASS, or completes review batches. When no real image-inspection call is available, leave the records pending and report `validation incomplete`.

Use contact sheets only to notice deck-wide rhythm, repetition, density, or a report-like absence of subject imagery. They do not replace slide-level inspection. In Full Validation, the final quality editor must assess whether the deck's overall media mix fits the subject rather than rewarding chart-only rigor by default.

The locked `research-brief.md` and `research-storyboard-review.md` own research sufficiency, metric relevance, causal boundaries, and story logic. The locked `design-contract.json` owns the selected theme, cover family, surface, title anchor, hero form, type direction, palette direction, and anti-pattern signatures. Visual review checks whether the rendered deck preserves both contracts; it must not start a second research or storyboard review, request another editorial pass, silently rename the visual direction, or create a new content-revision loop.

## Visual Checks

For `all` scope:

- `aesthetic_quality`: the slide is coherent, topic-appropriate, attractive, and presentation-ready; pass a sound deliberate composition without turning optional polish or personal taste into a failure;
- `readability`: the visual hierarchy and text remain easy to scan at presentation size, with no tofu glyphs, replacement characters, mojibake, malformed icons, broken line wraps, or avoidable reading ambiguity;
- `layout_integrity`: grids, stacks, cards, diagrams, media frames, and text regions retain their intended relationships without collapse, zero-size elements, merged shapes, or accidental overlaps;
- `surface_integrity`: gradients, image-backed fields, and hard color splits preserve contrast; no color boundary crosses a glyph, label, badge, icon, rule, or meaningful shape without a stable continuous backing;
- `diagram_semantics`: arrows and connectors point in the stated direction, land on the intended nodes, preserve clear endpoints, and do not cross or obscure their labels;
- `crop`: meaningful content remains fully visible;
- `aspect_ratio`: images, logos, screenshots, and diagrams are not stretched;
- `resolution`: inspect the full-size capture and confirm that edges, packaging, faces, screenshots, and embedded text are visibly sharp; reject thumbnails, prior upscales, heavy JPEG/WebP artifacts, ringing, or blur even when natural dimensions and effective pixel density pass;
- `content_match`: each meaningful image actually depicts and supports the slide's claimed subject, event, product, place, or concept; labels are not evidence. On the cover, chapter openers, company/entity profiles, and mechanism slides, also fail when a physical or observable subject that reasonably needs to be seen is replaced only by generic SVG, chart, or text treatment;
- for custom maps and illustrations, fail `aesthetic_quality`, `content_match`, or `completion` when geography or semantics cannot be verified, the result looks amateur or generic at full size, it serves only as decoration, or a sourced photograph, authoritative map, or image-free composition would communicate more clearly. Do not preserve a weak drawing merely to keep the layout filled;
- `completion`: no visible placeholder, temporary/dummy asset, empty media frame, or generic substitute graphic stands in for a promised real subject image; `PLACE NOTE` is an automatic failure, not a design label;
- `overflow`: text and components remain inside their intended regions;
- `occlusion`: media and decoration do not obscure copy or controls;
- `text`: copy is readable and visually coherent, with natural phrase-boundary wrapping and no one- or two-character Korean final line; a technical-share or seminar headline uses a concrete question, topic/action label, compact comparison, or result/boundary statement instead of replacing the identifiable object with a metaphor; the visible title matches `data-title`, and direct-technical titles do not repeat `-다` endings three times in a row;
- `text_bounds`: text remains inside its box, cell, button, badge, column, and safe area; rendered rows do not collide with each other or sibling copy; navigation covers no caption, source, or footer text; and no structural box crosses a protected annotation, caveat, source, footnote, or footer region;
- `density`: cards, panels, and decorative shapes justify their area and do not leave sparse copy stranded in oversized empty boxes;
- `controls`: navigation and interactive elements are centered, readable, and usable.
- `identity`: on explicitly or automatically identity-routed slides, every candidate matches its canonical WebP reference and the intended character/person variant.

For slide 1, also complete the generated cover checks. Judge first-glance focal hierarchy, subject clarity, topic-specific art direction, distinctiveness from recent or generic generated-series signatures, title readability, and surface integrity across every required profile. A cover does not pass these checks merely because crop, overflow, and controls pass.

All-scope reviews also check `design_adherence` and `component_repetition`. Text-only changes use aesthetic quality, readability, layout integrity, surface integrity, text, text bounds, density, and component repetition. Image-only changes use aesthetic quality, layout integrity, diagram semantics, crop, aspect ratio, resolution, content match, and completion. Navigation-only changes use controls. Identity-required `all` and `image` reviews also include `identity` and one cue-based `identity_review` entry per target.

Any `surface-contrast-boundary` warning forces AI inspection of that exact profile. Trace the boundary and state whether it crosses text, labels, or shapes. A missing, generic, mismatched-profile, or failed warning review blocks the slide. For slide 1 it also blocks cover approval and every publication or deployment path.

## Concrete Observations

Write what was visibly checked on that slide. Good observations name the composition and the result, for example:

> The two-line Korean title remains inside the left safe column, while the contained product image keeps all four edges and the bottom-right controls stay clear.

Do not reuse generic approval text across slides. Do not claim a model or person inspected evidence unless that inspection actually occurred.

## Fix Loop

When deterministic preparation fails, inspect the complete `<workspace>/validation-failures.json` report before editing. Group findings by `repair_lane`; use parallel agents only when their owned files do not overlap, while the main agent keeps sole ownership of shared HTML/CSS/runtime. Integrate all independent repairs and rerun once instead of fixing and rerunning one message at a time.

After an edit, rerun `validate_all.py --phase prepare`; the typed classifier discovers changed slides even when `--slides` is omitted. Pure copy, image, and slide-local CSS changes refresh only affected slides. Structure, order, transition, and adjacency-sensitive changes add immediate neighbors. Shared deck-wide CSS and runtime changes require a current two- or three-slide common preflight before one full render. CSS rules matching a finite slide subset and their background assets stay bound to that subset. Reopen every refreshed slide routed to AI review, then run `validate_all.py --phase verify`.

Never change a FAIL record to PASS in place. A FAIL requires a deck change, a new render run, and inspection of the new capture hashes. Focus that loop on the failed slide and check family; do not rerun unrelated validators or reopen unaffected captures. Do not bulk-generate reviewer labels, observations, checks, or PASS statuses, and do not use a local script to simulate a reviewer response. If a reviewer reports a defect after the main agent believes it is fixed, the reviewer verdict wins until a new independent inspection closes it.

Do not rerender unchanged source to see whether an intermittent font or navigation defect disappears. The renderer rejects this retry. The common preflight performs exactly two fresh-context captures as a determinism assertion; a mismatch is a renderer failure and there is no third attempt.

## Full Validation Final Pass

After all findings are settled:

1. run `validate_all.py --phase finalize-prepare`;
2. inspect every generated contact sheet once for deck rhythm, repetition, density, media balance, and consistency;
3. have the same independent presentation editor score the deck once with `quality-bar.md`;
4. complete exactly the generated full-size `cross_review_batches`, using an editor outside the full primary-reviewer set;
5. bind overview and cross-reviews to current capture hashes;
6. run `validate_all.py --phase finalize-verify`.

Standard risk uses at most five full-size targets; high risk uses at most six. Cover and closing take priority, followed by visual-critical, warning-triggered, and distributed sample slides. The contact sheets are overview evidence only and never prove fine text, crop, identity, or control geometry. Do not expand the generated final pass manually. After a focused repair, reuse a passing independent review only when the slide capture hash and review contract are unchanged; regenerate the failed or changed slide's review.

Image count does not create additional AI calls by itself. Inspect the rendered composition once per required slide/profile set. Do not open every fan-art source as a separate validation step, and do not infer critical status from styling classes such as `logo`, `key-visual`, `title-art`, or `diagram`.

## Evidence Limits

The validator checks capture origin, dimensions, PNG validity, hashes, current source fingerprints, adaptive routing, batch membership, geometry, and review-record structure. Reviewer names and observations are declarations, not cryptographic proof of a vision call. Never manufacture those declarations to satisfy the schema, including through a helper that assigns reviewer identities, inspected profiles, observations, PASS checks, statuses, or completed batches. Populate those fields only from structured findings returned after the assigned full-size captures were actually opened. When no image-inspection call is available, leave the records pending and report `validation incomplete`. Report a completed result as evidence-consistent review, not independently attested inspection.
