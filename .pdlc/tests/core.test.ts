import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { AuditLog } from "../core/audit.ts";
import { buildPocAuditSummary } from "../core/audit-summary.ts";
import { DeliveryFlowRegistry } from "../core/delivery-flow-registry.ts";
import { assessContractChange, assessDeliveryContract } from "../delivery-flows/product-requirements-analysis/delivery-contract.ts";
import { DisciplineRegistry } from "../core/discipline-registry.ts";
import { resolveDisciplineContext } from "../core/discipline-resolver.ts";
import { PdlcError } from "../core/errors.ts";
import { FlowEngine } from "../core/flow-engine.ts";
import { HarnessContext } from "../core/harness-context.ts";
import { IntegrationRegistry } from "../core/integration-registry.ts";
import { sha256 } from "../core/hash.ts";
import { acquireLock } from "../core/lock.ts";
import { ProjectOverlay } from "../core/project-overlay.ts";
import { currentPocStage, POC_SECURITY_RISK_TRIGGERS } from "../core/poc-progress.ts";
import { RoleRegistry } from "../core/role-registry.ts";
import { assessPocBuildReadiness, hashRequirementsDocument } from "../core/readiness.ts";
import { loadRequirementsFlowControl } from "../core/requirements.ts";
import { FileStateStore } from "../core/state.ts";
import { StageRegistry } from "../core/stage-registry.ts";
import { migrateLegacyStorage } from "../core/storage-migration.ts";
import type { PocDeliveryRecord } from "../core/types.ts";
import type { RequirementsAnalysisRecord } from "../delivery-flows/product-requirements-analysis/types.ts";
import { DECLARED_CAPABILITIES } from "../platform-adapters/capabilities.ts";
import { validateCorePortability } from "../platform-adapters/validate-portability.ts";

const projectRoot = resolve(import.meta.dirname, "../..");

async function exampleRecord(): Promise<PocDeliveryRecord> {
  return JSON.parse(await readFile(join(projectRoot, ".pdlc/examples/poc-delivery-record.json"), "utf8")) as PocDeliveryRecord;
}

async function requirementsRecord(): Promise<RequirementsAnalysisRecord> {
  return JSON.parse(await readFile(join(projectRoot, ".pdlc/examples/requirements-analysis-record.json"), "utf8")) as RequirementsAnalysisRecord;
}

async function temporaryWorkspace(): Promise<{ path: string; cleanup(): Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), "atlas-pdlc-test-"));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}

async function model(project = projectRoot) {
  const roles = await RoleRegistry.load(join(projectRoot, ".pdlc/roles/catalog.json"));
  const stages = await StageRegistry.load(join(projectRoot, ".pdlc/stages/catalog.json"), roles);
  const flows = await DeliveryFlowRegistry.load(join(projectRoot, ".pdlc/delivery-flows/catalog.json"), stages);
  const disciplines = await DisciplineRegistry.load(join(projectRoot, ".pdlc/disciplines"));
  const integrations = await IntegrationRegistry.load(join(projectRoot, ".pdlc/integrations/catalog.json"));
  const overlay = await ProjectOverlay.load(project, new Set(disciplines.list().map(({ manifest }) => manifest.id)));
  return { roles, stages, flows, disciplines, integrations, overlay };
}

test("loads registered Roles and derives Delivery Flow accountability dynamically", async () => {
  const { roles, flows } = await model();
  assert.deepEqual(roles.list().map(({ id }) => id), ["developer", "product", "qa"]);
  assert.deepEqual(flows.requiredRoles("poc", ["technology:web-ui"]), ["developer", "product", "qa"]);
});

