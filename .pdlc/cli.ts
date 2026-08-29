import { readFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AuditLog } from "./core/audit.ts";
import { buildPocAuditSummary } from "./core/audit-summary.ts";
import { assessApprovedBuildContract, hashApprovedBuildContract } from "./core/approval-contract.ts";
import { persistRecordAndAudit } from "./core/controlled-mutation.ts";
import { projectKnowledgeRefs, resolveDomainContext } from "./core/domain-resolver.ts";
import { PdlcError } from "./core/errors.ts";
import { assessEvidenceIntegrity } from "./core/evidence.ts";
import { assertCheckpointActor, checkpointFor, flowConstraintIssues } from "./core/flow-guard.ts";
import { HarnessContext } from "./core/harness-context.ts";
import { initializePocDeliveryRecord } from "./core/initialization.ts";
import { buildReadinessContextStages, contextClassificationIssues, contextTags, operationalContextStages, verificationContextStages } from "./core/poc-progress.ts";
import { assessProductizationPackage } from "./core/productization.ts";
import { assessControlApplications, assessPocBuildReadiness, assessResolvedControlSet, hashRequirementsDocument } from "./core/readiness.ts";
import { loadRequirementsFlowControl } from "./core/requirements.ts";
import { FileStateStore } from "./core/state.ts";
import { buildPocStatusSummary } from "./core/status-summary.ts";
import type { PocDeliveryRecord } from "./core/types.ts";
import { applyStageContext, domainList, domainSync, guidance, integrationList, stageContext } from "./commands/context.ts";
import type { RunnerOptions } from "./commands/types.ts";
import { validateHarness } from "./commands/validate.ts";

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = resolve(MODULE_DIRECTORY, "..");

interface ParsedArguments { command?: string; subcommand?: string; options: RunnerOptions }

function parseArguments(args: string[], currentDirectory: string): ParsedArguments {
  const positional: string[] = [];
  const options: RunnerOptions = { root: currentDirectory };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") positional.push("help");
    else if (argument === "--check") options.check = true;
    else if (["--root", "--record", "--actor", "--receipt", "--outcome", "--input"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new PdlcError("INVALID_ARGUMENT", `Missing value for ${argument}`);
      if (argument === "--root") options.root = resolve(currentDirectory, value);
      else if (argument === "--record") options.record = value;
      else if (argument === "--actor") options.actor = value;
      else if (argument === "--receipt") options.receipt = value;
      else if (argument === "--outcome") options.outcome = value;
      else options.input = value;
      index += 1;
    } else if (argument.startsWith("--")) throw new PdlcError("INVALID_ARGUMENT", `Unknown option: ${argument}`);
    else positional.push(argument);
  }
  if (positional.length > 2) throw new PdlcError("INVALID_ARGUMENT", `Too many positional arguments: ${positional.slice(2).join(" ")}`);
  return { command: positional[0], subcommand: positional[1], options };
}

async function readRecord(options: RunnerOptions): Promise<PocDeliveryRecord> {
  const store = new FileStateStore(options.root);
  return options.record ? store.readRecord(options.record) : store.readCurrentRecord();
}

