export const WORKFLOW_IDS = ["poc", "implementation", "pdlc"] as const;
export type WorkflowId = (typeof WORKFLOW_IDS)[number];

export const ROLE_SLOTS = ["product", "developer", "qa"] as const;
export type RoleSlot = (typeof ROLE_SLOTS)[number];

export const POC_STATUSES = [
  "DRAFT",
  "COMMITTED",
  "VERIFIED",
  "CLOSED_KILLED",
  "CLOSED_PIVOTED",
  "CLOSED_PRODUCTIZED",
] as const;
export type PocStatus = (typeof POC_STATUSES)[number];

export const RISK_LEVELS = ["low", "medium", "high", "blocked"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const ENFORCEMENT_LEVELS = [
  "required",
  "risk-based",
  "advisory",
  "not-applicable",
] as const;
export type EnforcementLevel = (typeof ENFORCEMENT_LEVELS)[number];

export const REQUIREMENTS_DEPTHS = ["minimal", "standard", "comprehensive"] as const;
export type RequirementsDepth = (typeof REQUIREMENTS_DEPTHS)[number];

export const REQUIREMENTS_STATUSES = ["draft", "approved"] as const;
export type RequirementsStatus = (typeof REQUIREMENTS_STATUSES)[number];

export const REQUIREMENTS_COVERAGE_TOPICS = [
  "productContext",
  "functionalBehavior",
  "userScenarios",
  "uxInteraction",
  "qualityAttributes",
  "dataIntegrations",
  "scopeSuccess",
] as const;
export type RequirementsCoverageTopic = (typeof REQUIREMENTS_COVERAGE_TOPICS)[number];

export const COVERAGE_STATUSES = ["pending", "complete"] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export const STANDARD_PROFILE_LAYERS = ["harness", "project"] as const;
export type StandardProfileLayer = (typeof STANDARD_PROFILE_LAYERS)[number];

export const STANDARD_DEFAULT_POLICIES = ["constraint", "default"] as const;
export type StandardDefaultPolicy = (typeof STANDARD_DEFAULT_POLICIES)[number];

export const PRINCIPLE_DISPOSITIONS = ["adopted", "exception"] as const;
export type PrincipleDisposition = (typeof PRINCIPLE_DISPOSITIONS)[number];

export const STAGE_PHASES = [
  "discover",
  "define",
  "design",
  "build",
  "verify",
  "release",
  "outcome",
] as const;
export type StagePhase = (typeof STAGE_PHASES)[number];

export const JOURNEY_STATUSES = ["active", "planned"] as const;
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];

export const JOURNEY_STAGE_INCLUSIONS = ["required", "conditional"] as const;
export type JourneyStageInclusion = (typeof JOURNEY_STAGE_INCLUSIONS)[number];

export interface EvidenceRef {
  kind: "file" | "url" | "ci" | "demo";
  ref: string;
  description: string;
  capturedAt?: string;
}

export interface PocDeliveryRecord {
  schemaVersion: 1;
  id: string;
  workflow: "poc";
  status: PocStatus;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  assignments: Record<RoleSlot, string>;
  idea: {
    problem: string;
    hypothesis: string;
    expectedOutcome: string;
    successCriteria: string[];
    timebox: string;
  };
  requirements: {
    documentRef: string;
    depth: RequirementsDepth;
    status: RequirementsStatus;
    clarification: {
      questionsAnswered: number;
      coverage: Record<RequirementsCoverageTopic, CoverageStatus>;
      openQuestions: string[];
      contradictions: string[];
    };
    approvedBy: string;
    approvedAt: string;
    approvedContentHash: string;
  };
  scope: {
    inScope: string[];
    outOfScope: string[];
    productionUse: false;
  };
  risk: {
    level: RiskLevel;
    triggers: string[];
  };
  principles: {
    applicable: string[];
    exceptions: string[];
    applications: Array<{
      pack: string;
      disposition: PrincipleDisposition;
      notes: string;
    }>;
  };
  design: {
    summary: string;
    decisions: string[];
    technologies: string[];
    domains: string[];
  };
  evidence: {
    tests: EvidenceRef[];
    build: EvidenceRef[];
    security: EvidenceRef[];
    demo: EvidenceRef[];
  };
  decision: {
    outcome: "" | "kill" | "pivot" | "productize";
    rationale: string;
    followUp: string;
  };
}

export interface RequirementsDepthPolicy {
  minimumAnsweredQuestions: number;
  requiredTopics: RequirementsCoverageTopic[];
}

