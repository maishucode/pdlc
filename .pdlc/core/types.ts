export type DeliveryFlowId = string;

export type RoleSlot = string;

export interface RoleCatalogEntry {
  id: RoleSlot;
  name: string;
  definition: string;
}

export interface RoleCatalog {
  schemaVersion: 1;
  owner: string;
  roles: RoleCatalogEntry[];
}

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

export const CONTROL_DISPOSITIONS = ["satisfied", "exception"] as const;
export type ControlDisposition = (typeof CONTROL_DISPOSITIONS)[number];

export const CONTROL_ENFORCEMENT_TYPES = ["automatic", "evidence", "approval"] as const;
export type ControlEnforcementType = (typeof CONTROL_ENFORCEMENT_TYPES)[number];

export const KNOWLEDGE_KINDS = ["guidance", "default", "reference", "kb"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export const CONTRIBUTION_MODES = ["restricted", "reviewed", "open"] as const;
export type ContributionMode = (typeof CONTRIBUTION_MODES)[number];

export const STAGE_PHASES = ["discover", "define", "design", "build", "verify", "release", "outcome"] as const;
export type StagePhase = (typeof STAGE_PHASES)[number];

export const DELIVERY_FLOW_STATUSES = ["active", "planned", "deprecated"] as const;
export type DeliveryFlowStatus = (typeof DELIVERY_FLOW_STATUSES)[number];

export const DELIVERY_FLOW_STAGE_INCLUSIONS = ["required", "conditional"] as const;
export type DeliveryFlowStageInclusion = (typeof DELIVERY_FLOW_STAGE_INCLUSIONS)[number];

export interface Applicability {
  deliveryFlows?: string[];
  stages?: string[];
  riskTriggers?: string[];
  technologies?: string[];
  domains?: string[];
}

export interface EvidenceRef {
  kind: "file" | "url" | "ci" | "demo";
  ref: string;
  description: string;
  capturedAt?: string;
}

export interface ControlApplication {
  control: string;
  disposition: ControlDisposition;
  notes: string;
  evidenceRefs: string[];
  approvedBy: string;
}

export const CONTEXT_USE_DISPOSITIONS = ["used", "not-used"] as const;
export type ContextUseDisposition = (typeof CONTEXT_USE_DISPOSITIONS)[number];

export interface ContextPolicyReceipt {
  ref: string;
  notes: string;
}

export interface ContextAssetReceipt {
  ref: string;
  disposition: ContextUseDisposition;
  notes: string;
  evidenceRefs: string[];
}

export interface ContextDomainContributionReceipt extends ContextAssetReceipt {
  agent: string;
  skills: string[];
}

export interface ContextIntegrationReceipt extends ContextAssetReceipt {
  skills: string[];
}

export interface StageContextReceipt {
  schemaVersion: 1;
  stage: string;
  contextHash: string;
  policies: ContextPolicyReceipt[];
  knowledge: ContextAssetReceipt[];
  domainContributions: ContextDomainContributionReceipt[];
  integrations: ContextIntegrationReceipt[];
}

export interface StageContextApplication extends StageContextReceipt {
  actor: string;
  appliedAt: string;
}

export interface PocDeliveryRecord {
  schemaVersion: 2;
  id: string;
  deliveryFlow: "poc";
  status: PocStatus;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  assignments: Record<string, string>;
  idea: {
    problem: string;
    hypothesis: string;
    expectedOutcome: string;
    successCriteria: string[];
    timebox: string;
  };
  requirements: {
    artifactType: "product-management.requirements";
    documentRef: string;
    profile: RequirementsDepth;
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
  resolution: {
    controls: {
      applicable: string[];
      exceptions: string[];
      applications: ControlApplication[];
    };
    baselines: string[];
    defaults: string[];
    knowledge: string[];
    integrations: string[];
    contextApplications: StageContextApplication[];
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

export interface RequirementsFlowControl {
  schemaVersion: 1;
  id: string;
  owner: string;
  version: string;
  artifactType: "product-management.requirements";
  profiles: Record<RequirementsDepth, RequirementsDepthPolicy>;
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
  inputArtifacts?: string[];
  outputArtifacts?: string[];
}

export interface StageCatalog {
  schemaVersion: 2;
  catalogVersion: string;
  owner: string;
  stages: StageDefinition[];
}

export interface DeliveryFlowCatalogEntry {
  id: string;
  definition: string;
}

export interface DeliveryFlowCatalog {
  schemaVersion: 1;
  owner: string;
  flows: DeliveryFlowCatalogEntry[];
}

export interface DeliveryFlowStageRef {
  stageId: string;
  inclusion: DeliveryFlowStageInclusion;
  activationTags?: string[];
}

export interface DeliveryFlowControls {
  initialStatus: string;
  terminalStatuses: string[];
  checkpoints: DeliveryFlowCheckpoint[];
  deliveryDefaults: {
    roleAssignmentMode: "approval-actor-all-roles";
    timebox: string;
    collectDuringRequirements: false;
    requirementsProfile?: RequirementsDepth;
  };
  constraints: {
    productionUse: boolean;
    externalIntegrations: string[];
    allowSinglePersonAllRoles: boolean;
  };
}

export interface DeliveryFlowDefinition {
  schemaVersion: 2;
  id: DeliveryFlowId;
  name: string;
  description: string;
  status: DeliveryFlowStatus;
  stageSequence: DeliveryFlowStageRef[];
  controls?: DeliveryFlowControls;
}

export interface ExecutableDeliveryFlowDefinition extends DeliveryFlowDefinition {
  status: "active";
  controls: DeliveryFlowControls;
}

export interface DeliveryFlowCheckpoint {
  id: string;
  from: string[];
  to?: string;
  toByOutcome?: Record<string, string>;
  ownerRole: RoleSlot;
}

export interface DomainManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  owners: string[];
  policyApprovers: string[];
  maintainers: string[];
  contributionMode: {
    artifacts: ContributionMode;
    policies: ContributionMode;
    knowledge: ContributionMode;
    skills: ContributionMode;
    agents: ContributionMode;
    hooks: ContributionMode;
  };
  defaultApplicability?: Applicability;
}

export interface ArtifactDefinition {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  ownerDomain: string;
  version: string;
  format: "markdown" | "json" | "reference";
  schemaRef?: string;
  profiles: string[];
  defaultTemplate?: string;
  examples?: string[];
}

export interface ControlRule {
  id: string;
  statement: string;
  enforcement: ControlEnforcementType;
  requiredEvidence?: string[];
  exceptionApprovers?: string[];
  enforceAt: string[];
  standardDefault?: {
    key: string;
    topic: RequirementsCoverageTopic;
  };
}

export interface ControlPolicy {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  ownerDomain: string;
  version: string;
  appliesTo: Applicability;
  rules: ControlRule[];
}

export interface StandardDefaultEntry {
  key: string;
  title: string;
  topic: RequirementsCoverageTopic;
  statement: string;
  rationale: string;
  controlRefs: string[];
}

export interface KnowledgeAsset {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  ownerDomain: string;
  version: string;
  kind: KnowledgeKind;
  appliesTo: Applicability;
  contentRef?: string;
  defaults?: StandardDefaultEntry[];
}

export interface ResolvedStandardDefault {
  key: string;
  title: string;
  topic: RequirementsCoverageTopic;
  statement: string;
  rationale: string;
  sourceRef: string;
  sourceLayer: "domain" | "project" | "harness";
  locked: boolean;
  controlRefs: string[];
  shadowedSources: string[];
}

export const DOMAIN_GUIDANCE_MODES = ["draft", "implement", "verify"] as const;
export type DomainGuidanceMode = (typeof DOMAIN_GUIDANCE_MODES)[number];

export interface DomainStageHookBinding {
  stage: string;
  agent: string;
  skills: string[];
  mode: DomainGuidanceMode;
  handoff: string;
  approvalBoundary: string;
}

export interface DomainStageHooksDescriptor {
  schemaVersion: 1;
  domain: string;
  version: string;
  deliveryFlows: string[];
  enabled: boolean;
  permissions: {
    filesystem: "read" | "write";
    network: boolean;
    externalWrites: boolean;
  };
  bindings: DomainStageHookBinding[];
}

export interface IntegrationCatalogEntry {
  id: string;
  definition: string;
}

export interface IntegrationCatalog {
  schemaVersion: 1;
  owner: string;
  integrations: IntegrationCatalogEntry[];
}

export interface IntegrationSkillRef {
  id: string;
  path: string;
}

export interface IntegrationManifest {
  schemaVersion: 1;
  kind: "integration";
  id: string;
  version: string;
  description: string;
  owners: string[];
  maintainers: string[];
  appliesTo: Applicability;
  skills: IntegrationSkillRef[];
  permissions: {
    network: boolean;
    credentialRefs: string[];
    externalWrites: boolean;
  };
}

export interface DiscoveredDomainHooks {
  domain: string;
  descriptor: DomainStageHooksDescriptor;
  root: string;
  bindings: DomainStageHookBinding[];
}

export interface DomainGuidanceContribution {
  domain: string;
  version: string;
  permissions: DomainStageHooksDescriptor["permissions"];
  agent: { id: string; path: string };
  skills: Array<{ name: string; path: string }>;
  mode: DomainGuidanceMode;
  handoff: string;
  approvalBoundary: string;
}

export interface DomainGuidanceResolution {
  deliveryFlow: string;
  stage: StageDefinition;
  contributions: DomainGuidanceContribution[];
}

export interface ProjectBaseline {
  schemaVersion: 1;
  domain: string;
  status: "approved";
  approvedBy: string;
  approvedAt: string;
  decisions: Record<string, string | number | boolean>;
  references: string[];
}

export interface ProjectDefaultProfile {
  schemaVersion: 1;
  id: string;
  domain: string;
  version: string;
  appliesTo: Applicability;
  defaults: StandardDefaultEntry[];
}

export interface ResolvedControl {
  ref: string;
  ownerDomain: string;
  policy: ControlPolicy;
  matchedStages: string[];
  source: "enterprise" | "project";
}

export interface ResolvedKnowledge {
  ref: string;
  ownerDomain: string;
  asset: KnowledgeAsset;
  matchedStages: string[];
  contentPath?: string;
}

export interface ResolvedBaseline {
  ref: string;
  domain: string;
  baseline: ProjectBaseline;
}

export interface AuditEvent {
  schemaVersion: 1;
  eventId: string;
  recordId: string;
  eventType: string;
  checkpoint?: string;
  stage?: string;
  contextHash?: string;
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
