# Validation Contract

This file defines validation semantics. `scripts/validation_contract.json` is the machine-readable authority for the schema version, exact profile geometry, check sets, batch size, managed Playwright version, and standard cross-review sampling values. Scripts and tests must read that JSON rather than duplicate those values.

## Choose By Intent

New-deck creation requires two explicit intake choices: Quick Draft versus Full Validation, and whether the optional reader-facing per-slide study guide is needed. Ask both together when both are unanswered. If the user already answered one, retain it and ask only the other; do not ask the same question again. Present the guide as optional and describe its sibling Markdown, readable HTML, and PDF outputs. Stop before research, drafting, file creation, or asset generation until both choices are resolved. Do not silently infer either choice. Recognize an explicit choice from meaning and context rather than a keyword list, regular expression, or substring heuristic.

| Mode | Use when | New evidence |
| --- | --- | --- |
| Edit Only | The user primarily wants an ordinary revision and does not seek new assurance | None |
| Quick Draft | The user prioritizes iteration or a first usable version | None; creation only |
| Full Validation | The deck is intended for delivery, publication, or a consequential decision, or strong assurance is requested | Automated geometry and AI review for every slide, independent review, final score |

Edit Only applies to an existing deck revision when the user asks for a change without requesting new validation evidence. It is not a substitute for asking the required new-deck mode question.

## Tool Preflight And Installation Consent

After the user chooses Full Validation, run this preflight before substantive work:

```bash
python3 scripts/check_environment.py
```

The script checks Python, Node.js, Playwright, Chromium, and screenshot capture without installing anything. If it fails, report the exact missing or incompatible components and ask whether the user wants them installed. Stop until the user gives explicit consent unless that consent was already part of the request. Do not run `npm install`, `npx playwright install`, an OS package manager, or elevated installation commands first. After approval, prefer the bundled user-scoped installer:

```bash
python3 scripts/install_browser_dependencies.py --consent
```

It installs the contract-pinned Playwright package and Chromium under `~/.build-html-slides/runtime`. Use `--with-deps` only when the user also approved Linux system-library installation, which may require elevated privileges. After installation, rerun the preflight. Do not begin Full Validation until it passes. Quick Draft skips this preflight because it performs no browser rendering or validation.

## Durable Research And Copy Freeze

Initialize the workspace before research with `node scripts/render_slides.js --init-workspace OUTPUT.html`. Fill and maintain `drafts/research-brief.md`; on resume, read it before continuing. `sources.json` remains raster provenance and never replaces the factual claim ledger.

Before HTML authoring, classify job, evidence, density, emotional register, surface family, and
focal anchor, then pass all six structured values to `select_visual_direction.py` with
`--output <workspace>/drafts/design-contract.json`. The primary result is binding by default; an
alternative requires its exact theme name and a concrete selection reason. Full Validation runs
`validate_design_contract.py` before rendering and blocks missing, hand-edited, or mismatched
contracts. The deck `<body>` must carry the exact contract ID and direction attributes, every
foreground/background semantic color pair must stay together, and every slide must declare
`data-composition-family`.

Before the first Full Validation render, settle facts, numbers, proper nouns, citations, and order; polish Korean slide copy and notes once; review for semantic drift; and run `freeze_authoring_state.py`. Initial Full prepare and every text change validate this hash-bound state. CSS, navigation, and image-only changes do not invalidate the copy hash.

## Turnaround Envelope

Full Validation controls review depth, not research breadth, art direction, or media variety. For a 20–25-slide deck, target 45 minutes from the first Full `prepare` to validated delivery. `validation_contract.json` enforces a durable 3,600-second budget across prepare, verify, repair, final preparation, and final verification. It is not a per-command timeout, and an ordinary failure, rerender, shared-style change, or metadata edit does not reset it.

A completely rejected theme is a different validation cycle. When the generated `design-contract.json` contains a genuinely different `selected` visual grammar and the classifier reports full impact, `--restart-validation-session theme-invalidated` starts a fresh 3,600-second cycle and retains the invalidated cycle in session history. A changed contract ID, selection reason, avoid list, slide copy, or CSS alone is insufficient.

At 45 minutes, freeze optional improvements and reserve the remaining time for current blockers and final evidence. At 60 minutes, stop ordinary work and report `validation incomplete`. Finalization, scoring, approval, publication, and deployment remain blocked. The only post-deadline exception is slide 1: `prepare --mode full --slides 1 --cover-rescue` may render a changed cover, and `--phase cover-verify` may verify its current hash-bound AI evidence. This closeout never marks the overall session complete.

