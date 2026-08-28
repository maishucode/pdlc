import type { EvidenceRef } from "../core/types.ts";

export interface WorkItemRef {
  id: string;
  url?: string;
}

export interface WorkItem {
  ref: WorkItemRef;
  title: string;
  status: string;
  acceptanceCriteria: string[];
}

export interface WorkItemInput {
  title: string;
  description: string;
  acceptanceCriteria: string[];
}

export interface TestRef {
  id: string;
  url?: string;
}

export interface TestCaseInput {
  title: string;
  expectedResult: string;
}

export interface TestExecutionInput {
  testRefs: TestRef[];
  environment: string;
}

export interface TestExecutionRef {
  id: string;
  url?: string;
}

export interface WorkItemAdapter {
  getWorkItem(ref: WorkItemRef): Promise<WorkItem>;
  createWorkItem(input: WorkItemInput): Promise<WorkItemRef>;
  updateStatus(ref: WorkItemRef, status: string): Promise<void>;
  attachEvidence(ref: WorkItemRef, evidence: EvidenceRef[]): Promise<void>;
}

export interface TestManagementAdapter {
  createTests(input: TestCaseInput[]): Promise<TestRef[]>;
  createExecution(input: TestExecutionInput): Promise<TestExecutionRef>;
  getExecutionEvidence(ref: TestExecutionRef): Promise<EvidenceRef[]>;
}

export interface DeliveryAdapter {
  getBuildEvidence(ref: string): Promise<EvidenceRef[]>;
  getDeploymentEvidence(ref: string): Promise<EvidenceRef[]>;
  getHealthEvidence(ref: string): Promise<EvidenceRef[]>;
}

