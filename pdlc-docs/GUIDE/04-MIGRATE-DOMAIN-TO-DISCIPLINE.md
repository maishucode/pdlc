# 04 — Migrate Domain Capabilities to the Discipline Stage Runtime

## 1. Purpose

This guide records the migration from `feature/v2-agent-capability-runtime` to `feature/v2-stage-agent-runtime` and explains how to preserve an existing professional Domain while converting it to the current Discipline model.

The migration has two independent goals:

1. move professional ownership from the old `Domain` terminology and paths to `Discipline`; and
2. replace one-subagent-per-Capability execution with one generic subagent invocation per Stage.

Do not treat every old Domain as a Discipline. Classify it first:

| Existing concept | Current owner | Example |
|---|---|---|
| Professional practice or expert team | Discipline | UX, Security, Solution Architecture, Java Engineering |
| External system or service boundary | Integration | JIRA, Xray, Databricks |
| Product business bounded context | Project business model, not the Discipline registry | Payments, Claims, Lending |

This guide applies directly to the first category. A business Domain must not be renamed mechanically into a Discipline merely to satisfy the folder layout.

## 2. Before and after

The old execution unit was one required Capability:

```text
Stage
  -> requiredAgentInvocations[]
       -> Capability A -> one task subagent
       -> Capability B -> one task subagent
  -> one execution envelope inside each contribution
```

The current execution unit is the Stage, while the acceptance unit remains the Capability:

```text
Stage
  -> requiredStageInvocation
       -> one general-purpose task subagent
            -> Capability A -> selected Skills + result + evidence
            -> Capability B -> selected Skills + result + evidence
  -> one Stage invocation Receipt
  -> one contribution Receipt per Capability
```

This change preserves independent Capability results without paying the startup and context cost of a separate subagent for every Capability or Skill.

## 3. Migration rounds

The capability runtime evolved through the following rounds. The listed commits identify the previous implementation history; the final row is the current Stage-scoped implementation.

| Round | Representative commits | Change | Result carried forward |
|---|---|---|---|
| 1. Required Capability identity | `d9a2278`, `2ef97f3` | Added globally unique Capability ids and deterministic invocation contracts. | Hooks still declare stable required Capability ids. |
| 2. Execution Receipt gates | `3835057`, `204c2a6` | Required completed execution Receipts and revalidated stored applications. | A governed boundary still rejects missing or stale execution provenance. |
| 3. Permission, evidence, and trace hardening | `0893814`, `9b2642b`, `7436950`, `a9f929f` | Bound permissions to the contract, checked evidence integrity, and validated platform trace formats. | The Stage Receipt validates aggregate permissions, evidence, status, and execution reference. |
| 4. Native generic subagent dispatch | `a3f0960` | Replaced reliance on custom Domain Agent discovery with the native `task` subagent and a role profile read at runtime. | Custom Discipline Agent projection remains optional; generic Stage execution is canonical. |
| 5. Current V2 foundation | `fe13d91` | Introduced the extensible Flow Engine, direct Discipline ownership, project-owned runtime storage, and configuration-only Flow support. | Capability execution is integrated with the current Flow and context model instead of porting the old Core wholesale. |
| 6. Stage-scoped batching | `5c89499` | Replaced `requiredAgentInvocations[]` with one `requiredStageInvocation`, changed fixed Skills into candidates, and moved execution provenance to one Stage-level Receipt. | Exactly one generic subagent handles all required same-Stage Capabilities. |
| 7. Atlas entrypoints | `5c89499` | Reapplied Atlas PDLC names to the V2 entrypoints, Agent, Skill, UX assets, package, and documentation while retaining `/pdlc` as a legacy text alias. | One consistent product identity without changing Delivery Flow semantics. |

The current implementation was rebuilt on the current V2 foundation. It was not produced by merging the old branch wholesale, because doing so would have restored obsolete Domain registries, paths, CLI composition, and runtime ownership.

### 3.1 Current file-level implementation

