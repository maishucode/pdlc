import { assessApprovedBuildContract } from "../../core/approval-contract.ts";
import { persistRecordAndAudit } from "../../core/controlled-mutation.ts";
import { resolveDisciplineContext } from "../../core/discipline-resolver.ts";
import { PdlcError } from "../../core/errors.ts";
import { assessEvidenceIntegrity } from "../../core/evidence.ts";
import type { FlowExecutionContext, FlowRunnerOptions } from "../../core/flow-executor.ts";
import { assertCheckpointActor, checkpointFor, flowConstraintIssues } from "../../core/flow-guard.ts";
import { contextTags, verificationContextStages } from "../../core/poc-progress.ts";
import { assessProductizationPackage } from "../../core/productization.ts";
import { assessControlApplications, assessResolvedControlSet } from "../../core/readiness.ts";
import { inspectGitSource } from "../../core/source-integrity.ts";
import type { PocDeliveryRecord } from "../../core/types.ts";

export async function pocCheckpoint(context: FlowExecutionContext, options: FlowRunnerOptions, checkpointId: string, original: PocDeliveryRecord): Promise<unknown> {
  if (checkpointId === "commit") throw new PdlcError("INVALID_ARGUMENT", "Commit is performed by the approved 'readiness build' operation");
  const harness = context.harness;
  const { deliveryFlows, disciplines, integrations, project } = harness.model;
  const flow = context.flow;
  const definition = checkpointFor(flow, checkpointId);
  const actor = assertCheckpointActor(original, definition, options.actor);
  if (!definition.from.includes(original.status)) throw new PdlcError("INVALID_ARGUMENT", `Checkpoint '${checkpointId}' cannot transition a record in status ${original.status}`);

  let targetStatus: PocDeliveryRecord["status"];
  let decision: string | undefined;
  let productizationPackageHash: string | undefined;
  let deliveredRevision = original.source.deliveredRevision;
  let evidenceRefs: string[] = [];
  if (checkpointId === "verify") {
    if (!definition.to) throw new PdlcError("INVALID_ARGUMENT", "Verify checkpoint has no target status");
    const sourceSnapshot = await inspectGitSource(options.root);
    if (sourceSnapshot && sourceSnapshot.dirtyApplicationPaths.length > 0) throw new PdlcError("BUILD_NOT_READY", "Application source contains uncommitted changes; verification must bind to an immutable Git revision", sourceSnapshot.dirtyApplicationPaths.map((path) => ({ code: "APPLICATION_SOURCE_DIRTY", path, message: "Commit the application change before Verify" })));
    deliveredRevision = sourceSnapshot?.revision ?? deliveredRevision;
    const activeStages = deliveryFlows.resolve(flow.id, contextTags(original)).map(({ definition: stage }) => stage.id);
    const requiredRoles = deliveryFlows.requiredRoles(flow.id, contextTags(original));
    const resolution = resolveDisciplineContext(disciplines, integrations, project, { deliveryFlow: flow.id, stages: activeStages, riskTriggers: original.risk.triggers, technologies: original.design.technologies, disciplines: original.design.disciplines });
    if (resolution.issues.length > 0) throw new PdlcError("BUILD_NOT_READY", "Discipline context contains unresolved conflicts", resolution.issues);
    const issues = flowConstraintIssues(original, flow, resolution.integrations.map(({ ref }) => ref), requiredRoles);
    if (original.evidence.tests.length === 0) issues.push({ code: "TEST_EVIDENCE_MISSING", path: "$.evidence.tests", message: "Test evidence is required before Verify" });
    if (original.evidence.build.length === 0) issues.push({ code: "BUILD_EVIDENCE_MISSING", path: "$.evidence.build", message: "Build evidence is required before Verify" });
    if (original.evidence.demo.length === 0) issues.push({ code: "DEMO_EVIDENCE_MISSING", path: "$.evidence.demo", message: "POC demonstration evidence is required before Verify" });
    if (activeStages.includes("security-verification") && original.evidence.security.length === 0) issues.push({ code: "SECURITY_EVIDENCE_MISSING", path: "$.evidence.security", message: "Security evidence is required because the Security Verification Stage is active" });
    evidenceRefs = [original.evidence.tests, original.evidence.build, original.evidence.security, original.evidence.demo].flat().map(({ ref }) => ref);
    const [approvalIssues, evidenceIssues, contextIssues] = await Promise.all([
      assessApprovedBuildContract(original, options.root),
      assessEvidenceIntegrity(options.root, [{ name: "tests", entries: original.evidence.tests }, { name: "build", entries: original.evidence.build }, { name: "security", entries: original.evidence.security }, { name: "demo", entries: original.evidence.demo }]),
      harness.contextIssues(original, verificationContextStages(original)),
    ]);
    issues.push(...approvalIssues, ...evidenceIssues, ...assessResolvedControlSet(original, resolution.controls));
    issues.push(...assessControlApplications(original, resolution.controls, ["developer-verification", "security-verification", "acceptance-verification"], new Set(evidenceRefs)), ...contextIssues);
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
      const assessment = await assessProductizationPackage(options.root, original);
      if (!assessment.ok || !assessment.contentHash || !assessment.documentRef) throw new PdlcError("BUILD_NOT_READY", "Productization Package is not ready for recommendation", assessment.issues);
      productizationPackageHash = assessment.contentHash;
      evidenceRefs = [assessment.documentRef];
    }
    const mapped = definition.toByOutcome[decision];
    if (!mapped) throw new PdlcError("INVALID_ARGUMENT", `No Decide transition is defined for outcome: ${decision}`);
    targetStatus = mapped as PocDeliveryRecord["status"];
  } else throw new PdlcError("INVALID_ARGUMENT", `Unsupported checkpoint: ${checkpointId}`);

  const updated: PocDeliveryRecord = {
    ...original,
    status: targetStatus,
    revision: original.revision + 1,
    updatedAt: new Date().toISOString(),
    source: { ...original.source, deliveredRevision },
    decision: decision ? {
      ...original.decision,
      outcome: decision as PocDeliveryRecord["decision"]["outcome"],
      productizationPackage: productizationPackageHash ? { ...original.decision.productizationPackage, documentRef: evidenceRefs[0]!, contentHash: productizationPackageHash } : original.decision.productizationPackage,
    } : original.decision,
  };
  await persistRecordAndAudit(options.root, original, updated, { eventType: "CHECKPOINT_APPROVED", checkpoint: checkpointId, fromStatus: original.status, toStatus: updated.status, actor, riskLevel: updated.risk.level, evidenceRefs, decision });
  return { ok: true, recordId: updated.id, checkpoint: checkpointId, from: original.status, to: updated.status, revision: updated.revision, decision, productizationPackage: productizationPackageHash ? { documentRef: updated.decision.productizationPackage.documentRef, contentHash: productizationPackageHash } : undefined };
}
