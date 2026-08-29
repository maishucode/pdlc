import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  PocDeliveryRecord,
  RequirementsFlowControl,
  ResolvedControl,
  ResolvedStandardDefault,
  ValidationIssue,
} from "./types.ts";

const REQUIREMENTS_MARKERS = [
  "<!-- pdlc:requirements:v2 -->",
  "<!-- pdlc:section:controls -->",
  "<!-- pdlc:section:defaults -->",
  "<!-- pdlc:requirements-review:presented -->",
  "<!-- pdlc:open-questions:none -->",
] as const;

export interface BuildReadinessResult {
  ok: boolean;
  issues: ValidationIssue[];
  requirementsDocument?: string;
  controls: Array<{ ref: string; ownerDomain: string; ruleCount: number }>;
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}

function isInsideWorkspace(workspaceRoot: string, target: string): boolean {
  const pathFromRoot = relative(resolve(workspaceRoot), target);
  return pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
}

export async function hashRequirementsDocument(workspaceRoot: string, documentRef: string): Promise<string> {
  if (isAbsolute(documentRef)) throw new Error("Requirements reference must be relative to the workspace");
  const documentPath = resolve(workspaceRoot, documentRef);
  if (!isInsideWorkspace(workspaceRoot, documentPath)) throw new Error("Requirements reference escapes the workspace");
  const contents = await readFile(documentPath, "utf8");
  return createHash("sha256").update(contents).digest("hex");
}