test("builds a readable audit summary for only the selected record", async () => {
  const record = await exampleRecord();
  const audit = new AuditLog(projectRoot);
  const selected = audit.create(record, {
    recordId: record.id,
    eventType: "DELIVERY_FLOW_CREATED",
    actor: "product-owner",
    riskLevel: record.risk.level,
  });
  const unrelated = audit.create(record, {
    recordId: "POC-OTHER",
    eventType: "DELIVERY_FLOW_CREATED",
    actor: "other-owner",
    riskLevel: record.risk.level,
  });
  const summary = buildPocAuditSummary(record, [unrelated, selected]);
  assert.equal(summary.audit.eventCount, 1);
  assert.equal(summary.timeline[0]?.summary, "Delivery Flow record created");
  assert.equal(summary.timeline[0]?.actor, "product-owner");
  assert.deepEqual(summary.audit.warnings, []);
});

test("adds a new Role through catalogs without changing Core code", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const rolesRoot = join(workspace.path, "roles");
  const flowsRoot = join(workspace.path, "flows");
  await mkdir(join(flowsRoot, "architecture-review"), { recursive: true });
  await mkdir(rolesRoot, { recursive: true });
  await writeFile(join(rolesRoot, "architect.md"), "# Architect role\n\nOwn the architecture decision.\n");
  await writeFile(join(rolesRoot, "catalog.json"), JSON.stringify({ schemaVersion: 1, owner: "pdlc-governance", roles: [{ id: "architect", name: "Architect", definition: "architect.md" }] }));
  await writeFile(join(workspace.path, "stages.json"), JSON.stringify({ schemaVersion: 2, catalogVersion: "2.0.0", owner: "pdlc-governance", stages: [{ id: "architecture-review", name: "Architecture review", description: "Review the material architecture decision.", phase: "design", roleSlots: ["architect"], requirements: ["Record the decision."], outputs: ["architecture-decision"] }] }));
  await writeFile(join(flowsRoot, "catalog.json"), JSON.stringify({ schemaVersion: 1, owner: "pdlc-governance", flows: [{ id: "architecture-review", definition: "architecture-review/flow.json" }] }));
  await writeFile(join(flowsRoot, "architecture-review/flow.json"), JSON.stringify({ schemaVersion: 2, id: "architecture-review", name: "Architecture Review", description: "A minimal Role extensibility test.", status: "active", stageSequence: [{ stageId: "architecture-review", inclusion: "required" }], controls: { initialStatus: "DRAFT", terminalStatuses: ["COMMITTED"], checkpoints: [{ id: "commit", from: ["DRAFT"], to: "COMMITTED", ownerRole: "architect" }], deliveryDefaults: { roleAssignmentMode: "approval-actor-all-roles", timebox: "1 working day", collectDuringRequirements: false }, constraints: { productionUse: false, externalIntegrations: [], allowSinglePersonAllRoles: true } } }));

  const roles = await RoleRegistry.load(join(rolesRoot, "catalog.json"));
  const stages = await StageRegistry.load(join(workspace.path, "stages.json"), roles);
  const flows = await DeliveryFlowRegistry.load(join(flowsRoot, "catalog.json"), stages);
  assert.deepEqual(flows.requiredRoles("architecture-review"), ["architect"]);
});

test("loads only explicitly cataloged Delivery Flows and resolves conditional Stages", async () => {
  const { stages, flows } = await model();
  assert.deepEqual(flows.catalog.flows.map(({ id }) => id), ["poc", "product-requirements-analysis", "implementation", "pdlc"]);
  assert.equal(stages.list().length, 29);
  assert.equal(flows.get("pdlc").stageSequence.length, 29);
  assert.equal(flows.get("poc").stageSequence.length, 10);
  assert.equal(flows.getExecutable("poc").controls.deliveryDefaults.requirementsProfile, "standard");
  assert.deepEqual(flows.getExecutable("poc").controls.checkpoints.find(({ id }) => id === "commit")?.from, ["DRAFT", "COMMITTED"]);
  assert.deepEqual(flows.getExecutable("poc").controls.terminalStatuses, ["PARKED", "PRODUCTIZATION_RECOMMENDED"]);
  assert.deepEqual(flows.getExecutable("poc").controls.checkpoints.find(({ id }) => id === "decide")?.toByOutcome, {
    park: "PARKED",
    "recommend-productization": "PRODUCTIZATION_RECOMMENDED",
  });
  assert.deepEqual(
    flows.getExecutable("poc").stageSequence.find(({ stageId }) => stageId === "security-verification")?.activationTags,
    POC_SECURITY_RISK_TRIGGERS.map((trigger) => `risk:${trigger}`),
  );
  assert(!stages.has("principle-applicability"));
  assert.throws(() => flows.getExecutable("pdlc"), (error: unknown) => error instanceof PdlcError && error.code === "DELIVERY_FLOW_NOT_EXECUTABLE");
  assert.equal(flows.resolve("poc").some(({ definition }) => definition.id === "ux-design"), false);
  assert.equal(flows.resolve("poc", ["technology:web-ui"]).some(({ definition }) => definition.id === "ux-design"), true);
  assert.equal(flows.resolve("poc", ["risk:sensitive-data"]).some(({ definition }) => definition.id === "security-verification"), true);
});

