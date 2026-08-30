import { join } from "node:path";
import { assessApprovedBuildContract, hashApprovedBuildContract } from "../../core/approval-contract.ts";
import { persistRecordAndAudit } from "../../core/controlled-mutation.ts";
import { resolveDisciplineContext } from "../../core/discipline-resolver.ts";
import { PdlcError } from "../../core/errors.ts";
import type { FlowExecutionContext, FlowRunnerOptions } from "../../core/flow-executor.ts";
import { checkpointFor, flowConstraintIssues } from "../../core/flow-guard.ts";
import { buildReadinessContextStages, contextClassificationIssues, contextTags } from "../../core/poc-progress.ts";
import { assessPocBuildReadiness, hashRequirementsDocument } from "../../core/readiness.ts";
import { loadRequirementsFlowControl } from "../../core/requirements.ts";
import { inspectGitSource } from "../../core/source-integrity.ts";
import type { PocDeliveryRecord } from "../../core/types.ts";

export async function pocBuildReadiness(context: FlowExecutionContext, options: FlowRunnerOptions, original: PocDeliveryRecord): Promise<unknown> {
  const approvalActor = options.actor?.trim();
  if (options.check && !approvalActor) throw new PdlcError("INVALID_ARGUMENT", "Build Readiness check requires --actor <identity> to simulate Flow-owned assignments and approval");
  const tagIssues = contextClassificationIssues(original);
  if (tagIssues.length > 0) throw new PdlcError("BUILD_NOT_READY", "Technology classification must use canonical context tags", tagIssues);
  const harness = context.harness;
  const { roles, deliveryFlows, disciplines, integrations, project } = harness.model;
  const flow = context.flow;
  const commit = checkpointFor(flow, "commit");
  let record = original;
  const commitRequested = Boolean(approvalActor) && !options.check;
  const activeStages = deliveryFlows.resolve(flow.id, contextTags(record)).map(({ definition }) => definition.id);
  const requiredRoles = deliveryFlows.requiredRoles(flow.id, contextTags(record));
  const resolution = resolveDisciplineContext(disciplines, integrations, project, { deliveryFlow: flow.id, stages: activeStages, riskTriggers: record.risk.triggers, technologies: record.design.technologies, disciplines: record.design.disciplines });
  if (resolution.issues.length > 0) throw new PdlcError("BUILD_NOT_READY", "Discipline context contains unresolved conflicts", resolution.issues);

  if (approvalActor) {
    if (!commit.from.includes(original.status) || !commit.to) throw new PdlcError("INVALID_ARGUMENT", `Build Readiness cannot Commit a record in status ${original.status}`);
    let approvedContentHash: string;
    try { approvedContentHash = await hashRequirementsDocument(options.root, original.requirements.documentRef); }
    catch (error) { throw new PdlcError("BUILD_NOT_READY", "Requirements document cannot be approved", [{ code: "REQUIREMENTS_DOCUMENT_UNREADABLE", path: "$.requirements.documentRef", message: error instanceof Error ? error.message : String(error) }]); }
    const sourceSnapshot = await inspectGitSource(options.root);
    if (sourceSnapshot && sourceSnapshot.dirtyApplicationPaths.length > 0) throw new PdlcError("BUILD_NOT_READY", "Application source contains uncommitted changes; establish a clean source baseline before Build Readiness", sourceSnapshot.dirtyApplicationPaths.map((path) => ({ code: "APPLICATION_SOURCE_DIRTY", path, message: "Commit or remove the application change before approval" })));
    const timestamp = new Date().toISOString();
    const buildApprovalControls = new Set(resolution.controls.filter(({ policy }) => policy.rules.some(({ enforcement, enforceAt }) => enforcement === "approval" && enforceAt.includes("build-readiness"))).map(({ ref }) => ref));
    const proposed = {
      ...original,
      status: commit.to as PocDeliveryRecord["status"],
      revision: original.revision + 1,
      updatedAt: timestamp,
      assignments: Object.fromEntries(requiredRoles.map((role) => [role, approvalActor])),
      source: { ...original.source, baseRevision: sourceSnapshot?.revision ?? original.source.baseRevision },
      idea: { ...original.idea, timebox: flow.controls.deliveryDefaults.timebox },
      requirements: { ...original.requirements, status: "approved" as const, approvedBy: approvalActor, approvedAt: timestamp, approvedContentHash, approvedContractHash: "" },
      resolution: {
        controls: { ...original.resolution.controls, applicable: resolution.controls.map(({ ref }) => ref), applications: original.resolution.controls.applications.map((application) => application.disposition === "satisfied" && buildApprovalControls.has(application.control) ? { ...application, approvedBy: approvalActor } : application) },
        baselines: resolution.baselines.map(({ ref }) => ref),
        defaults: resolution.defaults.map(({ sourceRef, key }) => `${sourceRef}:${key}`),
        knowledge: resolution.knowledge.map(({ ref }) => ref),
        integrations: resolution.integrations.map(({ ref }) => ref),
        contextApplications: original.resolution.contextApplications,
      },
    };
    record = { ...proposed, requirements: { ...proposed.requirements, approvedContractHash: hashApprovedBuildContract(proposed) } };
    if (original.requirements.status === "approved" && original.requirements.approvedContentHash === approvedContentHash && original.requirements.approvedContractHash === record.requirements.approvedContractHash) throw new PdlcError("INVALID_ARGUMENT", "Requirements and the approved build contract are unchanged; no new approval is needed");
  }

  const roleIssues = roles.validateAssignments(record, requiredRoles);
  if (roleIssues.length > 0) throw new PdlcError("BUILD_NOT_READY", "Required Delivery Flow Roles are not assigned", roleIssues);
  const constraints = flowConstraintIssues(record, flow, resolution.integrations.map(({ ref }) => ref), requiredRoles);
  if (constraints.length > 0) throw new PdlcError("BUILD_NOT_READY", "Delivery Flow constraints are not satisfied", constraints);
  const [contextIssues, policy] = await Promise.all([
    harness.contextIssues(record, buildReadinessContextStages(record)),
    loadRequirementsFlowControl(join(context.harnessRoot, ".pdlc", "delivery-flows", "poc", "controls", "requirements.json")),
  ]);
  if (contextIssues.length > 0) throw new PdlcError("BUILD_NOT_READY", "Required Stage context has not been applied or is stale", contextIssues);
  const result = await assessPocBuildReadiness(record, options.root, resolution.controls, policy, resolution.defaults, requiredRoles);
  if (!result.ok) throw new PdlcError("BUILD_NOT_READY", "POC requirements or mandatory Controls are not ready for build", result.issues);
  if (commitRequested && approvalActor) await persistRecordAndAudit(options.root, original, record, { eventType: "CHECKPOINT_APPROVED", checkpoint: "commit", fromStatus: original.status, toStatus: record.status, actor: approvalActor, riskLevel: record.risk.level, evidenceRefs: [record.requirements.documentRef, ...record.resolution.controls.applicable] });
  return {
    ok: true,
    mode: options.check ? "check" : commitRequested ? "commit" : "assessment",
    wouldMutate: commitRequested,
    recordId: record.id,
    target: "build",
    transition: approvalActor ? { checkpoint: "commit", from: original.status, to: record.status } : undefined,
    deliveryFlow: { id: flow.id, activeStages },
    approval: { status: record.requirements.status, approvedBy: record.requirements.approvedBy, approvedAt: record.requirements.approvedAt, contentHash: record.requirements.approvedContentHash, contractHash: record.requirements.approvedContractHash },
    deliveryControls: { roleAssignmentMode: flow.controls.deliveryDefaults.roleAssignmentMode, assignments: record.assignments, timebox: record.idea.timebox, requirementsProfile: flow.controls.deliveryDefaults.requirementsProfile },
    requirements: result.requirementsDocument,
    controls: result.controls,
    projectBaselines: resolution.baselines.map(({ ref }) => ref),
    defaults: resolution.defaults.map(({ key, sourceRef, locked }) => ({ key, source: sourceRef, locked })),
    knowledge: resolution.knowledge.map(({ ref }) => ref),
    integrations: resolution.integrations.map(({ ref, owners, permissions, skills }) => ({ ref, owners, permissions, skills: skills.map(({ id }) => id) })),
  };
}
