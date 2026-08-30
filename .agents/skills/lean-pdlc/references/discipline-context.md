# Discipline context resolution

Before each Stage, resolve context from `.pdlc/disciplines/` and `pdlc/disciplines/` using the Delivery Flow, Stage, risk, technology, and discipline tags.

Treat the returned channels independently:

- Controls are mandatory and require satisfaction or an approved exception.
- Project Baselines are approved facts; do not ask the user to decide them again.
- Defaults are automatic but may be replaced by a higher-precedence source unless locked by a Control.
- Guidance, References, and KB are advisory context. Project Knowledge is structured metadata plus content under its owning `pdlc/disciplines/<discipline>/knowledge/` and is returned only when its `appliesTo` matches.
- Discipline Hooks bind Discipline Agents and Skills to Stages. Top-level Integrations may contribute their own Skills and always declare explicit permissions and ownership.

Default precedence is locked Policy/Control, then Project Default, then Discipline Default. Project Policies are cumulative and cannot replace enterprise Policies.

Record provenance in the Requirements Artifact and Delivery Record. Do not count system-resolved context as an answered product clarification question.
