# Lean PDLC repository guidance

- Use the `lean-pdlc` skill for POC, implementation, or end-to-end product delivery work.
- Treat a user message beginning with `/pdlc` as a conversational activation request when the client delivers it as text. Parse `/pdlc <delivery-flow> [context]` and load the shared `lean-pdlc` skill.
- Never ask an end user to run Bun or the TypeScript Runner. The agent owns internal Runner calls and requests confirmation only at controlled checkpoints.
- Treat `.pdlc/stages/`, `.pdlc/delivery-flows/`, `.pdlc/disciplines/`, `.pdlc/integrations/`, `.pdlc/roles/`, and `.pdlc/schemas/` as the shared source of truth. Treat `pdlc/disciplines/<discipline>/` as the project-specific Discipline overlay; keep project Knowledge under its owning Discipline and resolve it by declared applicability.
- Resolve the selected Delivery Flow from canonical Stage references and delivery-context tags. Never redefine Stage requirements inside a Delivery Flow or platform adapter, and never treat every Stage as a human checkpoint.
- Change controlled Delivery Flow state only through `bun .pdlc/cli.ts`.
- Let the Runner persist each controlled Record mutation and its Audit Event as one coordinated operation. Never write either surface independently to imitate Build Readiness, Context Application, Verify, or Decide.
- Create a new POC only through the Runner's controlled initialization operation so the DRAFT Record, current pointer, and `DELIVERY_FLOW_CREATED` audit event are established together. Never write those three initialization surfaces independently.
- Do not bypass checkpoints, required evidence, applicable Controls, or approved Control exceptions.
- Before Verify, require the Runner to confirm that the Requirements document still matches its approved content hash and that every local evidence reference resolves to a readable regular file inside the project workspace. URL and CI evidence must be valid HTTP or HTTPS references; the Runner does not perform network availability checks.
- Do not create application code, install application dependencies, or run an application build before the approved Requirements document passes the internal Build Readiness check.
- Follow the Product-owned requirements policy, resolve all required clarification topics and contradictions, and present the complete Requirements document for explicit review before treating any response as Build approval.
- Before every Stage, resolve mandatory Discipline Policies as Controls, Project Baselines and Defaults, relevant Knowledge, Discipline Skills/Agents through Hooks, and applicable Integrations. Auto-apply resolved context instead of asking users to reconfirm it. Keep product requirements confirmation intact, disclose applied context in the final Requirements, and never allow a Project Overlay to weaken enterprise Policies.
- Respect the policy's conversational question limit. When enabled and selected by the user, generate the shared Requirements questionnaire, wait for `[Answer]:` fields to be completed, then re-read and reconcile it into the Requirements Draft.
- Treat role assignment and timebox as Delivery Flow-owned controls. When the selected Delivery Flow disables delivery-control collection during requirements, apply its defaults and do not ask the user to choose them.
- Keep platform-specific files thin; never duplicate Delivery Flow or governance logic under `.codex/` or `.github/`.
- A person may fill multiple role slots unless a risk or governance rule requires separation of duties.
- POC work must not deploy to production or integrate with JIRA/XRAY.