export async function assessPocBuildReadiness(
  record: PocDeliveryRecord,
  workspaceRoot: string,
  controls: ResolvedControl[],
  policy: RequirementsFlowControl,
  standardDefaults: ResolvedStandardDefault[],
  requiredRoles: readonly string[],
): Promise<BuildReadinessResult> {
  const enforcementStage = "build-readiness";
  const issues: ValidationIssue[] = [];
  let requirementsDocument: string | undefined;

  if (record.requirements.artifactType !== policy.artifactType) {
    issues.push(issue("REQUIREMENTS_ARTIFACT_MISMATCH", "$.requirements.artifactType", `Expected ${policy.artifactType}`));
  }
  if (record.requirements.status !== "approved") {
    issues.push(issue("REQUIREMENTS_NOT_APPROVED", "$.requirements.status", "Explicit Product approval is required before build"));
  }
  if (!record.requirements.approvedBy || !record.requirements.approvedAt) {
    issues.push(issue("REQUIREMENTS_APPROVAL_MISSING", "$.requirements", "Approved requirements must identify the approver and approval time"));
  }
  for (const role of requiredRoles) {
    if (!record.assignments[role]?.trim()) issues.push(issue("ROLE_ASSIGNMENT_MISSING", `$.assignments.${role}`, `The ${role} role must be assigned before build`));
  }
  for (const field of ["problem", "hypothesis", "expectedOutcome", "timebox"] as const) {
    if (!record.idea[field].trim()) issues.push(issue("IDEA_FIELD_MISSING", `$.idea.${field}`, `${field} must be confirmed before build`));
  }
  if (record.idea.successCriteria.length === 0) issues.push(issue("SUCCESS_CRITERIA_MISSING", "$.idea.successCriteria", "At least one measurable success criterion is required before build"));
  if (record.scope.inScope.length === 0 || record.scope.outOfScope.length === 0) issues.push(issue("SCOPE_INCOMPLETE", "$.scope", "Both in-scope and out-of-scope boundaries are required before build"));

  const documentRef = record.requirements.documentRef;
  if (isAbsolute(documentRef)) {
    issues.push(issue("UNSAFE_REQUIREMENTS_REF", "$.requirements.documentRef", "Requirements reference must be relative to the workspace"));
  } else {
    const documentPath = resolve(workspaceRoot, documentRef);
    if (!isInsideWorkspace(workspaceRoot, documentPath)) {
      issues.push(issue("UNSAFE_REQUIREMENTS_REF", "$.requirements.documentRef", "Requirements reference escapes the workspace"));
    } else {
      try {
        const contents = await readFile(documentPath, "utf8");
        requirementsDocument = contents;
        const actualHash = createHash("sha256").update(contents).digest("hex");
        if (record.requirements.status === "approved" && record.requirements.approvedContentHash !== actualHash) {
          issues.push(issue("REQUIREMENTS_CHANGED_AFTER_APPROVAL", "$.requirements.approvedContentHash", "Requirements content no longer matches the approved version"));
        }
        for (const marker of REQUIREMENTS_MARKERS) {
          if (!contents.includes(marker)) issues.push(issue("REQUIREMENTS_SECTION_MISSING", "$.requirements.documentRef", `Missing required document marker: ${marker}`));
        }
        for (const standard of standardDefaults) {
          if (!contents.includes(standard.key) || !contents.includes(standard.sourceRef)) {
            issues.push(issue("STANDARD_DEFAULT_NOT_TRACED", "$.requirements.documentRef", `Requirements must show default ${standard.key} from ${standard.sourceRef}`));
          }
        }
        for (const prefix of ["FR-", "AC-"] as const) {
          if (!contents.includes(prefix)) issues.push(issue("REQUIREMENTS_ID_MISSING", "$.requirements.documentRef", `Requirements document must contain at least one ${prefix} identifier`));
        }
        const decisionIds = new Set(contents.match(/\bRQ-\d{3,}\b/g) ?? []);
        if (decisionIds.size !== record.requirements.clarification.questionsAnswered) {
          issues.push(issue("CLARIFICATION_COUNT_MISMATCH", "$.requirements.clarification.questionsAnswered", `Delivery Record says ${record.requirements.clarification.questionsAnswered} answered questions but the document traces ${decisionIds.size}`));
        }
        const profile = policy.profiles[record.requirements.profile];
        if (decisionIds.size < profile.minimumAnsweredQuestions) {
          issues.push(issue("INSUFFICIENT_CLARIFICATION", "$.requirements.clarification.questionsAnswered", `${record.requirements.profile} profile requires at least ${profile.minimumAnsweredQuestions} traceable clarification decisions`));
        }
        const visibleContents = contents.replace(/<!--[\s\S]*?-->/g, "");
        if (/<[^>]+>|\bTBD\b|Draft pending|Pending confirmation|Pending clarification/i.test(visibleContents)) {
          issues.push(issue("REQUIREMENTS_PLACEHOLDER_REMAINS", "$.requirements.documentRef", "Requirements document still contains draft placeholders"));
        }
      } catch (error) {
        issues.push(issue("REQUIREMENTS_DOCUMENT_UNREADABLE", "$.requirements.documentRef", error instanceof Error ? error.message : String(error)));
      }
    }
  }

  const profile = policy.profiles[record.requirements.profile];
  for (const topic of profile.requiredTopics) {
    if (record.requirements.clarification.coverage[topic] !== "complete") {
      issues.push(issue("REQUIREMENTS_COVERAGE_INCOMPLETE", `$.requirements.clarification.coverage.${topic}`, `Required clarification topic is not complete: ${topic}`));
    }
  }
  if (record.requirements.clarification.openQuestions.length > 0) issues.push(issue("OPEN_REQUIREMENTS_QUESTIONS", "$.requirements.clarification.openQuestions", "All open requirements questions must be resolved before approval"));
  if (record.requirements.clarification.contradictions.length > 0) issues.push(issue("REQUIREMENTS_CONTRADICTIONS", "$.requirements.clarification.contradictions", "Contradictions must be resolved before approval"));
  if (!record.design.summary.trim() || record.design.decisions.length === 0) issues.push(issue("LIGHTWEIGHT_DESIGN_MISSING", "$.design", "A lightweight design summary and at least one decision are required before build"));

  const selectedRefs = new Set(controls.map((control) => control.ref));
  const recordedRefs = new Set(record.resolution.controls.applicable);
  for (const ref of selectedRefs) {
    if (!recordedRefs.has(ref)) issues.push(issue("APPLICABLE_CONTROL_MISSING", "$.resolution.controls.applicable", `Resolved Control is not recorded: ${ref}`));
  }
  for (const ref of recordedRefs) {
    if (!selectedRefs.has(ref)) issues.push(issue("STALE_CONTROL_REFERENCE", "$.resolution.controls.applicable", `Recorded Control is not applicable to the active context: ${ref}`));
  }

  const applications = new Map<string, PocDeliveryRecord["resolution"]["controls"]["applications"][number]>();
  for (const application of record.resolution.controls.applications) {
    if (applications.has(application.control)) issues.push(issue("DUPLICATE_CONTROL_APPLICATION", "$.resolution.controls.applications", `Control is applied more than once: ${application.control}`));
    applications.set(application.control, application);
  }
  for (const control of controls) {
    const ref = control.ref;
    const enforcedRules = control.policy.rules.filter((rule) => rule.enforceAt.includes(enforcementStage));
    if (enforcedRules.length === 0) continue;
    const application = applications.get(ref);
    if (!application) {
      issues.push(issue("CONTROL_APPLICATION_MISSING", "$.resolution.controls.applications", `No ${enforcementStage} application disposition is recorded for ${ref}`));
      continue;
    }
    if (application.disposition === "exception") {
      if (!record.resolution.controls.exceptions.some((entry) => entry.startsWith(`${ref}:`))) {
        issues.push(issue("CONTROL_EXCEPTION_MISSING", "$.resolution.controls.exceptions", `An approved exception reference is required for ${ref}`));
      }
      const approvers = new Set(enforcedRules.flatMap((rule) => rule.exceptionApprovers ?? []));
      if (!application.approvedBy || (approvers.size > 0 && !approvers.has(application.approvedBy))) {
        issues.push(issue("CONTROL_EXCEPTION_APPROVER_INVALID", "$.resolution.controls.applications", `Exception for ${ref} must be approved by one of: ${[...approvers].join(", ")}`));
      }
    } else {
      if (enforcedRules.some((rule) => rule.requiredEvidence?.length) && application.evidenceRefs.length === 0) {
        issues.push(issue("CONTROL_EVIDENCE_MISSING", "$.resolution.controls.applications", `Evidence is required for ${ref} at ${enforcementStage}`));
      }
      if (enforcedRules.some((rule) => rule.enforcement === "approval") && !application.approvedBy.trim()) {
        issues.push(issue("CONTROL_APPROVAL_MISSING", "$.resolution.controls.applications", `An approval identity is required for ${ref} at ${enforcementStage}`));
      }
      if (ref === "product-management.requirements-quality@1.0.0" && application.approvedBy !== record.requirements.approvedBy) {
        issues.push(issue("PRODUCT_CONTROL_APPROVER_MISMATCH", "$.resolution.controls.applications", `Product Control approval must match the approved Requirements owner for ${ref}`));
      }
      for (const rule of enforcedRules.filter((entry) => entry.enforcement === "automatic")) {
        const ruleRef = `${ref}#${rule.id}`;
        if (ruleRef !== "product-management.requirements-quality@1.0.0#resolve-material-ambiguity") {
          issues.push(issue("AUTOMATIC_CONTROL_NOT_IMPLEMENTED", "$.resolution.controls.applications", `No automatic evaluator is registered for ${ruleRef}`));
        }
      }
    }
  }
  if (requirementsDocument) for (const ref of record.resolution.controls.applicable) {
    if (!requirementsDocument.includes(ref)) issues.push(issue("CONTROL_NOT_TRACED", "$.requirements.documentRef", `Requirements document does not reference ${ref}`));
  }

  return {
    ok: issues.length === 0,
    issues,
    requirementsDocument: requirementsDocument ? documentRef : undefined,
    controls: controls.map((control) => ({ ref: control.ref, ownerDomain: control.ownerDomain, ruleCount: control.policy.rules.length })),
  };
}
