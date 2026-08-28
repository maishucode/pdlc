import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { selectApplicablePrinciplesForStages } from "./principles.ts";
import type {
  PocDeliveryRecord,
  PrinciplePack,
  RequirementsPolicy,
  ResolvedStandardDefault,
  ValidationIssue,
} from "./types.ts";

const REQUIREMENTS_MARKERS = [
  "<!-- pdlc:poc-requirements:v2 -->",
  "<!-- pdlc:section:clarification-decisions -->",
  "<!-- pdlc:section:product-context -->",
  "<!-- pdlc:section:functional-requirements -->",
  "<!-- pdlc:section:user-scenarios -->",
  "<!-- pdlc:section:ux-interaction -->",
  "<!-- pdlc:section:acceptance-criteria -->",
  "<!-- pdlc:section:non-functional-requirements -->",
  "<!-- pdlc:section:scope -->",
  "<!-- pdlc:section:data-integrations -->",
  "<!-- pdlc:section:success-measures -->",
  "<!-- pdlc:section:delivery-controls -->",
  "<!-- pdlc:section:principle-packs -->",
  "<!-- pdlc:section:lightweight-design -->",
  "<!-- pdlc:requirements-review:presented -->",
  "<!-- pdlc:open-questions:none -->",
] as const;

export interface BuildReadinessResult {
  ok: boolean;
  issues: ValidationIssue[];
  requirementsDocument?: string;
  principlePacks: Array<{
    ref: string;
    enforcement: "required" | "advisory";
  }>;
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
  packs: PrinciplePack[],
  policy: RequirementsPolicy,
  standardDefaults: ResolvedStandardDefault[] = [],
  principleStageIds: string[] = ["principle-applicability"],
): Promise<BuildReadinessResult> {
  const issues: ValidationIssue[] = [];
  let requirementsDocument: string | undefined;

  if (record.requirements.status !== "approved") {
    issues.push(issue("REQUIREMENTS_NOT_APPROVED", "$.requirements.status", "Explicit Product approval is required before build"));
  }
  if (!record.requirements.approvedBy || !record.requirements.approvedAt) {
    issues.push(issue("REQUIREMENTS_APPROVAL_MISSING", "$.requirements", "Approved requirements must identify the approver and approval time"));
  }
  for (const role of ["product", "developer", "qa"] as const) {
    if (!record.assignments[role].trim()) {
      issues.push(issue("ROLE_ASSIGNMENT_MISSING", `$.assignments.${role}`, `The ${role} role must be assigned before build`));
    }
  }
  for (const field of ["problem", "hypothesis", "expectedOutcome", "timebox"] as const) {
    if (!record.idea[field].trim()) {
      issues.push(issue("IDEA_FIELD_MISSING", `$.idea.${field}`, `${field} must be confirmed before build`));
    }
  }
  if (record.idea.successCriteria.length === 0) {
    issues.push(issue("SUCCESS_CRITERIA_MISSING", "$.idea.successCriteria", "At least one measurable success criterion is required before build"));
  }
  if (record.scope.inScope.length === 0 || record.scope.outOfScope.length === 0) {
    issues.push(issue("SCOPE_INCOMPLETE", "$.scope", "Both in-scope and out-of-scope boundaries are required before build"));
  }

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
          if (!contents.includes(marker)) {
            issues.push(issue("REQUIREMENTS_SECTION_MISSING", "$.requirements.documentRef", `Missing required document marker: ${marker}`));
          }
        }
        if (standardDefaults.length > 0 && !contents.includes("<!-- pdlc:section:standard-defaults -->")) {
          issues.push(issue("REQUIREMENTS_SECTION_MISSING", "$.requirements.documentRef", "Missing applied standards and defaults section"));
        }
        for (const standard of standardDefaults) {
          if (!contents.includes(standard.key) || !contents.includes(standard.sourceRef)) {
            issues.push(issue(
              "STANDARD_DEFAULT_NOT_TRACED",
              "$.requirements.documentRef",
              `Requirements must show standard ${standard.key} from ${standard.sourceRef}`,
            ));
          }
        }
        for (const prefix of ["FR-", "AC-", "NFR-"] as const) {
          if (!contents.includes(prefix)) {
            issues.push(issue("REQUIREMENTS_ID_MISSING", "$.requirements.documentRef", `Requirements document must contain at least one ${prefix} identifier`));
          }
        }
        const decisionIds = new Set(contents.match(/\bRQ-\d{3,}\b/g) ?? []);
        if (decisionIds.size !== record.requirements.clarification.questionsAnswered) {
          issues.push(issue("CLARIFICATION_COUNT_MISMATCH", "$.requirements.clarification.questionsAnswered", `Delivery Record says ${record.requirements.clarification.questionsAnswered} answered questions but the document traces ${decisionIds.size}`));
        }
        const depthPolicy = policy.depths[record.requirements.depth];
        if (decisionIds.size < depthPolicy.minimumAnsweredQuestions) {
          issues.push(issue("INSUFFICIENT_CLARIFICATION", "$.requirements.clarification.questionsAnswered", `${record.requirements.depth} depth requires at least ${depthPolicy.minimumAnsweredQuestions} traceable clarification decisions`));
        }
        const visibleContents = contents.replace(/<!--[\s\S]*?-->/g, "");
        if (/<[^>]+>|\bTBD\b|Draft pending|Pending confirmation|Pending clarification/i.test(visibleContents)) {
          issues.push(issue("REQUIREMENTS_PLACEHOLDER_REMAINS", "$.requirements.documentRef", "Requirements document still contains draft placeholders"));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        issues.push(issue("REQUIREMENTS_DOCUMENT_UNREADABLE", "$.requirements.documentRef", message));
      }
    }
  }

  const depthPolicy = policy.depths[record.requirements.depth];
  for (const topic of depthPolicy.requiredTopics) {
    if (record.requirements.clarification.coverage[topic] !== "complete") {
      issues.push(issue("REQUIREMENTS_COVERAGE_INCOMPLETE", `$.requirements.clarification.coverage.${topic}`, `Required clarification topic is not complete: ${topic}`));
    }
  }
  if (record.requirements.clarification.openQuestions.length > 0) {
    issues.push(issue("OPEN_REQUIREMENTS_QUESTIONS", "$.requirements.clarification.openQuestions", "All open requirements questions must be resolved before approval"));
  }
  if (record.requirements.clarification.contradictions.length > 0) {
    issues.push(issue("REQUIREMENTS_CONTRADICTIONS", "$.requirements.clarification.contradictions", "Contradictions must be resolved before approval"));
  }

  if (!record.design.summary.trim() || record.design.decisions.length === 0) {
    issues.push(issue("LIGHTWEIGHT_DESIGN_MISSING", "$.design", "A lightweight design summary and at least one decision are required before build"));
  }

  const selected = selectApplicablePrinciplesForStages(packs, {
    workflow: "poc",
    stages: principleStageIds,
    riskTriggers: record.risk.triggers,
    technologies: record.design.technologies,
    domains: record.design.domains,
  });
  const selectedRefs = selected.map(({ pack }) => `${pack.id}@${pack.version}`);
  const applicable = new Set(record.principles.applicable);
  for (const ref of selectedRefs) {
    if (!applicable.has(ref)) {
      issues.push(issue("APPLICABLE_PRINCIPLE_MISSING", "$.principles.applicable", `Selected Principle Pack is not recorded: ${ref}`));
    }
  }

  const applications = new Map<string, PocDeliveryRecord["principles"]["applications"][number]>();
  for (const application of record.principles.applications) {
    if (applications.has(application.pack)) {
      issues.push(issue("DUPLICATE_PRINCIPLE_APPLICATION", "$.principles.applications", `Principle Pack is applied more than once: ${application.pack}`));
    }
    applications.set(application.pack, application);
  }

  for (const ref of record.principles.applicable) {
    const application = applications.get(ref);
    if (!application) {
      issues.push(issue("PRINCIPLE_APPLICATION_MISSING", "$.principles.applications", `No implementation disposition is recorded for ${ref}`));
      continue;
    }
    if (application.disposition === "exception" && !record.principles.exceptions.some((entry) => entry.startsWith(`${ref}:`))) {
      issues.push(issue("PRINCIPLE_EXCEPTION_MISSING", "$.principles.exceptions", `An exception reference is required for ${ref}`));
    }
    if (requirementsDocument && !requirementsDocument.includes(ref)) {
      issues.push(issue("PRINCIPLE_NOT_TRACED", "$.requirements.documentRef", `Requirements document does not reference ${ref}`));
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    requirementsDocument: requirementsDocument ? documentRef : undefined,
    principlePacks: selected.map(({ pack, effectiveEnforcement }) => ({
      ref: `${pack.id}@${pack.version}`,
      enforcement: effectiveEnforcement,
    })),
  };
}