| File | Current responsibility |
|---|---|
| `.pdlc/core/types.ts` | Defines Discipline Hook schema v2, candidate Skills, Stage invocation contracts, Stage invocation Receipts, and selected-Skill contributions. |
| `.pdlc/core/stage-agent.ts` | Generates the deterministic Stage invocation id and aggregates same-Stage permissions. |
| `.pdlc/core/discipline-guidance.ts` | Discovers Discipline Hooks, validates Capability uniqueness and local Agent/Skill references, and verifies Flow gate coverage. |
| `.pdlc/core/context-receipt.ts` | Hashes Agent and candidate Skill content and validates exact Capability coverage, selected Skill subsets, invocation identity, permissions, and trace format. |
| `.pdlc/core/harness-context.ts` | Resolves current Stage material and revalidates stored Receipts and evidence at governed boundaries. |
| `.pdlc/commands/context.ts` | Returns the resolved Discipline contributions and one optional `requiredStageInvocation`; applies validated Receipts. |
| `.pdlc/platform-adapters/github-copilot-stage-agent.ts` | Maps portable same-Stage contributions into the GitHub Copilot `task`/`general-purpose` contract. |
| `.pdlc/core/flow-executor.ts` | Blocks configuration-only checkpoints whose declared `contextStages` do not have current Receipts. |
| `.pdlc/core/delivery-flow-registry.ts` | Rejects checkpoint context references outside the Flow's canonical Stage sequence. |
| `.pdlc/schemas/discipline-stage-hooks.schema.json` | Validates required Capability bindings and candidate Skills. |
| `.pdlc/schemas/stage-context-receipt.schema.json` | Requires one completed Stage invocation when Discipline contributions are present. |
| `.pdlc/schemas/delivery-flow.schema.json` | Defines optional checkpoint `contextStages`. |
| `.pdlc/disciplines/ux/hooks/stages.json` | Demonstrates five UX Capability bindings with three worker-selectable Skills. |
| `.github/agents/atlas-pdlc.agent.md` | Grants the `agent` tool alias and requires one generic subagent call per Stage contract. |
| `.agents/skills/atlas-pdlc/SKILL.md` | Defines just-in-time Stage resolution, reuse rules, and the main Agent's execution protocol. |

The previous files were replaced rather than retained as a compatibility layer:

| Removed previous component | Current replacement |
|---|---|
| `.pdlc/core/agent-capability.ts` | `.pdlc/core/stage-agent.ts` |
| `.pdlc/platform-adapters/github-copilot-agent-runtime.ts` | `.pdlc/platform-adapters/github-copilot-stage-agent.ts` |
| `.pdlc/core/domain-guidance.ts` | `.pdlc/core/discipline-guidance.ts` |
| `.pdlc/core/domain-registry.ts` | `.pdlc/core/discipline-registry.ts` |
| `.pdlc/core/domain-resolver.ts` | `.pdlc/core/discipline-resolver.ts` |
| `.pdlc/domains/` | `.pdlc/disciplines/` |

No parallel Domain runtime, Plugin wrapper, or `capabilities/` directory was added.

## 4. Contract and path mapping

### 4.1 Shared Harness assets

| Previous | Current | Migration action |
|---|---|---|
| `.pdlc/domains/<id>/` | `.pdlc/disciplines/<id>/` | Move the directory without changing `<id>`. |
| `domain.json` | `discipline.json` | Rename the file; the manifest body is otherwise compatible. |
| `ownerDomain` | `ownerDiscipline` | Rename in Artifact, Policy, and Knowledge metadata. |
| Hook root field `domain` | Hook root field `discipline` | Preserve the same owner id. |
| `.pdlc/schemas/domain.schema.json` | `.pdlc/schemas/discipline.schema.json` | Use the current schema. |
| `.pdlc/schemas/domain-stage-hooks.schema.json` | `.pdlc/schemas/discipline-stage-hooks.schema.json` | Use the current schema. |
| `DomainRegistry` | `DisciplineRegistry` | Do not retain a parallel Domain registry. |
| `DomainResolver` | `DisciplineResolver` | Update imports and ownership language. |
| `domain list` / `domain sync` | `discipline list` / `discipline sync` | Update maintainer automation. |

### 4.2 Project Overlay assets

