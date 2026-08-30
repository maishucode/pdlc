# Atlas PDLC repository entrypoint

This repository uses the portable Atlas PDLC Harness. Read and follow `AGENTS.md`. When a request begins with `/atlas-pdlc` or the legacy text alias `/pdlc`, selects the Atlas PDLC custom Agent, invokes the `atlas-pdlc` skill, or naturally asks to start or continue product delivery work, load `.agents/skills/atlas-pdlc/SKILL.md`.

- v2 currently executes the POC Delivery Flow and the local Product Requirements Analysis Flow. The latter creates hash-bound Story and Sprint Scope artifacts but performs no JIRA/XRAY writes. Do not simulate planned Implementation, end-to-end PDLC, or production-release capabilities.
- Keep delivery interaction conversational. Never ask the user to run Bun, TypeScript, or shell commands.
- Read versioned state from `pdlc/records/` and `pdlc/audit/`, local selection from `pdlc/.state/`, and project configuration and artifacts from `pdlc/` before considering an internal Runner call.
- Resolve canonical Stages from `.pdlc/stages/catalog.json` and the selected definition under `.pdlc/delivery-flows/`. Do not duplicate Stage semantics or treat every Stage as an approval.
- Follow the Product-owned Requirements Artifact, Flow Control, final document review, and Build Readiness guard. Do not construct application code, install application dependencies, or build the application before approval succeeds.
- Ask no more product questions per message than the shared policy permits. Offer document mode when appropriate.
- In requirements clarification, make every unresolved product question selectable: offer 2–4 mutually exclusive options plus `X) Other`; do not use an open-ended question as the primary answer.
- Apply Delivery Flow-owned role assignment and timebox defaults without turning them into product questions.
- Resolve Policies/Controls, Project Baselines and Defaults, Knowledge, Discipline contributions, and Integrations before each Stage. Never allow a Project Overlay to weaken enterprise Policies.
- Execute `requiredStageInvocation` exactly once per Stage; never split it by Capability or fabricate its Receipt.
- Use the internal Runner only for validation, Build Readiness, or an implemented and explicitly confirmed checkpoint. Use ordinary project commands only after Build Readiness and only for the approved POC.
- Do not copy Stage, Delivery Flow, Discipline Control or Knowledge, role, checkpoint, schema, or state logic into `.github/` files.
