import { sha256 } from "./hash.ts";
import { hashRequirementsDocument } from "./readiness.ts";
import type { PocDeliveryRecord, ValidationIssue } from "./types.ts";

/**
 * Hash only the approved build contract. Operational evidence, Stage receipts,
 * revisions, timestamps, and outcome notes are expected to evolve after Commit.
 */
export function hashApprovedBuildContract(record: PocDeliveryRecord): string {
  const { approvedContractHash: _approvedContractHash, approvedAt: _approvedAt, ...requirements } = record.requirements;
  const sorted = (values: string[]): string[] => [...values].sort();
  return sha256({
    deliveryFlow: record.deliveryFlow,
    assignments: record.assignments,
    idea: record.idea,
    requirements,
    scope: record.scope,
    risk: { ...record.risk, triggers: sorted(record.risk.triggers) },
    design: { ...record.design, technologies: sorted(record.design.technologies), domains: sorted(record.design.domains) },
    resolution: {
      controls: {
        applicable: sorted(record.resolution.controls.applicable),
        exceptions: sorted(record.resolution.controls.exceptions),
        applications: record.resolution.controls.applications
          .map(({ evidenceRefs: _evidenceRefs, ...application }) => application)
          .sort((left, right) => left.control.localeCompare(right.control)),
      },
      baselines: sorted(record.resolution.baselines),
      defaults: sorted(record.resolution.defaults),
      knowledge: sorted(record.resolution.knowledge),
      integrations: sorted(record.resolution.integrations),
    },
  });
}

export async function assessApprovedBuildContract(record: PocDeliveryRecord, workspaceRoot: string): Promise<ValidationIssue[]> {
  if (record.requirements.status !== "approved") return [];
  const issues: ValidationIssue[] = [];
  const expectedContractHash = hashApprovedBuildContract(record);
  if (record.requirements.approvedContractHash !== expectedContractHash) {
    issues.push({
      code: "APPROVED_BUILD_CONTRACT_CHANGED",
      path: "$.requirements.approvedContractHash",
      message: "The approved scope, risk, design, assignments, or resolved governance changed after Build Readiness; refresh context and obtain approval again.",
    });
  }
  try {
    const currentRequirementsHash = await hashRequirementsDocument(workspaceRoot, record.requirements.documentRef);
    if (currentRequirementsHash !== record.requirements.approvedContentHash) {
      issues.push({
        code: "REQUIREMENTS_CHANGED_AFTER_APPROVAL",
        path: "$.requirements.approvedContentHash",
        message: "Requirements content changed after Build Readiness approval; approve the revised Requirements before continuing.",
      });
    }
  } catch (error) {
    issues.push({
      code: "REQUIREMENTS_DOCUMENT_UNREADABLE",
      path: "$.requirements.documentRef",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return issues;
}
