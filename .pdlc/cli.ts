import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AuditLog } from "./core/audit.ts";
import { createStageContextSnapshot, validateReceiptAgainstSnapshot, type StageContextSnapshot } from "./core/context-receipt.ts";
import { DeliveryFlowRegistry } from "./core/delivery-flow-registry.ts";
import { discoverDomainHooks, domainAgentPath, domainSkillPath, resolveDomainGuidance } from "./core/domain-guidance.ts";
import { DomainRegistry } from "./core/domain-registry.ts";
import { projectKnowledgeRefs, resolveDomainContext } from "./core/domain-resolver.ts";
import { PdlcError } from "./core/errors.ts";
import { IntegrationRegistry } from "./core/integration-registry.ts";
import { ProjectOverlay } from "./core/project-overlay.ts";
import { assessProductizationPackage } from "./core/productization.ts";
import { assessControlApplications, assessPocBuildReadiness, assessResolvedControlSet, hashRequirementsDocument } from "./core/readiness.ts";
import { loadRequirementsFlowControl } from "./core/requirements.ts";
import { RoleRegistry, type ResolvedRole } from "./core/role-registry.ts";
import { validatePocDeliveryRecord, validateStageContextReceipt } from "./core/schema.ts";
import { FileStateStore } from "./core/state.ts";
import { StageRegistry } from "./core/stage-registry.ts";
import type { DeliveryFlowCheckpoint, DomainGuidanceResolution, ExecutableDeliveryFlowDefinition, PocDeliveryRecord, StageContextReceipt, ValidationIssue } from "./core/types.ts";
import { validateConversationEntrypoints } from "./platform-adapters/validate-entrypoints.ts";
import { validateCorePortability } from "./platform-adapters/validate-portability.ts";

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = resolve(MODULE_DIRECTORY, "..");

interface CliOptions { root: string; record?: string; actor?: string; receipt?: string; outcome?: string }
interface ParsedArguments { command?: string; subcommand?: string; options: CliOptions }

function parseArguments(args: string[], currentDirectory: string): ParsedArguments {
  const positional: string[] = [];
  const options: CliOptions = { root: currentDirectory };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") positional.push("help");
    else if (["--root", "--record", "--actor", "--receipt", "--outcome"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new PdlcError("INVALID_ARGUMENT", `Missing value for ${argument}`);
      if (argument === "--root") options.root = resolve(currentDirectory, value);
      else if (argument === "--record") options.record = value;
      else if (argument === "--actor") options.actor = value;
      else if (argument === "--receipt") options.receipt = value;
      else options.outcome = value;
      index += 1;
    } else if (argument.startsWith("--")) throw new PdlcError("INVALID_ARGUMENT", `Unknown option: ${argument}`);
    else positional.push(argument);
  }
  if (positional.length > 2) throw new PdlcError("INVALID_ARGUMENT", `Too many positional arguments: ${positional.slice(2).join(" ")}`);
  return { command: positional[0], subcommand: positional[1], options };
}

function checkpointFor(flow: ExecutableDeliveryFlowDefinition, id: string): DeliveryFlowCheckpoint {
  const checkpoint = flow.controls.checkpoints.find((entry) => entry.id === id);
  if (!checkpoint) throw new PdlcError("INVALID_ARGUMENT", `Unknown checkpoint for ${flow.id}: ${id}`);
  return checkpoint;
}

function assertCheckpointActor(record: PocDeliveryRecord, checkpoint: DeliveryFlowCheckpoint, actor?: string): string {
  if (!actor?.trim()) throw new PdlcError("INVALID_ARGUMENT", `Checkpoint '${checkpoint.id}' requires --actor <identity>`);
  const assigned = record.assignments[checkpoint.ownerRole];
  if (!assigned || assigned !== actor) throw new PdlcError("INVALID_ARGUMENT", `Checkpoint '${checkpoint.id}' must be performed by the assigned ${checkpoint.ownerRole} role`);
  return actor;
}

function constraintIssues(
  record: PocDeliveryRecord,
  flow: ExecutableDeliveryFlowDefinition,
  resolvedIntegrations: readonly string[],
  requiredRoles: readonly string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (record.scope.productionUse !== flow.controls.constraints.productionUse) {
    issues.push({ code: "FLOW_PRODUCTION_CONSTRAINT", path: "$.scope.productionUse", message: `Delivery Flow requires productionUse=${flow.controls.constraints.productionUse}` });
  }
  const allowedIntegrations = new Set(flow.controls.constraints.externalIntegrations);
  for (const ref of resolvedIntegrations) {
    const id = ref.split("@")[0];
    if (!allowedIntegrations.has(ref) && !allowedIntegrations.has(id)) issues.push({ code: "FLOW_INTEGRATION_CONSTRAINT", path: "$.resolution.integrations", message: `External Integration is not allowed by this Delivery Flow: ${ref}` });
  }
  if (!flow.controls.constraints.allowSinglePersonAllRoles) {
    const identities = requiredRoles.map((role) => record.assignments[role]).filter(Boolean);
    if (new Set(identities).size !== identities.length) issues.push({ code: "ROLE_SEPARATION_REQUIRED", path: "$.assignments", message: "This Delivery Flow requires separate identities for its required Roles" });
  }
  return issues;
}

