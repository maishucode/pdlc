import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { AuditLog } from "../core/audit.ts";
import { PdlcError } from "../core/errors.ts";
import { acquireLock } from "../core/lock.ts";
import {
  loadPrinciplePacks,
  selectApplicablePrinciples,
  selectApplicablePrinciplesForStages,
} from "../core/principles.ts";
import { loadStandardProfiles, resolveStandardDefaultsForStages } from "../core/defaults.ts";
import { JourneyRegistry } from "../core/journey-registry.ts";
import { assessPocBuildReadiness, hashRequirementsDocument } from "../core/readiness.ts";
import { loadRequirementsPolicy } from "../core/requirements.ts";
import { FileStateStore } from "../core/state.ts";
import { StageRegistry } from "../core/stage-registry.ts";
import type { PocDeliveryRecord, StandardProfile } from "../core/types.ts";
import { WorkflowRegistry } from "../core/workflow-registry.ts";
import { validateCorePortability } from "../harnesses/validate-portability.ts";
import { DECLARED_CAPABILITIES } from "../harnesses/capabilities.ts";

const projectRoot = resolve(import.meta.dirname, "../..");

async function exampleRecord(): Promise<PocDeliveryRecord> {
  return JSON.parse(await readFile(join(projectRoot, "pdlc/examples/poc-delivery-record.json"), "utf8")) as PocDeliveryRecord;
}

async function temporaryWorkspace(): Promise<{ path: string; cleanup(): Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), "lean-pdlc-test-"));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}

test("loads the POC workflow through the registry", async () => {
  const registry = await WorkflowRegistry.load(join(projectRoot, "pdlc/workflows"));
  const workflow = registry.get("poc");
  assert.equal(workflow.initialStatus, "DRAFT");
  assert.equal(workflow.journeyId, "poc");
  assert.deepEqual(workflow.checkpoints.map((checkpoint) => checkpoint.id), ["commit", "verify", "decide"]);
  assert.deepEqual(workflow.deliveryDefaults, {
    roleAssignmentMode: "approval-actor-all-roles",
    timebox: "1 working day",
    collectDuringRequirements: false,
  });
});

test("loads 30 canonical Stages and resolves conditional User Journey composition", async () => {
  const stages = await StageRegistry.load(join(projectRoot, "pdlc/stages/catalog.json"));
  const journeys = await JourneyRegistry.load(join(projectRoot, "pdlc/journeys"), stages);
  assert.equal(stages.list().length, 30);
  assert.equal(journeys.get("pdlc").stageSequence.length, 30);
  assert.equal(journeys.resolve("poc").some((stage) => stage.definition.id === "ux-design"), false);
  assert.equal(
    journeys.resolve("poc", ["technology:web-ui"]).some((stage) => stage.definition.id === "ux-design"),
    true,
  );
  assert.equal(
    journeys.resolve("poc", ["risk:sensitive-data"]).some((stage) => stage.definition.id === "security-verification"),
    true,
  );
});

test("declares the Copilot capabilities needed for a complete Phase 1 POC", () => {
  assert.deepEqual([...DECLARED_CAPABILITIES["github-copilot"]].sort(), [
    "cloud-environment-setup",
    "command-approval",
    "custom-agent",
    "prompt-file",
    "repository-instructions",
    "shared-skill",
  ]);
});

test("selects and escalates risk-based Principle Packs", async () => {
  const packs = await loadPrinciplePacks(join(projectRoot, "pdlc/principles"));
  const baseline = selectApplicablePrinciples(packs, { workflow: "poc", stage: "principle-applicability" });
  assert.deepEqual(baseline.map((item) => [item.pack.id, item.effectiveEnforcement]), [
    ["security", "advisory"],
    ["solution-architecture", "advisory"],
  ]);

  const elevated = selectApplicablePrinciples(packs, {
    workflow: "poc",
    stage: "principle-applicability",
    riskTriggers: ["sensitive-data"],
  });
  assert.equal(elevated.find((item) => item.pack.id === "security")?.effectiveEnforcement, "required");

  const frontend = selectApplicablePrinciples(packs, {
    workflow: "poc",
    stage: "principle-applicability",
    technologies: ["web-ui", "react"],
  });
  assert.equal(frontend.find((item) => item.pack.id === "ux")?.effectiveEnforcement, "required");
});