test("navigates every material POC Stage from recorded progress", async () => {
  const record = await exampleRecord();
  const apply = (stage: string): void => {
    record.resolution.contextApplications.push({
      schemaVersion: 2,
      stage,
      contextHash: "a".repeat(64),
      policies: [],
      knowledge: [],
      disciplineContributions: [],
      integrations: [],
      actor: "pdlc-agent",
      appliedAt: "2026-08-30T00:00:00.000Z",
    });
  };
  assert.equal(currentPocStage(record), "requirements-clarification");
  Object.keys(record.requirements.clarification.coverage).forEach((topic) => {
    record.requirements.clarification.coverage[topic as keyof typeof record.requirements.clarification.coverage] = "complete";
  });
  record.requirements.clarification.openQuestions = [];
  assert.equal(currentPocStage(record), "solution-design");
  record.design.summary = "A reversible browser experiment.";
  record.design.technologies = ["web-ui"];
  assert.equal(currentPocStage(record), "ux-design");
  apply("ux-design");
  assert.equal(currentPocStage(record), "build-readiness");
  apply("build-readiness");
  assert.equal(currentPocStage(record), "requirements-approval");

  record.status = "COMMITTED";
  assert.equal(currentPocStage(record), "implementation");
  record.evidence.build = [{ kind: "file", ref: "pdlc/evidence/build.txt", description: "Build evidence." }];
  apply("implementation");
  assert.equal(currentPocStage(record), "developer-verification");
  record.evidence.tests = [{ kind: "file", ref: "pdlc/evidence/tests.txt", description: "Test evidence." }];
  apply("developer-verification");
  record.risk.triggers = ["sensitive-data"];
  assert.equal(currentPocStage(record), "security-verification");
  record.evidence.security = [{ kind: "file", ref: "pdlc/evidence/security.txt", description: "Security evidence." }];
  apply("security-verification");
  assert.equal(currentPocStage(record), "acceptance-verification");
});

test("loads Discipline-owned Artifacts, Policies, Knowledge, Skills, Agents, and Hooks", async () => {
  const { disciplines, integrations } = await model();
  assert.deepEqual(disciplines.list().map(({ manifest }) => manifest.id), ["data-platform", "product-management", "security", "solution-architecture", "ux"]);
  assert.equal(disciplines.artifact("product-management.requirements").definition.ownerDiscipline, "product-management");
  assert.equal(disciplines.artifact("product-management.productization-package").definition.ownerDiscipline, "product-management");
  assert.equal(disciplines.get("ux").policies.length, 1);
  assert.equal(disciplines.get("ux").skills.length, 3);
  assert.equal(disciplines.get("ux").agents[0]?.id, "atlas-pdlc-ux");
  assert.equal(disciplines.get("ux").hooks.length, 1);
  assert.equal(disciplines.get("data-platform").knowledge[0]?.asset.kind, "kb");
  assert.equal(integrations.get("databricks").manifest.kind, "integration");
});

