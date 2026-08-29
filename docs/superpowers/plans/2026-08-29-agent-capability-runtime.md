# Agent Capability Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every resolved UX Agent + Skills contribution a required, native GitHub Copilot custom-agent invocation with a Runner-validated execution receipt.

**Architecture:** Extend the existing Domain Stage Hook contract instead of adding a parallel plugin framework. The Runner derives deterministic invocation contracts from resolved Hook bindings and the Stage context hash. GitHub Copilot delegates through its native `agent` tool. `context-apply` validates the returned execution metadata against the immutable Stage snapshot before recording provenance.

**Tech Stack:** TypeScript, Bun test runner, JSON Schema, GitHub Copilot custom agents and repository Skills.

---

## Task 1: Define the portable Agent capability contract

- [ ] Add failing schema and Domain guidance tests for `capability`, `invocation`, and globally duplicate active capability IDs.
- [ ] Run the focused tests and confirm they fail because the fields are unsupported.
- [ ] Extend `.pdlc/core/types.ts`, `.pdlc/core/schema.ts`, and `.pdlc/schemas/domain-stage-hooks.schema.json`; increment the changed descriptor schema version.
- [ ] Add globally unique stable capability IDs and `invocation: "required"` to `.pdlc/domains/ux/hooks/stages.json`.
- [ ] Include the fields in Domain guidance and snapshot hashing.
- [ ] Run the focused tests and commit the passing contract.

## Task 2: Produce deterministic GitHub Copilot invocation contracts

- [ ] Add failing unit and CLI tests that require `context <stage>` to emit `requiredAgentInvocations` with platform, deterministic ID, exact Agent, exact Skills, mode, handoff, and approval boundary.
- [ ] Assert the ID is stable for an unchanged snapshot and changes after a context-driving input changes.
- [ ] Run the focused test and confirm the field is missing.
- [ ] Add a small invocation-contract builder and expose its result from `.pdlc/commands/context.ts`.
- [ ] Run focused CLI tests and commit the passing context contract.

## Task 3: Gate Stage application on completed native invocation receipts

- [ ] Add failing schema and CLI tests for skipped, missing, and mismatched required invocation metadata.
- [ ] Run the focused tests and confirm they fail for the intended missing validation.
- [ ] Extend the Stage Context Receipt type, validator, JSON Schema, snapshot comparison, and test receipt helper; increment the changed receipt schema version.
- [ ] Require `disposition: "used"`, the matching capability/invocation ID, `platform: "github-copilot"`, `status: "completed"`, and a non-empty native execution reference.
- [ ] Run focused tests and commit the passing receipt gate.

## Task 4: Wire the native Copilot custom-agent delegation UX

- [ ] Add failing entrypoint validation tests for the native `agent` tool and explicit required-delegation markers.
- [ ] Run the focused test and confirm the current prompt-only entrypoint fails.
- [ ] Update `.github/agents/lean-pdlc.agent.md`, `.agents/skills/lean-pdlc/SKILL.md`, and the UX Agent source.
- [ ] Make the UX Agent programmatically callable, keep the user in the main conversation, and specify the structured completion envelope.
- [ ] Project the canonical UX Agent into `.github/agents/` so Copilot discovers it before the session starts.
- [ ] Update adapter marker validation and relevant documentation.
- [ ] Run focused adapter tests and commit the passing platform wiring.

## Task 5: Verify the vertical slice

- [ ] Run all `.pdlc` tests.
- [ ] Run Harness validation.
- [ ] Run a clean UX context/apply smoke test with a completed invocation receipt.
- [ ] Stage an isolated existing-project workspace and run the narrow prompt through `/Users/baizijun/.codex/skills/copilot-agent-iteration/scripts/run_copilot_prompt.py` with the `lean-pdlc` Agent.
- [ ] Inspect the saved transcript for a native subagent call to `lean-pdlc-ux`, the exact context-generated invocation ID, a structured completion envelope containing evidence references, and successful `context-apply` driven by that result.
- [ ] Treat any prompt-only or manually fabricated receipt path as a failed end-to-end test and iterate before completion.
- [ ] Inspect the branch diff and ensure no user worktree changes are included.
- [ ] Record residual limitations: native event attestation remains owned by GitHub Copilot; the Runner validates the context-bound receipt.