function stageFor(record: PocDeliveryRecord): string {
  if (record.status === "DRAFT") return record.requirements.status === "approved" ? "build-readiness" : "requirements-clarification";
  if (record.status === "COMMITTED") return "implementation";
  return "outcome-review-and-disposition";
}

function contextTags(record: PocDeliveryRecord): string[] {
  return [
    ...record.risk.triggers.map((value) => `risk:${value}`),
    ...record.design.technologies.map((value) => `technology:${value}`),
    ...record.design.domains.map((value) => `domain:${value}`),
  ];
}

async function loadHarnessModel(projectRoot = HARNESS_ROOT) {
  const roles = await RoleRegistry.load(join(HARNESS_ROOT, ".pdlc", "roles", "catalog.json"));
  const stages = await StageRegistry.load(join(HARNESS_ROOT, ".pdlc", "stages", "catalog.json"), roles);
  const deliveryFlows = await DeliveryFlowRegistry.load(join(HARNESS_ROOT, ".pdlc", "delivery-flows", "catalog.json"), stages);
  const domains = await DomainRegistry.load(join(HARNESS_ROOT, ".pdlc", "domains"));
  const integrations = await IntegrationRegistry.load(join(HARNESS_ROOT, ".pdlc", "integrations", "catalog.json"));
  const project = await ProjectOverlay.load(projectRoot, new Set(domains.list().map(({ manifest }) => manifest.id)));
  return { roles, stages, deliveryFlows, domains, integrations, project };
}

function unknownStageReferences(stages: StageRegistry, sources: Array<{ source: string; stageIds?: string[] }>): ValidationIssue[] {
  return sources.flatMap(({ source, stageIds = [] }) => stageIds.flatMap((stageId, index) => stages.has(stageId) ? [] : [{
    code: "UNKNOWN_STAGE_REF",
    path: `${source}.stages[${index}]`,
    message: `Stage is not defined in the canonical Stage Catalog: ${stageId}`,
  }]));
}

async function readRecord(options: CliOptions): Promise<PocDeliveryRecord> {
  const store = new FileStateStore(options.root);
  return options.record ? store.readRecord(options.record) : store.readCurrentRecord();
}

interface ResolvedStageMaterial {
  deliveryFlow: string;
  stage: ReturnType<StageRegistry["get"]>;
  resolved: ReturnType<typeof resolveDomainContext>;
  domainGuidance: DomainGuidanceResolution;
  snapshot: StageContextSnapshot;
  project: ProjectOverlay;
  roles: ResolvedRole[];
}

async function resolveStageMaterial(options: CliOptions, stageId: string, record?: PocDeliveryRecord): Promise<ResolvedStageMaterial> {
  const { roles, stages, domains, integrations, project } = await loadHarnessModel(options.root);
  const stage = stages.get(stageId);
  const stageRoles = stage.roleSlots.map((role) => roles.get(role));
  const deliveryFlow = record?.deliveryFlow ?? "poc";
  const resolved = resolveDomainContext(domains, integrations, project, {
    deliveryFlow,
    stages: [stageId],
    riskTriggers: record?.risk.triggers ?? [],
    technologies: record?.design.technologies ?? [],
    domains: record?.design.domains ?? [],
  });
  if (resolved.issues.length > 0) throw new PdlcError("CONTEXT_RESOLUTION_FAILED", `Cannot resolve context for Stage ${stageId}`, resolved.issues);
  const domainGuidance = await resolveDomainGuidance(stages, domains, HARNESS_ROOT, stageId, deliveryFlow);
  const snapshot = await createStageContextSnapshot({
    harnessRoot: HARNESS_ROOT,
    projectRoot: options.root,
    deliveryFlow,
    stage: stageId,
    stageDefinition: stage,
    roles: stageRoles,
    controls: resolved.controls,
    baselines: resolved.baselines,
    defaults: resolved.defaults,
    knowledge: resolved.knowledge,
    project,
    domainGuidance,
    integrations: resolved.integrations,
  });
  return { deliveryFlow, stage, resolved, domainGuidance, snapshot, project, roles: stageRoles };
}

function requiredContextIssues(record: PocDeliveryRecord, stages: string[], snapshots: Map<string, StageContextSnapshot>): ValidationIssue[] {
  const applications = new Map(record.resolution.contextApplications.map((entry) => [entry.stage, entry]));
  return stages.flatMap((stage) => {
    const application = applications.get(stage);
    if (!application) return [{ code: "STAGE_CONTEXT_APPLICATION_MISSING", path: "$.resolution.contextApplications", message: `Stage context has not been applied: ${stage}` }];
    const snapshot = snapshots.get(stage);
    return snapshot && application.contextHash !== snapshot.contextHash
      ? [{ code: "STALE_STAGE_CONTEXT_APPLICATION", path: `$.resolution.contextApplications.${stage}.contextHash`, message: `Resolved assets changed after the Stage context was applied: ${stage}` }]
      : [];
  });
}

