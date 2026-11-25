# Research First

Every new deck starts from a durable Markdown brief at:

```text
<workspace>/drafts/research-brief.md
```

Initialize the workspace before research:

```bash
node scripts/render_slides.js --init-workspace OUTPUT.html
```

This creates both `research-brief.md` and `research-storyboard-review.md` without requiring the deck to exist. On resume or after context loss, read the locked brief before opening the deck source.

## Choose research depth semantically

The AI must choose the evidence burden from the actual communication job, audience, decision, uncertainty, and requested explanatory depth. Do not use keyword matching, substring checks, regexes, a topic allowlist, or any other static heuristic to select research depth.

Record one or more applicable depths and the reasoning in `Research depth decision`:

- **Standard explanatory:** the audience needs a reliable orientation, selection, guide, narrative, or overview. Verify material facts and organize them clearly without manufacturing a diagnostic burden.
- **Analytical:** the deck compares performance, trends, rankings, outcomes, anomalies, risks, causes, or decisions. Separate observation from interpretation, explain why each major metric is present, consider competing explanations, and connect evidence to an action or conclusion.
- **Deep technical:** the audience needs to understand how a system, protocol, model, implementation, failure, or tradeoff actually works. Trace mechanisms and boundaries, use version-aware primary documentation or repository evidence, compare alternatives, and cover failure modes and operational consequences.

Analytical and deep technical may both apply. A technically sophisticated subject does not automatically require deep technical treatment when the room only needs a high-level decision; a familiar subject may still require analytical depth when the user asks why outcomes diverged.

## Build the brief as the reasoning source of truth

Complete these parts before HTML authoring:

1. Define audience, decision owner, room outcome, scope, locale, and as-of date.
2. Build a decision question tree from the opening question to the final decision or takeaway.
3. Maintain an evidence and reasoning ledger. For each material claim, keep observation, source, interpretation, why it matters, competing explanations or counterevidence, decision implication, confidence, caveat, and target slide.
4. Build the storyboard as a question chain. Each slide needs an incoming question, answer, evidence IDs, `so what`, next question, visual job, and explicit connection from the previous slide. For every image-worthy slide, fill the visual coverage table with a unique factual asset or search target, reuse status, minimum quality bar, and an image-free fallback. The fallback cannot be a weak drawing, pseudo-map, repeated photo, or generic substitute.
5. Preserve unresolved questions honestly. `없음` is valid only after the evidence ledger actually resolves the requested questions.

`sources.json` remains raster-asset provenance. Never use it as the factual citation ledger.

Time these activities as separate authoring stages. `research` ends when the evidence and reasoning ledger is ready to support a sequence; it must not remain open during storyboarding, image search, HTML work, or validation. Transition to `storyboard` while building the question chain, `editorial-review` for the single AI critique, and `editorial-revision` for the one consolidated correction. This separation makes research duration auditable instead of absorbing every later task.

## Additional analytical evidence burden

For every major metric, state:

- what the denominator and comparison window are;
- what the metric can and cannot establish;
- why the audience needs it;
- what conclusion or decision changes because of it.

Do not promote an orphan metric into the deck merely because it is large, recent, or visually impressive. A total, ranking, percentage, or market size without an interpretation and decision use belongs in the brief or appendix, not the main story.

When the data reveals a salient collapse, spike, reversal, outlier, or unexpected leader, investigate it before storyboarding. Build a bounded timeline and examine plausible causes such as product or content changes, release cadence, pricing or monetization, platform and region mix, external competition, incidents, and measurement artifacts. Record at least two competing explanations when the evidence permits. If public evidence cannot identify the cause, say that the cause is unknown and distinguish the observed change from hypotheses.

Never infer a common success formula from a ranking alone. Support the mechanism with case evidence or label it as a hypothesis.

## Additional deep-technical evidence burden

Trace the subject at the depth the audience must trust:

- system boundary and actors;
- end-to-end control, data, request, or state flow;
- component responsibilities and invariants;
- version, configuration, and environmental assumptions;
- alternatives and explicit tradeoffs;
- failure modes, observability, recovery, and operational consequences;
- primary documentation, code, tests, standards, or reproducible evidence.

Do not replace mechanism with a component catalog. Every deep technical section must answer how the behavior occurs, why the chosen design behaves differently, and where it fails.

## Run exactly one pre-authoring editorial review

After the initial research and storyboard are complete, but before HTML authoring, run exactly one dedicated AI editorial review. When a separate reviewer context is available, use it once with the user request, research brief, source ledger, audience, and storyboard. Otherwise perform one explicit editorial pass in the current agent. This pass is authoring quality control, not render validation.

The reviewer must return all findings together in `research-storyboard-review.md`:

- central-question coverage;
- source and evidence sufficiency for the selected depth;
- observation, interpretation, hypothesis, and causal boundaries;
- relevance and use of every major metric;
- incoming-question → answer → `so what` → next-question continuity;
- a headline-only outline check: every proposed headline uses the register appropriate to the presentation job rather than the author's comparison, confirmation, review, analysis, or sampling activity; technical shares, seminars, workshops, runbooks, and training use direct technical questions, topic/action labels, or result/boundary statements, while an evocative register is reserved for a genuinely emotional, brand, culture, entertainment, narrative, or keynote job;
- conclusion and action payoff;
- unresolved limitations.

Apply one consolidated revision to the research brief and storyboard. Do not enter a reviewer–author loop. Do not request a second editorial pass to approve the repairs. Carry any remaining uncertainty into the brief and presentation.

Lock the reviewed and revised artifacts:

```bash
python3 scripts/lock_research_storyboard.py \
  <workspace>/drafts/research-brief.md \
  <workspace>/drafts/research-storyboard-review.md \
  --reviewer-ref RUN-SPECIFIC-REF
```

The lock records exactly one review pass and one consolidated revision pass. Do not rerun this editorial review during HTML implementation, copy polishing, rendering, visual QA, or finalization. Those later stages may repair presentation expression but must not silently reopen the research thesis. If the user later changes the core scope or decision, treat that as a new authoring cycle rather than repeatedly polishing the old review.

## Freeze copy before the first Full Validation render

Implement the deck and presenter notes from the locked brief. If the user opted into the reader study guide at intake, implement it from the same brief and authoritative sources. Fill in the background, intermediate reasoning, mechanisms, component responsibilities, process flow, practical examples, operating conditions, tradeoffs, and failure modes omitted by the visual canvas. Lead with the answer and explain one causal step at a time; do not hide a simple point inside jargon, long setup, or repeated summary. Settle the substance before polishing. Every Korean guide must then pass through `humanize-korean`, in coherent chunks of at most 5,000 characters when necessary, and retain its `HUMANIZE-SUMMARY` evidence. Review the reassembled guide for factual drift. If the companion is missing, stop Korean-guide finalization and ask for installation consent. Manual polishing remains acceptable only for Korean slide copy and presenter notes when no guide is being produced.

Freeze the exact visible slide copy and notes:

```bash
python3 scripts/freeze_authoring_state.py OUTPUT.html OUTPUT-notes.md \
  <workspace>/drafts/research-brief.md \
  --polish humanize-korean
```

The command requires the one-time editorial lock to remain current and stores a separate copy hash. Image, CSS, and runtime-only repairs do not reopen either lock. Text or note changes require a fresh copy freeze, but not another research/storyboard review.
