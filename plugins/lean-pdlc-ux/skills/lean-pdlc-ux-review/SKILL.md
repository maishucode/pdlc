---
name: lean-pdlc-ux-review
description: Reviews a UX artifact or implementation against supplied requirements and evidence.
---

# UX review

Use this skill to review an existing UX artifact or implementation. If the requirement or evidence is unavailable, state that the conclusion is unknown instead of guessing.

## Required output

For every finding, include:

- **Severity:** The user impact and urgency.
- **Evidence:** The observed behavior, artifact location, or reproducible condition.
- **Recommendation:** The smallest change that addresses the finding.
- **Linked requirement or acceptance criterion:** The requirement or acceptance criterion that the finding traces to.

## Constraints

- Every conclusion must be grounded in available evidence.
- Separate confirmed defects from unverified risks.
- Prefer a short prioritized list over a broad redesign proposal.