export interface RequirementsPolicy {
  schemaVersion: 1;
  id: string;
  owner: string;
  version: string;
  depths: Record<RequirementsDepth, RequirementsDepthPolicy>;
  questionRules: {
    maxQuestionsPerRound: number;
    requireOtherOption: boolean;
    analyzeContradictions: boolean;
    requireFinalDocumentReview: boolean;
    allowDocumentAnswers: boolean;
    questionDocumentPattern: string;
    answerTag: string;
  };
}

export interface StageDefinition {
  id: string;
  name: string;
  description: string;
  phase: StagePhase;
  roleSlots: RoleSlot[];
  requirements: string[];
  outputs: string[];
}

export interface StageCatalog {
  schemaVersion: 1;
  catalogVersion: string;
  owner: string;
  stages: StageDefinition[];
}

export const PLUGIN_GUIDANCE_MODES = ["draft", "implement", "verify"] as const;
export type PluginGuidanceMode = (typeof PLUGIN_GUIDANCE_MODES)[number];

export interface PluginStageBinding {
  stage: string;
  agent: string;
  skills: string[];
  mode: PluginGuidanceMode;
  handoff: string;
  approvalBoundary: string;
}

export interface PluginStageBindingsDescriptor {
  schemaVersion: 1;
  plugin: string;
  bindings: PluginStageBinding[];
}

export interface PluginGuidanceResolution {
  stage: StageDefinition;
  guidance: {
    plugin: string;
    agent: string;
    skills: string[];
    mode: PluginGuidanceMode;
    handoff: string;
    approvalBoundary: string;
  };
}

export interface JourneyStageRef {
  stageId: string;
  inclusion: JourneyStageInclusion;
  activationTags?: string[];
}

export interface JourneyDefinition {
  schemaVersion: 1;
  id: WorkflowId;
  name: string;
  description: string;
  status: JourneyStatus;
  stageSequence: JourneyStageRef[];
}

export interface WorkflowCheckpoint {
  id: string;
  from: string[];
  to?: string;
  toByOutcome?: Record<string, string>;
  ownerRole: RoleSlot;
}

export interface WorkflowDefinition {
  schemaVersion: 1;
  id: WorkflowId;
  name: string;
  description: string;
  initialStatus: string;
  terminalStatuses: string[];
  journeyId: WorkflowId;
  checkpoints: WorkflowCheckpoint[];
  deliveryDefaults: {
    roleAssignmentMode: "approval-actor-all-roles";
    timebox: string;
    collectDuringRequirements: false;
  };
  constraints: {
    productionUse: boolean;
    externalIntegrations: string[];
    allowSinglePersonAllRoles: boolean;
  };
}

export interface Principle {
  id: string;
  title: string;
  requirement: string;
  standardDefault?: {
    key: string;
    topic: RequirementsCoverageTopic;
    policy: StandardDefaultPolicy;
  };
}

export interface PrinciplePack {
  schemaVersion: 1;
  id: string;
  name: string;
  owner: string;
  version: string;
  appliesTo: {
    workflows: WorkflowId[];
    stages: string[];
    riskTriggers?: string[];
    technologies?: string[];
    domains?: string[];
  };
  enforcement: Record<WorkflowId, EnforcementLevel>;
  principles: Principle[];
}

export interface StandardDefaultEntry {
  key: string;
  title: string;
  topic: RequirementsCoverageTopic;
  statement: string;
  rationale: string;
  principleRefs: string[];
}

export interface StandardProfile {
  schemaVersion: 1;
  id: string;
  name: string;
  owner: string;
  version: string;
  layer: StandardProfileLayer;
  appliesTo: {
    workflows: WorkflowId[];
    stages: string[];
    technologies?: string[];
    domains?: string[];
  };
  defaults: StandardDefaultEntry[];
}

export interface ResolvedStandardDefault {
  key: string;
  title: string;
  topic: RequirementsCoverageTopic;
  statement: string;
  rationale: string;
  sourceRef: string;
  sourceLayer: "enterprise" | StandardProfileLayer;
  locked: boolean;
  principleRefs: string[];
  shadowedSources: string[];
}

export interface AuditEvent {
  schemaVersion: 1;
  eventId: string;
  recordId: string;
  eventType: string;
  checkpoint?: string;
  fromStatus?: string;
  toStatus?: string;
  actor: string;
  timestamp: string;
  riskLevel?: RiskLevel;
  evidenceRefs?: string[];
  recordHash: string;
  decision?: string;
  failureReason?: string;
}

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T; issues: [] }
  | { ok: false; issues: ValidationIssue[] };
