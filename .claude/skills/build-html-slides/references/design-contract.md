# Locked Design Contract

Use this contract for every new deck and every redesign that changes the visual system.

## Lock The Selector Result

`../scripts/theme_registry.json` is the canonical named-theme inventory. Its ordered theme names
must exactly match the numbered headings in `theme-gallery.md`.

After workspace initialization, classify the brief on all six semantic axes and write the selector
result directly into the workspace:

```bash
WORKSPACE="$(node scripts/render_slides.js --workspace-dir OUTPUT.html)"
python3 scripts/select_visual_direction.py \
  --title "Exact deck title" \
  --audience "Primary audience" \
  --job "explain" \
  --evidence "diagram" \
  --density "analytical-dense" \
  --emotional-register "institutional" \
  --surface-family "technical-canvas" \
  --focal-anchor "system" \
  --output "$WORKSPACE/drafts/design-contract.json"
```

The required selector inputs are `--job`, `--evidence`, `--density`,
`--emotional-register`, `--surface-family`, and `--focal-anchor`. The selector evaluates those
structured values against registry metadata. Bounded subject phrases may strengthen a match, but
do not route from unbounded raw keywords, substrings, or a topic noun alone.

The primary result is the default. To lock one of the two returned alternatives, pass its exact
theme name and a concrete conflict with the primary:

```bash
python3 scripts/select_visual_direction.py \
  --title "Exact deck title" \
  --audience "Primary audience" \
  --job "explain" \
  --evidence "diagram" \
  --density "analytical-dense" \
  --emotional-register "institutional" \
  --surface-family "technical-canvas" \
  --focal-anchor "system" \
  --select-theme "Blueprint Workshop" \
  --selection-reason "The main evidence is an implementation drawing with measured interfaces." \
  --output "$WORKSPACE/drafts/design-contract.json"
```

Do not hand-write the contract, rename the selected direction, or edit its JSON after generation.
Rerun the selector when the audience, any semantic axis, recent-deck avoid list, or chosen candidate
changes.

## Bind The Deck

Copy the exact `required_html_attributes` from the locked contract onto `<body>` and add
`data-design-contract-id` with the contract ID. Preserve the selected theme, cover family, surface,
title anchor, hero form, type direction, palette direction, and generated semantic color tokens
together.

Semantic color tokens are generated as paired foreground/background roles, such as a surface with
its on-surface text or a status background with its on-status text. Apply both members of the
selected pair together. Foreground-only and background-only overrides are prohibited at deck,
slide, and component scope because either override breaks the selector's generated contrast
relationship.

Do not:

- keep one theme's grid while importing another theme's palette and component language;
- invent a post-selection label such as `Incident Dossier` to justify an unselected hybrid;
- convert a system-explanation deck into a repeated dashboard of cards, chips, and status badges;
- claim that an accent-color swap is a new visual direction.

The contract is a starting constraint, not a demand to repeat one layout. Use its grammar across
several composition families.

## Declare Composition Rhythm

Add `data-composition-family="<lowercase-hyphen-case>"` to every slide. Use names such as:

- `cover`, `statement`, `editorial-split`, `full-bleed`;
- `metric-proof`, `comparison`, `diagram`, `timeline`;
- `annotated-screenshot`, `gallery`, `chapter-reset`, `decision`;
- `card-grid` only when the information genuinely requires a catalog or repeated comparison.

Never repeat the same family on three consecutive slides. Generic card-grid, component-wall, or
dashboard families may occupy at most two slides per ten. A slide that literally presents a real
dashboard as evidence may use `data-dashboard-intent="evidence"`; this exemption belongs on that
slide only and does not permit dashboard styling across the deck.

## Validation

Full Validation requires:

```bash
python3 scripts/validate_design_contract.py \
  OUTPUT.html \
  "$WORKSPACE/drafts/design-contract.json"
```

The main validation entrypoint runs this gate automatically. It blocks a missing or edited
contract, mismatched body attributes, silent theme substitution, missing composition-family
declarations, excessive generic grids, and three-slide layout repetition before Chromium review.

Rendered review still owns what metadata cannot prove: whether the pixels actually follow the
selected grammar, whether another theme's palette or component language leaked in, and whether
cards, badges, panels, or dashboard density dominate the visual rhythm. The rendered contrast gate
blocks ordinary text and controls below 4.5:1 and large display text below 3:1; source-token values
alone are not proof.
