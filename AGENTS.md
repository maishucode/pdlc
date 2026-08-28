# Lean PDLC repository guidance

- Use the `lean-pdlc` skill for POC, implementation, or end-to-end product delivery work.
- Treat a user message beginning with `/pdlc` as a conversational activation request when the client delivers it as text. Parse `/pdlc <workflow> [context]` and load the shared `lean-pdlc` skill.
- Never ask an end user to run Bun or the TypeScript Runner. The agent owns internal Runner calls and requests confirmation only at controlled checkpoints.
- Treat `pdlc/stages/`, `pdlc/journeys/`, `pdlc/workflows/`, `pdlc/roles/`, `pdlc/principles/`, `pdlc/defaults/`, and `pdlc/schemas/` as the shared source of truth. Treat `.pdlc/project/standards/` as the project-specific standards layer.
- Resolve a User Journey from canonical Stage references and delivery-context tags. Never redefine Stage requirements inside a Journey or platform adapter, and never treat every Stage as a human checkpoint.
- Change controlled workflow state only through `bun pdlc/cli.ts`.
- Do not bypass checkpoints, required evidence, risk controls, or applicable principle packs.
- Do not create application code, install application dependencies, or run an application build before the approved Requirements document passes the internal Build Readiness check.
- Follow the Product-owned requirements policy, resolve all required clarification topics and contradictions, and present the complete Requirements document for explicit review before treating any response as Build approval.
- Auto-apply resolved enterprise, project, and Harness standards instead of asking users to reconfirm each standard. Keep product requirements confirmation intact, show every applied standard in the final Requirements, and never allow project settings to override locked enterprise constraints.
- Respect the policy's conversational question limit. When enabled and selected by the user, generate the shared Requirements questionnaire, wait for `[Answer]:` fields to be completed, then re-read and reconcile it into the Requirements Draft.
- Treat role assignment and timebox as workflow-owned delivery controls. When the selected workflow disables delivery-control collection during requirements, apply its defaults and do not ask the user to choose them.
- Keep platform-specific files thin; never duplicate workflow or governance logic under `.codex/` or `.github/`.
- A person may fill multiple role slots unless a risk or governance rule requires separation of duties.
- POC work must not deploy to production or integrate with JIRA/XRAY.
