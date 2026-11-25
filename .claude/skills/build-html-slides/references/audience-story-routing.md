# Audience-Aware Story Routing

Read this before storyboarding whenever the speaker names an audience or the audience can be inferred from the request. Audience affects slide order, evidence timing, terminology, and presenter notes, not only tone.

## Build the audience model

Create a compact internal table before ordering slides:

| Audience | Why they are here | Decision or action | Existing knowledge | Detail tolerance | Likely objection |
|---|---|---|---|---|---|

Identify the decision owner, implementation owner, operational user, and any audience that can block the proposal. One person may hold several roles. Do not ask another question when the user already supplied enough context; infer reasonable jobs and record uncertainty in notes.

## Choose the attention order

Sequence information by the room's shared decision path:

1. Establish the subject and the outcome this room cares about.
2. Give the least technical shared context needed to understand the stakes.
3. Show the contrast, evidence, experience, or mechanism that makes the recommendation credible.
4. State the decision, recommendation, or next action before specialist attention becomes fragmented.
5. Place implementation detail, architecture, edge cases, and source-heavy proof after the common decision spine unless those details are themselves the decision.
6. Close by resolving the opening promise for every named audience, not only the most technical group.

This is a reasoning framework, not a fixed `AS-IS → TO-BE` template. Use the information order that best earns attention and supports the requested outcome.

## Choose the headline register

- Technical shares, engineering seminars, workshops, runbooks, and training default to direct technical titles: a concrete question, topic/action label, or result/boundary statement.
- Direct technical does not mean full sentence. Use compact noun phrases and comparison labels for configuration, architecture, reference, and comparison slides; reserve `-다` endings for real claims or boundaries, never three titles in a row and never more than 40% of the deck.
- Executive and approval decks may lead with the decision, implication, risk, or recommended action.
- Brand, culture, entertainment, keynote, and explicitly emotional narratives may use evocative titles when atmosphere is part of the requested outcome.
- Short is acceptable when the object remains identifiable. `곡선은 왜 늘어났나` and `파라미터를 왜 의심하나` are concrete technical questions; an unnamed “앞문”, “증언”, “엔진”, or “나침반” standing in for the actual system is not.

## Mixed-audience routing

For executives, business teams, and developers in the same room, normally lead with common stakes and decision contrast, then move from business effect to delivery confidence and finally technical depth. For example, an `AS-IS / TO-BE` contrast may move early because it gives every group a shared mental model, while architecture, protocol, API, deployment, and edge-case slides move into a later technical chapter.

Change that order when the room's actual decision demands it:

- Architecture review: constraints, system context, tradeoffs, and failure modes may need to come before the recommendation.
- Budget or executive approval: impact, alternatives, risk, cost, and the ask should appear before implementation mechanics.
- Client or sales presentation: pain, desired outcome, product experience, proof, and adoption confidence usually precede internal architecture.
- Training or onboarding: mental model, demonstration, guided practice, and exceptions usually work better than a proposal arc.
- Incident review: impact, timeline, root cause, containment, corrective action, and prevention form the decision path.

## Storyboard contract

For every slide, add these internal fields to the slide-role table:

- `primary_audience`: who most needs this slide;
- `secondary_audience`: who must remain oriented;
- `audience_question`: the question answered now;
- `decision_job`: how this slide advances understanding, confidence, or action;
- `detail_level`: common, decision, operational, or specialist;
- `why_now`: why this information belongs at this point rather than earlier or later.
- `incoming_question`: the question earned by the previous slide;
- `answer`: the conclusion this slide establishes;
- `evidence_ids`: the locked research-ledger entries that support the answer;
- `so_what`: why this answer matters to the room;
- `next_question`: the question that makes the following slide necessary.

No audience should sit through a long specialist section before understanding why it matters. Conversely, do not remove technical evidence merely to simplify the deck; defer it to the point where it answers an earned question.

## Presenter notes

Use notes to bridge audience layers. Signal when a technical section begins, explain why it matters to non-specialists, and tell the room when implementation detail is being deferred. Do not say that a section is optional when it contains evidence required for the decision.

## Review questions

- Can each named audience explain the problem and proposed outcome before the first specialist deep dive?
- Does the decision owner see the ask early enough to evaluate the remaining evidence?
- Are implementation owners given enough detail to trust feasibility?
- Does every specialist slide answer a question established earlier?
- Would moving any slide earlier or later reduce confusion or attention loss?
- Does the closing give each audience a clear implication or next action?

Run these questions inside the exactly one pre-authoring editorial review. Apply one consolidated revision and do not rerun the story review during render or visual QA.