test("derives a reverse Principle mapping across the active Stage set", async () => {
  const packs = await loadPrinciplePacks(join(projectRoot, "pdlc/principles"));
  const selected = selectApplicablePrinciplesForStages(packs, {
    workflow: "poc",
    stages: ["requirements-analysis", "ux-design", "security-verification"],
    riskTriggers: ["sensitive-data"],
    technologies: ["web-ui"],
  });
  assert.deepEqual(
    selected.map((item) => [item.pack.id, item.effectiveEnforcement, item.matchedStages]),
    [
      ["security", "required", ["security-verification"]],
      ["solution-architecture", "advisory", ["requirements-analysis"]],
      ["ux", "required", ["ux-design"]],
    ],
  );
});

test("resolves enterprise, project, and Harness standards without replacing product decisions", async () => {
  const packs = await loadPrinciplePacks(join(projectRoot, "pdlc/principles"));
  const profiles = [
    ...await loadStandardProfiles(join(projectRoot, "pdlc/defaults/harness"), "harness"),
    ...await loadStandardProfiles(join(projectRoot, "pdlc/tests/fixtures"), "project"),
  ];
  const result = resolveStandardDefaultsForStages(packs, profiles, {
    workflow: "poc",
    stages: ["principle-applicability", "solution-design", "test-strategy", "build-readiness"],
    technologies: ["web-ui", "react"],
  });

  assert.deepEqual(result.issues, []);
  assert.equal(result.defaults.find((item) => item.key === "ux.visual-foundation")?.locked, true);
  assert.equal(result.defaults.find((item) => item.key === "quality.browser-baseline")?.sourceLayer, "harness");
  assert.equal(result.defaults.find((item) => item.key === "engineering.web-stack")?.sourceLayer, "project");
  assert(!result.defaults.some((item) => item.topic === "functionalBehavior"));
  assert(!result.defaults.some((item) => item.topic === "productContext"));
  assert(!result.defaults.some((item) => item.topic === "scopeSuccess"));
});

test("lets project defaults replace Harness defaults but blocks enterprise constraints", async () => {
  const packs = await loadPrinciplePacks(join(projectRoot, "pdlc/principles"));
  const [harness] = await loadStandardProfiles(join(projectRoot, "pdlc/defaults/harness"), "harness");
  const projectOverride: StandardProfile = {
    ...structuredClone(harness),
    id: "project-overrides",
    layer: "project",
    defaults: [
      {
        ...structuredClone(harness.defaults[0]),
        statement: "Verify Firefox and Chrome at project-approved viewports.",
      },
      {
        key: "ux.visual-foundation",
        title: "Attempted palette replacement",
        topic: "uxInteraction",
        statement: "Use a red palette instead.",
        rationale: "Project preference.",
        principleRefs: ["ux@1.0.0#ux-blue-foundation"],
      },
    ],
  };
  const result = resolveStandardDefaultsForStages(packs, [harness, projectOverride], {
    workflow: "poc",
    stages: ["principle-applicability", "solution-design", "test-strategy", "build-readiness"],
    technologies: ["web-ui"],
  });

  assert.equal(
    result.defaults.find((item) => item.key === "quality.browser-baseline")?.sourceRef,
    "project:project-overrides@1.0.0",
  );
  assert(result.issues.some((issue) => issue.code === "STANDARD_CONSTRAINT_OVERRIDE"));
  assert.equal(
    result.defaults.find((item) => item.key === "ux.visual-foundation")?.sourceLayer,
    "enterprise",
  );
});

