# Requirements clarification reference

Use `.pdlc/delivery-flows/poc/controls/requirements.json` as the deterministic Flow Control and the Product Management Requirements Artifact Definition and templates as the document contract.

## Adaptive depth

- `minimal`: use only for a narrow, already-specific technical experiment.
- `standard`: default for a greenfield or user-facing POC.
- `comprehensive`: use for multiple stakeholders, material risk, integrations, sensitive data, or complex workflows.

The policy defines the minimum traceable decisions and required coverage topics for each depth. Meeting the numeric minimum does not excuse missing or ambiguous coverage.

## Clarification rounds

Ask focused conversational rounds with no more than the policy's `maxQuestionsPerRound`. This is a hard per-message limit, not a target. Do not treat a generic product description as complete requirements. Cover:

1. `productContext`: user, problem, frequency, goal, hypothesis, and decision the POC enables.
2. `functionalBehavior`: entities and fields, commands, validation, state transitions, calculations, sorting, filtering, and bulk actions.
3. `userScenarios`: primary and alternate journeys, empty state, invalid input, boundaries, destructive actions, failures, and recovery.
4. `uxInteraction`: information hierarchy, interaction patterns, feedback states, responsive behavior, accessibility, and applicable UX standards.
5. `qualityAttributes`: measurable performance, reliability, security, privacy, compatibility, maintainability, and testability expectations.
6. `dataIntegrations`: data model, persistence, classification, retention, integrations, credentials, and unavailable or corrupt data behavior.
7. `scopeSuccess`: explicit in/out scope, measurable success and failure signals, and required evidence.

Role assignments and timebox are delivery controls, not product requirements. Read them from the selected Delivery Flow's `controls.deliveryDefaults`. When `collectDuringRequirements` is `false`, never ask the user to choose them during requirements clarification and never count them as an `RQ-xxx` decision. The Runner binds the configured role-assignment mode to the Build Readiness actor.

Applicable Controls, Baselines, and Defaults are also not product answers. Resolve them through the current Stage context described in [domain-context.md](domain-context.md), write their references into the Draft without delaying the first question, and do not count them as `RQ-xxx` decisions or `questionsAnswered`. Expand concrete applications and provenance incrementally, completing them before final Requirements review. They may satisfy the corporate baseline portion of UX, quality, security, architecture, or engineering coverage, but product-specific interaction, failure, data, scope, and success decisions still require clarification. For example, do not ask for the corporate blue palette or semantic-control baseline; do ask whether this product uses inline editing, Undo, confirmation, or another product behavior.

When choices help the user decide, provide only meaningful mutually exclusive options plus a custom-response path, subject to the active platform's interaction rules. Accept natural-language answers.

## Interaction modes

Use chat mode by default. If more questions remain than fit in one round, briefly tell the user that document mode is available; do not make interaction-mode selection an `RQ-xxx` decision.

### Chat mode

- Ask no more than `maxQuestionsPerRound` product questions in one assistant message.
- Record the answers, update the Requirements Draft, then ask the next batch only if required coverage is still incomplete.
- Do not split one product decision into artificial questions merely to reach the policy minimum.

### Document mode

Use only when `allowDocumentAnswers` is true and the user chooses it.

1. Generate the Flow Control's `questionDocumentPattern` from `.pdlc/domains/product-management/artifacts/requirements/templates/questions.md`, replacing `{recordId}` with the active POC ID.
2. Include all currently outstanding product questions; document mode is not limited to three questions.
3. Give every question a stable ID, meaningful mutually exclusive options, `X) Other`, an empty `[Answer]:` tag, and an optional `[Notes]:` tag.
4. Link the file, explain that the user may fill it directly, and stop. Do not proceed from an unfilled questionnaire.
5. When the user says it is ready, re-read the file from disk. Validate that every answer is present and maps to an option or a clear custom response.
6. Analyze answers for contradictions and ambiguities. If follow-up is necessary, update the same document with targeted questions and stop again.
7. Convert resolved answers into durable `RQ-xxx` decisions and requirements; do not copy the raw questionnaire into the final Requirements contract.
8. Mark the questionnaire status `processed` after successful ingestion and retain it as a supporting decision artifact until the POC is cleaned up.

Never force document mode. The user may switch between chat and document mode while Requirements remain Draft.

## Trace decisions

After each answer:

- Add one unique `RQ-xxx` row per resolved question to the Requirements document.
- Update the corresponding requirements and acceptance criteria.
- Increment `requirements.clarification.questionsAnswered` to equal the number of distinct `RQ-xxx` decisions in the document.
- Mark a coverage topic `complete` only when it is concrete enough for independent implementers and testers.
- Keep unresolved items in `openQuestions` and conflicting statements in `contradictions`.
- Ask targeted follow-ups until both arrays can be empty; never silently choose a material product behavior.

Do not store raw conversation transcripts. Record the confirmed decision and its consequences.

## Final document review

Before approval:

1. Resolve every required topic, open question, contradiction, placeholder, applicable Control disposition, Project Baseline, and Default/override disposition.
2. Reconcile the Delivery Record with the Requirements document.
3. Replace `pdlc:open-questions:pending` with `pdlc:open-questions:none`.
4. Present the complete Requirements Artifact link and a concise review summary covering behavior, edge cases, UX, quality attributes, scope, data, success measures, Controls, Baselines, Defaults, design, and a separately labelled Delivery Flow controls summary.
5. Only after presenting it, replace `pdlc:requirements-review:pending` with `pdlc:requirements-review:presented` and ask for explicit approval of the named document and Build Readiness.
6. Stop. A short confirmation to an earlier clarification question is not final Requirements approval.

If the user requests a material change, restore the review marker to `pending`, update the contract and Delivery Record, re-run ambiguity analysis, and present the complete document again.
