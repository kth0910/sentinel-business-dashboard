# Common CSS, Font, and Navigation Preflight

Shared CSS, embedded fonts, stage scaling, and persistent navigation legitimately affect every slide. Existing captures cannot remain valid after those shared inputs change. The performance fix is to validate and freeze the common system on two or three representative slides before the first full-deck render.

Mark:

- the cover with `data-common-preflight="cover"`;
- the densest Korean/body-copy slide with `data-common-preflight="dense"`;
- optionally the closing slide with `data-common-preflight="closing"`.

Run:

```bash
python3 scripts/validate_common_preflight.py OUTPUT.html
```

The preflight renders only those marked slides across `normal`, `short`, and `zoom150`, twice in separate fresh browser contexts. It checks font integrity, text bounds, and controls through the normal automation gate. Identical source/profile captures must produce identical PNG hashes. A mismatch is a nondeterministic renderer failure; do not retry a third time or select whichever capture looks better.

The report binds shared style/runtime/font dependencies, the marked slide sources, Chromium evidence, and both capture hashes. The first Full Validation render and every later shared CSS/runtime change require a current report. This avoids discovering a Korean font or navigation defect after rendering the whole deck.

After the common system passes, keep shared rules frozen. Put genuinely slide-local CSS in a selector that matches only that slide or in `<style data-slide-scope="N">`. Copy, image, and slide-local style repairs then reuse unaffected captures. A real shared CSS or navigation change still requires one new common preflight followed by one full render; stale captures are never reused.