test("blocks build until requirements and selected principles are approved and traced", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const record = await exampleRecord();
  record.requirements.documentRef = "requirements.md";
  record.requirements.depth = "standard";
  record.design.summary = "A reversible browser-only experiment.";
  record.design.decisions = ["Use a local web UI with no production integration."];
  record.design.technologies = ["web-ui", "react"];
  const packs = await loadPrinciplePacks(join(projectRoot, "pdlc/principles"));
  const policy = await loadRequirementsPolicy(join(projectRoot, "pdlc/workflows/poc/requirements-policy.json"));

  const blocked = await assessPocBuildReadiness(record, workspace.path, packs, policy);
  assert.equal(blocked.ok, false);
  assert(blocked.issues.some((entry) => entry.code === "REQUIREMENTS_NOT_APPROVED"));

  record.requirements.status = "approved";
  record.requirements.approvedBy = "product-owner";
  record.requirements.approvedAt = "2026-08-28T01:00:00.000Z";
  record.principles.applicable = ["security@1.0.0", "solution-architecture@1.0.0", "ux@1.0.0"];
  record.principles.applications = record.principles.applicable.map((pack) => ({
    pack,
    disposition: "adopted",
    notes: `Apply ${pack} during design and verification.`,
  }));
  record.requirements.clarification = {
    questionsAnswered: 8,
    coverage: {
      productContext: "complete",
      functionalBehavior: "complete",
      userScenarios: "complete",
      uxInteraction: "complete",
      qualityAttributes: "complete",
      dataIntegrations: "complete",
      scopeSuccess: "complete",
    },
    openQuestions: [],
    contradictions: [],
  };
  await writeFile(
    join(workspace.path, "requirements.md"),
    await readFile(join(projectRoot, "pdlc/tests/fixtures/ready-requirements.md"), "utf8"),
  );
  record.requirements.approvedContentHash = await hashRequirementsDocument(workspace.path, record.requirements.documentRef);

  const profiles = await loadStandardProfiles(join(projectRoot, "pdlc/defaults/harness"), "harness");
  const standards = resolveStandardDefaultsForStages(packs, profiles, {
    workflow: "poc",
    stages: ["principle-applicability", "solution-design", "test-strategy", "build-readiness"],
    riskTriggers: record.risk.triggers,
    technologies: record.design.technologies,
    domains: record.design.domains,
  });
  assert.deepEqual(standards.issues, []);

  const ready = await assessPocBuildReadiness(record, workspace.path, packs, policy, standards.defaults);
  assert.deepEqual(ready.issues, []);
  assert.equal(ready.ok, true);

  const completeDocument = await readFile(join(workspace.path, "requirements.md"), "utf8");
  const withoutStandards = completeDocument.replace(
    /<!-- pdlc:section:standard-defaults -->[\s\S]*?(?=<!-- pdlc:section:lightweight-design -->)/,
    "",
  );
  await writeFile(join(workspace.path, "requirements.md"), withoutStandards);
  record.requirements.approvedContentHash = await hashRequirementsDocument(workspace.path, record.requirements.documentRef);
  const untraced = await assessPocBuildReadiness(record, workspace.path, packs, policy, standards.defaults);
  assert(untraced.issues.some((entry) => entry.code === "STANDARD_DEFAULT_NOT_TRACED"));

  await writeFile(join(workspace.path, "requirements.md"), completeDocument);
  record.requirements.approvedContentHash = await hashRequirementsDocument(workspace.path, record.requirements.documentRef);

  await writeFile(join(workspace.path, "requirements.md"), "changed after approval");
  const changed = await assessPocBuildReadiness(record, workspace.path, packs, policy);
  assert(changed.issues.some((entry) => entry.code === "REQUIREMENTS_CHANGED_AFTER_APPROVAL"));
});

