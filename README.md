# Lean PDLC Harness v2

Lean PDLC is a portable, policy-aware delivery Harness for running POC, implementation, and end-to-end product delivery through one shared model.

The v2 architecture is intentionally small:

- A **Stage** is a reusable work unit.
- A **Delivery Flow** composes Stages and owns lifecycle controls such as checkpoints, constraints, role-assignment behavior, and timebox.
- A **Domain** is the ownership boundary for Artifacts, mandatory Controls, advisory Knowledge, Plugins, and Integration Adapters.
- A **Project Overlay** records approved project decisions and project-specific additions without copying the shared Harness.
- A **Delivery Record** stores execution state, resolved context, decisions, exceptions, and evidence.

There is no separate Workflow or User Journey model. Both are represented by Delivery Flow. There is no Principle Pack runtime concept in v2: mandatory content is a Control; recommended content is Knowledge.

## Architecture at a glance

```text
Delivery Flow
  -> ordered canonical Stages
  -> checkpoints, constraints, artifact profiles, role/timebox defaults

Before each Stage
  -> resolve mandatory Controls
  -> apply Project Baselines and resolved Defaults
  -> retrieve relevant Guidance, References, and KB
  -> compose eligible Plugins and Integration Adapters

Stage execution
  -> reads and produces Domain-owned Artifacts
  -> updates the Delivery Record and evidence
```

The four context channels remain separate because they have different semantics:

| Channel | Meaning | Blocking? |
|---|---|---|
| Controls | Rules that must be satisfied or formally excepted | Yes |
| Project Baselines and Defaults | Approved project facts and automatic choices | Baselines are authoritative; Defaults are overrideable unless Control-locked |
| Knowledge | Guidance, defaults, references, and concrete KB | No, unless referenced by a Control |
| Capabilities | Plugins and Integration Adapters that can perform work | Only when the Flow or Control requires them |

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
      controls/
      knowledge/
      capabilities/
    ux/
    solution-architecture/
    security/
    data-platform/
  roles/
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
    controls/
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

- Product Management owns Requirements and Story Artifact Definitions, requirements quality Controls, and authoring guidance.
- UX owns experience Controls, design guidance, web-POC Defaults, and the UX Plugin.
- Solution Architecture owns reversible-delivery Controls and minimum-design guidance/defaults.
- Security owns credential and sensitive-data Controls.
- Data Platform owns the Databricks connectivity KB example.

The Databricks example is intentionally Knowledge, not a Plugin. A future Integration Adapter can connect to Databricks; a Plugin can orchestrate that Adapter during a Stage.

## Runner

The Agent owns Runner calls; end users should not be asked to execute Bun commands.

Internal capabilities include:

```text
bun .pdlc/cli.ts validate
bun .pdlc/cli.ts status --root <project>
bun .pdlc/cli.ts context <stage-id> --root <project>
bun .pdlc/cli.ts readiness build --root <project> --record <id> --actor <identity>
bun .pdlc/cli.ts plugin list
bun .pdlc/cli.ts plugin sync --root <project>
```

`context` is the normal Stage-resolution API. It returns Controls, Baselines, Defaults, Knowledge, and Capability contributions independently. `guidance` remains a Plugin-only compatibility view.

## Adding an asset

- New Stage: add it once to `.pdlc/stages/catalog.json`, then reference it from registered Delivery Flows and applicable Domain assets.
- New Delivery Flow: create `.pdlc/delivery-flows/<id>/flow.json` and explicitly register it in `.pdlc/delivery-flows/catalog.json`.
- New Control or Knowledge: place it in the owning Domain and declare applicability metadata.
- New Plugin: place it under the owning Domain's `capabilities/plugins/` folder and declare permissions and Stage bindings.
- Project-specific decision: place it under `pdlc/config/domains/<domain>/`; do not fork shared definitions.

See [Harness Architecture and Ownership](pdlc-docs/HARNESS_ARCHITECTURE_AND_OWNERSHIP.md), [Delivery Flow Model](pdlc-docs/DELIVERY_FLOW_MODEL.md), and [Target Architecture](pdlc-docs/HARNESS_TARGET_ARCHITECTURE.md).

## Validate

```bash
bun test ./.pdlc/tests
bun .pdlc/cli.ts validate
```

The leading `./` in the test path is required because Bun otherwise treats the hidden Harness directory as a non-path filter.
