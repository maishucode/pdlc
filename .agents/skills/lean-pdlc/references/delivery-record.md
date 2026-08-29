# Delivery Record reference

Use `.pdlc/schemas/poc-delivery-record.schema.json` as the structural contract and `.pdlc/examples/poc-delivery-record.json` as the starting shape.

- Keep `id`, `deliveryFlow`, and checkpoint-controlled state stable.
- Make the problem, hypothesis, expected outcome, and success criteria concrete and testable.
- Store the requirements contract at `pdlc/requirements/<POC-ID>.md`; keep it `draft` until explicit Product approval.
- Track answered-question count, coverage status for every policy topic, open questions, and contradictions under `requirements.clarification`. Keep unknown DRAFT business fields empty instead of inserting fictional values.
- Keep `questionsAnswered` equal to the number of distinct `RQ-xxx` decisions in the Requirements document.
- Let the Runner record requirements depth, approver, approval timestamp, and approved content hash. Material scope or standard changes create a content-hash mismatch and require a new explicit approval before further build activity.
- Treat only explicit approval after the complete document review as approval; a generic confirmation during clarification does not qualify.
- Set `scope.productionUse` to `false` for every POC.
- Copy the Delivery Flow timebox into the Draft without asking the user. Let the Runner bind all role assignments to the Build Readiness actor when the Delivery Flow uses `approval-actor-all-roles`; do not turn these delivery controls into clarification questions or `RQ-xxx` decisions.
- Store evidence as stable file or URL references with a short description; do not embed chat transcripts. Local evidence must be a readable regular file inside the project workspace. URL and CI evidence must use an absolute HTTP or HTTPS URL; Verify syntax-checks those references without making a network request.
- Record resolved Control applicability, application, and exception references explicitly.
- Record one concrete application disposition for every applicable `pack@version` and trace the same reference in the requirements document.
- Do not manually alter checkpoint state, audit hashes, or checkpoint timestamps.
- Use ISO 8601 UTC timestamps when a timestamp is required.

During ordinary work, update descriptive fields and evidence references. Let the Runner own controlled state transitions and append-only audit events.