async function readiness(options: RunnerOptions, target?: string): Promise<unknown> {
  if (target !== "build") throw new PdlcError("INVALID_ARGUMENT", "Readiness target must be 'build'");
  const approvalActor = options.actor?.trim();
  if (options.check && !approvalActor) throw new PdlcError("INVALID_ARGUMENT", "Build Readiness check requires --actor <identity> to simulate Flow-owned assignments and approval");
  const original = await readRecord(options);
  const tagIssues = contextClassificationIssues(original);
  if (tagIssues.length > 0) throw new PdlcError("BUILD_NOT_READY", "Technology classification must use canonical context tags", tagIssues);
  const harness = await HarnessContext.load(HARNESS_ROOT, options.root);
  const { roles, deliveryFlows, domains, integrations, project } = harness.model;
  const flow = deliveryFlows.getExecutable("poc");
  const commit = checkpointFor(flow, "commit");
  let record = original;
  const commitRequested = Boolean(approvalActor) && !options.check;
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

  if (approvalActor) {
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
    const timestamp = new Date().toISOString();
    const buildApprovalControls = new Set(resolution.controls
      .filter(({ policy }) => policy.rules.some(({ enforcement, enforceAt }) => enforcement === "approval" && enforceAt.includes("build-readiness")))
      .map(({ ref }) => ref));
    const proposed = {
      ...original,
      status: commit.to as PocDeliveryRecord["status"],
      revision: original.revision + 1,
      updatedAt: timestamp,
      assignments: Object.fromEntries(requiredRoles.map((role) => [role, approvalActor])),
      idea: { ...original.idea, timebox: flow.controls.deliveryDefaults.timebox },
      requirements: { ...original.requirements, status: "approved" as const, approvedBy: approvalActor, approvedAt: timestamp, approvedContentHash, approvedContractHash: "" },
      resolution: {
        controls: {
          ...original.resolution.controls,
          applicable: resolution.controls.map(({ ref }) => ref),
          applications: original.resolution.controls.applications.map((application) => (
            application.disposition === "satisfied" && buildApprovalControls.has(application.control)
              ? { ...application, approvedBy: approvalActor }
              : application
          )),
        },
        baselines: resolution.baselines.map(({ ref }) => ref),
        defaults: resolution.defaults.map(({ sourceRef, key }) => `${sourceRef}:${key}`),
        knowledge: resolution.knowledge.map(({ ref }) => ref),
        integrations: resolution.integrations.map(({ ref }) => ref),
        contextApplications: original.resolution.contextApplications,
      },
    };
    record = {
      ...proposed,
      requirements: { ...proposed.requirements, approvedContractHash: hashApprovedBuildContract(proposed) },
    };
    if (
      original.requirements.status === "approved"
      && original.requirements.approvedContentHash === approvedContentHash
      && original.requirements.approvedContractHash === record.requirements.approvedContractHash
    ) throw new PdlcError("INVALID_ARGUMENT", "Requirements and the approved build contract are unchanged; no new approval is needed");
  }

  const roleIssues = roles.validateAssignments(record, requiredRoles);
  if (roleIssues.length > 0) throw new PdlcError("BUILD_NOT_READY", "Required Delivery Flow Roles are not assigned", roleIssues);
  const constraints = flowConstraintIssues(record, flow, resolution.integrations.map(({ ref }) => ref), requiredRoles);
  if (constraints.length > 0) throw new PdlcError("BUILD_NOT_READY", "Delivery Flow constraints are not satisfied", constraints);

  const receiptStages = buildReadinessContextStages();
  const [contextIssues, policy] = await Promise.all([
    harness.contextIssues(record, receiptStages),
    loadRequirementsFlowControl(join(HARNESS_ROOT, ".pdlc", "delivery-flows", "poc", "controls", "requirements.json")),
  ]);
  if (contextIssues.length > 0) throw new PdlcError("BUILD_NOT_READY", "Required Stage context has not been applied or is stale", contextIssues);

  const result = await assessPocBuildReadiness(record, options.root, resolution.controls, policy, resolution.defaults, requiredRoles);
  if (!result.ok) throw new PdlcError("BUILD_NOT_READY", "POC requirements or mandatory Controls are not ready for build", result.issues);
  if (commitRequested && approvalActor) {
    await persistRecordAndAudit(options.root, original, record, {
      eventType: "CHECKPOINT_APPROVED",
      checkpoint: "commit",
      fromStatus: original.status,
      toStatus: record.status,
      actor: approvalActor,
      riskLevel: record.risk.level,
      evidenceRefs: [record.requirements.documentRef, ...record.resolution.controls.applicable],
    });
  }
  return {
    ok: true,
    mode: options.check ? "check" : commitRequested ? "commit" : "assessment",
    wouldMutate: commitRequested,
    recordId: record.id,
    target,
    transition: approvalActor ? { checkpoint: "commit", from: original.status, to: record.status } : undefined,
    deliveryFlow: { id: flow.id, activeStages },
    approval: { status: record.requirements.status, approvedBy: record.requirements.approvedBy, approvedAt: record.requirements.approvedAt, contentHash: record.requirements.approvedContentHash, contractHash: record.requirements.approvedContractHash },
    deliveryControls: { roleAssignmentMode: flow.controls.deliveryDefaults.roleAssignmentMode, assignments: record.assignments, timebox: record.idea.timebox, requirementsProfile: flow.controls.deliveryDefaults.requirementsProfile },
    requirements: result.requirementsDocument,
    controls: result.controls,
    projectBaselines: resolution.baselines.map(({ ref }) => ref),
    defaults: resolution.defaults.map(({ key, sourceRef, locked }) => ({ key, source: sourceRef, locked })),
    knowledge: [...resolution.knowledge.map(({ ref }) => ref), ...projectKnowledgeRefs(project, options.root)],
    integrations: resolution.integrations.map(({ ref, owners, permissions, skills }) => ({ ref, owners, permissions, skills: skills.map(({ id }) => id) })),
  };
}