| Previous | Current | Migration action |
|---|---|---|
| `pdlc/config/domains/<id>/` | `pdlc/disciplines/<id>/` | Move directly; remove the empty `pdlc/config/` root. |
| Baseline field `domain` | `discipline` | Preserve the id and approval metadata. |
| Project Default field `domain` | `discipline` | Preserve the id, version, applicability, and defaults. |
| Project Policy `ownerDomain` | `ownerDiscipline` | Preserve the Policy id and version. |
| Project Knowledge `ownerDomain` | `ownerDiscipline` | Preserve the Knowledge id, version, kind, and `contentRef`. |
| `controls/` | `policies/` | Rename the folder; Controls are now the resolved mandatory obligations produced from Policies. |

The current Runner rejects the legacy `pdlc/config/` path. It also rejects project-only Discipline ids that do not exist in the shared Discipline registry.

### 4.3 Runtime and Receipt fields

| Previous | Current | Compatibility |
|---|---|---|
| `design.domains` | `design.disciplines` | Rename values only after classifying them as professional Disciplines. |
| `domainContributions` | `disciplineContributions` | Structural rename plus the changes below. |
| `requiredAgentInvocations[]` | optional `requiredStageInvocation` | Not wire-compatible. Re-resolve the Stage. |
| Hook `skills` | Hook `candidateSkills` | Start with the same list for behavior preservation. |
| Contribution `skills` | Contribution `selectedSkills` | Record only the Skills actually selected by the Stage worker. |
| Per-contribution `execution` | one top-level `stageInvocation` | Old execution envelopes cannot be reused. |
| Invocation id bound to Capability, Agent, and fixed Skills | Invocation id bound to Stage and current `contextHash` | Always obtain a new id from `context <stage>`. |
| Contribution ref ending in Agent id | contribution ref ending in Capability id | Example: `ux@1.0.0:ux-design`. |

Both implementations used a schema-version-2 Receipt during development, but their internal shapes differ. Treat old Capability-scoped Receipts as incompatible even if the numeric schema version matches. Never convert only the field names and claim the old subagent execution as a new Stage invocation.

## 5. What can be preserved

For a professional Domain such as UX, preserve these identifiers and contents unless there is a separate product decision to change them:

- the owner id, such as `ux`;
- the manifest version and ownership groups;
- Artifact ids, schemas, templates, and examples;
- Policy ids, versions, rules, evidence requirements, and exception approvers;
- Knowledge ids, versions, applicability, content, and content references;
- Agent role-profile ids and behavioral boundaries;
- Skill directory ids and Skill procedures; and
- Delivery Flow and canonical Stage ids.

The following items must change:

- Domain paths and ownership field names;
- Hook `domain` and `skills` fields;
- runtime output and Receipt shapes;
- project Overlay paths and metadata fields; and
- any code, test, documentation, or automation that imports Domain-specific Core modules.

Preserving an asset id preserves references such as `ux.experience-quality@1.0.0`. Moving the file and renaming `ownerDomain` does not require changing that Policy ref.

## 6. Step-by-step asset migration

### Step 1: classify the old Domain

Ask one question: does this directory describe reusable professional expertise, an external system, or the product's business model?

- Professional expertise becomes a Discipline.
- External-system behavior becomes an Integration.
- Business decomposition stays project-owned and must not be inserted into `design.disciplines`.

Stop if the answer is ambiguous. A path rename made before classification creates a permanent ownership error.

### Step 2: move the shared directory

For a professional Domain:

```text
git mv .pdlc/domains/<id> .pdlc/disciplines/<id>
git mv .pdlc/disciplines/<id>/domain.json .pdlc/disciplines/<id>/discipline.json
```

Keep optional folders only when the Discipline owns them:

```text
.pdlc/disciplines/<id>/
├── discipline.json
├── artifacts/
├── policies/
├── knowledge/
├── skills/
├── agents/
└── hooks/
```

Do not create empty categories merely to mirror another Discipline.

### Step 3: update ownership metadata

The manifest body can remain unchanged after its filename changes:

```json
{
  "schemaVersion": 1,
  "id": "ux",
  "name": "User Experience",
  "owners": ["ux-leadership"],
  "policyApprovers": ["ux-governance-team"],
  "maintainers": ["ux-practice-team"]
}
```

Change owned asset metadata:

```diff
- "ownerDomain": "ux"
+ "ownerDiscipline": "ux"
```

Apply this to Artifact definitions, Policies, and Knowledge metadata. Do not change their ids or versions solely because of the ownership terminology migration.

