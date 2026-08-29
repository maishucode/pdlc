import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { AuditLog } from "../core/audit.ts";
import { buildPocAuditSummary } from "../core/audit-summary.ts";
import { DeliveryFlowRegistry } from "../core/delivery-flow-registry.ts";
import { DomainRegistry } from "../core/domain-registry.ts";
import { resolveDomainContext } from "../core/domain-resolver.ts";
import { PdlcError } from "../core/errors.ts";
import { IntegrationRegistry } from "../core/integration-registry.ts";
import { acquireLock } from "../core/lock.ts";
import { ProjectOverlay } from "../core/project-overlay.ts";
import { RoleRegistry } from "../core/role-registry.ts";
import { assessPocBuildReadiness, hashRequirementsDocument } from "../core/readiness.ts";
import { loadRequirementsFlowControl } from "../core/requirements.ts";
import { FileStateStore } from "../core/state.ts";
import { StageRegistry } from "../core/stage-registry.ts";
import type { PocDeliveryRecord } from "../core/types.ts";
import { DECLARED_CAPABILITIES } from "../platform-adapters/capabilities.ts";
import { validateCorePortability } from "../platform-adapters/validate-portability.ts";

const projectRoot = resolve(import.meta.dirname, "../..");

async function exampleRecord(): Promise<PocDeliveryRecord> {
  return JSON.parse(await readFile(join(projectRoot, ".pdlc/examples/poc-delivery-record.json"), "utf8")) as PocDeliveryRecord;
}

async function temporaryWorkspace(): Promise<{ path: string; cleanup(): Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), "lean-pdlc-test-"));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}

async function model(project = projectRoot) {
  const roles = await RoleRegistry.load(join(projectRoot, ".pdlc/roles/catalog.json"));
  const stages = await StageRegistry.load(join(projectRoot, ".pdlc/stages/catalog.json"), roles);
  const flows = await DeliveryFlowRegistry.load(join(projectRoot, ".pdlc/delivery-flows/catalog.json"), stages);
  const domains = await DomainRegistry.load(join(projectRoot, ".pdlc/domains"));
  const integrations = await IntegrationRegistry.load(join(projectRoot, ".pdlc/integrations/catalog.json"));
  const overlay = await ProjectOverlay.load(project, new Set(domains.list().map(({ manifest }) => manifest.id)));
  return { roles, stages, flows, domains, integrations, overlay };
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
  assert.deepEqual(flows.catalog.flows.map(({ id }) => id), ["poc", "implementation", "pdlc"]);
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
  assert(!stages.has("principle-applicability"));
  assert.throws(() => flows.getExecutable("pdlc"), (error: unknown) => error instanceof PdlcError && error.code === "DELIVERY_FLOW_NOT_EXECUTABLE");
  assert.equal(flows.resolve("poc").some(({ definition }) => definition.id === "ux-design"), false);
  assert.equal(flows.resolve("poc", ["technology:web-ui"]).some(({ definition }) => definition.id === "ux-design"), true);
  assert.equal(flows.resolve("poc", ["risk:sensitive-data"]).some(({ definition }) => definition.id === "security-verification"), true);
});

test("loads Domain-owned Artifacts, Policies, Knowledge, Skills, Agents, and Hooks", async () => {
  const { domains, integrations } = await model();
  assert.deepEqual(domains.list().map(({ manifest }) => manifest.id), ["data-platform", "product-management", "security", "solution-architecture", "ux"]);
  assert.equal(domains.artifact("product-management.requirements").definition.ownerDomain, "product-management");
  assert.equal(domains.artifact("product-management.productization-package").definition.ownerDomain, "product-management");
  assert.equal(domains.get("ux").policies.length, 1);
  assert.equal(domains.get("ux").skills.length, 3);
  assert.equal(domains.get("ux").agents[0]?.id, "lean-pdlc-ux");
  assert.equal(domains.get("ux").hooks.length, 1);
  assert.equal(domains.get("data-platform").knowledge[0]?.asset.kind, "kb");
  assert.equal(integrations.get("databricks").manifest.kind, "integration");
});