test("resolves mandatory Controls separately from guidance and defaults", async () => {
  const { flows, disciplines, integrations, overlay } = await model();
  const stages = flows.resolve("poc", ["technology:web-ui", "risk:sensitive-data"]).map(({ definition }) => definition.id);
  const result = resolveDisciplineContext(disciplines, integrations, overlay, {
    deliveryFlow: "poc",
    stages,
    riskTriggers: ["sensitive-data"],
    technologies: ["web-ui", "react"],
  });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.controls.map(({ ref }) => ref), [
    "product-management.requirements-quality@1.0.0",
    "security.credential-boundary@1.0.0",
    "security.sensitive-data@1.0.0",
    "solution-architecture.reversible-delivery@1.0.0",
    "ux.experience-quality@1.0.0",
  ]);
  assert.equal(result.defaults.find(({ key }) => key === "ux.visual-foundation")?.locked, true);
  assert.equal(result.defaults.find(({ key }) => key === "quality.browser-baseline")?.sourceRef, "ux.poc-web-ui-defaults@1.0.0");
  assert(result.knowledge.some(({ ref }) => ref === "ux.experience-design@1.0.0"));
  assert.deepEqual(result.integrations, []);
});

test("resolves every active POC Stage independently", async () => {
  const { flows, disciplines, integrations, overlay } = await model();
  const stages = flows.resolve("poc", ["technology:web-ui"]).map(({ definition }) => definition.id);
  for (const stage of stages) {
    const result = resolveDisciplineContext(disciplines, integrations, overlay, {
      deliveryFlow: "poc",
      stages: [stage],
      technologies: ["web-ui", "react"],
      disciplines: ["ux"],
    });
    assert.deepEqual(result.issues, [], `${stage}: ${JSON.stringify(result.issues)}`);
  }
});

test("resolves Databricks Knowledge and Integration as separate assets", async () => {
  const { disciplines, integrations, overlay } = await model();
  const result = resolveDisciplineContext(disciplines, integrations, overlay, {
    deliveryFlow: "implementation",
    stages: ["data-integration-boundaries", "solution-design", "implementation"],
    technologies: ["databricks"],
  });
  assert(result.knowledge.some(({ ref, asset }) => ref === "data-platform.databricks-connectivity@1.0.0" && asset.kind === "kb"));
  assert(result.integrations.some(({ ref }) => ref === "databricks@1.0.0"));
  const poc = resolveDisciplineContext(disciplines, integrations, overlay, {
    deliveryFlow: "poc",
    stages: ["data-integration-boundaries", "implementation"],
    technologies: ["databricks"],
  });
  assert.deepEqual(poc.integrations, []);
});

test("lets project defaults override Discipline defaults but not locked Controls", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const defaultsRoot = join(workspace.path, "pdlc/disciplines/ux/defaults");
  await mkdir(defaultsRoot, { recursive: true });
  await writeFile(join(defaultsRoot, "override.json"), JSON.stringify({
    schemaVersion: 1,
    id: "ux-project-overrides",
    discipline: "ux",
    version: "1.0.0",
    appliesTo: { deliveryFlows: ["poc"], stages: ["ux-design", "build-readiness"], technologies: ["web-ui"] },
    defaults: [
      { key: "quality.browser-baseline", title: "Project browsers", topic: "qualityAttributes", statement: "Verify Chrome and Firefox at project-approved viewports.", rationale: "Approved project choice.", controlRefs: ["ux.experience-quality@1.0.0#responsive-baseline"] },
      { key: "ux.visual-foundation", title: "Attempted palette override", topic: "uxInteraction", statement: "Use a red palette.", rationale: "Project preference.", controlRefs: ["ux.experience-quality@1.0.0#approved-visual-foundation"] },
    ],
  }, null, 2));
  const { disciplines, integrations } = await model();
  const overlay = await ProjectOverlay.load(workspace.path, new Set(disciplines.list().map(({ manifest }) => manifest.id)));
  const result = resolveDisciplineContext(disciplines, integrations, overlay, { deliveryFlow: "poc", stages: ["ux-design", "build-readiness"], technologies: ["web-ui"] });
  assert.equal(result.defaults.find(({ key }) => key === "quality.browser-baseline")?.sourceLayer, "project");
  assert.equal(result.defaults.find(({ key }) => key === "ux.visual-foundation")?.sourceLayer, "discipline");
  assert(result.issues.some(({ code }) => code === "CONTROL_CONSTRAINT_OVERRIDE"));
});

