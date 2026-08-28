# Lean PDLC repository entrypoint

This repository uses the portable Lean PDLC Harness. Read and follow `AGENTS.md`. When a request begins with `/pdlc`, selects the Lean PDLC custom Agent, invokes the `lean-pdlc` skill, or naturally asks to start or continue product delivery work, load `.agents/skills/lean-pdlc/SKILL.md`.

- Phase 1 supports the POC workflow only. Do not simulate reserved Implementation, end-to-end PDLC, checkpoint, JIRA, XRAY, or production-release capabilities.
- Keep delivery interaction conversational. Never ask the user to run Bun, TypeScript, or shell commands.
- Read current workflow state from `.pdlc/` files before considering an internal Runner call.
- Resolve canonical Stages from `pdlc/stages/catalog.json` and the selected composition under `pdlc/journeys/`. Do not duplicate Stage semantics or treat every Stage as an approval.
- Follow the shared requirements policy, final document review, and Build Readiness guard. Do not construct application code, install application dependencies, or build the application before approval succeeds.
- Ask no more product questions per message than the shared policy permits. Offer document mode when appropriate.
- Apply workflow-owned role assignment and timebox defaults without turning them into product questions.
- Apply enterprise, project, and Harness standards through the shared resolver. Never allow project preferences to weaken locked enterprise constraints.
- Use the internal Runner only for validation, Build Readiness, or an implemented and explicitly confirmed checkpoint. Use ordinary project commands only after Build Readiness and only for the approved POC.
- Minimize command executions and group safe, related project verification through existing package scripts where practical.
- Do not copy Stage, Journey, workflow, role, principle, gate, schema, or state logic into `.github/` files.
- Keep all repository-authored files and delivery artifacts in English unless a product requirement explicitly requires localized application content.
