# Canonical Stages, User Journeys, and Principle Mapping

## 1. Design decision

The proposed model is sound and is now the canonical Harness design:

```text
Canonical Stage Catalog
        |
        +--> POC User Journey
        +--> Implementation User Journey
        `--> End-to-End PDLC User Journey

Principle Packs --appliesTo.stages--> Canonical Stage ids

Executable Workflow --journeyId--> User Journey
Executable Workflow --checkpoints--> Controlled state transitions
```

This separation gives the Harness reusable work units without turning every work unit into a script or approval. A Stage is a unit of delivery intent. A checkpoint is a controlled decision. They are deliberately different concepts.

The model also keeps ownership clean:

- PDLC Governance owns the Stage Catalog and User Journey composition.
- Product, Engineering, and QA governance review Stage requirements that affect their role.
- Professional functions own their Principle Packs and map those packs to canonical Stage ids.
- Harness Engineering owns schemas, cross-reference validation, and deterministic resolution.
- Delivery teams execute the resolved Journey and provide project evidence.

## 2. Source-of-truth files

| Concern | Authoritative file or folder | What it defines |
|---|---|---|
| Reusable Stage semantics | `pdlc/stages/catalog.json` | Stable id, phase, description, role slots, requirements, and outputs |
| User Journey composition | `pdlc/journeys/*.json` | Ordered Stage references and conditional activation tags |
| Executable state control | `pdlc/workflows/*/workflow.json` | Journey reference, statuses, checkpoints, defaults, and constraints |
| Principle-to-Stage mapping | `pdlc/principles/*/pack.json` | `appliesTo.stages`, workflow scope, risk, technology, domain, and enforcement |
| Harness and project defaults | `pdlc/defaults/` and `.pdlc/project/standards/` | Stage-scoped automatic defaults and project preferences |
| Machine contracts | `pdlc/schemas/` | Stage Catalog, Journey, Workflow, Principle Pack, and profile schemas |
| Runtime enforcement | `pdlc/core/` and `pdlc/cli.ts` | Loading, conditional resolution, cross-reference checks, and readiness |

There is intentionally no second hand-maintained Stage-to-Principle map. Each Principle Pack owns its `appliesTo.stages` mapping, and the Runner resolves the reverse Stage-to-Pack view. This prevents two mapping files from drifting.

## 3. Canonical Stage Catalog

The first catalog contains 30 reusable Stages. The catalog size is not a process target; add, merge, or retire Stages when the semantic boundary warrants it.

| # | Phase | Canonical Stage id | Primary role slot | Current Principle Pack mapping |
|---:|---|---|---|---|
| 1 | Discover | `ideation-intake` | Product | None yet |
| 2 | Discover | `problem-framing` | Product | None yet |
| 3 | Discover | `stakeholder-context` | Product | None yet |
| 4 | Discover | `business-architecture-alignment` | Product | None yet; reserved for Business Architecture |
| 5 | Discover | `hypothesis-definition` | Product | None yet |
| 6 | Discover | `success-measures` | Product, QA | None yet |
| 7 | Define | `scope-definition` | Product, Developer, QA | None yet |
| 8 | Define | `requirements-clarification` | Product, Developer, QA | UX |
| 9 | Define | `requirements-analysis` | Product, Developer, QA | Solution Architecture |
| 10 | Define | `acceptance-criteria-definition` | Product, QA, Developer | UX |
| 11 | Define | `data-integration-boundaries` | Product, Developer, QA | Security, Solution Architecture |
| 12 | Define | `risk-classification` | Product, Developer, QA | Security |
| 13 | Define | `principle-applicability` | Product, Developer, QA | Security, Solution Architecture, UX |
| 14 | Define | `requirements-approval` | Product | None; controlled by Requirements approval |
| 15 | Define | `work-item-planning` | Product, Developer, QA | None yet; future JIRA/XRAY boundary |
| 16 | Design | `solution-design` | Developer, Product, QA | Security, Solution Architecture |
| 17 | Design | `ux-design` | Product, Developer, QA | UX |
| 18 | Design | `test-strategy` | QA, Developer, Product | UX |
| 19 | Design | `delivery-planning` | Product, Developer, QA | Solution Architecture |
| 20 | Design | `build-readiness` | Product, Developer, QA | Security, Solution Architecture, UX |
| 21 | Build | `implementation` | Developer | Security, Solution Architecture, UX |
| 22 | Build | `developer-verification` | Developer | Security, Solution Architecture, UX |
| 23 | Verify | `security-verification` | Developer, QA | Security |
| 24 | Verify | `test-case-preparation` | QA | None yet; reserved for Quality governance |
| 25 | Verify | `test-execution` | QA, Developer | Security, UX |
| 26 | Verify | `acceptance-verification` | QA, Product | Security, UX |
| 27 | Release | `release-readiness` | Product, Developer, QA | Security, Solution Architecture |
| 28 | Release | `deployment` | Developer, QA | Security |
| 29 | Release | `production-validation` | Developer, QA, Product | Security |
| 30 | Outcome | `outcome-review-and-disposition` | Product, Developer, QA | None yet |

The complete requirement and output statements are in `pdlc/stages/catalog.json`; this table is a presentation view.

## 4. User Journey composition

| User Journey | Definition | Stage references | Current execution status |
|---|---|---:|---|
| POC | `pdlc/journeys/poc.json` | 22 | Active in Phase 1 |
| Implementation | `pdlc/journeys/implementation.json` | 21 | Planned; composition defined, Runner workflow not implemented |
| End-to-End PDLC | `pdlc/journeys/pdlc.json` | 30 | Planned; composition defined, Runner workflow not implemented |

`required` Stage references always participate. A `conditional` Stage participates when any of its `activationTags` matches the delivery context. Current tag namespaces are:

- `technology:<value>`, such as `technology:web-ui`
- `risk:<value>`, such as `risk:sensitive-data`
- `domain:<value>` for a project or business domain

For example, `ux-design` is activated for web or mobile UI work, and `security-verification` is activated by relevant risk triggers. Conditional inclusion reduces unnecessary work; it does not disable a required Principle Pack that applies at another active Stage.

## 5. How to change the model

### Change the meaning or requirements of an existing Stage

1. Edit the Stage in `pdlc/stages/catalog.json` without changing its id.
2. Increase `catalogVersion` for a behavioral change.
3. Review every Journey and Principle Pack that references the Stage id.
4. Update schemas or Core only if the Stage contract itself changes.
5. Run Harness tests and validation.

Use this path when the Stage still represents the same reusable lifecycle responsibility. A wording change does not require a new Stage id; a materially different responsibility usually does.

### Add a new Stage

1. Add a unique lowercase kebab-case id to `pdlc/stages/catalog.json` and increase `catalogVersion`.
2. Add the Stage reference only to the User Journeys that need it.
3. Ask each relevant professional owner to decide whether its Principle Pack maps to the new Stage.
4. Decide whether the Stage creates a new human checkpoint. The default is no.
5. Add or update tests for ordering, activation, and cross references.

### Remove, merge, or rename a Stage

Treat a Stage id as a shared API. First remove or migrate every reference in:

- `pdlc/journeys/*.json`
- `pdlc/principles/*/pack.json`
- `pdlc/defaults/**/*.json`
- `.pdlc/project/standards/*.json`
- tests, templates, and documentation

The Runner rejects dangling references. For an established enterprise rollout, deprecate an id for one catalog version before removal when active records or external reports store it.

### Reorder or tailor a User Journey

Edit only the relevant file under `pdlc/journeys/`:

- Reorder entries to change sequence.
- Add or remove a Stage reference to change scope.
- Use `conditional` plus activation tags when context should control inclusion.
- Keep `required` for controls that always apply to that Journey.

Do not copy or redefine Stage requirements inside a Journey.

### Change Principle applicability

The professional owner edits its own `pdlc/principles/<area>/pack.json`:

1. Change `appliesTo.stages` using canonical Stage ids.
2. Review workflow, risk, technology, domain, and enforcement dimensions together.
3. Increase the pack semantic version for behavioral change.
4. Add concrete, verifiable Principle requirements.
5. Run Harness validation; unknown Stage ids fail deterministically.

### Add or change a human approval

Edit the executable workflow under `pdlc/workflows/<journey>/workflow.json` and the Runner transition logic. Do not model an approval by creating a Stage or by adding another TypeScript process. Human checkpoints should remain few and material.

## 6. Validation guarantees

The Runner currently validates that:

- The Stage Catalog is valid and Stage ids are unique.
- Every Journey is valid, ordered, and free of duplicate Stage references.
- Every Journey Stage reference exists in the canonical catalog.
- Every executable Workflow references its matching active Journey.
- Every Principle Pack and Standard Profile references only canonical Stage ids.
- Conditional Stages resolve from delivery-context tags.
- Build Readiness resolves standards and Principle Packs across the active POC Stage set, not from a single broad phase label.

The validation response also exposes the resolved reverse Stage-to-Principle-Pack mapping for inspection.

## 7. Lightweight operating rule

Do not equate configuration granularity with user interaction. A delivery may traverse many internal Stages while the Agent asks only the product questions that remain undecided and invokes the TypeScript Runner only for validation or a material checkpoint. Enterprise defaults and Principle Packs should silently remove repetitive questions, while the final Requirements and readiness summary still disclose what was applied.