test("resolves only applicable project Knowledge from its owning Discipline", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const knowledgeRoot = join(workspace.path, "pdlc/disciplines/solution-architecture/knowledge/guidance");
  await mkdir(knowledgeRoot, { recursive: true });
  await writeFile(join(knowledgeRoot, "system-context.json"), JSON.stringify({
    schemaVersion: 1,
    id: "solution-architecture.project-system-context",
    title: "Project system context",
    description: "Project-local architecture guidance.",
    ownerDiscipline: "solution-architecture",
    version: "1.0.0",
    kind: "guidance",
    appliesTo: { deliveryFlows: ["poc"], stages: ["solution-design"] },
    contentRef: "system-context.md",
  }, null, 2));
  await writeFile(join(knowledgeRoot, "system-context.md"), "# System context\n\nUse the approved project boundary.\n");

  const { disciplines, integrations } = await model();
  const overlay = await ProjectOverlay.load(workspace.path, new Set(disciplines.list().map(({ manifest }) => manifest.id)));
  const design = resolveDisciplineContext(disciplines, integrations, overlay, { deliveryFlow: "poc", stages: ["solution-design"] });
  const requirements = resolveDisciplineContext(disciplines, integrations, overlay, { deliveryFlow: "poc", stages: ["requirements-clarification"] });

  assert(design.knowledge.some(({ ref, source }) => ref === "project:solution-architecture.project-system-context@1.0.0" && source === "project"));
  assert(!requirements.knowledge.some(({ ref }) => ref === "project:solution-architecture.project-system-context@1.0.0"));

  const harness = await HarnessContext.load(projectRoot, workspace.path);
  const designSnapshot = await harness.resolveStage("solution-design");
  const requirementsSnapshot = await harness.resolveStage("requirements-clarification");
  assert(designSnapshot.snapshot.knowledge.some(({ ref }) => ref === "project:solution-architecture.project-system-context@1.0.0"));
  assert(!requirementsSnapshot.snapshot.knowledge.some(({ ref }) => ref === "project:solution-architecture.project-system-context@1.0.0"));
});

test("rejects unowned or unstructured project Knowledge", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const knowledgeRoot = join(workspace.path, "pdlc/disciplines/solution-architecture/knowledge");
  await mkdir(knowledgeRoot, { recursive: true });
  await writeFile(join(knowledgeRoot, "loose-note.md"), "# Unscoped note\n");
  const { disciplines } = await model();
  await assert.rejects(
    ProjectOverlay.load(workspace.path, new Set(disciplines.list().map(({ manifest }) => manifest.id))),
    (error: unknown) => error instanceof PdlcError && error.code === "VALIDATION_FAILED" && error.message.includes("unsupported entries"),
  );
});

test("fails closed when the legacy project Overlay path is still present", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  await mkdir(join(workspace.path, "pdlc/config/disciplines/solution-architecture"), { recursive: true });
  const { disciplines } = await model();
  await assert.rejects(
    ProjectOverlay.load(workspace.path, new Set(disciplines.list().map(({ manifest }) => manifest.id))),
    (error: unknown) => error instanceof PdlcError && error.code === "LEGACY_PROJECT_OVERLAY_PATH" && error.message.includes("pdlc/disciplines"),
  );
});

test("rejects the obsolete project controls folder", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  await mkdir(join(workspace.path, "pdlc/disciplines/ux/controls"), { recursive: true });
  const { disciplines } = await model();
  await assert.rejects(
    ProjectOverlay.load(workspace.path, new Set(disciplines.list().map(({ manifest }) => manifest.id))),
    (error: unknown) => error instanceof PdlcError && error.code === "VALIDATION_FAILED" && error.message.includes("Rename it to policies/"),
  );
});

