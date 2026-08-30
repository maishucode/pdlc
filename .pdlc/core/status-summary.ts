import type { ProductizationPackageAssessment } from "./productization.ts";
import { buildReadinessContextStages, currentPocStage, requiresSecurityVerification, verificationContextStages } from "./poc-progress.ts";
import type { PocDeliveryRecord, RequirementsCoverageTopic, ValidationIssue } from "./types.ts";

export interface StatusBlocker {
  code: string;
  area: "requirements" | "controls" | "context" | "evidence" | "decision" | "risk";
  message: string;
}

export interface StatusNextAction {
  id: string;
  label: string;
  available: boolean;
  reason?: string;
}

interface AppliedResource {
  ref: string;
  stages: string[];
}

interface EvidenceStatus {
  required: boolean;
  ready: boolean;
  count: number;
  refs: string[];
}

export interface PocStatusSummary {
  record: {
    id: string;
    deliveryFlow: string;
    status: PocDeliveryRecord["status"];
    stage: string;
    title: string;
    revision: number;
    risk: PocDeliveryRecord["risk"];
    assignments: PocDeliveryRecord["assignments"];
    updatedAt: string;
    terminal: boolean;
  };
  nextActions: StatusNextAction[];
  blockers: StatusBlocker[];
  requirements: {
    documentRef: string;
    profile: string;
    status: string;
    approved: boolean;
    approvedBy: string;
    approvedAt: string;
    contentHashBound: boolean;
    contractHashBound: boolean;
    questionsAnswered: number;
    pendingTopics: RequirementsCoverageTopic[];
    openQuestions: number;
    contradictions: number;
  };
  evidence: {
    readyForVerify: boolean;
    tests: EvidenceStatus;
    build: EvidenceStatus;
    security: EvidenceStatus;
    demo: EvidenceStatus;
  };
  applied: {
    policies: AppliedResource[];
    knowledge: AppliedResource[];
    skills: AppliedResource[];
  };
  controls: {
    applicable: string[];
    satisfied: string[];
    exceptions: string[];
    pending: string[];
  };
  productizationPackage: {
    state: "not-required" | "missing" | "invalid" | "ready";
    expectedRef: string;
    documentRef: string;
    contentHash: string;
    issues: string[];
  };
}

function appliedResources(entries: Array<{ ref: string; stage: string }>): AppliedResource[] {
  const stagesByRef = new Map<string, Set<string>>();
  for (const { ref, stage } of entries) {
    const stages = stagesByRef.get(ref) ?? new Set<string>();
    stages.add(stage);
    stagesByRef.set(ref, stages);
  }
  return [...stagesByRef.entries()]
    .map(([ref, stages]) => ({ ref, stages: [...stages].sort() }))
    .sort((left, right) => left.ref.localeCompare(right.ref));
}

function evidenceStatus(required: boolean, refs: string[]): EvidenceStatus {
  return { required, ready: !required || refs.length > 0, count: refs.length, refs };
}

function packageStatus(record: PocDeliveryRecord, assessment?: ProductizationPackageAssessment): PocStatusSummary["productizationPackage"] {
  const expectedRef = `pdlc/artifacts/${record.id}/productization-package.md`;
  if (record.status === "PRODUCTIZATION_RECOMMENDED" && record.decision.productizationPackage.contentHash) {
    return {
      state: "ready",
      expectedRef,
      documentRef: record.decision.productizationPackage.documentRef,
      contentHash: record.decision.productizationPackage.contentHash,
      issues: [],
    };
  }
  if (record.status !== "VERIFIED") {
    return { state: "not-required", expectedRef, documentRef: "", contentHash: "", issues: [] };
  }
  if (assessment?.ok) {
    return {
      state: "ready",
      expectedRef,
      documentRef: assessment.documentRef ?? expectedRef,
      contentHash: assessment.contentHash ?? "",
      issues: [],
    };
  }
  const issues = assessment?.issues.map(({ message }) => message) ?? [];
  const missing = assessment?.issues.some(({ code }) => code === "PRODUCTIZATION_PACKAGE_UNREADABLE") ?? true;
  return {
    state: missing ? "missing" : "invalid",
    expectedRef,
    documentRef: "",
    contentHash: "",
    issues: missing ? [`Productization Package has not been created at ${expectedRef}.`] : issues,
  };
}

