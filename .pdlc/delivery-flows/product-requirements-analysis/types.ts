import type { BaseDeliveryRecord, PocDeliveryRecord } from "../../core/types.ts";

export const REQUIREMENTS_ANALYSIS_STATUSES = ["DRAFT", "REQUIREMENTS_APPROVED", "WORK_ITEMS_PREPARED", "SCOPED"] as const;
export type RequirementsAnalysisStatus = (typeof REQUIREMENTS_ANALYSIS_STATUSES)[number];

export interface StorySnapshot {
  localId: string;
  artifactRef: string;
  externalKey: string;
  revision: number;
  contentHash: string;
  requirementRefs: string[];
  acceptanceCriteria: string[];
  dependencies: string[];
}

export interface SprintScopeBinding {
  artifactType: "product-management.sprint-scope";
  documentRef: string;
  version: number;
  previousScopeHash: string;
  scopeHash: string;
  epicRef: string;
  sprint: { id: string; name: string; capturedAt: string };
  storyIds: string[];
  approvedBy: string;
  approvedAt: string;
}

export const CHANGE_TYPES = ["implementation-defect", "clarification", "requirements-change", "scope-change"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];
export const CHANGE_STATUSES = ["proposed", "impact-assessed", "approved", "applied", "rejected"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export interface DeliveryChange {
  id: string;
  type: ChangeType;
  status: ChangeStatus;
  storyIds: string[];
  reason: string;
  impact: string;
  proposedBy: string;
  createdAt: string;
  approvedBy: string;
  approvedAt: string;
}

export interface RequirementsAnalysisRecord extends BaseDeliveryRecord {
  schemaVersion: 1;
  deliveryFlow: "product-requirements-analysis";
  status: RequirementsAnalysisStatus;
  requirements: PocDeliveryRecord["requirements"];
  risk: PocDeliveryRecord["risk"];
  resolution: PocDeliveryRecord["resolution"];
  design: PocDeliveryRecord["design"];
  stories: StorySnapshot[];
  scope: SprintScopeBinding;
  changes: DeliveryChange[];
}