test("blocks build until the Requirements Artifact and mandatory Controls are approved and traced", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const record = await exampleRecord();
  record.requirements.documentRef = "requirements.md";
  record.requirements.profile = "standard";
  record.design.summary = "A reversible browser-only experiment.";
  record.design.decisions = ["Use local browser state only."];
  record.design.technologies = ["web-ui", "react"];
  record.risk.triggers = ["sensitive-data"];
  const { flows, disciplines, integrations } = await model();
  const overlay = await ProjectOverlay.load(workspace.path, new Set(disciplines.list().map(({ manifest }) => manifest.id)));
  const activeStages = flows.resolve("poc", ["technology:web-ui", "risk:sensitive-data"]).map(({ definition }) => definition.id);
  const resolved = resolveDisciplineContext(disciplines, integrations, overlay, { deliveryFlow: "poc", stages: activeStages, riskTriggers: record.risk.triggers, technologies: record.design.technologies });
  const policy = await loadRequirementsFlowControl(join(projectRoot, ".pdlc/delivery-flows/poc/controls/requirements.json"));

  const blocked = await assessPocBuildReadiness(record, workspace.path, resolved.controls, policy, resolved.defaults, flows.requiredRoles("poc", ["technology:web-ui", "risk:sensitive-data"]));
  assert(blocked.issues.some(({ code }) => code === "REQUIREMENTS_NOT_APPROVED"));

  record.requirements.status = "approved";
  record.requirements.approvedBy = "product-owner";
  record.requirements.approvedAt = "2026-08-28T01:00:00.000Z";
  record.requirements.clarification = { questionsAnswered: 8, coverage: { productContext: "complete", functionalBehavior: "complete", userScenarios: "complete", uxInteraction: "complete", qualityAttributes: "complete", dataIntegrations: "complete", scopeSuccess: "complete" }, openQuestions: [], contradictions: [] };
  record.resolution.controls.applicable = resolved.controls.map(({ ref }) => ref);
  record.resolution.controls.applications = record.resolution.controls.applicable.map((control) => ({
    control,
    disposition: "satisfied",
    notes: `Apply ${control}.`,
    evidenceRefs: [record.requirements.documentRef],
    approvedBy: "product-owner",
  }));
  await writeFile(join(workspace.path, "requirements.md"), await readFile(join(projectRoot, ".pdlc/tests/fixtures/ready-requirements.md"), "utf8"));
  record.requirements.approvedContentHash = await hashRequirementsDocument(workspace.path, record.requirements.documentRef);
  const ready = await assessPocBuildReadiness(record, workspace.path, resolved.controls, policy, resolved.defaults, flows.requiredRoles("poc", ["technology:web-ui", "risk:sensitive-data"]));
  assert.deepEqual(ready.issues, []);
  assert.equal(ready.ok, true);

  await writeFile(join(workspace.path, "requirements.md"), "changed after approval");
  const changed = await assessPocBuildReadiness(record, workspace.path, resolved.controls, policy, resolved.defaults, flows.requiredRoles("poc", ["technology:web-ui", "risk:sensitive-data"]));
  assert(changed.issues.some(({ code }) => code === "REQUIREMENTS_CHANGED_AFTER_APPROVAL"));
});

test("declares the Copilot capabilities needed by the portable Harness", () => {
  assert.deepEqual([...DECLARED_CAPABILITIES["github-copilot"]].sort(), ["cloud-environment-setup", "command-approval", "custom-agent", "native-subagent", "prompt-file", "repository-instructions", "shared-skill"]);
});

test("writes and reads a Delivery Record atomically with optimistic revision control", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const store = new FileStateStore(workspace.path);
  const record = await exampleRecord();
  assert.equal(store.recordPath(record.id), join(workspace.path, "pdlc/records/POC-EXAMPLE.json"));
  await store.writeRecord(record);
  await store.setCurrentRecord(record.id);
  assert.equal((await readFile(join(workspace.path, "pdlc/.state/current"), "utf8")).trim(), record.id);
  assert.deepEqual(await store.readCurrentRecord(), record);
  const next = { ...record, revision: 1, updatedAt: new Date().toISOString() };
  await assert.rejects(store.writeRecord(next), (error: unknown) => error instanceof PdlcError && error.code === "REVISION_CONFLICT");
  await store.writeRecord(next, 0);
  assert.equal((await store.readRecord(record.id)).revision, 1);
});