async function readiness(options: CliOptions, target?: string): Promise<unknown> {
  if (target !== "build") throw new PdlcError("INVALID_ARGUMENT", "Readiness target must be 'build'");
  const original = await readRecord(options);
  const { roles, deliveryFlows, domains, integrations, project } = await loadHarnessModel(options.root);
  const flow = deliveryFlows.getExecutable("poc");
  const commit = checkpointFor(flow, "commit");
  let record = original;
  const activeStages = deliveryFlows.resolve(flow.id, contextTags(record)).map(({ definition }) => definition.id);
  const requiredRoles = deliveryFlows.requiredRoles(flow.id, contextTags(record));
  const resolution = resolveDomainContext(domains, integrations, project, {
    deliveryFlow: flow.id,
    stages: activeStages,
    riskTriggers: record.risk.triggers,
    technologies: record.design.technologies,
    domains: record.design.domains,
  });
  if (resolution.issues.length > 0) throw new PdlcError("BUILD_NOT_READY", "Domain context contains unresolved conflicts", resolution.issues);

  if (options.actor) {
    if (!commit.from.includes(original.status) || !commit.to) throw new PdlcError("INVALID_ARGUMENT", `Build Readiness cannot Commit a record in status ${original.status}`);
    let approvedContentHash: string;
    try {
      approvedContentHash = await hashRequirementsDocument(options.root, original.requirements.documentRef);
    } catch (error) {
      throw new PdlcError("BUILD_NOT_READY", "Requirements document cannot be approved", [{
        code: "REQUIREMENTS_DOCUMENT_UNREADABLE",
        path: "$.requirements.documentRef",
        message: error instanceof Error ? error.message : String(error),
      }]);
    }
    if (original.requirements.status === "approved" && original.requirements.approvedContentHash === approvedContentHash) throw new PdlcError("INVALID_ARGUMENT", "Requirements content is already approved; no new approval is needed");
    const timestamp = new Date().toISOString();
    record = {
      ...original,
      status: commit.to as PocDeliveryRecord["status"],
      revision: original.revision + 1,
      updatedAt: timestamp,
      assignments: Object.fromEntries(requiredRoles.map((role) => [role, options.actor])),
      idea: { ...original.idea, timebox: flow.controls.deliveryDefaults.timebox },
      requirements: { ...original.requirements, status: "approved", approvedBy: options.actor, approvedAt: timestamp, approvedContentHash },
      resolution: {
        controls: { ...original.resolution.controls, applicable: resolution.controls.map(({ ref }) => ref) },
        baselines: resolution.baselines.map(({ ref }) => ref),
        defaults: resolution.defaults.map(({ sourceRef, key }) => `${sourceRef}:${key}`),
        knowledge: resolution.knowledge.map(({ ref }) => ref),
        integrations: resolution.integrations.map(({ ref }) => ref),
        contextApplications: original.resolution.contextApplications,
      },
    };
  }

  const roleIssues = roles.validateAssignments(record, requiredRoles);
  if (roleIssues.length > 0) throw new PdlcError("BUILD_NOT_READY", "Required Delivery Flow Roles are not assigned", roleIssues);
  const constraints = constraintIssues(record, flow, resolution.integrations.map(({ ref }) => ref), requiredRoles);
  if (constraints.length > 0) throw new PdlcError("BUILD_NOT_READY", "Delivery Flow constraints are not satisfied", constraints);

  const receiptStages = ["requirements-clarification", "build-readiness"];
  const receiptSnapshots = new Map<string, StageContextSnapshot>();
  for (const stageId of receiptStages) receiptSnapshots.set(stageId, (await resolveStageMaterial(options, stageId, record)).snapshot);
  const contextIssues = requiredContextIssues(record, receiptStages, receiptSnapshots);
  if (contextIssues.length > 0) throw new PdlcError("BUILD_NOT_READY", "Required Stage context has not been applied or is stale", contextIssues);

  const policy = await loadRequirementsFlowControl(join(HARNESS_ROOT, ".pdlc", "delivery-flows", "poc", "controls", "requirements.json"));
  const result = await assessPocBuildReadiness(record, options.root, resolution.controls, policy, resolution.defaults, requiredRoles);
  if (!result.ok) throw new PdlcError("BUILD_NOT_READY", "POC requirements or mandatory Controls are not ready for build", result.issues);
  if (options.actor) {
    await new FileStateStore(options.root).writeRecord(record, original.revision);
    await new AuditLog(options.root).append(new AuditLog(options.root).create(record, {
      recordId: record.id,
      eventType: "CHECKPOINT_APPROVED",
      checkpoint: "commit",
      fromStatus: original.status,
      toStatus: record.status,
      actor: options.actor,
      riskLevel: record.risk.level,
      evidenceRefs: [record.requirements.documentRef, ...record.resolution.controls.applicable],
    }));
  }
  return {
    ok: true,
    recordId: record.id,
    target,
    transition: options.actor ? { checkpoint: "commit", from: original.status, to: record.status } : undefined,
    deliveryFlow: { id: flow.id, activeStages },
    approval: { status: record.requirements.status, approvedBy: record.requirements.approvedBy, approvedAt: record.requirements.approvedAt, contentHash: record.requirements.approvedContentHash },
    deliveryControls: { roleAssignmentMode: flow.controls.deliveryDefaults.roleAssignmentMode, assignments: record.assignments, timebox: record.idea.timebox, requirementsProfile: flow.controls.deliveryDefaults.requirementsProfile },
    requirements: result.requirementsDocument,
    controls: result.controls,
    projectBaselines: resolution.baselines.map(({ ref }) => ref),
    defaults: resolution.defaults.map(({ key, sourceRef, locked }) => ({ key, source: sourceRef, locked })),
    knowledge: [...resolution.knowledge.map(({ ref }) => ref), ...projectKnowledgeRefs(project, options.root)],
    integrations: resolution.integrations.map(({ ref, owners, permissions, skills }) => ({ ref, owners, permissions, skills: skills.map(({ id }) => id) })),
  };
}

