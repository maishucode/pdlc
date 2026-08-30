# Discipline context resolution

Before each Stage, resolve context from `.pdlc/disciplines/` and `pdlc/disciplines/` using the Delivery Flow, Stage, risk, technology, and discipline tags.

Treat the returned channels independently:

- Controls are mandatory and require satisfaction or an approved exception.
- Project Baselines are approved facts; do not ask the user to decide them again.
- Defaults are automatic but may be replaced by a higher-precedence source unless locked by a Control.
- Guidance, References, and KB are advisory context. Project Knowledge is structured metadata plus content under its owning `pdlc/disciplines/<discipline>/knowledge/` and is returned only when its `appliesTo` matches.
- Discipline Hooks bind required Capabilities, Agent role profiles, and candidate Skills to Stages. Top-level Integrations may contribute their own Skills and always declare explicit permissions and ownership.

The Runner compiles all required Discipline Capabilities for one Stage into one `requiredStageInvocation`. Invoke exactly one generic subagent for that contract. The worker handles every listed Capability, reads its role profile, selects at least one Skill from its own `candidateSkills`, reads the selected Skill files, and returns one contribution per Capability. Candidate Skills are not fixed Stage instructions; `selectedSkills` records the worker's actual choice.

The execution unit is the Stage invocation; the acceptance unit is the Capability contribution. A Stage Context Receipt therefore contains at most one `stageInvocation` and exactly one `disciplineContributions` entry for every required Capability. The Runner rejects missing Capabilities, selections outside the candidate set, mismatched invocation identity or permissions, missing evidence, and stale context. Reuse a valid receipt while its context hash remains unchanged.

Default precedence is locked Policy/Control, then Project Default, then Discipline Default. Project Policies are cumulative and cannot replace enterprise Policies.

Record provenance in the Requirements Artifact and Delivery Record. Do not count system-resolved context as an answered product clarification question.