async function checkpoint(options: RunnerOptions, checkpointId?: string): Promise<unknown> {
  if (!checkpointId) throw new PdlcError("INVALID_ARGUMENT", "Checkpoint id is required");
  if (checkpointId === "commit") throw new PdlcError("INVALID_ARGUMENT", "Commit is performed by the approved 'readiness build' operation");
  const original = await readRecord(options);
  const harness = await HarnessContext.load(HARNESS_ROOT, options.root);
  const { deliveryFlows, domains, integrations, project } = harness.model;
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
    const issues = flowConstraintIssues(original, flow, resolution.integrations.map(({ ref }) => ref), requiredRoles);
    if (original.evidence.tests.length === 0) issues.push({ code: "TEST_EVIDENCE_MISSING", path: "$.evidence.tests", message: "Test evidence is required before Verify" });
    if (original.evidence.build.length === 0) issues.push({ code: "BUILD_EVIDENCE_MISSING", path: "$.evidence.build", message: "Build evidence is required before Verify" });
    if (original.evidence.demo.length === 0) issues.push({ code: "DEMO_EVIDENCE_MISSING", path: "$.evidence.demo", message: "POC demonstration evidence is required before Verify" });
    if (activeStages.includes("security-verification") && original.evidence.security.length === 0) issues.push({ code: "SECURITY_EVIDENCE_MISSING", path: "$.evidence.security", message: "Security evidence is required because the Security Verification Stage is active" });
    evidenceRefs = [original.evidence.tests, original.evidence.build, original.evidence.security, original.evidence.demo].flat().map(({ ref }) => ref);
    const receiptStages = verificationContextStages(original);
    const [approvalIssues, evidenceIssues, contextIssues] = await Promise.all([
      assessApprovedBuildContract(original, options.root),
      assessEvidenceIntegrity(options.root, [
        { name: "tests", entries: original.evidence.tests },
        { name: "build", entries: original.evidence.build },
        { name: "security", entries: original.evidence.security },
        { name: "demo", entries: original.evidence.demo },
      ]),
      harness.contextIssues(original, receiptStages),
    ]);
    issues.push(...approvalIssues, ...evidenceIssues);
    issues.push(...assessResolvedControlSet(original, resolution.controls));
    issues.push(...assessControlApplications(original, resolution.controls, ["developer-verification", "security-verification", "acceptance-verification"], new Set(evidenceRefs)));
    issues.push(...contextIssues);
    if (issues.length > 0) throw new PdlcError("BUILD_NOT_READY", "POC evidence or mandatory Controls are not ready for Verify", issues);
    targetStatus = definition.to as PocDeliveryRecord["status"];
  } else if (checkpointId === "decide") {
    if (!definition.toByOutcome) throw new PdlcError("INVALID_ARGUMENT", "Decide checkpoint has no outcome transitions");
    if (!options.outcome || !["park", "recommend-productization"].includes(options.outcome)) throw new PdlcError("INVALID_ARGUMENT", "Decide requires --outcome park|recommend-productization");
    if (original.decision.outcome && original.decision.outcome !== options.outcome) throw new PdlcError("INVALID_ARGUMENT", "Requested outcome conflicts with the Delivery Record decision");
    if (!original.decision.rationale.trim() || !original.decision.followUp.trim()) throw new PdlcError("BUILD_NOT_READY", "Decision rationale and follow-up are required before Decide");
    const approvalIssues = await assessApprovedBuildContract(original, options.root);
    if (approvalIssues.length > 0) throw new PdlcError("BUILD_NOT_READY", "The approved build contract is no longer intact", approvalIssues);
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
  await persistRecordAndAudit(options.root, original, updated, {
    eventType: "CHECKPOINT_APPROVED",
    checkpoint: checkpointId,
    fromStatus: original.status,
    toStatus: updated.status,
    actor,
    riskLevel: updated.risk.level,
    evidenceRefs,
    decision,
  });
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

async function status(options: RunnerOptions): Promise<unknown> {
  try {
    const record = await readRecord(options);
    const harness = await HarnessContext.load(HARNESS_ROOT, options.root);
    const [stageContextIssues, approvalIssues, packageAssessment] = await Promise.all([
      harness.contextIssues(record, operationalContextStages(record)),
      assessApprovedBuildContract(record, options.root),
      record.status === "VERIFIED" ? assessProductizationPackage(options.root, record) : Promise.resolve(undefined),
    ]);
    const contextIssues = [
      ...contextClassificationIssues(record),
      ...stageContextIssues,
    ];
    return { ok: true, initialized: true, ...buildPocStatusSummary(record, packageAssessment, contextIssues, approvalIssues) };
  } catch (error) {
    if (error instanceof PdlcError && error.code === "CURRENT_RECORD_NOT_SET") return { ok: true, initialized: false, message: error.message };
    throw error;
  }
}

async function initialize(options: RunnerOptions): Promise<unknown> {
  if (!options.input) throw new PdlcError("INVALID_ARGUMENT", "Init requires --input <draft-record.json>");
  if (!options.actor?.trim()) throw new PdlcError("INVALID_ARGUMENT", "Init requires --actor <identity>");
  const inboxRoot = resolve(options.root, ".pdlc", "runtime", "inbox");
  const inputPath = isAbsolute(options.input) ? resolve(options.input) : resolve(options.root, options.input);
  const inputFromInbox = relative(inboxRoot, inputPath);
  if (inputFromInbox === "" || inputFromInbox === ".." || inputFromInbox.startsWith(`..${sep}`) || isAbsolute(inputFromInbox) || !inputPath.endsWith(".json")) {
    throw new PdlcError("INVALID_ARGUMENT", "Init input must be a JSON file under .pdlc/runtime/inbox/");
  }
  let raw: unknown;
  try { raw = JSON.parse(await readFile(inputPath, "utf8")) as unknown; }
  catch (error) { throw new PdlcError("VALIDATION_FAILED", "Initial POC draft cannot be read", error instanceof Error ? error.message : String(error)); }
  const initialized = await initializePocDeliveryRecord(options.root, raw, options.actor);
  let inputConsumed = true;
  try { await unlink(inputPath); } catch { inputConsumed = false; }
  return {
    ok: true,
    recordId: initialized.record.id,
    deliveryFlow: initialized.record.deliveryFlow,
    status: initialized.record.status,
    stage: initialized.event.stage,
    revision: initialized.record.revision,
    current: true,
    auditEvent: { eventId: initialized.event.eventId, eventType: initialized.event.eventType, actor: initialized.event.actor, timestamp: initialized.event.timestamp, recordHash: initialized.event.recordHash },
    inputConsumed,
  };
}

async function auditSummary(options: RunnerOptions, subcommand?: string): Promise<unknown> {
  if (subcommand !== "summary") throw new PdlcError("INVALID_ARGUMENT", "Audit command must be summary");
  let record: PocDeliveryRecord;
  try {
    record = await readRecord(options);
  } catch (error) {
    if (!options.record && error instanceof PdlcError && error.code === "CURRENT_RECORD_NOT_SET") {
      return { ok: true, initialized: false, message: "No active Delivery Record is selected" };
    }
    throw error;
  }
  const events = await new AuditLog(options.root).readAll();
  return { ok: true, initialized: true, ...buildPocAuditSummary(record, events) };
}

export async function runCli(args: string[], currentDirectory = process.cwd()): Promise<{ exitCode: number; output: unknown }> {
  try {
    const parsed = parseArguments(args, currentDirectory);
    if (!parsed.command || parsed.command === "help") return { exitCode: 0, output: { name: "Lean PDLC Runner v2", commands: ["init --input <draft-record.json> --actor <identity>", "status", "audit summary", "validate", "context <stage>", "context-apply <stage>", "readiness build --check --actor <identity>", "readiness build --actor <identity>", "checkpoint verify", "checkpoint decide --outcome park|recommend-productization", "guidance <stage>", "domain list", "domain sync", "integration list"] } };
    if (parsed.command === "init") return { exitCode: 0, output: await initialize(parsed.options) };
    if (parsed.command === "status") return { exitCode: 0, output: await status(parsed.options) };
    if (parsed.command === "audit") return { exitCode: 0, output: await auditSummary(parsed.options, parsed.subcommand) };
    if (parsed.command === "validate") return { exitCode: 0, output: await validateHarness(HARNESS_ROOT, parsed.options) };
    if (parsed.command === "context") return { exitCode: 0, output: await stageContext(HARNESS_ROOT, parsed.options, parsed.subcommand) };
    if (parsed.command === "context-apply") return { exitCode: 0, output: await applyStageContext(HARNESS_ROOT, parsed.options, parsed.subcommand) };
    if (parsed.command === "readiness") return { exitCode: 0, output: await readiness(parsed.options, parsed.subcommand) };
    if (parsed.command === "guidance") return { exitCode: 0, output: await guidance(HARNESS_ROOT, parsed.subcommand) };
    if (parsed.command === "domain" && parsed.subcommand === "list") return { exitCode: 0, output: await domainList(HARNESS_ROOT) };
    if (parsed.command === "domain" && parsed.subcommand === "sync") return { exitCode: 0, output: await domainSync(HARNESS_ROOT, parsed.options) };
    if (parsed.command === "domain") throw new PdlcError("INVALID_ARGUMENT", "Domain command must be list or sync");
    if (parsed.command === "integration" && parsed.subcommand === "list") return { exitCode: 0, output: await integrationList(HARNESS_ROOT) };
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