async function checkpoint(options: CliOptions, checkpointId?: string): Promise<unknown> {
  if (!checkpointId) throw new PdlcError("INVALID_ARGUMENT", "Checkpoint id is required");
  if (checkpointId === "commit") throw new PdlcError("INVALID_ARGUMENT", "Commit is performed by the approved 'readiness build' operation");
  const original = await readRecord(options);
  const { deliveryFlows, domains, integrations, project } = await loadHarnessModel(options.root);
  const flow = deliveryFlows.getExecutable(original.deliveryFlow);
  const definition = checkpointFor(flow, checkpointId);
  const actor = assertCheckpointActor(original, definition, options.actor);
  if (!definition.from.includes(original.status)) throw new PdlcError("INVALID_ARGUMENT", `Checkpoint '${checkpointId}' cannot transition a record in status ${original.status}`);

  let targetStatus: PocDeliveryRecord["status"];
  let decision: string | undefined;
  let productizationPackageHash: string | undefined;
  let evidenceRefs: string[] = [];
  if (checkpointId === "verify") {
    if (!definition.to) throw new PdlcError("INVALID_ARGUMENT", "Verify checkpoint has no target status");
    const activeStages = deliveryFlows.resolve(flow.id, contextTags(original)).map(({ definition: stage }) => stage.id);
    const requiredRoles = deliveryFlows.requiredRoles(flow.id, contextTags(original));
    const resolution = resolveDomainContext(domains, integrations, project, {
      deliveryFlow: flow.id,
      stages: activeStages,
      riskTriggers: original.risk.triggers,
      technologies: original.design.technologies,
      domains: original.design.domains,
    });
    if (resolution.issues.length > 0) throw new PdlcError("BUILD_NOT_READY", "Domain context contains unresolved conflicts", resolution.issues);
    const issues = constraintIssues(original, flow, resolution.integrations.map(({ ref }) => ref), requiredRoles);
    if (original.evidence.tests.length === 0) issues.push({ code: "TEST_EVIDENCE_MISSING", path: "$.evidence.tests", message: "Test evidence is required before Verify" });
    if (original.evidence.build.length === 0) issues.push({ code: "BUILD_EVIDENCE_MISSING", path: "$.evidence.build", message: "Build evidence is required before Verify" });
    if (original.evidence.demo.length === 0) issues.push({ code: "DEMO_EVIDENCE_MISSING", path: "$.evidence.demo", message: "POC demonstration evidence is required before Verify" });
    if (activeStages.includes("security-verification") && original.evidence.security.length === 0) issues.push({ code: "SECURITY_EVIDENCE_MISSING", path: "$.evidence.security", message: "Security evidence is required because the Security Verification Stage is active" });
    evidenceRefs = [original.evidence.tests, original.evidence.build, original.evidence.security, original.evidence.demo].flat().map(({ ref }) => ref);
    issues.push(...assessResolvedControlSet(original, resolution.controls));
    issues.push(...assessControlApplications(original, resolution.controls, ["developer-verification", "security-verification", "acceptance-verification"], new Set(evidenceRefs)));
    const receiptStages = ["requirements-clarification", "build-readiness", "implementation", "developer-verification", ...(activeStages.includes("security-verification") ? ["security-verification"] : []), "acceptance-verification"];
    const snapshots = new Map<string, StageContextSnapshot>();
    for (const stageId of receiptStages) snapshots.set(stageId, (await resolveStageMaterial(options, stageId, original)).snapshot);
    issues.push(...requiredContextIssues(original, receiptStages, snapshots));
    if (issues.length > 0) throw new PdlcError("BUILD_NOT_READY", "POC evidence or mandatory Controls are not ready for Verify", issues);
    targetStatus = definition.to as PocDeliveryRecord["status"];
  } else if (checkpointId === "decide") {
    if (!definition.toByOutcome) throw new PdlcError("INVALID_ARGUMENT", "Decide checkpoint has no outcome transitions");
    if (!options.outcome || !["park", "recommend-productization"].includes(options.outcome)) throw new PdlcError("INVALID_ARGUMENT", "Decide requires --outcome park|recommend-productization");
    if (original.decision.outcome && original.decision.outcome !== options.outcome) throw new PdlcError("INVALID_ARGUMENT", "Requested outcome conflicts with the Delivery Record decision");
    if (!original.decision.rationale.trim() || !original.decision.followUp.trim()) throw new PdlcError("BUILD_NOT_READY", "Decision rationale and follow-up are required before Decide");
    decision = options.outcome;
    if (decision === "recommend-productization") {
      const packageAssessment = await assessProductizationPackage(options.root, original);
      if (!packageAssessment.ok || !packageAssessment.contentHash || !packageAssessment.documentRef) {
        throw new PdlcError("BUILD_NOT_READY", "Productization Package is not ready for recommendation", packageAssessment.issues);
      }
      productizationPackageHash = packageAssessment.contentHash;
      evidenceRefs = [packageAssessment.documentRef];
    }
    const mapped = definition.toByOutcome[decision];
    if (!mapped) throw new PdlcError("INVALID_ARGUMENT", `No Decide transition is defined for outcome: ${decision}`);
    targetStatus = mapped as PocDeliveryRecord["status"];
  } else {
    throw new PdlcError("INVALID_ARGUMENT", `Unsupported checkpoint: ${checkpointId}`);
  }

  const timestamp = new Date().toISOString();
  const updated: PocDeliveryRecord = {
    ...original,
    status: targetStatus,
    revision: original.revision + 1,
    updatedAt: timestamp,
    decision: decision ? {
      ...original.decision,
      outcome: decision as PocDeliveryRecord["decision"]["outcome"],
      productizationPackage: productizationPackageHash
        ? {
          ...original.decision.productizationPackage,
          documentRef: evidenceRefs[0],
          contentHash: productizationPackageHash,
        }
        : original.decision.productizationPackage,
    } : original.decision,
  };
  await new FileStateStore(options.root).writeRecord(updated, original.revision);
  await new AuditLog(options.root).append(new AuditLog(options.root).create(updated, {
    recordId: updated.id,
    eventType: "CHECKPOINT_APPROVED",
    checkpoint: checkpointId,
    fromStatus: original.status,
    toStatus: updated.status,
    actor,
    riskLevel: updated.risk.level,
    evidenceRefs,
    decision,
  }));
  return {
    ok: true,
    recordId: updated.id,
    checkpoint: checkpointId,
    from: original.status,
    to: updated.status,
    revision: updated.revision,
    decision,
    productizationPackage: productizationPackageHash ? { documentRef: updated.decision.productizationPackage.documentRef, contentHash: productizationPackageHash } : undefined,
  };
}

