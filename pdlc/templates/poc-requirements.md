<!-- pdlc:poc-requirements:v2 -->
# POC Requirements: <title>

## Intent Analysis

- Request: <original idea in one sentence>
- Request type: New POC
- Scope estimate: <single component / multiple components>
- Complexity: <simple / moderate / complex>
- Requirements depth: <minimal / standard / comprehensive>

<!-- pdlc:section:clarification-decisions -->
## Clarification Decisions

Record resolved questions as durable decisions, not chat transcripts. Use one unique ID per answered question.

| ID | Topic | Confirmed decision |
|---|---|---|
| RQ-001 | <topic> | <decision> |

<!-- pdlc:section:product-context -->
## Product Context

### User and problem

<Who has which problem, in what context and frequency?>

### Hypothesis

<What does the experiment expect to prove or disprove?>

### Expected decision

<What kill, pivot, or productize decision will the evidence support?>

<!-- pdlc:section:functional-requirements -->
## Functional Requirements

- FR-001: <observable system behavior, including validation and state changes>

<!-- pdlc:section:user-scenarios -->
## User Scenarios and Edge Cases

- Primary journey: <happy path from entry to outcome>
- Alternate journey: <valid alternate path>
- Empty state: <expected behavior>
- Invalid input: <expected behavior>
- Failure or recovery: <expected behavior>
- Boundary case: <expected behavior>

<!-- pdlc:section:ux-interaction -->
## UX and Interaction Requirements

- Information hierarchy: <primary content and actions>
- Interaction pattern: <forms, inline editing, dialogs, undo, confirmation>
- Feedback states: <empty, success, error, disabled, loading, destructive>
- Responsive behavior: <mobile and desktop expectations>
- Accessibility: <keyboard, focus, labels, contrast, reduced motion>

<!-- pdlc:section:acceptance-criteria -->
## Acceptance Criteria

- AC-001: Given <context>, when <action>, then <observable result>.

<!-- pdlc:section:non-functional-requirements -->
## Non-Functional Requirements

- NFR-001 Performance: <measurable target or explicit POC boundary>
- NFR-002 Accessibility: <target and verification method>
- NFR-003 Reliability and recovery: <data and failure behavior>
- NFR-004 Security and privacy: <data, credentials, and dependency boundary>
- NFR-005 Compatibility: <supported browser, viewport, or platform>
- NFR-006 Maintainability and testability: <expected structure and evidence>

<!-- pdlc:section:scope -->
## Scope

### In scope

- <included capability>

### Out of scope

- Production deployment
- JIRA and XRAY integration
- <other explicit exclusion>

<!-- pdlc:section:data-integrations -->
## Data and Integration Boundaries

- Data model: <entities and material fields>
- Persistence: <none, local, approved service>
- Data classification: <synthetic, public, internal, confidential, regulated>
- Integrations: <none or named non-production dependency>
- Credentials: <none or approved secret mechanism>
- Failure and recovery: <corrupt, unavailable, or partial data behavior>

<!-- pdlc:section:success-measures -->
## Success Measures

- Success criterion: <measurable evidence that supports the hypothesis>
- Failure signal: <observation that rejects or weakens the hypothesis>
- Required evidence: <test, build, browser, usability, or demo evidence>

<!-- pdlc:section:delivery-controls -->
## Workflow Delivery Controls

- Assignment mode: <copied from the selected workflow; do not ask as a product requirement>
- Product: <resolved by the workflow at Build Readiness>
- Developer: <resolved by the workflow at Build Readiness>
- QA: <resolved by the workflow at Build Readiness>
- Timebox: <copied from the selected workflow>

<!-- pdlc:section:principle-packs -->
## Applicable Principle Packs

| Pack | Enforcement | How this POC will apply it |
|---|---|---|
| `<pack-id>@<version>` | required/advisory | <concrete design, implementation, and verification constraint> |

<!-- pdlc:section:standard-defaults -->
## Applied Standards and Defaults

Standards are not product answers and do not replace clarification of user needs, behavior, scope, data, or success measures. Apply resolved standards automatically and show every one here. A user or project may override an overrideable default; a locked enterprise constraint requires the owning function's exception process.

| Key | Source | Policy | Applied requirement | Disposition |
|---|---|---|---|---|
| `<standard-key>` | `<enterprise pack or profile ref>` | locked/overrideable | <concrete requirement> | applied/overridden with rationale |

<!-- pdlc:section:lightweight-design -->
## Lightweight Design

- Technology classification: <for example web-ui, react>
- Design summary: <smallest reversible experiment>
- Material decisions: <boundaries, persistence, interfaces, trade-offs>
- Verification approach: <tests and browser/demo evidence>

## Assumptions and Open Questions

<!-- pdlc:open-questions:pending -->
- Assumption: <confirmed assumption>
- Open question: <unresolved decision>
- Contradiction: <conflicting requirement or None>

## Final Requirements Review

<!-- pdlc:requirements-review:pending -->

Before requesting approval, replace the two pending machine markers with:

- `pdlc:open-questions:none` only when every open question and contradiction is resolved.
- `pdlc:requirements-review:presented` only after presenting this complete document to the user for review.

Confirm during review that the document describes the intended user, exact behavior, edge cases, UX states, acceptance criteria, NFRs, scope, data boundaries, success measures, applicable Principle Packs, resolved standard defaults and any overrides, lightweight design, and the separately identified workflow-owned delivery controls.

## Approval Scope

Approval of this document authorizes only the bounded, non-production POC described above. It does not authorize production deployment or productization. Approval metadata and the approved content hash are stored in the Delivery Record.
