# Lean PDLC Harness v2 Target Architecture

> Status: implemented architecture baseline on the `v2` branch. The POC Delivery Flow is executable; Implementation and end-to-end PDLC remain registered but planned.

## 1. Design decisions

The target architecture uses a small set of concepts:

1. `Delivery Flow` is the only lifecycle composition model. There is no separate Workflow or User Journey.
2. A `Stage` is a reusable unit of delivery work and is not automatically an approval gate.
3. A `Domain` is an expert-team ownership boundary.
4. Domain content is direct and type-specific: Artifacts, Policies, Knowledge, Skills, Agents, and Hooks.
5. A `Policy` is an authored mandatory rule. When applicable, it enters the effective Control chain.
6. An `Integration` is a top-level external-system package, not a Domain capability or Plugin.
7. Integrations may bundle Skills so existing JIRA, Xray, Databricks, and similar system procedures can be reused.
8. A `Project Overlay` supplies approved project facts, project Policies, Defaults, and local Knowledge.
9. The Runner performs deterministic resolution, readiness, state, and audit behavior. The Agent provides the conversation and delivery work.
10. Governance is expressed through ownership metadata, CODEOWNERS, schemas, approvals, and tests rather than a separate runtime layer.

There is no `Principle Pack`, `Plugin`, or generic `Capability` runtime concept in v2.

## 2. Architectural model

```text
Delivery Flow
  -> orders canonical Stages
  -> owns checkpoints, constraints, role behavior, and timebox

Stage entry
  -> resolves Domain and Project Policies into the Control set
  -> applies Project Baselines and resolved Defaults
  -> retrieves relevant Domain and Project Knowledge
  -> activates Domain Skills and Agents through Hooks
  -> resolves applicable top-level Integrations and bundled Skills

Stage execution
  -> reads or produces governed Artifacts
  -> records decisions, evidence, exceptions, and audit events
```

These channels remain separate:

| Channel | Purpose | Runtime semantics |
|---|---|---|
| Policies / Controls | Mandatory rules and effective obligations | Must be satisfied or formally excepted |
| Baselines / Defaults | Approved facts and automatic choices | Baselines are authoritative; Defaults may be replaced unless locked |
| Knowledge | Guidance, defaults, references, and KB | Advisory unless required by a Policy |
| Domain contributions | Skills and Agents bound through Hooks | Applied when the Hook matches Flow and Stage |
| Integrations | External-system connection packages and their Skills | Applied only when applicability and permission boundaries match |

## 3. Domain contract

Each Domain has one ownership manifest and only the categories it actually needs:

```text
.pdlc/domains/<domain>/
  domain.json
  artifacts/
  policies/
  knowledge/
    guidance/
    defaults/
    references/
    kb/
  skills/
    <skill>/SKILL.md
  agents/
    <agent>.agent.md
  hooks/
    <hook>.json
```

The categories mean:

- `artifacts/`: governed deliverable definitions, schemas, templates, and examples.
- `policies/`: mandatory professional or enterprise rules.
- `knowledge/`: non-blocking expert context and default choices.
- `skills/`: reusable expert procedures.
- `agents/`: Domain-owned execution behaviors.
- `hooks/`: Flow/Stage bindings that activate Agents and Skills and declare permissions and approval boundaries.

`domain.json` declares owners, policy approvers, maintainers, contribution modes, and optional default applicability. It does not enumerate every asset dynamically; the Domain Registry discovers the fixed category structure.

Artifacts remain a separate Domain category because Requirements, Stories, ADRs, and similar deliverables are governed contracts, not Knowledge.

## 4. Integration contract

External-system connections are cataloged independently:

```text
.pdlc/integrations/
  catalog.json
  jira/
    integration.json
    skills/
      jira-work-items/SKILL.md
  xray/
    integration.json
    skills/
      xray-test-management/SKILL.md
  databricks/
    integration.json
```

An Integration manifest declares:

- stable id and version;
- owners and maintainers;
- Delivery Flow, Stage, risk, technology, and Domain applicability;
- network access;
- credential references;
- whether external writes are allowed;
- bundled Skill ids and relative paths.

