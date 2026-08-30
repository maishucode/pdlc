import { access } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { assessApprovedBuildContract } from "../../core/approval-contract.ts";
import { buildPocAuditSummary } from "../../core/audit-summary.ts";
import { PdlcError } from "../../core/errors.ts";
import type { DeliveryFlowExecutor } from "../../core/flow-executor.ts";
import { contextClassificationIssues, currentPocStage, operationalContextStages } from "../../core/poc-progress.ts";
import { assessProductizationPackage } from "../../core/productization.ts";
import { loadRequirementsFlowControl } from "../../core/requirements.ts";
import { validatePocDeliveryRecord } from "../../core/schema.ts";
import { buildPocStatusSummary } from "../../core/status-summary.ts";
import type { BaseDeliveryRecord, PocDeliveryRecord, ValidationIssue } from "../../core/types.ts";
import { pocCheckpoint } from "./checkpoint.ts";
import { pocBuildReadiness } from "./readiness.ts";

function asPoc(record: BaseDeliveryRecord): PocDeliveryRecord {
  const validation = validatePocDeliveryRecord(record);
  if (!validation.ok) throw new PdlcError("VALIDATION_FAILED", `POC Delivery Record is invalid: ${record.id}`, validation.issues);
  return validation.value;
}

async function prepareInitialization(projectRoot: string, input: unknown) {
  const validation = validatePocDeliveryRecord(input);
  if (!validation.ok) throw new PdlcError("VALIDATION_FAILED", "Initial POC Delivery Record is invalid", validation.issues);
  const record = validation.value;
  const issues: ValidationIssue[] = [...contextClassificationIssues(record)];
  if (record.requirements.status !== "draft") issues.push({ code: "INITIAL_REQUIREMENTS_INVALID", path: "$.requirements.status", message: "A new POC must start with draft Requirements" });
  if (record.decision.outcome !== "" || record.decision.productizationPackage.contentHash !== "") issues.push({ code: "INITIAL_DECISION_INVALID", path: "$.decision", message: "A new POC cannot have a decision or Productization Package" });
  if ([record.evidence.tests, record.evidence.build, record.evidence.security, record.evidence.demo].some((entries) => entries.length > 0)) issues.push({ code: "INITIAL_EVIDENCE_INVALID", path: "$.evidence", message: "A new POC cannot start with evidence" });
  if (record.resolution.contextApplications.length > 0) issues.push({ code: "INITIAL_CONTEXT_INVALID", path: "$.resolution.contextApplications", message: "Stage Context is applied after initialization" });
  const requirementsPath = resolve(projectRoot, record.requirements.documentRef);
  const location = relative(resolve(projectRoot), requirementsPath);
  if (isAbsolute(record.requirements.documentRef) || location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location)) issues.push({ code: "INITIAL_REQUIREMENTS_REF_UNSAFE", path: "$.requirements.documentRef", message: "Requirements must remain inside the project workspace" });
  if (issues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Initial POC Delivery Record violates initialization constraints", issues);
  try { await access(requirementsPath); }
  catch { throw new PdlcError("VALIDATION_FAILED", "Initial Requirements document does not exist", [{ code: "INITIAL_REQUIREMENTS_MISSING", path: "$.requirements.documentRef", message: `Create ${record.requirements.documentRef} before initializing the POC` }]); }
  return { record, stage: currentPocStage(record), evidenceRefs: [record.requirements.documentRef] };
}

export const deliveryFlowExecutor: DeliveryFlowExecutor = {
  validateConfiguration: async (harnessRoot, flow) => {
    const control = await loadRequirementsFlowControl(join(harnessRoot, ".pdlc", "delivery-flows", flow.id, "controls", "requirements.json"));
    return { requirementsFlowControl: `${control.id}@${control.version}` };
  },
  validateRecord: validatePocDeliveryRecord,
  prepareInitialization: (context, input) => prepareInitialization(context.projectRoot, input),
  checkpoint: (context, options, checkpointId, record) => pocCheckpoint(context, options, checkpointId, asPoc(record)),
  action: (context, options, actionId, record) => {
    if (actionId !== "build-readiness") throw new PdlcError("INVALID_ARGUMENT", `Unsupported POC action: ${actionId}`);
    return pocBuildReadiness(context, options, asPoc(record));
  },
  status: async (context, record) => {
    const selected = asPoc(record);
    const [issues, packageAssessment] = await Promise.all([
      pocOperationalIssues(context, selected),
      selected.status === "VERIFIED" ? assessProductizationPackage(context.projectRoot, selected) : Promise.resolve(undefined),
    ]);
    const classificationCodes = new Set(contextClassificationIssues(selected).map(({ code }) => code));
    return { ok: true, initialized: true, ...buildPocStatusSummary(selected, packageAssessment, issues.filter(({ code }) => classificationCodes.has(code) || code.includes("CONTEXT")), issues.filter(({ code }) => !classificationCodes.has(code) && !code.includes("CONTEXT"))) };
  },
  auditSummary: (_context, record, events) => ({ ok: true, initialized: true, ...buildPocAuditSummary(asPoc(record), events) }),
  operationalIssues: (context, record) => pocOperationalIssues(context, asPoc(record)),
};

async function pocOperationalIssues(context: Parameters<NonNullable<DeliveryFlowExecutor["operationalIssues"]>>[0], record: PocDeliveryRecord): Promise<ValidationIssue[]> {
  const [stageContextIssues, approvalIssues] = await Promise.all([
    context.harness.contextIssues(record, operationalContextStages(record)),
    assessApprovedBuildContract(record, context.projectRoot),
  ]);
  return [...contextClassificationIssues(record), ...stageContextIssues, ...approvalIssues];
}