### Step 4: convert the Hook

For a behavior-preserving first pass, preserve the existing Capability id, Agent id, and fixed Skill list:

```diff
 {
   "schemaVersion": 2,
-  "domain": "ux",
+  "discipline": "ux",
   "version": "1.0.0",
   "deliveryFlows": ["poc"],
   "enabled": true,
   "bindings": [
     {
       "stage": "ux-design",
       "capability": "ux-design-spec",
       "invocation": "required",
       "agent": "atlas-pdlc-ux",
-      "skills": ["atlas-pdlc-ux-spec"],
+      "candidateSkills": ["atlas-pdlc-ux-spec"],
       "mode": "draft"
     }
   ]
 }
```

After that migration passes, candidate selection may be widened deliberately:

```json
"candidateSkills": [
  "atlas-pdlc-ux-spec",
  "atlas-pdlc-ux-review",
  "atlas-pdlc-ux-react-ui-delivery"
]
```

Widening the list changes the Stage context hash and gives the worker more discretion. Review the Agent role profile before making that change.

### Step 5: preserve or remap Capability ids

The current UX reference implementation uses Stage-aligned Capability ids:

| Previous UX Capability | Current UX Capability |
|---|---|
| `ux-requirements-spec` | `ux-requirements-clarification` |
| `ux-design-spec` | `ux-design` |
| `ux-react-ui-implementation` | `ux-implementation` |
| `ux-react-ui-developer-verification` | `ux-developer-verification` |
| `ux-acceptance-review` | `ux-acceptance-verification` |

This rename is not required by the Discipline schema. Preserve the old Capability id when external automation depends on it. If it is renamed, treat the new id as a new execution identity and regenerate every affected Stage Receipt.

### Step 6: update the role profile

Keep the professional instructions, permissions behavior, handoff, and approval boundaries. Replace assumptions about one fixed Capability invocation with the Stage worker contract:

- the role profile may receive multiple same-Stage Capabilities;
- it must return one result per assigned Capability;
- it selects at least one Skill per Capability only from that Capability's candidates;
- it reports the selected Skill ids and evidence for every result; and
- it never approves Requirements, gates, or controlled PDLC state.

The canonical profile remains under the Discipline. Projection into `.github/agents/` is optional and must not become a runtime dependency.

### Step 7: update project Overlay content

Move an existing project configuration:

```text
git mv pdlc/config/domains/<id> pdlc/disciplines/<id>
```

Then update:

```diff
- "domain": "ux"
+ "discipline": "ux"
```

for `baseline.json` and project Defaults, and:

```diff
- "ownerDomain": "ux"
+ "ownerDiscipline": "ux"
```

for project Policies and Knowledge.

Project Knowledge must live under one of these typed folders and must keep a matching `kind`:

```text
pdlc/disciplines/<id>/knowledge/guidance/
pdlc/disciplines/<id>/knowledge/references/
pdlc/disciplines/<id>/knowledge/kb/
```

Move project Defaults to the sibling `defaults/` directory instead of leaving them under Knowledge.

### Step 8: update Flow gates

Custom Flow executors must call `HarnessContext.contextIssues()` at their governed boundaries. A configuration-only Flow with a required Capability must declare the relevant Stage in a checkpoint:

```json
{
  "id": "review",
  "from": ["DRAFT"],
  "to": "REVIEWED",
  "ownerRole": "developer",
  "contextStages": ["ux-design"]
}
```

The Harness rejects an active configuration-only Flow when a required Capability is not protected by at least one `contextStages` gate.

### Step 9: invalidate old Capability Receipts

Do not copy an old `domainContributions` Receipt into `disciplineContributions`. Re-enter the Stage and obtain the current contract:

```text
context <stage-id>
  -> requiredStageInvocation
  -> one native task subagent
  -> one result per Capability
  -> Stage Context Receipt v2
  -> context-apply <stage-id>
```

The new Receipt must contain:

- exactly one `stageInvocation` when the Stage has required Capabilities;
- exactly one `disciplineContributions` entry for every required Capability;
- a non-empty `selectedSkills` subset for every Capability;
- the current invocation id and aggregate permissions; and
- readable local evidence or valid HTTP(S) evidence references.

### Step 10: handle existing Delivery Records and audit history