export function buildPocStatusSummary(
  record: PocDeliveryRecord,
  productizationAssessment?: ProductizationPackageAssessment,
  contextIssues?: ValidationIssue[],
  approvalIssues: ValidationIssue[] = [],
): PocStatusSummary {
  const blockers: StatusBlocker[] = [];
  const pendingTopics = Object.entries(record.requirements.clarification.coverage)
    .filter(([, status]) => status !== "complete")
    .map(([topic]) => topic as RequirementsCoverageTopic);
  const appliedControls = new Set(record.resolution.controls.applications.map(({ control }) => control));
  const satisfiedControls = [...new Set(record.resolution.controls.applications
    .filter(({ disposition }) => disposition === "satisfied")
    .map(({ control }) => control))];
  const pendingControls = record.resolution.controls.applicable.filter((control) => !appliedControls.has(control));
  const contextStages = new Set(record.resolution.contextApplications.map(({ stage }) => stage));
  const securityRequired = requiresSecurityVerification(record);
  const tests = evidenceStatus(true, record.evidence.tests.map(({ ref }) => ref));
  const build = evidenceStatus(true, record.evidence.build.map(({ ref }) => ref));
  const security = evidenceStatus(securityRequired, record.evidence.security.map(({ ref }) => ref));
  const demo = evidenceStatus(true, record.evidence.demo.map(({ ref }) => ref));
  const evidenceReady = tests.ready && build.ready && security.ready && demo.ready;
  const contextWasValidated = contextIssues !== undefined;
  const appendContextIssues = (): void => {
    for (const issue of contextIssues ?? []) blockers.push({ code: issue.code, area: "context", message: issue.message });
  };

  if (record.risk.level === "blocked") blockers.push({ code: "RISK_BLOCKED", area: "risk", message: "Risk status is blocked." });
  for (const issue of approvalIssues) blockers.push({ code: issue.code, area: "requirements", message: issue.message });
  if (record.status === "DRAFT") {
    if (!record.idea.problem.trim()) blockers.push({ code: "PROBLEM_MISSING", area: "requirements", message: "Product problem is not defined." });
    if (!record.idea.hypothesis.trim()) blockers.push({ code: "HYPOTHESIS_MISSING", area: "requirements", message: "POC hypothesis is not defined." });
    if (!record.idea.expectedOutcome.trim()) blockers.push({ code: "EXPECTED_OUTCOME_MISSING", area: "requirements", message: "Expected outcome is not defined." });
    if (record.idea.successCriteria.length === 0) blockers.push({ code: "SUCCESS_CRITERIA_MISSING", area: "requirements", message: "Measurable success criteria are not defined." });
    if (!record.design.summary.trim()) blockers.push({ code: "DESIGN_SUMMARY_MISSING", area: "requirements", message: "The reversible POC design is not summarized." });
    if (pendingTopics.length > 0) blockers.push({ code: "CLARIFICATION_INCOMPLETE", area: "requirements", message: `Clarification topics remain incomplete: ${pendingTopics.join(", ")}.` });
    if (record.requirements.clarification.openQuestions.length > 0) blockers.push({ code: "OPEN_QUESTIONS", area: "requirements", message: `${record.requirements.clarification.openQuestions.length} requirements question(s) remain open.` });
    if (record.requirements.clarification.contradictions.length > 0) blockers.push({ code: "CONTRADICTIONS", area: "requirements", message: `${record.requirements.clarification.contradictions.length} requirements contradiction(s) remain.` });
    for (const control of pendingControls) blockers.push({ code: "CONTROL_PENDING", area: "controls", message: `Control has no recorded disposition: ${control}` });
    if (contextWasValidated) appendContextIssues();
    else for (const stage of buildReadinessContextStages(record).filter((stage) => !contextStages.has(stage))) blockers.push({ code: "CONTEXT_NOT_APPLIED", area: "context", message: `Stage context is not yet applied: ${stage}` });
  }
  if (record.status === "COMMITTED") {
    if (!tests.ready) blockers.push({ code: "TEST_EVIDENCE_MISSING", area: "evidence", message: "Test evidence is missing." });
    if (!build.ready) blockers.push({ code: "BUILD_EVIDENCE_MISSING", area: "evidence", message: "Build evidence is missing." });
    if (!security.ready) blockers.push({ code: "SECURITY_EVIDENCE_MISSING", area: "evidence", message: "Security evidence is required by the recorded risk triggers." });
    if (!demo.ready) blockers.push({ code: "DEMO_EVIDENCE_MISSING", area: "evidence", message: "Demo evidence is missing." });
    for (const control of pendingControls) blockers.push({ code: "CONTROL_PENDING", area: "controls", message: `Control has no recorded disposition: ${control}` });
    if (contextWasValidated) appendContextIssues();
    else for (const stage of verificationContextStages(record).filter((stage) => !contextStages.has(stage))) blockers.push({ code: "CONTEXT_NOT_APPLIED", area: "context", message: `Stage context is not yet applied: ${stage}` });
  }
  const decisionReady = record.decision.rationale.trim().length > 0 && record.decision.followUp.trim().length > 0;
  if (record.status === "VERIFIED" && !decisionReady) blockers.push({ code: "DECISION_DETAILS_MISSING", area: "decision", message: "Decision rationale and follow-up are required." });

  const productizationPackage = packageStatus(record, productizationAssessment);
  const currentStage = currentPocStage(record);
  let nextActions: StatusNextAction[];
  if (record.status === "DRAFT") {
    const ready = blockers.length === 0;
    const workingAction = currentStage === "requirements-clarification"
      ? { id: "continue-requirements", label: "Continue requirements clarification" }
      : currentStage === "solution-design"
        ? { id: "complete-solution-design", label: "Complete the reversible POC design" }
        : { id: "complete-build-readiness", label: "Complete Build Readiness preparation" };
    nextActions = [
      { ...workingAction, available: true },
      { id: "request-build-readiness", label: "Review Requirements and request Build Readiness approval", available: ready, reason: ready ? undefined : `Resolve ${blockers.length} known blocker(s).` },
    ];
  } else if (record.status === "COMMITTED") {
    const ready = blockers.length === 0;
    const workingAction = currentStage === "security-verification"
      ? { id: "complete-security-verification", label: "Complete security verification evidence" }
      : currentStage === "acceptance-verification"
        ? { id: "complete-acceptance-verification", label: "Complete acceptance verification preparation" }
        : { id: "continue-implementation", label: "Continue implementation and evidence capture" };
    nextActions = [
      { ...workingAction, available: true },
      { id: "request-verification", label: "Request Verify approval", available: ready, reason: ready ? undefined : `Resolve ${blockers.length} known blocker(s).` },
    ];
  } else if (record.status === "VERIFIED") {
    const governanceReady = blockers.length === 0;
    nextActions = [
      { id: "park", label: "Park the POC", available: decisionReady && governanceReady, reason: !governanceReady ? "Restore the approved build contract." : decisionReady ? undefined : "Add decision rationale and follow-up." },
      {
        id: "recommend-productization",
        label: "Recommend productization",
        available: decisionReady && governanceReady && productizationPackage.state === "ready",
        reason: !governanceReady ? "Restore the approved build contract." : !decisionReady ? "Add decision rationale and follow-up." : productizationPackage.state !== "ready" ? "Complete the Productization Package." : undefined,
      },
    ];
  } else if (record.status === "PARKED") {
    nextActions = [];
  } else {
    nextActions = [{
      id: "formal-delivery-handoff",
      label: "Use the Productization Package as input to a new formal Delivery Flow",
      available: false,
      reason: "Implementation and end-to-end PDLC execution are currently planned, not active.",
    }];
  }

  const policyEntries = record.resolution.contextApplications.flatMap((application) => application.policies.map(({ ref }) => ({ ref, stage: application.stage })));
  const knowledgeEntries = record.resolution.contextApplications.flatMap((application) => application.knowledge
    .filter(({ disposition }) => disposition === "used")
    .map(({ ref }) => ({ ref, stage: application.stage })));
  const skillEntries = record.resolution.contextApplications.flatMap((application) => [
    ...application.disciplineContributions.filter(({ disposition }) => disposition === "used").flatMap(({ selectedSkills }) => selectedSkills.map((ref) => ({ ref, stage: application.stage }))),
    ...application.integrations.filter(({ disposition }) => disposition === "used").flatMap(({ skills }) => skills.map((ref) => ({ ref, stage: application.stage }))),
  ]);
  return {
    record: {
      id: record.id,
      deliveryFlow: record.deliveryFlow,
      status: record.status,
      stage: currentStage,
      title: record.title,
      revision: record.revision,
      risk: record.risk,
      assignments: record.assignments,
      updatedAt: record.updatedAt,
      terminal: record.status === "PARKED" || record.status === "PRODUCTIZATION_RECOMMENDED",
    },
    nextActions,
    blockers,
    requirements: {
      documentRef: record.requirements.documentRef,
      profile: record.requirements.profile,
      status: record.requirements.status,
      approved: record.requirements.status === "approved",
      approvedBy: record.requirements.approvedBy,
      approvedAt: record.requirements.approvedAt,
      contentHashBound: /^[a-f0-9]{64}$/.test(record.requirements.approvedContentHash),
      contractHashBound: /^[a-f0-9]{64}$/.test(record.requirements.approvedContractHash ?? ""),
      questionsAnswered: record.requirements.clarification.questionsAnswered,
      pendingTopics,
      openQuestions: record.requirements.clarification.openQuestions.length,
      contradictions: record.requirements.clarification.contradictions.length,
    },
    evidence: { readyForVerify: evidenceReady, tests, build, security, demo },
    applied: {
      policies: appliedResources(policyEntries),
      knowledge: appliedResources(knowledgeEntries),
      skills: appliedResources(skillEntries),
    },
    controls: {
      applicable: record.resolution.controls.applicable,
      satisfied: satisfiedControls,
      exceptions: record.resolution.controls.exceptions,
      pending: pendingControls,
    },
    productizationPackage,
  };
}