test("blocks incomplete clarification, unresolved ambiguity, and missing final review", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const record = await exampleRecord();
  record.requirements.documentRef = "requirements.md";
  record.requirements.depth = "standard";
  record.requirements.status = "approved";
  record.requirements.approvedBy = "product-owner";
  record.requirements.approvedAt = "2026-08-28T01:00:00.000Z";
  record.requirements.clarification = {
    questionsAnswered: 7,
    coverage: {
      productContext: "complete",
      functionalBehavior: "complete",
      userScenarios: "complete",
      uxInteraction: "pending",
      qualityAttributes: "complete",
      dataIntegrations: "complete",
      scopeSuccess: "complete",
    },
    openQuestions: ["Confirm the destructive-action interaction."],
    contradictions: ["Deletion is described as both immediate and confirmed."],
  };
  record.design.summary = "A reversible browser-only experiment.";
  record.design.decisions = ["Use local browser state only."];
  record.design.technologies = ["web-ui", "react"];
  record.principles.applicable = ["security@1.0.0", "solution-architecture@1.0.0", "ux@1.0.0"];
  record.principles.applications = record.principles.applicable.map((pack) => ({ pack, disposition: "adopted", notes: `Apply ${pack}.` }));

  const incompleteDocument = (await readFile(join(projectRoot, "pdlc/tests/fixtures/ready-requirements.md"), "utf8"))
    .replace(/^\| RQ-008.*\n/m, "")
    .replace("<!-- pdlc:requirements-review:presented -->", "<!-- pdlc:requirements-review:pending -->");
  await writeFile(join(workspace.path, "requirements.md"), incompleteDocument);
  record.requirements.approvedContentHash = await hashRequirementsDocument(workspace.path, record.requirements.documentRef);

  const packs = await loadPrinciplePacks(join(projectRoot, "pdlc/principles"));
  const policy = await loadRequirementsPolicy(join(projectRoot, "pdlc/workflows/poc/requirements-policy.json"));
  const result = await assessPocBuildReadiness(record, workspace.path, packs, policy);
  const codes = new Set(result.issues.map((entry) => entry.code));
  assert(codes.has("INSUFFICIENT_CLARIFICATION"));
  assert(codes.has("REQUIREMENTS_COVERAGE_INCOMPLETE"));
  assert(codes.has("OPEN_REQUIREMENTS_QUESTIONS"));
  assert(codes.has("REQUIREMENTS_CONTRADICTIONS"));
  assert(codes.has("REQUIREMENTS_SECTION_MISSING"));
});

test("writes and reads a Delivery Record atomically", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const store = new FileStateStore(workspace.path);
  const record = await exampleRecord();

  await store.writeRecord(record);
  await store.setCurrentRecord(record.id);

  assert.deepEqual(await store.readCurrentRecord(), record);
  assert.equal(await store.currentRecordId(), record.id);
});

test("requires optimistic revision control when replacing a Delivery Record", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const store = new FileStateStore(workspace.path);
  const record = await exampleRecord();
  await store.writeRecord(record);

  const next = { ...record, revision: 1, updatedAt: new Date().toISOString() };
  await assert.rejects(
    store.writeRecord(next),
    (error: unknown) => error instanceof PdlcError && error.code === "REVISION_CONFLICT",
  );
  await store.writeRecord(next, 0);
  assert.equal((await store.readRecord(record.id)).revision, 1);
});

test("prevents concurrent ownership of the same lock", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const first = await acquireLock(workspace.path, "record-POC-EXAMPLE");
  try {
    await assert.rejects(
      acquireLock(workspace.path, "record-POC-EXAMPLE"),
      (error: unknown) => error instanceof PdlcError && error.code === "LOCK_HELD",
    );
  } finally {
    await first.release();
  }
});

test("appends and validates audit events with deterministic record hashes", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const record = await exampleRecord();
  const audit = new AuditLog(workspace.path);
  const event = audit.create(record, {
    recordId: record.id,
    eventType: "WORKFLOW_CREATED",
    actor: record.assignments.product,
    riskLevel: record.risk.level,
  });

  await audit.append(event);
  const events = await audit.readAll();
  assert.equal(events.length, 1);
  assert.equal(events[0].recordHash.length, 64);
  assert.deepEqual(events[0], event);
});

test("shared Core contains no harness-specific markers", async () => {
  const result = await validateCorePortability(join(projectRoot, "pdlc/core"));
  assert.deepEqual(result, { ok: true, issues: [] });
});