Storage migration and semantic migration are different operations:

- `migrate storage` moves legacy `.pdlc/runtime/` state into project-owned `pdlc/` paths.
- It does not convert `design.domains`, old contribution Receipts, or old invocation identities.

Do not rewrite append-only audit history to make old events look as though they were produced by the Discipline Stage runtime.

For a terminal historical Record, retain it as history and start a new Record under the current model. For an active old Record, either complete it with the old runtime before switching or add a dedicated controlled semantic migration operation. Do not hand-edit controlled Record and Audit state independently.

## 7. UX preservation example

The UX migration preserves the professional assets while changing their owner vocabulary and execution contract:

```text
.pdlc/domains/ux/                         .pdlc/disciplines/ux/
├── domain.json                           ├── discipline.json
├── policies/experience-quality...        ├── policies/experience-quality...
├── knowledge/...                         ├── knowledge/...
├── agents/atlas-pdlc-ux.agent.md    ->  ├── agents/atlas-pdlc-ux.agent.md
├── skills/atlas-pdlc-ux-spec/...         ├── skills/atlas-pdlc-ux-spec/...
├── skills/atlas-pdlc-ux-review/...       ├── skills/atlas-pdlc-ux-review/...
├── skills/atlas-pdlc-ux-react...         ├── skills/atlas-pdlc-ux-react...
└── hooks/stages.json                     └── hooks/stages.json
```

Preserved:

- `ux` ownership id;
- Policy, Knowledge, Agent, and Skill ids;
- content and governance boundaries; and
- canonical Stage assignments.

Changed:

- folder and manifest names;
- `ownerDomain` to `ownerDiscipline`;
- fixed `skills` to `candidateSkills`;
- selected-Skill recording;
- Stage-scoped invocation identity and Receipt location; and
- the reference Capability ids listed above.

## 8. Validation sequence

Run validation in this order after migrating one Discipline:

```text
bun install --cwd .pdlc --frozen-lockfile
bun run --cwd .pdlc typecheck
bun run --cwd .pdlc test
bun .pdlc/cli.ts discipline list
bun .pdlc/cli.ts context <bound-stage> --root <project-root>
bun .pdlc/cli.ts validate --root <project-root>
```

Inspect `context <bound-stage>` and confirm:

- the owner is returned under `disciplineContributions`;
- Agent and candidate Skill paths resolve under the same Discipline;
- only one `requiredStageInvocation` is returned;
- all required same-Stage Capabilities appear in its `capabilities` array;
- permissions are the aggregate of those Capabilities; and
- an unbound Stage has no invocation.

Then test one valid Receipt and these negative cases:

- missing Capability result;
- selected Skill outside the candidate set;
- missing Stage invocation;
- altered invocation id or permissions;
- missing or unreadable evidence;
- stale context hash; and
- a governed checkpoint attempted without the current Receipt.

## 9. Migration completion checklist

- [ ] The old Domain was classified as professional expertise rather than a business bounded context or Integration.
- [ ] Its id, versions, owners, Policy refs, Knowledge refs, Agent ids, and Skill ids were preserved where possible.
- [ ] `.pdlc/domains/<id>/` moved to `.pdlc/disciplines/<id>/`.
- [ ] `domain.json` became `discipline.json`.
- [ ] All `ownerDomain` fields became `ownerDiscipline`.
- [ ] The Hook root uses `discipline` and bindings use `candidateSkills`.
- [ ] Candidate widening, if any, was reviewed as a behavior change.
- [ ] Capability id changes were recorded explicitly.
- [ ] Project Overlay content moved to `pdlc/disciplines/<id>/`.
- [ ] `baseline.json` and project Defaults use `discipline`.
- [ ] Project Knowledge uses typed folders and has no orphan content.
- [ ] Flow gates enforce current Stage context.
- [ ] Old Capability-scoped Receipts were not reused.
- [ ] Historical audit events were not rewritten.
- [ ] One bound Stage returns exactly one invocation with complete Capability coverage.
- [ ] Typecheck, tests, Harness validation, and negative Receipt tests pass.

Continue with [03. Add Discipline Capabilities, Agents, and Skills](03-ADD-DISCIPLINE-CONTRIBUTIONS.md) for the current authoring contract.
