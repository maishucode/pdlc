# Lean PDLC Delivery Flow Model

## One composition concept

Delivery Flow is the only lifecycle composition concept. POC, Implementation, and end-to-end PDLC are all Delivery Flows with different Stage sequences and controls.

The Catalog at `pdlc/delivery-flows/catalog.json` is explicit. Adding a directory does not activate a Flow. This prevents unfinished, experimental, or copied definitions from silently becoming available.

## Stage and Flow responsibilities

| Concern | Stage | Delivery Flow |
|---|---:|---:|
| Reusable work intent | Yes | No |
| Role slots, requirements, outputs | Yes | No |
| Artifact input/output types | Yes | No |
| Order and conditional inclusion | No | Yes |
| Lifecycle state and checkpoints | No | Yes |
| Flow constraints and defaults | No | Yes |
| Human approval by default | No | Only explicit checkpoints |

## Current Flows

| Flow | Status | Purpose |
|---|---|---|
| `poc` | active | Bounded, non-production idea validation |
| `implementation` | planned | Delivery from an existing Requirement or Story through release |
| `pdlc` | planned | Ideation through outcome review |

Conditional Stages use activation tags. For example, `ux-design` activates for UI technology tags, while `security-verification` activates for relevant risk tags.

## Adding a Stage

1. Add the reusable definition to `pdlc/stages/catalog.json`.
2. Give it a stable id, intent, phase, role slots, requirements, outputs, and Artifact references where applicable.
3. Add it to each relevant Delivery Flow sequence.
4. Ask each Domain owner whether existing Controls, Knowledge, Plugins, or Adapters apply to the new Stage.
5. Update tests and run Harness validation.

Do not create a Stage solely to perform context resolution. The Runner resolves Domain context before every Stage.

## Adding a Delivery Flow

1. Create `pdlc/delivery-flows/<id>/flow.json`.
2. Compose canonical Stage ids without redefining their semantics.
3. Mark incomplete Flows `planned` and omit executable controls.
4. When executable behavior is ready, add statuses, checkpoints, constraints, delivery defaults, Artifact profiles, and required Capabilities; mark it `active`.
5. Register the definition explicitly in `pdlc/delivery-flows/catalog.json`.
6. Add validation and lifecycle tests.

## Changing a Flow

A Flow change can alter delivery obligations even when Stage definitions are unchanged. Review:

- sequence and conditional tags;
- checkpoint ownership;
- Artifact profiles;
- role/timebox behavior;
- Control and Knowledge applicability;
- Plugin and Adapter eligibility;
- compatibility with active Delivery Records.

## Context is orthogonal to composition

Domain assets declare applicability to Flow, Stage, risk, technology, and domain tags. The Runner derives the reverse view dynamically. This means expert teams own their policies and knowledge without editing every Flow, while Flow owners still control the lifecycle sequence.