test("prevents concurrent ownership of the same lock", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const first = await acquireLock(workspace.path, "record-POC-EXAMPLE");
  assert.equal(first.path, join(workspace.path, "pdlc/.state/locks/record-POC-EXAMPLE.lock"));
  try { await assert.rejects(acquireLock(workspace.path, "record-POC-EXAMPLE"), (error: unknown) => error instanceof PdlcError && error.code === "LOCK_HELD"); }
  finally { await first.release(); }
});

test("appends auditable events with deterministic record hashes", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const record = await exampleRecord();
  const audit = new AuditLog(workspace.path);
  assert.equal(audit.pathFor(record.id), join(workspace.path, "pdlc/audit/POC-EXAMPLE.jsonl"));
  const event = audit.create(record, { recordId: record.id, eventType: "DELIVERY_FLOW_CREATED", actor: record.assignments.product, riskLevel: record.risk.level });
  await audit.append(event);
  assert.equal((await audit.readAll())[0]?.recordHash.length, 64);
});

test("migrates legacy Harness runtime into project-owned per-record storage", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const record = await exampleRecord();
  const event = new AuditLog(workspace.path).create(record, { recordId: record.id, eventType: "DELIVERY_FLOW_CREATED", actor: "owner", riskLevel: "low" });
  const legacyRecord = structuredClone(record) as unknown as Record<string, unknown>;
  legacyRecord.schemaVersion = 2;
  delete legacyRecord.source;
  const legacy = join(workspace.path, ".pdlc/runtime");
  await mkdir(join(legacy, "records"), { recursive: true });
  await mkdir(join(legacy, "audit"), { recursive: true });
  await writeFile(join(legacy, "records", `${record.id}.json`), JSON.stringify(legacyRecord));
  await writeFile(join(legacy, "current"), `${record.id}\n`);
  await writeFile(join(legacy, "audit/events.jsonl"), `${JSON.stringify(event)}\n`);
  const migrated = await migrateLegacyStorage(workspace.path);
  assert.equal(migrated.migrated, true);
  assert.deepEqual(migrated.records, [record.id]);
  const upgraded = await new FileStateStore(workspace.path).readRecord(record.id);
  assert.equal(upgraded.id, record.id);
  assert.equal(upgraded.schemaVersion, 3);
  assert.deepEqual(upgraded.source, { baseRevision: "", derivedFromRecord: "", deliveredRevision: "" });
  assert.equal((await new AuditLog(workspace.path).readAll(record.id)).length, 1);
  await assert.rejects(readFile(legacy, "utf8"));
});

test("binds downstream work to scoped Story hashes and detects selected Story changes", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const record = await requirementsRecord();
  const storyRef = "pdlc/artifacts/stories/STORY-ONE.md";
  const scopeRef = "pdlc/artifacts/scopes/sprint-1.json";
  await mkdir(join(workspace.path, "pdlc/artifacts/stories"), { recursive: true });
  await mkdir(join(workspace.path, "pdlc/artifacts/scopes"), { recursive: true });
  await writeFile(join(workspace.path, storyRef), "# Story One\n");
  await writeFile(join(workspace.path, scopeRef), JSON.stringify({ artifactType: "product-management.sprint-scope", version: 1 }));
  record.status = "SCOPED";
  record.source.deliveredRevision = "abcdef1";
  record.stories = [{ localId: "STORY-ONE", artifactRef: storyRef, externalKey: "", revision: 1, contentHash: sha256("# Story One\n"), requirementRefs: ["FR-1"], acceptanceCriteria: ["It works"], dependencies: [] }];
  record.scope = { artifactType: "product-management.sprint-scope", documentRef: scopeRef, version: 1, previousScopeHash: "", scopeHash: sha256(JSON.stringify({ artifactType: "product-management.sprint-scope", version: 1 })), epicRef: "EPIC-1", sprint: { id: "S1", name: "Sprint 1", capturedAt: "2026-08-30T00:00:00.000Z" }, storyIds: ["STORY-ONE"], approvedBy: "product", approvedAt: "2026-08-30T00:00:00.000Z" };
  const assessed = await assessDeliveryContract(workspace.path, record, ["STORY-ONE"]);
  assert.equal(assessed.ok, true, JSON.stringify(assessed.issues));
  const previous = assessed.contract!;
  const current = { ...previous, scopeHash: "b".repeat(64), stories: [{ ...previous.stories[0]!, revision: 2, contentHash: "c".repeat(64) }] };
  const changed = assessContractChange(previous, current);
  assert(changed.issues.some(({ code }) => code === "SELECTED_STORY_CHANGED"));
});

