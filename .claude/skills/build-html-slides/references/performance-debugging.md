# Performance Debugging

Use the persistent workflow timer when turnaround matters or a prior deck ran longer than expected. It records manual production stages and appends every `validate_all.py` subprocess, including failures and timeouts, to the same workspace report.

## Start The Report

`--init-workspace` prints the workspace path. Retain it in a task-specific shell variable:

```bash
SLIDES_WORKSPACE="$(node scripts/render_slides.js --init-workspace OUTPUT.html)"
python3 scripts/workflow_timer.py --workspace "$SLIDES_WORKSPACE" start research
```

Move to the next stage atomically at the real boundary:

```bash
python3 scripts/workflow_timer.py --workspace "$SLIDES_WORKSPACE" transition storyboard
```

Only one manual stage may be active. `start` rejects overlapping manual stages, and `transition` closes the current stage and opens the next with one timestamp. Stop `implementation` before the first `validate_all.py` command. Never leave a manual authoring timer open across common preflight, render automation, AI review, final review, or deployment; otherwise the report will mislabel validation time as HTML implementation time.

Use these stable top-level stage names:

1. `research`
2. `storyboard`
3. `editorial-review`
4. `editorial-revision`
5. `asset-selection`
6. `asset-production`
7. `implementation`
8. `common-preflight`
9. `render-automation`
10. `ai-review`
11. `final-review`

`research` is source discovery, reading, fact checking, comparison, and synthesis only. `storyboard` starts when the evidence ledger is stable enough to arrange slides. `editorial-review` is the one AI editorial pass; `editorial-revision` is the single integrated correction. `asset-selection` covers candidate search, comparison, and final choice. `asset-production` covers download, generation, cropping, WebP conversion, and provenance. Notion capture, upload, and deployment are external delivery work and are not part of these authoring totals.

Record a blocked or failed stage instead of abandoning the active timer:

```bash
python3 scripts/workflow_timer.py --workspace "$SLIDES_WORKSPACE" stop asset-selection \
  --status blocked --detail "official screenshots unavailable"
```

## Automatic Validation Timings

Every `validate_all.py` phase automatically appends:

- review-workspace resolution;
- source-change classification when used;
- every deterministic validator, including the bounded parallel aggregate suite;
- browser interaction E2E;
- Chromium rendering and geometry checks;
- visual-evidence validation;
- finalization preparation;
- total wall-clock time for the phase.

Add `--debug-timing` or set `BUILD_HTML_SLIDES_DEBUG_TIMING=1` to print millisecond-level timing lines while the command runs. Persistence does not depend on this flag.

## Read The Result

```bash
python3 scripts/workflow_timer.py --workspace "$SLIDES_WORKSPACE" report
python3 scripts/workflow_timer.py --workspace "$SLIDES_WORKSPACE" report --json
```

The durable report is `<workspace>/workflow-timing.json`. The first table shows exclusive manual authoring time in workflow order, including separate rows for pure research, storyboard, AI editorial review, integrated revision, and image selection. The second table shows automatic validation diagnostics. The JSON retains individual steps, timestamps, status, duration in milliseconds, source, and optional detail.

Validation wall-clock spans contain their child command spans, so do not add every row together as exclusive CPU time. Use the wall-clock row for elapsed time and the child rows to locate the bottleneck.

When the aggregate suite fails, inspect `<workspace>/validation-failures.json` for the complete set and its repair-lane grouping. Do not infer serial execution from the order in which captured outputs are printed; results are emitted in stable command order after the parallel workers finish.

## Interpretation

- Repeated `Chromium render and geometry gate` time usually means invalidation scope is too broad or authoring was not frozen before rendering.
- High `common-preflight` time with failures points to shared CSS, local-font, stage-fit, or navigation instability.
- High `ai-review` time is a reviewer-batch or coordination issue, not a renderer issue.
- A timeout or intermittent failure should remain visible in the report. Do not retry unchanged source until the captured cause has been classified.