async function status(options: CliOptions): Promise<unknown> {
  try {
    const record = await readRecord(options);
    return { ok: true, initialized: true, record: { id: record.id, deliveryFlow: record.deliveryFlow, status: record.status, stage: stageFor(record), title: record.title, revision: record.revision, risk: record.risk, assignments: record.assignments, updatedAt: record.updatedAt } };
  } catch (error) {
    if (error instanceof PdlcError && error.code === "CURRENT_RECORD_NOT_SET") return { ok: true, initialized: false, message: error.message };
    throw error;
  }
}

async function stageContext(options: CliOptions, stageId?: string): Promise<unknown> {
  if (!stageId) throw new PdlcError("INVALID_ARGUMENT", "Context requires a canonical Stage id");
  let record: PocDeliveryRecord | undefined;
  try { record = await readRecord(options); } catch (error) {
    if (!(error instanceof PdlcError) || error.code !== "CURRENT_RECORD_NOT_SET") throw error;
  }
  const { deliveryFlow, stage, resolved, domainGuidance, snapshot, project, roles } = await resolveStageMaterial(options, stageId, record);
  return {
    ok: true,
    deliveryFlow,
    stage,
    contextHash: snapshot.contextHash,
    roles: roles.map(({ id, name, path }) => ({ id, name, path: relative(HARNESS_ROOT, path) })),
    controls: resolved.controls.map(({ ref, ownerDomain, source, policy }) => ({ ref, ownerDomain, source, rules: policy.rules })),
    baselines: resolved.baselines.map(({ ref, baseline }) => ({ ref, decisions: baseline.decisions })),
    defaults: resolved.defaults,
    knowledge: [...resolved.knowledge.map(({ ref, asset, contentPath }) => ({ ref, kind: asset.kind, contentPath: contentPath ? relative(HARNESS_ROOT, contentPath) : undefined })), ...projectKnowledgeRefs(project, options.root).map((ref) => ({ ref, kind: "project" }))],
    domainContributions: domainGuidance.contributions,
    integrations: resolved.integrations.map(({ ref, owners, permissions, skills }) => ({
      ref,
      owners,
      permissions,
      skills: skills.map(({ id, path }) => ({ id, path: relative(HARNESS_ROOT, path) })),
    })),
  };
}