test("shared Core remains platform-portable", async () => {
  assert.deepEqual(await validateCorePortability(join(projectRoot, ".pdlc/core")), { ok: true, issues: [] });
});

test("executes a newly declared Delivery Flow without changing Core or CLI", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const harnessRoot = join(workspace.path, "harness");
  const deliveryRoot = join(workspace.path, "project");
  await cp(join(projectRoot, ".pdlc"), join(harnessRoot, ".pdlc"), {
    recursive: true,
    filter: (source) => basename(source) !== "node_modules",
  });
  await mkdir(deliveryRoot, { recursive: true });

  const catalogPath = join(harnessRoot, ".pdlc/delivery-flows/catalog.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { flows: Array<{ id: string; definition: string }> };
  catalog.flows.push({ id: "architecture-review", definition: "architecture-review/flow.json" });
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  await mkdir(join(harnessRoot, ".pdlc/delivery-flows/architecture-review"), { recursive: true });
  await writeFile(join(harnessRoot, ".pdlc/delivery-flows/architecture-review/flow.json"), JSON.stringify({
    schemaVersion: 2,
    id: "architecture-review",
    name: "Architecture Review",
    description: "Configuration-only executable Flow used to prove engine extensibility.",
    status: "active",
    stageSequence: [{ stageId: "solution-design", inclusion: "required" }],
    controls: {
      initialStatus: "DRAFT",
      terminalStatuses: ["APPROVED"],
      checkpoints: [{ id: "approve", from: ["DRAFT"], to: "APPROVED", ownerRole: "developer" }],
      deliveryDefaults: { roleAssignmentMode: "approval-actor-all-roles", timebox: "2 hours", collectDuringRequirements: false },
      constraints: { productionUse: false, externalIntegrations: [], allowSinglePersonAllRoles: true },
    },
  }));

  const engine = await FlowEngine.load(harnessRoot, deliveryRoot);
  const initialized = await engine.initialize({
    schemaVersion: 1,
    id: "ARCH-ONE",
    deliveryFlow: "architecture-review",
    status: "DRAFT",
    title: "Review the service boundary",
    revision: 0,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    assignments: {},
    source: { baseRevision: "", derivedFromRecord: "", deliveredRevision: "" },
    decisionContext: { option: "modular-monolith" },
  }, "architect@example.com");
  assert.equal(initialized.record.status, "DRAFT");
  const approved = await engine.checkpoint({ root: deliveryRoot, actor: "architect@example.com" }, "approve") as { to: string; revision: number };
  assert.deepEqual(approved, { ok: true, recordId: "ARCH-ONE", checkpoint: "approve", from: "DRAFT", to: "APPROVED", revision: 1 });
  assert.equal((await engine.activeRecords()).length, 0);
  assert.equal((await new AuditLog(deliveryRoot).readAll("ARCH-ONE")).length, 2);
  await unlink(join(deliveryRoot, "pdlc/.state/current"));
  assert.equal((await engine.status({}) as { initialized: boolean }).initialized, false);
});
