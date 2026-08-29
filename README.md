# Lean PDLC Harness v2

Lean PDLC is a portable, policy-aware delivery Harness for running POC, implementation, and end-to-end product delivery through one shared model.

The v2 architecture is intentionally small:

- A **Stage** is a reusable work unit.
- A **Delivery Flow** composes Stages and owns lifecycle controls such as checkpoints, constraints, role-assignment behavior, and timebox.
- A **Role** is a cataloged logical accountability slot used by Stages, Checkpoints, and Delivery Record assignments.
- A **Domain** is the expert-team ownership boundary for Artifacts, mandatory Policies, advisory Knowledge, Skills, Agents, and Hooks.
- An **Integration** is a cataloged external-system connection such as JIRA, Xray, or Databricks. It may bundle Skills and always declares ownership and permissions.
- A **Project Overlay** records approved project decisions and project-specific additions without copying the shared Harness.
- A **Delivery Record** stores execution state, resolved context, decisions, exceptions, and evidence.

There is no separate Workflow or User Journey model. Both are represented by Delivery Flow. There is no Principle Pack or Plugin runtime concept in v2: mandatory content is a Policy applied as a Control; recommended content is Knowledge; executable expert behavior is represented directly by Domain Skills, Agents, and Hooks.

## Architecture at a glance

```text
Delivery Flow
  -> ordered canonical Stages
  -> checkpoints, constraints, artifact profiles, role/timebox defaults

Before each Stage
  -> resolve mandatory Domain and project Policies as Controls
  -> apply Project Baselines and resolved Defaults
  -> retrieve relevant Guidance, References, and KB
  -> compose Domain Agents and Skills through Hooks
  -> resolve eligible top-level Integrations and bundled Skills

Stage execution
  -> reads and produces Domain-owned Artifacts
  -> applies a hashed Stage Context Receipt after the work is done
  -> updates the Delivery Record and evidence
```

The four context channels remain separate because they have different semantics:

| Channel | Meaning | Blocking? |
|---|---|---|
| Policies / Controls | Policies are authored rules; applicable mandatory rules enter the Control chain | Yes |
| Project Baselines and Defaults | Approved project facts and automatic choices | Baselines are authoritative; Defaults are overrideable unless Control-locked |
| Knowledge | Guidance, defaults, references, and concrete KB | No, unless referenced by a Control |
| Execution contributions | Domain Skills/Agents/Hooks plus top-level Integrations | Only when applicable to the Flow and Stage |

## Repository layout

```text
.pdlc/
  stages/catalog.json
  delivery-flows/
    catalog.json
    poc/flow.json
    implementation/flow.json
    pdlc/flow.json
  domains/
    product-management/
      artifacts/
      policies/
      knowledge/
      skills/
      agents/
      hooks/
    ux/
    solution-architecture/
    security/
    data-platform/
  integrations/
    catalog.json
    databricks/integration.json
  roles/
    catalog.json
    product.md
    developer.md
    qa.md
  schemas/
  core/
  tests/
  cli.ts
  runtime/
    records/
    audit/

pdlc/
  config/domains/<domain>/
    baseline.json
    policies/
    defaults/
    knowledge/
  requirements/
  evidence/
  artifacts/
```

The ownership rule is: `.pdlc/` is owned by the Harness and Runner; `pdlc/` is owned by the product project. Every shared professional asset lives under its owning Domain inside `.pdlc/domains/`.

## Current implementation

The POC Delivery Flow is executable. Implementation and end-to-end PDLC Flows are registered and validated but remain planned until their checkpoint and integration behavior is implemented.

Bundled Domains demonstrate the model:

- Product Management owns Requirements, Story, and Productization Package Artifact Definitions, requirements quality Policies, and authoring guidance.
- UX owns experience Policies, design guidance, web-POC Defaults, Skills, an Agent, and Stage Hooks.
- Solution Architecture owns reversible-delivery Controls and minimum-design guidance/defaults.
- Security owns credential and sensitive-data Controls.
- Data Platform owns the Databricks connectivity KB example; the external connection is registered separately under `.pdlc/integrations/databricks/`.

The Knowledge and Integration remain separate assets: the KB explains company usage, while the Integration declares connection permissions and applicability.

## Runner

The Agent owns Runner calls; end users should not be asked to execute Bun commands.

Internal Runner operations include:

```text
bun .pdlc/cli.ts validate
bun .pdlc/cli.ts status --root <project>
bun .pdlc/cli.ts audit summary --root <project> [--record <id>]
bun .pdlc/cli.ts context <stage-id> --root <project>
bun .pdlc/cli.ts context-apply <stage-id> --root <project> --receipt <receipt.json> --actor <identity>
bun .pdlc/cli.ts readiness build --root <project> --record <id> --actor <identity>
bun .pdlc/cli.ts domain list
bun .pdlc/cli.ts domain sync --root <project>
bun .pdlc/cli.ts integration list
```

`context` is the normal Stage-resolution API. It returns the current Stage's registered Roles, Controls, Baselines, Defaults, Knowledge, Domain contributions, Integrations, and a deterministic `contextHash`. It remains read-only and resolves only the requested Stage. After the Stage work, `context-apply` records an evidence-backed receipt for what was applied or intentionally not used. Build Readiness rejects missing or stale receipts for the requirements and readiness Stages. `guidance` is the narrower Domain-contribution view.

`audit summary` is a read-only projection over the selected Delivery Record and append-only Audit Log. It reports the current conclusion, Build Readiness, Verify and Decide milestones, a concise timeline, evidence references, satisfied, excepted, and pending Controls, and warnings when record state has no matching audit event. It never replaces or modifies the underlying Audit Events.

`status` is the read-only operational view. It reports the current canonical Stage and state, allowed and unavailable next actions, known blockers, Requirements approval, evidence readiness, applied Policies/Knowledge/Skills, Control dispositions, and Productization Package readiness. It derives routine status from the current Delivery Record and recorded Context Applications; only a verified POC triggers the just-in-time package check.

This assurance does not add startup questions, network calls, or a full-Harness scan. The Runner hashes only the already-resolved local files for the current Stage, and receipt persistence happens after Stage work rather than before the first clarification round.

## Adding an asset

- New Stage: add it once to `.pdlc/stages/catalog.json`, then reference it from registered Delivery Flows and applicable Domain assets.
- New Delivery Flow: create `.pdlc/delivery-flows/<id>/flow.json` and explicitly register it in `.pdlc/delivery-flows/catalog.json`.
- New Role: add its definition under `.pdlc/roles/`, register it in `.pdlc/roles/catalog.json`, and reference it from the relevant Stage or Checkpoint. Core code does not change.
- New mandatory Policy or Knowledge asset: place it in the owning Domain and declare applicability metadata.
- New expert behavior: add a Skill or Agent directly under the Domain and bind it to Stages through `hooks/`.
- New external system: create `.pdlc/integrations/<id>/integration.json`, optionally include `skills/`, and register it in `.pdlc/integrations/catalog.json`.
- Project-specific decision: place it under `pdlc/config/domains/<domain>/`; do not fork shared definitions.

See [Harness Architecture and Ownership](pdlc-docs/HARNESS_ARCHITECTURE_AND_OWNERSHIP.md), [Delivery Flow Model](pdlc-docs/DELIVERY_FLOW_MODEL.md), and [Target Architecture](pdlc-docs/HARNESS_TARGET_ARCHITECTURE.md).

## Validate

```bash
bun test ./.pdlc/tests
bun .pdlc/cli.ts validate
```

The leading `./` in the test path is required because Bun otherwise treats the hidden Harness directory as a non-path filter.