async function applyStageContext(options: CliOptions, stageId?: string): Promise<unknown> {
  if (!stageId) throw new PdlcError("INVALID_ARGUMENT", "Context apply requires a canonical Stage id");
  if (!options.receipt) throw new PdlcError("INVALID_ARGUMENT", "Context apply requires --receipt <path>");
  if (!options.actor?.trim()) throw new PdlcError("INVALID_ARGUMENT", "Context apply requires --actor <identity>");
  const original = await readRecord(options);
  let raw: unknown;
  try {
    const receiptPath = isAbsolute(options.receipt) ? options.receipt : resolve(options.root, options.receipt);
    const receiptFromRoot = relative(resolve(options.root), receiptPath);
    if (receiptFromRoot === ".." || receiptFromRoot.startsWith(`..${sep}`) || isAbsolute(receiptFromRoot)) {
      throw new Error("Receipt path must remain inside the project workspace");
    }
    raw = JSON.parse(await readFile(receiptPath, "utf8")) as unknown;
  } catch (error) {
    throw new PdlcError("CONTEXT_RECEIPT_INVALID", "Stage context receipt cannot be read", [{ code: "CONTEXT_RECEIPT_UNREADABLE", path: "--receipt", message: error instanceof Error ? error.message : String(error) }]);
  }
  const validation = validateStageContextReceipt(raw);
  if (!validation.ok) throw new PdlcError("CONTEXT_RECEIPT_INVALID", "Stage context receipt is invalid", validation.issues);
  const receipt: StageContextReceipt = validation.value;
  const material = await resolveStageMaterial(options, stageId, original);
  const issues = validateReceiptAgainstSnapshot(receipt, material.snapshot);
  if (issues.length > 0) throw new PdlcError("CONTEXT_RECEIPT_INVALID", "Stage context receipt does not match the current resolved context", issues);

  const appliedAt = new Date().toISOString();
  const application = { ...receipt, actor: options.actor, appliedAt };
  const contextApplications = original.resolution.contextApplications.filter((entry) => entry.stage !== stageId);
  contextApplications.push(application);
  contextApplications.sort((left, right) => left.stage.localeCompare(right.stage));
  const updated: PocDeliveryRecord = {
    ...original,
    revision: original.revision + 1,
    updatedAt: appliedAt,
    resolution: { ...original.resolution, contextApplications },
  };
  await new FileStateStore(options.root).writeRecord(updated, original.revision);
  const evidenceRefs = [
    ...receipt.knowledge.flatMap((entry) => entry.evidenceRefs),
    ...receipt.domainContributions.flatMap((entry) => entry.evidenceRefs),
    ...receipt.integrations.flatMap((entry) => entry.evidenceRefs),
  ];
  await new AuditLog(options.root).append(new AuditLog(options.root).create(updated, {
    recordId: updated.id,
    eventType: "STAGE_CONTEXT_APPLIED",
    stage: stageId,
    contextHash: receipt.contextHash,
    actor: options.actor,
    riskLevel: updated.risk.level,
    evidenceRefs: [...new Set(evidenceRefs)],
  }));
  return { ok: true, recordId: updated.id, stage: stageId, contextHash: receipt.contextHash, revision: updated.revision, appliedAt };
}

async function guidance(options: CliOptions, stageId?: string): Promise<unknown> {
  if (!stageId) throw new PdlcError("INVALID_ARGUMENT", "Guidance requires a canonical Stage id");
  const { stages, domains } = await loadHarnessModel(options.root);
  return { ok: true, ...await resolveDomainGuidance(stages, domains, HARNESS_ROOT, stageId) };
}

async function domainList(): Promise<unknown> {
  const { stages, domains } = await loadHarnessModel();
  const hooks = await discoverDomainHooks(stages, domains);
  return { ok: true, domains: domains.list().map(({ manifest, artifacts, policies, knowledge, skills, agents, hooks: domainHooks }) => ({
    id: manifest.id,
    artifacts: artifacts.length,
    policies: policies.length,
    knowledge: knowledge.length,
    skills: skills.map(({ id }) => id),
    agents: agents.map(({ id }) => id),
    hooks: domainHooks.length,
    stages: hooks.filter(({ domain }) => domain === manifest.id).flatMap(({ bindings }) => bindings.map(({ stage }) => stage)),
  })) };
}

async function domainSync(options: CliOptions): Promise<unknown> {
  const { stages, domains } = await loadHarnessModel(options.root);
  const hooks = (await discoverDomainHooks(stages, domains)).filter(({ descriptor }) => descriptor.enabled && descriptor.deliveryFlows.includes("poc"));
  const sources = new Map<string, { domain: string; source: string; destination: string }>();
  for (const { domain, root, bindings } of hooks) for (const binding of bindings) {
    const agentDestination = join(".github", "agents", `${binding.agent}.agent.md`);
    sources.set(agentDestination, { domain, source: domainAgentPath(root, binding.agent), destination: agentDestination });
    for (const skill of binding.skills) {
      const skillDestination = join(".github", "skills", skill, "SKILL.md");
      sources.set(skillDestination, { domain, source: domainSkillPath(root, skill), destination: skillDestination });
    }
  }
  const installed: string[] = [];
  const unchanged: string[] = [];
  for (const item of [...sources.values()].sort((a, b) => a.destination.localeCompare(b.destination))) {
    const destination = join(options.root, item.destination);
    const sourceContent = await readFile(item.source, "utf8");
    try {
      if (await readFile(destination, "utf8") !== sourceContent) throw new PdlcError("DOMAIN_FILE_CONFLICT", `Domain '${item.domain}' will not overwrite an existing file: ${relative(options.root, destination)}`);
      unchanged.push(relative(options.root, destination));
    } catch (error) {
      if (error instanceof PdlcError) throw error;
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(item.source, destination);
      installed.push(relative(options.root, destination));
    }
  }
  return { ok: true, domains: [...new Set(hooks.map(({ domain }) => domain))], target: options.root, installed, unchanged };
}

