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
  "PARKED",
  "PRODUCTIZATION_RECOMMENDED",
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
  disciplines?: string[];
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

export interface ContextDisciplineContributionReceipt extends ContextAssetReceipt {
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
  disciplineContributions: ContextDisciplineContributionReceipt[];
  integrations: ContextIntegrationReceipt[];
}

export interface StageContextApplication extends StageContextReceipt {
  actor: string;
  appliedAt: string;
}

export interface DeliverySourceLineage {
  baseRevision: string;
  derivedFromRecord: string;
  deliveredRevision: string;
}

export interface BaseDeliveryRecord {
  schemaVersion: number;
  id: string;
  deliveryFlow: DeliveryFlowId;
  status: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  assignments: Record<string, string>;
  source: DeliverySourceLineage;
}

export interface PocDeliveryRecord extends BaseDeliveryRecord {
  schemaVersion: 3;
  deliveryFlow: "poc";
  status: PocStatus;
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
    approvedContractHash?: string;
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
    disciplines: string[];
  };
  evidence: {
    tests: EvidenceRef[];
    build: EvidenceRef[];
    security: EvidenceRef[];
    demo: EvidenceRef[];
  };
  decision: {
    outcome: "" | "park" | "recommend-productization";
    rationale: string;
    followUp: string;
    productizationPackage: {
      artifactType: "product-management.productization-package";
      documentRef: string;
      contentHash: string;
    };
  };
}

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
  sprint: {
    id: string;
    name: string;
    capturedAt: string;
  };
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

export type DeliveryRecord = PocDeliveryRecord | RequirementsAnalysisRecord;
export type ContextualDeliveryRecord = Pick<DeliveryRecord, "deliveryFlow" | "risk" | "resolution" | "design">;

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
    roleAssignmentMode: string;
    timebox: string;
    collectDuringRequirements: boolean;
    requirementsProfile?: RequirementsDepth;
  };
  constraints: {
    productionUse: boolean;
    externalIntegrations: string[];
    allowSinglePersonAllRoles: boolean;
  };
}

export interface DeliveryFlowRuntime {
  /** Optional Flow-owned module exporting `deliveryFlowExecutor`. */
  executor?: string;
  /** Optional Record schema, relative to the Harness `.pdlc/` root. */
  recordSchema?: string;
  /** Additional Runner actions accepted by `action <id>`. */
  actions?: string[];
}

export interface DeliveryFlowDefinition {
  schemaVersion: 2;
  id: DeliveryFlowId;
  name: string;
  description: string;
  status: DeliveryFlowStatus;
  stageSequence: DeliveryFlowStageRef[];
  controls?: DeliveryFlowControls;
  runtime?: DeliveryFlowRuntime;
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

export interface DisciplineManifest {
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
  ownerDiscipline: string;
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
  ownerDiscipline: string;
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
  ownerDiscipline: string;
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
  sourceLayer: "discipline" | "project" | "harness";
  locked: boolean;
  controlRefs: string[];
  shadowedSources: string[];
}

export const DISCIPLINE_GUIDANCE_MODES = ["draft", "implement", "verify"] as const;
export type DisciplineGuidanceMode = (typeof DISCIPLINE_GUIDANCE_MODES)[number];

export interface DisciplineStageHookBinding {
  stage: string;
  agent: string;
  skills: string[];
  mode: DisciplineGuidanceMode;
  handoff: string;
  approvalBoundary: string;
}

export interface DisciplineStageHooksDescriptor {
  schemaVersion: 1;
  discipline: string;
  version: string;
  deliveryFlows: string[];
  enabled: boolean;
  permissions: {
    filesystem: "read" | "write";
    network: boolean;
    externalWrites: boolean;
  };
  bindings: DisciplineStageHookBinding[];
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

export interface DiscoveredDisciplineHooks {
  discipline: string;
  descriptor: DisciplineStageHooksDescriptor;
  root: string;
  bindings: DisciplineStageHookBinding[];
}

export interface DisciplineGuidanceContribution {
  discipline: string;
  version: string;
  permissions: DisciplineStageHooksDescriptor["permissions"];
  agent: { id: string; path: string };
  skills: Array<{ name: string; path: string }>;
  mode: DisciplineGuidanceMode;
  handoff: string;
  approvalBoundary: string;
}

export interface DisciplineGuidanceResolution {
  deliveryFlow: string;
  stage: StageDefinition;
  contributions: DisciplineGuidanceContribution[];
}

export interface ProjectBaseline {
  schemaVersion: 1;
  discipline: string;
  status: "approved";
  approvedBy: string;
  approvedAt: string;
  decisions: Record<string, string | number | boolean>;
  references: string[];
}

export interface ProjectDefaultProfile {
  schemaVersion: 1;
  id: string;
  discipline: string;
  version: string;
  appliesTo: Applicability;
  defaults: StandardDefaultEntry[];
}

export interface ResolvedControl {
  ref: string;
  ownerDiscipline: string;
  policy: ControlPolicy;
  matchedStages: string[];
  source: "enterprise" | "project";
}

export interface ResolvedKnowledge {
  ref: string;
  ownerDiscipline: string;
  asset: KnowledgeAsset;
  matchedStages: string[];
  source: "enterprise" | "project";
  contentPath?: string;
}

export interface ResolvedBaseline {
  ref: string;
  discipline: string;
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
