---
name: atlas-pdlc-ux-spec
description: Creates a compact, implementation-ready UX specification for a defined user outcome.
---

# UX specification

Use this skill to turn a requested UX change into a small, testable artifact. Ask for missing product context instead of inventing it.

## Required output

- User, outcome, trigger, and success signal.
- Main flow with the user action, system response, and completion condition.
- Explicit assumptions, open questions, and acceptance criteria.
- A textual mockup or prototype proposal when the current Stage is `ux-design`.
- A concise handoff that an implementation owner can verify.

## Requirement clarification questions

At `requirements-clarification`, every unresolved UX question must offer 2–4 mutually exclusive, selectable options, plus `X) Other`. The user can answer with an option letter and add detail for `X) Other`; do not ask an open-ended question as the primary answer.

## State coverage

- **normal:** The primary successful state and its next action.
- **loading:** What remains visible, what is pending, and when it resolves.
- **empty:** Why no content is present and the useful recovery action.
- **error:** The user-facing failure explanation and retry or escalation path.
- **validation:** Invalid input, guidance, and the condition for proceeding.
- **destructive:** The irreversible consequence, confirmation, and cancellation path.
- **responsive:** Behavior and priority changes across supported viewport sizes.
- **accessibility:** Keyboard, focus, semantics, contrast, and announcement needs.

## Constraints

- Keep the artifact scoped to the requested outcome; do not propose a new product strategy.
- Distinguish confirmed requirements from assumptions.
- Make each acceptance criterion observable without relying on this agent.