async function integrationList(): Promise<unknown> {
  const { integrations } = await loadHarnessModel();
  return { ok: true, integrations: integrations.list().map(({ manifest }) => ({
    id: manifest.id,
    version: manifest.version,
    owners: manifest.owners,
    maintainers: manifest.maintainers,
    permissions: manifest.permissions,
    skills: manifest.skills.map(({ id }) => id),
  })) };
}

async function validate(options: CliOptions): Promise<unknown> {
  const checks: Record<string, unknown> = {};
  const schemaNames = ["audit-event", "artifact-definition", "control-policy", "delivery-flow-catalog", "delivery-flow", "domain", "domain-stage-hooks", "integration-catalog", "integration", "knowledge-metadata", "poc-delivery-record", "project-baseline", "project-default", "requirements-flow-control", "role-catalog", "stage-catalog", "stage-context-receipt"];
  for (const schemaName of schemaNames) {
    const path = join(HARNESS_ROOT, ".pdlc", "schemas", `${schemaName}.schema.json`);
    const schema = JSON.parse(await readFile(path, "utf8")) as { $schema?: unknown; type?: unknown };
    if (typeof schema.$schema !== "string" || schema.type !== "object") throw new PdlcError("VALIDATION_FAILED", `Invalid JSON Schema metadata: ${path}`);
  }
  checks.schemas = { ok: true, loaded: schemaNames };

  const { roles, stages, deliveryFlows, domains, integrations, project } = await loadHarnessModel(options.root);
  checks.roles = { ok: true, owner: roles.catalog.owner, loaded: roles.list().map(({ id, name, definition }) => ({ id, name, definition })) };
  checks.deliveryModel = { ok: true, catalogVersion: stages.catalog.catalogVersion, canonicalStages: stages.list().length, catalog: deliveryFlows.catalog.flows, deliveryFlows: deliveryFlows.list().map(({ id, status, stageSequence }) => ({ id, status, stageCount: stageSequence.length })) };
  checks.domains = { ok: true, loaded: domains.list().map(({ manifest, artifacts, policies, knowledge, skills, agents, hooks }) => ({ id: manifest.id, artifacts: artifacts.length, policies: policies.length, knowledge: knowledge.length, skills: skills.length, agents: agents.length, hooks: hooks.length })) };
  checks.integrations = { ok: true, loaded: integrations.list().map(({ manifest }) => ({ ref: `${manifest.id}@${manifest.version}`, owners: manifest.owners, skills: manifest.skills.map(({ id }) => id) })) };

  const stageIssues = unknownStageReferences(stages, [
    ...domains.policies().map(({ policy }) => ({ source: `policy:${policy.id}@${policy.version}`, stageIds: policy.appliesTo.stages })),
    ...domains.knowledge().map(({ asset }) => ({ source: `knowledge:${asset.id}@${asset.version}`, stageIds: asset.appliesTo.stages })),
    ...integrations.list().map(({ manifest }) => ({ source: `integration:${manifest.id}@${manifest.version}`, stageIds: manifest.appliesTo.stages })),
    ...project.policies().map(({ policy }) => ({ source: `project-policy:${policy.id}@${policy.version}`, stageIds: policy.appliesTo.stages })),
    ...project.defaults().map(({ profile }) => ({ source: `project-default:${profile.id}@${profile.version}`, stageIds: profile.appliesTo.stages })),
    ...domains.policies().flatMap(({ policy }) => policy.rules.map((rule) => ({ source: `policy-rule:${policy.id}@${policy.version}#${rule.id}.enforceAt`, stageIds: rule.enforceAt }))),
    ...project.policies().flatMap(({ policy }) => policy.rules.map((rule) => ({ source: `project-policy-rule:${policy.id}@${policy.version}#${rule.id}.enforceAt`, stageIds: rule.enforceAt }))),
  ]);
  const artifactIssues = stages.list().flatMap((stage) => [...(stage.inputArtifacts ?? []), ...(stage.outputArtifacts ?? [])].flatMap((artifact) => {
    try { domains.artifact(artifact); return []; } catch { return [{ code: "UNKNOWN_ARTIFACT_REF", path: `stage:${stage.id}`, message: `Unknown Artifact Definition: ${artifact}` }]; }
  }));
  if (stageIssues.length + artifactIssues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Domain assets reference unknown Stages or Artifacts", [...stageIssues, ...artifactIssues]);
  checks.references = { ok: true };

  const domainHooks = await discoverDomainHooks(stages, domains);
  checks.domainHooks = { ok: true, loaded: domainHooks.map(({ domain, descriptor, bindings }) => ({ domain, version: descriptor.version, stages: bindings.map(({ stage }) => stage) })) };
  const requirementsControl = await loadRequirementsFlowControl(join(HARNESS_ROOT, ".pdlc", "delivery-flows", "poc", "controls", "requirements.json"));
  checks.requirementsFlowControl = { ok: true, loaded: `${requirementsControl.id}@${requirementsControl.version}` };

  const recordSource = options.record ? (isAbsolute(options.record) || options.record.endsWith(".json") ? resolve(options.root, options.record) : new FileStateStore(options.root).recordPath(options.record)) : join(HARNESS_ROOT, ".pdlc", "examples", "poc-delivery-record.json");
  const recordValidation = validatePocDeliveryRecord(JSON.parse(await readFile(recordSource, "utf8")) as unknown);
  checks.record = { ok: recordValidation.ok, source: recordSource, issues: recordValidation.issues };
  if (!recordValidation.ok) throw new PdlcError("VALIDATION_FAILED", `Invalid Delivery Record: ${recordSource}`, recordValidation.issues);
  const activeStages = deliveryFlows.resolve(recordValidation.value.deliveryFlow, contextTags(recordValidation.value)).map(({ definition }) => definition.id);
  const requiredRoles = deliveryFlows.requiredRoles(recordValidation.value.deliveryFlow, contextTags(recordValidation.value));
  const roleIssues = roles.validateAssignments(recordValidation.value, requiredRoles, recordValidation.value.requirements.status === "approved");
  checks.roleAssignments = { ok: roleIssues.length === 0, required: requiredRoles, assigned: Object.keys(recordValidation.value.assignments).sort(), issues: roleIssues };
  if (roleIssues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Delivery Record contains invalid or missing Role assignments", roleIssues);
  const resolution = resolveDomainContext(domains, integrations, project, { deliveryFlow: recordValidation.value.deliveryFlow, stages: activeStages, riskTriggers: recordValidation.value.risk.triggers, technologies: recordValidation.value.design.technologies, domains: recordValidation.value.design.domains });
  checks.resolution = { ok: resolution.issues.length === 0, controls: resolution.controls.map(({ ref }) => ref), defaults: resolution.defaults.map(({ key, sourceRef }) => ({ key, sourceRef })), knowledge: resolution.knowledge.map(({ ref }) => ref), baselines: resolution.baselines.map(({ ref }) => ref), integrations: resolution.integrations.map(({ ref }) => ref), issues: resolution.issues };
  if (resolution.issues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Domain context contains unresolved conflicts", resolution.issues);

  const portability = await validateCorePortability(join(HARNESS_ROOT, ".pdlc", "core"));
  checks.portability = portability;
  if (!portability.ok) throw new PdlcError("PORTABILITY_VIOLATION", "Shared Core contains platform-specific content", portability.issues);
  const entrypoints = await validateConversationEntrypoints(HARNESS_ROOT);
  checks.entrypoints = entrypoints;
  if (!entrypoints.ok) throw new PdlcError("PORTABILITY_VIOLATION", "Conversational entrypoints are missing or have drifted", entrypoints.issues);
  return { ok: true, checks };
}

export async function runCli(args: string[], currentDirectory = process.cwd()): Promise<{ exitCode: number; output: unknown }> {
  try {
    const parsed = parseArguments(args, currentDirectory);
    if (!parsed.command || parsed.command === "help") return { exitCode: 0, output: { name: "Lean PDLC Runner v2", commands: ["status", "validate", "context <stage>", "context-apply <stage>", "readiness build", "checkpoint verify", "checkpoint decide --outcome park|recommend-productization", "guidance <stage>", "domain list", "domain sync", "integration list"] } };
    if (parsed.command === "status") return { exitCode: 0, output: await status(parsed.options) };
    if (parsed.command === "validate") return { exitCode: 0, output: await validate(parsed.options) };
    if (parsed.command === "context") return { exitCode: 0, output: await stageContext(parsed.options, parsed.subcommand) };
    if (parsed.command === "context-apply") return { exitCode: 0, output: await applyStageContext(parsed.options, parsed.subcommand) };
    if (parsed.command === "readiness") return { exitCode: 0, output: await readiness(parsed.options, parsed.subcommand) };
    if (parsed.command === "guidance") return { exitCode: 0, output: await guidance(parsed.options, parsed.subcommand) };
    if (parsed.command === "domain" && parsed.subcommand === "list") return { exitCode: 0, output: await domainList() };
    if (parsed.command === "domain" && parsed.subcommand === "sync") return { exitCode: 0, output: await domainSync(parsed.options) };
    if (parsed.command === "domain") throw new PdlcError("INVALID_ARGUMENT", "Domain command must be list or sync");
    if (parsed.command === "integration" && parsed.subcommand === "list") return { exitCode: 0, output: await integrationList() };
    if (parsed.command === "integration") throw new PdlcError("INVALID_ARGUMENT", "Integration command must be list");
    if (parsed.command === "checkpoint") return { exitCode: 0, output: await checkpoint(parsed.options, parsed.subcommand) };
    throw new PdlcError("INVALID_ARGUMENT", `Unknown command: ${parsed.command}`);
  } catch (error) {
    if (error instanceof PdlcError) return { exitCode: 2, output: { ok: false, error: { code: error.code, message: error.message, details: error.details } } };
    return { exitCode: 1, output: { ok: false, error: { code: "UNEXPECTED_ERROR", message: error instanceof Error ? error.message : String(error) } } };
  }
}

async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2));
  (result.exitCode === 0 ? process.stdout : process.stderr).write(`${JSON.stringify(result.output, null, 2)}\n`);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
