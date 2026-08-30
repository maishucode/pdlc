# Lean PDLC Delivery Flow Model

## One composition concept

Delivery Flow is the only lifecycle composition concept. POC, Implementation, and end-to-end PDLC are all Delivery Flows with different Stage sequences and controls.

The Catalog at `.pdlc/delivery-flows/catalog.json` is explicit. Adding a directory does not activate a Flow. This prevents unfinished, experimental, or copied definitions from silently becoming available.

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

1. Add the reusable definition to `.pdlc/stages/catalog.json`.
2. Give it a stable id, intent, phase, role slots, requirements, outputs, and Artifact references where applicable.
3. Add it to each relevant Delivery Flow sequence.
4. Ask each Discipline owner whether existing Policies, Knowledge, Skills, Agents, or Hooks apply to the new Stage, and ask Integration owners whether any external system applies.
5. Update tests and run Harness validation.

Do not create a Stage solely to perform context resolution. The Runner resolves Discipline context before every Stage.

## Adding a Delivery Flow

1. Create `.pdlc/delivery-flows/<id>/flow.json`.
2. Compose canonical Stage ids without redefining their semantics.
3. Mark incomplete Flows `planned` and omit executable controls.
4. When executable behavior is ready, add statuses, checkpoints, constraints, and delivery defaults; mark it `active`. The generic engine can execute this definition without code changes.
5. If the Flow needs specialized validation, initialization, actions, checkpoint gates, status, or integrity checks, add a Flow-owned `executor.ts` and declare it in `runtime`. Keep discipline knowledge and reusable policy outside the executor.
6. Register the definition explicitly in `.pdlc/delivery-flows/catalog.json`.
7. Add validation and lifecycle tests. The extensibility test must prove that the Flow can initialize and transition without editing Core or CLI.

## Changing a Flow

A Flow change can alter delivery obligations even when Stage definitions are unchanged. Review:

- sequence and conditional tags;
- checkpoint ownership;
- delivery defaults, including the recommended Requirements profile;
- role/timebox behavior;
- Control and Knowledge applicability;
- Discipline Hook and Integration eligibility;
- compatibility with active Delivery Records.

## Context is orthogonal to composition

Discipline assets declare applicability to Flow, Stage, risk, technology, and discipline tags. The Runner derives the reverse view dynamically. This means expert teams own their policies and knowledge without editing every Flow, while Flow owners still control the lifecycle sequence.
