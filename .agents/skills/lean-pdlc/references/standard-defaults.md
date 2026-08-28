# Standard defaults reference

Standard defaults reduce repetitive governance questions without weakening product requirements clarification.

## Source layers

Resolve standards in this order:

1. Locked enterprise constraints declared by applicable Principle Pack principles through `standardDefault.policy: constraint`.
2. Project defaults under `.pdlc/project/standards/*.json`.
3. Overrideable enterprise defaults declared through `standardDefault.policy: default`.
4. Harness defaults under `pdlc/defaults/harness/*.json`.

Locked enterprise constraints always win. A conflicting project or Harness value is a validation failure, not a question to ask an ordinary delivery user. The owning enterprise function must change the Principle Pack or provide a governed exception mechanism.

Project defaults may add standards or replace overrideable defaults. They are project source, should be code-reviewed by the project team, and must not contain platform-specific Codex or Copilot behavior.

## What defaults may decide

Defaults are appropriate for standards such as:

- design tokens and corporate visual language;
- semantic interaction and accessibility baselines;
- security and credential boundaries;
- reversible architecture and engineering conventions;
- supported browser baselines and proportionate test evidence;
- a project team's preferred framework or implementation conventions.

Defaults must not invent or replace product decisions such as:

- target user, business problem, frequency, or hypothesis;
- functional capabilities, entities, business validation, and state transitions;
- product-specific empty, alternate, destructive, or recovery behavior;
- product scope, data retention or integration choices;
- measurable success and failure signals.

When a standard supplies part of `uxInteraction`, `qualityAttributes`, or `dataIntegrations`, still ask for the product-specific behavior needed to make that topic testable.

## Conversation behavior

- Apply matching standards silently while drafting; do not ask the user to confirm each one.
- Tell the user early which major standard families will be applied, in one concise summary.
- Ask only when the user requests an override, two sources conflict, or the standard cannot determine a product-specific decision.
- Preserve every user-confirmed product decision as an `RQ-xxx` entry. Automatic standards are not user answers and do not increase `questionsAnswered`.
- At final review, show every resolved standard in `Applied Standards and Defaults`, including key, source, locked/overrideable policy, applied statement, and disposition.
- For an overrideable change, keep the original source visible, mark the disposition overridden, record the replacement and rationale as a product/design decision, and re-run Build Readiness.

## Project customization

Project teams customize `.pdlc/project/standards/*.json`. Use stable dotted keys. A project profile may:

- add a project convention;
- replace a matching Harness default;
- replace an enterprise entry only when that enterprise entry is an overrideable default.

It may not weaken a locked enterprise constraint. Keep Product requirements and one-off delivery decisions out of project profiles.

Do not silently promote one delivery answer into a project default because that changes future deliveries. When the same stable convention recurs, the Agent may suggest promotion and explain its future effect; write or update the project profile only after the user explicitly agrees that it is a project-level standard. Record the owner and bump the profile version when behavior changes.