test("resolves mandatory Controls separately from guidance and defaults", async () => {
  const { flows, domains, integrations, overlay } = await model();
  const stages = flows.resolve("poc", ["technology:web-ui", "risk:sensitive-data"]).map(({ definition }) => definition.id);
  const result = resolveDomainContext(domains, integrations, overlay, {
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
  const { flows, domains, integrations, overlay } = await model();
  const stages = flows.resolve("poc", ["technology:web-ui"]).map(({ definition }) => definition.id);
  for (const stage of stages) {
    const result = resolveDomainContext(domains, integrations, overlay, {
      deliveryFlow: "poc",
      stages: [stage],
      technologies: ["web-ui", "react"],
      domains: ["ux"],
    });
    assert.deepEqual(result.issues, [], `${stage}: ${JSON.stringify(result.issues)}`);
  }
});

test("resolves Databricks Knowledge and Integration as separate assets", async () => {
  const { domains, integrations, overlay } = await model();
  const result = resolveDomainContext(domains, integrations, overlay, {
    deliveryFlow: "implementation",
    stages: ["data-integration-boundaries", "solution-design", "implementation"],
    technologies: ["databricks"],
  });
  assert(result.knowledge.some(({ ref, asset }) => ref === "data-platform.databricks-connectivity@1.0.0" && asset.kind === "kb"));
  assert(result.integrations.some(({ ref }) => ref === "databricks@1.0.0"));
  const poc = resolveDomainContext(domains, integrations, overlay, {
    deliveryFlow: "poc",
    stages: ["data-integration-boundaries", "implementation"],
    technologies: ["databricks"],
  });
  assert.deepEqual(poc.integrations, []);
});

test("lets project defaults override Domain defaults but not locked Controls", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const defaultsRoot = join(workspace.path, "pdlc/config/domains/ux/defaults");
  await mkdir(defaultsRoot, { recursive: true });
  await writeFile(join(defaultsRoot, "override.json"), JSON.stringify({
    schemaVersion: 1,
    id: "ux-project-overrides",
    domain: "ux",
    version: "1.0.0",
    appliesTo: { deliveryFlows: ["poc"], stages: ["ux-design", "build-readiness"], technologies: ["web-ui"] },
    defaults: [
      { key: "quality.browser-baseline", title: "Project browsers", topic: "qualityAttributes", statement: "Verify Chrome and Firefox at project-approved viewports.", rationale: "Approved project choice.", controlRefs: ["ux.experience-quality@1.0.0#responsive-baseline"] },
      { key: "ux.visual-foundation", title: "Attempted palette override", topic: "uxInteraction", statement: "Use a red palette.", rationale: "Project preference.", controlRefs: ["ux.experience-quality@1.0.0#approved-visual-foundation"] },
    ],
  }, null, 2));
  const { domains, integrations } = await model();
  const overlay = await ProjectOverlay.load(workspace.path, new Set(domains.list().map(({ manifest }) => manifest.id)));
  const result = resolveDomainContext(domains, integrations, overlay, { deliveryFlow: "poc", stages: ["ux-design", "build-readiness"], technologies: ["web-ui"] });
  assert.equal(result.defaults.find(({ key }) => key === "quality.browser-baseline")?.sourceLayer, "project");
  assert.equal(result.defaults.find(({ key }) => key === "ux.visual-foundation")?.sourceLayer, "domain");
  assert(result.issues.some(({ code }) => code === "CONTROL_CONSTRAINT_OVERRIDE"));
});

test("rejects the obsolete project controls folder", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  await mkdir(join(workspace.path, "pdlc/config/domains/ux/controls"), { recursive: true });
  const { domains } = await model();
  await assert.rejects(
    ProjectOverlay.load(workspace.path, new Set(domains.list().map(({ manifest }) => manifest.id))),
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
  const { flows, domains, integrations } = await model();
  const overlay = await ProjectOverlay.load(workspace.path, new Set(domains.list().map(({ manifest }) => manifest.id)));
  const activeStages = flows.resolve("poc", ["technology:web-ui", "risk:sensitive-data"]).map(({ definition }) => definition.id);
  const resolved = resolveDomainContext(domains, integrations, overlay, { deliveryFlow: "poc", stages: activeStages, riskTriggers: record.risk.triggers, technologies: record.design.technologies });
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
  assert.deepEqual([...DECLARED_CAPABILITIES["github-copilot"]].sort(), ["cloud-environment-setup", "command-approval", "custom-agent", "prompt-file", "repository-instructions", "shared-skill"]);
});

test("writes and reads a Delivery Record atomically with optimistic revision control", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const store = new FileStateStore(workspace.path);
  const record = await exampleRecord();
  assert.equal(store.recordPath(record.id), join(workspace.path, ".pdlc/runtime/records/POC-EXAMPLE.json"));
  await store.writeRecord(record);
  await store.setCurrentRecord(record.id);
  assert.equal((await readFile(join(workspace.path, ".pdlc/runtime/current"), "utf8")).trim(), record.id);
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
  assert.equal(first.path, join(workspace.path, ".pdlc/runtime/locks/record-POC-EXAMPLE.lock"));
  try { await assert.rejects(acquireLock(workspace.path, "record-POC-EXAMPLE"), (error: unknown) => error instanceof PdlcError && error.code === "LOCK_HELD"); }
  finally { await first.release(); }
});

test("appends auditable events with deterministic record hashes", async (context) => {
  const workspace = await temporaryWorkspace();
  context.after(workspace.cleanup);
  const record = await exampleRecord();
  const audit = new AuditLog(workspace.path);
  assert.equal(audit.path, join(workspace.path, ".pdlc/runtime/audit/events.jsonl"));
  const event = audit.create(record, { recordId: record.id, eventType: "DELIVERY_FLOW_CREATED", actor: record.assignments.product, riskLevel: record.risk.level });
  await audit.append(event);
  assert.equal((await audit.readAll())[0]?.recordHash.length, 64);
});

test("shared Core remains platform-portable", async () => {
  assert.deepEqual(await validateCorePortability(join(projectRoot, ".pdlc/core")), { ok: true, issues: [] });
});