## Validation Workspace

Review evidence and temporary authoring files are internal working data, not presentation deliverables. By default, the renderer stores the latest evidence for each deck at:

```text
<agent-home>/build-html-slides/workspaces/<deck-id>/review/
```

Use `--init-workspace` before the deck exists and `--workspace-dir` afterward. Store the durable research brief in `drafts/`; generated final overview sheets live under `review/final-overview/`. Do not create them beside the final HTML. Codex defaults to `~/.codex`; Claude Code defaults to `~/.claude`; Gemini CLI defaults to `~/.gemini`. `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `CLAUDE_HOME`, `GEMINI_HOME`, or `BUILD_HTML_SLIDES_AGENT_HOME` relocates the matching agent home; `BUILD_HTML_SLIDES_WORKSPACE_ROOT` overrides the workspace root directly.

The deck ID combines a readable filename with a hash of the absolute deck path, so decks with the same name do not collide. A full render replaces that deck's prior review directory; incremental renders reuse it. An explicit positional `REVIEW_DIR` remains supported for integrations.

After evidence is no longer needed, remove the default workspace with `node scripts/render_slides.js --clean-workspace OUTPUT.html`. Do not remove it before validation or while incremental revisions are expected.

## Canonical Profiles

Full Validation captures every slide at:

- `normal`: 1920×1080 viewport and screenshot, zoom 1;
- `short`: 1366×650 viewport and screenshot, zoom 1;
- `zoom150`: 1920×1080 layout viewport with Chromium page scale 1.5, a measured 1280×720 `visualViewport`, and a 1920×1080 screenshot. This is a browser zoom stress test, not a DPR-only capture.

Add `tablet` 1024×768 and `mobile` 390×844 only when responsive device support is requested. Additional exploratory sizes supplement rather than replace canonical evidence.

## Optional Reader Study Guide

The study guide is not a required deck deliverable. Create it only when the user opts in. Its Markdown source, readable HTML, and PDF are siblings of the deck; local per-slide captures may live in a sibling guide-assets directory. Each slide capture appears immediately above its explanation. The prose must remain understandable without seeing or hearing the presentation and must explain both the visible claim and the necessary background, intermediate reasoning, mechanism, operating conditions, practical use, tradeoffs, and failure modes omitted from the slide. Ground added details in the locked brief or authoritative sources. Lead with the answer, define unfamiliar terms at first use, explain one causal step at a time, and prefer a concrete example over another layer of abstraction. Do not pad the guide with long introductions, repeated conclusions, inflated significance, or jargon chains. Add a front primer, prerequisites, or terminology only when useful. Omit presenter cues and full read-aloud scripts.

Every requested Korean guide must pass through the installed `humanize-korean` companion after its facts and substantive explanations are settled. Process coherent chunks of at most 5,000 characters when necessary, preserve the generated `HUMANIZE-SUMMARY` evidence in the final Markdown, and review the reassembled guide for factual or ordering drift. A missing companion blocks Korean-guide finalization; manual polishing is not a substitute for this required pass.

Full Validation validates the Markdown guide only when it exists or an explicit `--guide` path is supplied. Guide HTML/PDF generation remains an output-production step rather than validation evidence.

## Quick Draft

Quick Draft is creation-only. Build the final HTML, sibling presenter notes, `sources.json`, locally referenced assets, and the study guide only when requested, then deliver them without entering the validation pipeline. A requested guide is a standalone subject explanation: it supplies the background, intermediate reasoning, component responsibilities, mechanisms, step-by-step flow, practical use, assumptions, and limits that the slide leaves out. It must remain direct and easy to follow rather than verbose or circular. Presenter cues, full read-aloud scripts, or visual-reading directions do not satisfy this deliverable. A Korean guide still requires `humanize-korean` and its summary evidence before delivery.

Do not run `check_environment.py`, install Playwright or Chromium solely for validation, invoke `validate_all.py`, create a review workspace, execute deterministic gates, request AI visual inspection, calculate the 24-point score, or run independent cross-review. When the guide was requested, `render_slide_guide.js` may open Chromium only to capture each slide for the guide and print the guide PDF. Those production captures are not deck-validation screenshots and provide no clipping, crop, interaction, identity, placeholder, font, or visual-quality assurance. Report explicitly that the deck was not rendered or validated and disclose any guide-only Chromium use. A later request may upgrade the same deck to Full Validation.

## Full Validation

The initial Full preparation runs the complete deterministic suite and Chromium geometry checks. The placeholder gate therefore runs once for every new or edited source before AI review and blocks `PLACE NOTE`, image-here instructions, dummy asset markers, CSS-generated placeholder copy, and other explicit unfinished media. Later edits run only gates that the typed change can affect. AI inspects `normal` for every refreshed slide and records `completion` for all/image scope. Any visible placeholder, empty media promise, or generic substitute for an expected real subject image blocks delivery regardless of the final quality score. The cover and closing are always visual-critical, and cover, closing, explicit critical slides, and warning-triggered profiles receive their adaptive stress profiles. When responsive support was requested, tablet/mobile captures remain automated evidence for ordinary slides and become AI-required only for critical or warning-routed slides.

Parallel-safe deterministic checks run concurrently with four workers by default and a hard maximum of eight. They always finish as a group rather than stopping at the first nonzero exit. If any fail, `validate_all.py` writes every captured failure to `<workspace>/validation-failures.json`, including stdout, stderr, duration, command, and a suggested `repair_lane`, then blocks common preflight and Chromium rendering. Browser render/geometry and common preflight remain sequential because they consume the settled output of the deterministic suite.

Read the complete failure report before editing. Parallel repair is allowed only across disjoint file ownership: `notes` owns the presenter-notes file; `guide` owns the detailed slide-guide file; `media-provenance` owns raster assets and `sources.json`; `copy-state` owns the authoring brief or copy-freeze metadata. The main agent retains sole ownership of shared HTML/CSS/runtime and integrates all lanes. Never assign two writers to the same file, and never parallelize a downstream repair that depends on an unsettled shared-style or runtime change.

The deterministic layer-alignment gate runs for all/image scope. It compares explicit `data-frame-id` and `data-frame-for` pairs and detects substantially overlapping mirrored classes across direct media/content layers. Edge divergence blocks AI review. Only the exact elements carrying one of the supported `data-overlap-intent` values may opt out.

The `text_bounds` geometry gate also protects annotation, caveat, source, footnote, and footer rails. Conventional rail classes are detected automatically; custom rails use `data-protected-region`. Painted cards, panels, tiles, boxes, bands, and transformed structural layers may not cross a protected region. `data-protected-overlap-ok` is reserved for a deliberate underlay, produces a warning, and never substitutes for reserving layout space.

The same gate resolves each text element's nearest painted parent instead of treating the slide
viewport as sufficient containment. A label, code string, badge, or paragraph that leaves its
card, panel, cell, or other painted parent blocks review even when CSS overflow is visible and the
glyphs remain inside the slide.

The container-density gate blocks severe oversized empty surfaces and repeated component walls.
It also records dashboard-like density per slide. Three or more unmarked dashboard-like slides, or
more than 20 percent of the deck, fail as a deck-wide component pattern. Only a slide that
literally presents a dashboard as evidence may use `data-dashboard-intent="evidence"`.

Slide 1 also receives six mandatory cover-specific AI checks for focal hierarchy, subject clarity, art direction, distinctiveness, title readability, and surface integrity.

Automation warnings are typed, stable, and review-bound. Every warning has a `warning_id`, code, profile, and `requires_ai_review: true`. The slide record must list each ID in `required_warning_ids` and resolve it exactly once in `warning_reviews` with the inspected profile, pass verdict, and a concrete pixel observation. A gradient, image-backed text field, or hard split background uses `surface-contrast-boundary`; the reviewer must trace the color boundary and state whether it crosses any glyph, label, or meaningful shape. Every cover warning sets `blocks_cover_approval: true`.

Standard is the fixed default. High risk is allowed only when the user explicitly identifies one of these intents:

- legal or regulatory review: `--high-risk-reason legal`;
- public release or publication: `--high-risk-reason public-release`;
- a consequential decision: `--high-risk-reason consequential-decision`.

Technical complexity, visual complexity, image count, uncertainty, or audience sensitivity alone never upgrades risk.

- `standard`: two primary visual reviewers;
- `high`: three primary visual reviewers.

Pass high risk with both `--review-risk high` and its required reason. Assign contiguous slide ranges. Vision batches contain at most four slides, independent of reviewer range size.

After fixes settle, run `--phase finalize-prepare`. It does not rerender slides. It generates one or more hash-bound 1920×1080 contact sheets with at most 16 normal captures each, one quality-score record, and bounded `cross_review_batches`. One independent final editor uses the contact sheets for rhythm, repetition, density, media balance, consistency, locked-design adherence, and repeated component grammar, then opens only the generated full-size targets for checks that thumbnails cannot prove. Contact sheets never replace primary full-size inspection for Korean wrapping, text sharpness, identity, crop, or navigation geometry. Standard final cross-review is capped at five slides; high is capped at six. Cover and closing receive first priority, followed by explicit critical/warning slides and deterministic distributed samples. Every final editor remains outside the primary-reviewer set.

## Commands

Full Validation preparation:

```bash
python3 scripts/validate_all.py OUTPUT.html --mode full --review-risk standard --phase prepare
```

Before this command, `validate_common_preflight.py OUTPUT.html` must have passed for two or three marked representative slides, and the authoring state must be frozen. After filling the listed AI batches, run `--phase verify`, then `--phase finalize-prepare`, inspect the generated contact sheets, fill the overview, quality score, and generated cross-review batches, and run `--phase finalize-verify`.

## Incremental Revision

After the initial render, rerun `prepare`; the classifier automatically discovers changed slides even when `--slides` is omitted. `--slides` remains an optional explicit narrowing hint:

```bash
python3 scripts/validate_all.py OUTPUT.html --phase prepare \
  --mode full --review-risk standard \
  --slides N --change-type text|image|navigation|all
