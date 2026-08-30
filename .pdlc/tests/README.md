# Harness test strategy

Primary owner: **Harness Engineering**. A Discipline policy owner should review test changes that alter its Policies.

The complete suite covers schema contracts, explicit Delivery Flow and Integration registration, conditional Stage composition, Discipline ownership, Policy and Knowledge resolution, Project Overlay precedence, Discipline Hook composition, Build Readiness, atomic state, locking, audit, entry points, and platform neutrality.

The framework E2E suite is the fast stability contract for the data-driven Flow Engine:

```sh
bun run --cwd .pdlc test:e2e
```

It is intentionally local, isolated, and repeatable. Each test creates its own temporary workspace and removes it afterward. It does not use network services, credentials, JIRA, XRAY, application dependencies, or production deployment.

## What the E2E suite proves

| Scenario | Contract exercised |
|---|---|
| Concrete Product Requirements Analysis Flow | Generic CLI and Flow Engine dispatch a Flow-owned executor, reach `SCOPED`, approve a Change Proposal, publish revised Story and Scope versions, and require downstream rebase when selected Story content changes. |
| Lightweight POC Flow | A non-production POC performs a non-mutating Build Readiness preflight, controlled Commit, fail-closed Verify, evidence-backed Verify, and terminal Park decision without activating irrelevant Security work. |
| Synthetic extension fixture | A newly declared Stage and configuration-only Delivery Flow load and execute without a Flow executor or a Core/CLI edit; separately assigned Developer and QA actors own their checkpoints and an unauthorized actor is rejected. |
| Synthetic Discipline assets | A newly added Discipline Policy, Knowledge asset, Agent, Skill, and Stage Hook are discovered, resolved, acknowledged in a context receipt, and recorded in the audit log. |
| Core fingerprint | Adding those extension assets leaves the generic CLI, Flow Engine, and Harness context resolver byte-for-byte unchanged. |

The normal `bun run --cwd .pdlc test` command also includes this suite. Keep the dedicated E2E suite small; detailed schema errors and edge cases belong in the focused unit and integration test files.

## Stability boundary

New canonical Stages, Delivery Flow definitions, Discipline Policies, Knowledge, Agents, Skills, Hooks, and Flow-owned executors should not require framework changes. Core changes remain appropriate only when introducing a genuinely new engine primitive or changing the shared lifecycle, storage, audit, security, or extension contracts.