Credentials and secrets are never stored in the Integration package.

An Integration may contain a Skill, but the concepts remain distinct:

- Integration defines the external-system boundary.
- Skill tells the Agent how and when to use it.
- An underlying tool, MCP server, API client, or platform connector performs the actual operation.

The Runner returns applicable Integration Skill paths in Stage context. A platform-specific discovery wrapper may also point to the canonical Skill when direct `$skill-name` invocation is useful, but the wrapper must remain thin.

JIRA and Xray are unavailable to the POC Flow even when their Integration packages exist. They become usable only in approved Implementation or PDLC execution paths.

## 5. Policy and Control chain

The word `Policy` describes authored Domain or project content. `Control` describes the effective mandatory obligation after resolution.

```text
Harness Invariants
  + Delivery Flow Controls
  + Stage Completion Contract
  + applicable Enterprise Domain Policies
  + applicable Project Policies
  = Effective Control Set
```

Project Policies are cumulative and cannot weaken enterprise Policies. Locked Control decisions outrank Project and Domain Defaults. A conflict is a validation error, not a question for the delivery user.

The Delivery Record keeps `resolution.controls` because it records the effective applications and exceptions, even though the authored Domain folders are named `policies/`.

## 6. Project-specific configuration

Project-owned configuration stays visible under the product workspace:

```text
pdlc/config/domains/<domain>/
  baseline.json
  policies/
  defaults/
  knowledge/
```

- Put an already-approved architecture or technology decision in `baseline.json`.
- Put an additional mandatory project rule in `policies/`.
- Put an automatic but replaceable project choice in `defaults/`.
- Put a project guide, diagram, connection note, or reference in `knowledge/`.

Project configuration cannot introduce hidden Integrations, replace shared Domain assets, or weaken enterprise Policies.

## 7. Complete repository structure

```text
.pdlc/                         Harness-owned
  cli.ts
  core/
  stages/
  delivery-flows/
  domains/
  integrations/
  roles/
  schemas/
  platform-adapters/
  examples/
  tests/
  runtime/
    records/
    audit/

pdlc/                          Project-owned
  config/domains/
  requirements/
  evidence/
  artifacts/

pdlc-docs/                     Harness documentation
```

`.pdlc/runtime/current` and `.pdlc/runtime/locks/` are created only when needed.

## 8. Extension procedures

### Add a Stage

Add it once to `.pdlc/stages/catalog.json`, reference it from the required Delivery Flows, and update relevant Policy, Knowledge, Hook, Integration, Artifact, and test references.

### Add a Delivery Flow

Create `.pdlc/delivery-flows/<id>/flow.json` and register it explicitly in `.pdlc/delivery-flows/catalog.json`. A planned Flow must not claim executable checkpoints or external-system behavior.

### Add Domain behavior

Add the Skill or Agent directly under the owning Domain and bind it through `hooks/`. Do not create a Plugin manifest or `capabilities/` directory.

### Add an Integration

Create `.pdlc/integrations/<id>/integration.json`, optionally place existing system Skills under `skills/`, register the definition in `catalog.json`, and add permission and applicability tests.

### Add project configuration

Place the smallest necessary content under `pdlc/config/domains/<domain>/`. Do not fork the shared Harness.

## 9. Safety properties

- Only explicitly cataloged Delivery Flows and Integrations are loadable.
- Stages remain canonical and cannot be redefined by a Flow, Hook, Integration, or platform adapter.
- Domain asset ownership must match its folder.
- Hook Agent and Skill references must resolve inside the same Domain.
- Integration Skill references must resolve inside the Integration package.
- Network, credentials, filesystem writes, and external writes remain explicit permission boundaries.
- Project configuration cannot override locked enterprise constraints.
- Requirements approval is content-hash bound.
- Controlled state changes go through the Runner and audit log.
- Platform adapters remain thin and do not duplicate governance logic.

See [Harness Architecture and Ownership](HARNESS_ARCHITECTURE_AND_OWNERSHIP.md) for the detailed governance and Control review model.