```

`--change-type` is a performance hint, not trusted proof. Before choosing validators, `validate_all.py` compares typed per-slide text, media, structure, slide-local style, shared-style, runtime, linked-source, and local-asset fingerprints. It uses the actual detected type even when the hint was broader or wrong.

- **Direct impact:** pure copy, image, title, or slide-local CSS changes refresh the requested and actually changed slides only. A CSS rule that matches a finite subset of slides refreshes that subset.
- **Neighbor impact:** structure, order, transition, or adjacency-sensitive changes refresh affected slides plus immediate neighbors.
- **Full impact:** shared CSS that affects the whole deck, dynamic active-state selectors, runtime/navigation code, profile set, mode, review risk, slide-count changes, or unsafe deck-wide dependencies require a fresh common preflight and then refresh every slide once.

Linked CSS is read through Chromium CSSOM and attributed to matching slides when possible. CSS background assets and inline-style assets inherit the same scope. Authors may also declare isolated rules with `<style data-slide-scope="N">`. The classifier cache is reused by the renderer only while the deck and every tracked local file retain the same size, mtime, and ctime.

Run checks by change type:

| Change | Automated and AI scope |
| --- | --- |
| Text | aesthetic quality, readability, layout integrity, surface integrity, text, text bounds, density, and component repetition |
| Image | aesthetic quality, layout integrity, diagram semantics, crop, aspect ratio, resolution, content match, and completion |
| Navigation | controls and interaction |
| Mixed/global | all checks |

Do not recalculate the quality score during the fix loop. Full Validation scores only after the settled final render. A failed automated check blocks AI review. For deterministic failures, repair every independent lane from the aggregate report and rerun `prepare` once after integration; do not rerun after each individual message. After a render or AI-review failure, rerun only the failed/changed slide scope and relevant geometry family. A failed primary or cross-review verdict requires a new capture and inspection for the implicated slide, but does not invalidate unrelated current captures or valid independent cross-reviews.

Any reviewer FAIL is monotonic for that render: do not rewrite it to PASS. Fix the deck, rerun `prepare`, inspect the new capture hashes, and record a new verdict. A shared CSS, runtime, or layout-family edit invalidates every affected slide review; do not preserve or reconstruct old observations. Review JSON is evidence output, not a checklist to complete programmatically.

If the classifier finds no source change, it refuses an unchanged-source rerender. The common preflight captures each representative source/profile twice in separate fresh contexts; different hashes are a nondeterministic renderer failure and block delivery without a third retry.

## Evidence Meaning

The manifest proves that captures came from the current HTML/local assets, match canonical profiles, passed deterministic geometry, and are bound to review records. Reviewer labels and observations remain agent-provided records; do not describe them as cryptographic proof that a particular model or person opened the files.

## Delivery Language

- Edit Only: state that no new render or validation was performed.
- Quick Draft: state that no browser render, automated validation, AI visual review, or quality score was performed.
- Full Validation: report review risk, reviewer count, AI coverage, final score, and any limitation.

Never report stale captures as current evidence or imply a broader validation scope than was performed.
