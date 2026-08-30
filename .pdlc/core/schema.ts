import {
  CONTROL_DISPOSITIONS,
  CONTEXT_USE_DISPOSITIONS,
  CONTRIBUTION_MODES,
  CONTROL_ENFORCEMENT_TYPES,
  COVERAGE_STATUSES,
  DELIVERY_FLOW_STAGE_INCLUSIONS,
  DELIVERY_FLOW_STATUSES,
  DISCIPLINE_GUIDANCE_MODES,
  KNOWLEDGE_KINDS,
  POC_STATUSES,
  REQUIREMENTS_ANALYSIS_STATUSES,
  CHANGE_STATUSES,
  CHANGE_TYPES,
  REQUIREMENTS_COVERAGE_TOPICS,
  REQUIREMENTS_DEPTHS,
  REQUIREMENTS_STATUSES,
  RISK_LEVELS,
  STAGE_PHASES,
  type Applicability,
  type ArtifactDefinition,
  type AuditEvent,
  type BaseDeliveryRecord,
  type ControlPolicy,
  type DeliveryFlowCatalog,
  type DeliveryFlowDefinition,
  type DeliveryRecord,
  type DisciplineStageHooksDescriptor,
  type DisciplineManifest,
  type IntegrationCatalog,
  type IntegrationManifest,
  type KnowledgeAsset,
  type PocDeliveryRecord,
  type ProjectBaseline,
  type ProjectDefaultProfile,
  type RequirementsFlowControl,
  type RequirementsAnalysisRecord,
  type RoleCatalog,
  type StageCatalog,
  type StageContextReceipt,
  type ValidationIssue,
  type ValidationResult,
} from "./types.ts";
import { safeRecordId } from "./project-paths.ts";

export type JsonObject = Record<string, unknown>;
const ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const ROLE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function result<T>(value: unknown, issues: ValidationIssue[]): ValidationResult<T> {
  return issues.length === 0
    ? { ok: true, value: value as T, issues: [] }
    : { ok: false, issues };
}

export function issue(issues: ValidationIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path, message });
}

export function object(value: unknown, path: string, issues: ValidationIssue[]): JsonObject | undefined {
  if (!isObject(value)) {
    issue(issues, "EXPECTED_OBJECT", path, "Expected an object");
    return undefined;
  }
  return value;
}

export function exact(value: JsonObject, allowed: readonly string[], path: string, issues: ValidationIssue[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issue(issues, "UNKNOWN_FIELD", `${path}.${key}`, "Unknown field");
  }
}

export function string(value: unknown, path: string, issues: ValidationIssue[], allowEmpty = false): value is string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    issue(issues, "EXPECTED_STRING", path, allowEmpty ? "Expected a string" : "Expected a non-empty string");
    return false;
  }
  return true;
}

function id(value: unknown, path: string, issues: ValidationIssue[]): value is string {
  if (!string(value, path, issues)) return false;
  if (!ID_PATTERN.test(value)) issue(issues, "INVALID_ID", path, "Expected a lowercase kebab-case or discipline-qualified id");
  return true;
}

export function roleId(value: unknown, path: string, issues: ValidationIssue[]): value is string {
  if (!string(value, path, issues)) return false;
  if (!ROLE_ID_PATTERN.test(value)) issue(issues, "INVALID_ROLE_ID", path, "Expected a lowercase kebab-case Role id");
  return true;
}

function version(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (string(value, path, issues) && !VERSION_PATTERN.test(value)) {
    issue(issues, "INVALID_VERSION", path, "Expected semantic version x.y.z");
  }
}

export function stringArray(value: unknown, path: string, issues: ValidationIssue[], minItems = 0): value is string[] {
  if (!Array.isArray(value)) {
    issue(issues, "EXPECTED_ARRAY", path, "Expected an array");
    return false;
  }
  if (value.length < minItems) issue(issues, "TOO_FEW_ITEMS", path, `Expected at least ${minItems} item(s)`);
  value.forEach((entry, index) => string(entry, `${path}[${index}]`, issues));
  if (new Set(value).size !== value.length) issue(issues, "DUPLICATE_ITEM", path, "Array items must be unique");
  return true;
}

export function isoDate(value: unknown, path: string, issues: ValidationIssue[], allowEmpty = false): void {
  if (!string(value, path, issues, allowEmpty) || (allowEmpty && value === "")) return;
  if (Number.isNaN(Date.parse(value))) issue(issues, "INVALID_DATE_TIME", path, "Expected an ISO 8601 date-time");
}

export function relativePath(value: unknown, path: string, issues: ValidationIssue[]): value is string {
  if (!string(value, path, issues)) return false;
  if (value.startsWith("/") || value.split(/[\\/]/).includes("..")) {
    issue(issues, "UNSAFE_PATH", path, "Expected a safe relative path");
  }
  return true;
}

function applicability(value: unknown, path: string, issues: ValidationIssue[], optional = false): Applicability | undefined {
  if (value === undefined && optional) return undefined;
  const entry = object(value, path, issues);
  if (!entry) return undefined;
  exact(entry, ["deliveryFlows", "stages", "riskTriggers", "technologies", "disciplines"], path, issues);
  for (const key of ["deliveryFlows", "stages", "riskTriggers", "technologies", "disciplines"] as const) {
    if (entry[key] !== undefined) stringArray(entry[key], `${path}.${key}`, issues);
  }
  return entry as Applicability;
}

function validateEvidenceList(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issue(issues, "EXPECTED_ARRAY", path, "Expected an evidence array");
    return;
  }
  value.forEach((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const evidence = object(entry, itemPath, issues);
    if (!evidence) return;
    exact(evidence, ["kind", "ref", "description", "capturedAt"], itemPath, issues);
    if (!["file", "url", "ci", "demo"].includes(String(evidence.kind))) {
      issue(issues, "INVALID_ENUM", `${itemPath}.kind`, "Unsupported evidence kind");
    }
    string(evidence.ref, `${itemPath}.ref`, issues);
    string(evidence.description, `${itemPath}.description`, issues);
    if (evidence.capturedAt !== undefined) isoDate(evidence.capturedAt, `${itemPath}.capturedAt`, issues);
  });
}

function validateStageContextReceiptFields(value: unknown, path: string, issues: ValidationIssue[], stored: boolean): void {
  const receipt = object(value, path, issues);
  if (!receipt) return;
  const allowed = ["schemaVersion", "stage", "contextHash", "policies", "knowledge", "disciplineContributions", "integrations", "stageInvocation", ...(stored ? ["actor", "appliedAt"] : [])];
  exact(receipt, allowed, path, issues);
  if (receipt.schemaVersion !== 2) issue(issues, "UNSUPPORTED_SCHEMA", `${path}.schemaVersion`, "Expected schemaVersion 2");
  id(receipt.stage, `${path}.stage`, issues);
  if (typeof receipt.contextHash !== "string" || !/^[a-f0-9]{64}$/.test(receipt.contextHash)) issue(issues, "INVALID_CONTEXT_HASH", `${path}.contextHash`, "Expected a SHA-256 digest");
  if (stored) {
    string(receipt.actor, `${path}.actor`, issues);
    isoDate(receipt.appliedAt, `${path}.appliedAt`, issues);
  }

  if (!Array.isArray(receipt.policies)) issue(issues, "EXPECTED_ARRAY", `${path}.policies`, "Expected policies array");
  else {
    const refs: string[] = [];
    receipt.policies.forEach((entry, index) => {
      const itemPath = `${path}.policies[${index}]`;
      const item = object(entry, itemPath, issues);
      if (!item) return;
      exact(item, ["ref", "notes"], itemPath, issues);
      if (string(item.ref, `${itemPath}.ref`, issues)) refs.push(item.ref);
      string(item.notes, `${itemPath}.notes`, issues);
    });
    if (new Set(refs).size !== refs.length) issue(issues, "DUPLICATE_CONTEXT_REF", `${path}.policies`, "Policy receipt refs must be unique");
  }

  validateContextAssets(receipt.knowledge, `${path}.knowledge`, issues, "asset");
  validateContextAssets(receipt.disciplineContributions, `${path}.disciplineContributions`, issues, "discipline");
  validateContextAssets(receipt.integrations, `${path}.integrations`, issues, "integration");
  const requiredCapabilities = Array.isArray(receipt.disciplineContributions) && receipt.disciplineContributions.length > 0;
  if (requiredCapabilities) validateStageInvocation(receipt.stageInvocation, `${path}.stageInvocation`, issues);
  else if (receipt.stageInvocation !== undefined) issue(issues, "UNEXPECTED_STAGE_INVOCATION", `${path}.stageInvocation`, "A Stage without required capabilities must not include a Stage Agent invocation");
}

function validateContextAssets(value: unknown, path: string, issues: ValidationIssue[], kind: "asset" | "discipline" | "integration"): void {
  if (!Array.isArray(value)) {
    issue(issues, "EXPECTED_ARRAY", path, "Expected context asset array");
    return;
  }
  const refs: string[] = [];
  value.forEach((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const item = object(entry, itemPath, issues);
    if (!item) return;
    const allowed = [
      "ref",
      "disposition",
      "notes",
      "evidenceRefs",
      ...(kind === "discipline" ? ["capability", "agent", "selectedSkills"] : []),
      ...(kind === "integration" ? ["skills"] : []),
    ];
    exact(item, allowed, itemPath, issues);
    if (string(item.ref, `${itemPath}.ref`, issues)) refs.push(item.ref);
    if (!CONTEXT_USE_DISPOSITIONS.includes(item.disposition as never)) issue(issues, "INVALID_CONTEXT_DISPOSITION", `${itemPath}.disposition`, "Expected used or not-used");
    string(item.notes, `${itemPath}.notes`, issues);
    const minimumEvidence = item.disposition === "used" ? 1 : 0;
    stringArray(item.evidenceRefs, `${itemPath}.evidenceRefs`, issues, minimumEvidence);
    if (kind === "discipline") {
      id(item.capability, `${itemPath}.capability`, issues);
      string(item.agent, `${itemPath}.agent`, issues);
      stringArray(item.selectedSkills, `${itemPath}.selectedSkills`, issues, 1);
      if (item.disposition !== "used") issue(issues, "REQUIRED_AGENT_CAPABILITY_SKIPPED", `${itemPath}.disposition`, "A required Agent capability must be executed");
    }
    if (kind === "integration") stringArray(item.skills, `${itemPath}.skills`, issues);
  });
  if (new Set(refs).size !== refs.length) issue(issues, "DUPLICATE_CONTEXT_REF", path, "Context asset refs must be unique");
}

function validateStageInvocation(value: unknown, path: string, issues: ValidationIssue[]): void {
  const execution = object(value, path, issues);
  if (!execution) return;
  exact(execution, ["invocationId", "platform", "executor", "agentType", "status", "platformExecutionRef", "permissions"], path, issues);
  if (typeof execution.invocationId !== "string" || !/^[a-f0-9]{64}$/.test(execution.invocationId)) issue(issues, "INVALID_INVOCATION_ID", `${path}.invocationId`, "Expected a context-bound SHA-256 invocation id");
  if (execution.platform !== "github-copilot") issue(issues, "INVALID_AGENT_PLATFORM", `${path}.platform`, "Expected github-copilot");
  if (execution.executor !== "generic-subagent") issue(issues, "INVALID_AGENT_EXECUTOR", `${path}.executor`, "Expected generic-subagent");
  if (execution.agentType !== "general-purpose") issue(issues, "INVALID_SUBAGENT_TYPE", `${path}.agentType`, "Expected general-purpose");
  if (execution.status !== "completed") issue(issues, "AGENT_CAPABILITY_INCOMPLETE", `${path}.status`, "Expected completed");
  if (string(execution.platformExecutionRef, `${path}.platformExecutionRef`, issues) && !/^github-copilot:subagent:\S+$/.test(execution.platformExecutionRef as string)) {
    issue(issues, "INVALID_PLATFORM_EXECUTION_REF", `${path}.platformExecutionRef`, "Expected an opaque platform-generated subagent execution reference");
  }
  const permissions = object(execution.permissions, `${path}.permissions`, issues);
  if (permissions) {
    exact(permissions, ["filesystem", "network", "externalWrites"], `${path}.permissions`, issues);
    if (!["read", "write"].includes(String(permissions.filesystem))) issue(issues, "INVALID_FILESYSTEM_PERMISSION", `${path}.permissions.filesystem`, "Expected read or write");
    if (typeof permissions.network !== "boolean") issue(issues, "EXPECTED_BOOLEAN", `${path}.permissions.network`, "Expected a boolean");
    if (typeof permissions.externalWrites !== "boolean") issue(issues, "EXPECTED_BOOLEAN", `${path}.permissions.externalWrites`, "Expected a boolean");
  }
}

export function validateStageContextReceipt(value: unknown): ValidationResult<StageContextReceipt> {
  const issues: ValidationIssue[] = [];
  validateStageContextReceiptFields(value, "$", issues, false);
  return result<StageContextReceipt>(value, issues);
}

export function validatePocDeliveryRecord(value: unknown): ValidationResult<PocDeliveryRecord> {
  const issues: ValidationIssue[] = [];
  const record = object(value, "$", issues);
  if (!record) return result(value, issues);
  exact(record, ["schemaVersion", "id", "deliveryFlow", "status", "title", "revision", "createdAt", "updatedAt", "assignments", "source", "idea", "requirements", "scope", "risk", "resolution", "design", "evidence", "decision"], "$", issues);
  if (record.schemaVersion !== 3) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 3");
  if (!string(record.id, "$.id", issues) || !/^POC-[A-Z0-9][A-Z0-9-]*$/.test(record.id)) {
    issue(issues, "INVALID_RECORD_ID", "$.id", "Expected POC- followed by uppercase letters, digits, or hyphens");
  }
  if (record.deliveryFlow !== "poc") issue(issues, "INVALID_DELIVERY_FLOW", "$.deliveryFlow", "Expected poc");
  if (!POC_STATUSES.includes(record.status as never)) issue(issues, "INVALID_STATUS", "$.status", "Unsupported POC status");
  string(record.title, "$.title", issues);
  if (!Number.isInteger(record.revision) || Number(record.revision) < 0) issue(issues, "INVALID_REVISION", "$.revision", "Expected a non-negative integer");
  isoDate(record.createdAt, "$.createdAt", issues);
  isoDate(record.updatedAt, "$.updatedAt", issues);

  const requirementsApproved = isObject(record.requirements) && record.requirements.status === "approved";
  const assignments = object(record.assignments, "$.assignments", issues);
  if (assignments) {
    const entries = Object.entries(assignments);
    if (entries.length === 0) issue(issues, "ROLE_ASSIGNMENTS_EMPTY", "$.assignments", "Expected at least one registered Role assignment");
    entries.forEach(([role, identity]) => {
      roleId(role, `$.assignments.${role}`, issues);
      string(identity, `$.assignments.${role}`, issues, !requirementsApproved);
    });
  }

  const source = object(record.source, "$.source", issues);
  if (source) {
    exact(source, ["baseRevision", "derivedFromRecord", "deliveredRevision"], "$.source", issues);
    for (const key of ["baseRevision", "deliveredRevision"] as const) {
      if (string(source[key], `$.source.${key}`, issues, true) && source[key] !== "" && !/^[a-f0-9]{7,64}$/.test(source[key] as string)) {
        issue(issues, "INVALID_SOURCE_REVISION", `$.source.${key}`, "Expected an empty value or a Git object id");
      }
    }
    if (string(source.derivedFromRecord, "$.source.derivedFromRecord", issues, true) && source.derivedFromRecord !== "") {
      try { safeRecordId(source.derivedFromRecord as string); }
      catch { issue(issues, "INVALID_SOURCE_RECORD", "$.source.derivedFromRecord", "Expected a valid Delivery Record id"); }
      if (source.derivedFromRecord === record.id) issue(issues, "SELF_DERIVED_RECORD", "$.source.derivedFromRecord", "A Delivery Record cannot derive from itself");
    }
  }

  const idea = object(record.idea, "$.idea", issues);
  if (idea) {
    exact(idea, ["problem", "hypothesis", "expectedOutcome", "successCriteria", "timebox"], "$.idea", issues);
    for (const key of ["problem", "hypothesis", "expectedOutcome", "timebox"] as const) string(idea[key], `$.idea.${key}`, issues, !requirementsApproved);
    stringArray(idea.successCriteria, "$.idea.successCriteria", issues, requirementsApproved ? 1 : 0);
  }

  const requirements = object(record.requirements, "$.requirements", issues);
  if (requirements) {
    exact(requirements, ["artifactType", "documentRef", "profile", "status", "clarification", "approvedBy", "approvedAt", "approvedContentHash", "approvedContractHash"], "$.requirements", issues);
    if (requirements.artifactType !== "product-management.requirements") issue(issues, "INVALID_ARTIFACT_TYPE", "$.requirements.artifactType", "Expected product-management.requirements");
    if (string(requirements.documentRef, "$.requirements.documentRef", issues) && !requirements.documentRef.endsWith(".md")) issue(issues, "INVALID_REQUIREMENTS_REF", "$.requirements.documentRef", "Requirements document must be Markdown");
    if (!REQUIREMENTS_DEPTHS.includes(requirements.profile as never)) issue(issues, "INVALID_REQUIREMENTS_PROFILE", "$.requirements.profile", "Unsupported requirements profile");
    if (!REQUIREMENTS_STATUSES.includes(requirements.status as never)) issue(issues, "INVALID_REQUIREMENTS_STATUS", "$.requirements.status", "Unsupported requirements status");
    const clarification = object(requirements.clarification, "$.requirements.clarification", issues);
    if (clarification) {
      exact(clarification, ["questionsAnswered", "coverage", "openQuestions", "contradictions"], "$.requirements.clarification", issues);
      if (!Number.isInteger(clarification.questionsAnswered) || Number(clarification.questionsAnswered) < 0) issue(issues, "INVALID_QUESTION_COUNT", "$.requirements.clarification.questionsAnswered", "Expected a non-negative integer");
      const coverage = object(clarification.coverage, "$.requirements.clarification.coverage", issues);
      if (coverage) {
        exact(coverage, REQUIREMENTS_COVERAGE_TOPICS, "$.requirements.clarification.coverage", issues);
        REQUIREMENTS_COVERAGE_TOPICS.forEach((topic) => {
          if (!COVERAGE_STATUSES.includes(coverage[topic] as never)) issue(issues, "INVALID_COVERAGE_STATUS", `$.requirements.clarification.coverage.${topic}`, "Expected pending or complete");
        });
      }
      stringArray(clarification.openQuestions, "$.requirements.clarification.openQuestions", issues);
      stringArray(clarification.contradictions, "$.requirements.clarification.contradictions", issues);
    }
    string(requirements.approvedBy, "$.requirements.approvedBy", issues, true);
    isoDate(requirements.approvedAt, "$.requirements.approvedAt", issues, true);
    string(requirements.approvedContentHash, "$.requirements.approvedContentHash", issues, true);
    if (requirements.approvedContractHash !== undefined) string(requirements.approvedContractHash, "$.requirements.approvedContractHash", issues, true);
    if (requirements.status === "approved") {
      string(requirements.approvedBy, "$.requirements.approvedBy", issues);
      isoDate(requirements.approvedAt, "$.requirements.approvedAt", issues);
      if (typeof requirements.approvedContentHash !== "string" || !/^[a-f0-9]{64}$/.test(requirements.approvedContentHash)) issue(issues, "INVALID_REQUIREMENTS_HASH", "$.requirements.approvedContentHash", "Expected a SHA-256 digest");
      if (requirements.approvedContractHash !== undefined && (typeof requirements.approvedContractHash !== "string" || !/^[a-f0-9]{64}$/.test(requirements.approvedContractHash))) issue(issues, "INVALID_BUILD_CONTRACT_HASH", "$.requirements.approvedContractHash", "Expected a SHA-256 digest");
    } else if (requirements.approvedBy !== "" || requirements.approvedAt !== "" || requirements.approvedContentHash !== "" || (requirements.approvedContractHash ?? "") !== "") {
      issue(issues, "DRAFT_REQUIREMENTS_HAVE_APPROVAL", "$.requirements", "Draft requirements cannot contain approval metadata");
    }
  }

  const scope = object(record.scope, "$.scope", issues);
  if (scope) {
    exact(scope, ["inScope", "outOfScope", "productionUse"], "$.scope", issues);
    stringArray(scope.inScope, "$.scope.inScope", issues);
    stringArray(scope.outOfScope, "$.scope.outOfScope", issues);
    if (scope.productionUse !== false) issue(issues, "POC_PRODUCTION_FORBIDDEN", "$.scope.productionUse", "POC production use must remain false");
  }

  const risk = object(record.risk, "$.risk", issues);
  if (risk) {
    exact(risk, ["level", "triggers"], "$.risk", issues);
    if (!RISK_LEVELS.includes(risk.level as never)) issue(issues, "INVALID_RISK_LEVEL", "$.risk.level", "Unsupported risk level");
    stringArray(risk.triggers, "$.risk.triggers", issues);
  }

  const resolution = object(record.resolution, "$.resolution", issues);
  if (resolution) {
    exact(resolution, ["controls", "baselines", "defaults", "knowledge", "integrations", "contextApplications"], "$.resolution", issues);
    const controls = object(resolution.controls, "$.resolution.controls", issues);
    if (controls) {
      exact(controls, ["applicable", "exceptions", "applications"], "$.resolution.controls", issues);
      stringArray(controls.applicable, "$.resolution.controls.applicable", issues);
      stringArray(controls.exceptions, "$.resolution.controls.exceptions", issues);
      if (!Array.isArray(controls.applications)) issue(issues, "EXPECTED_ARRAY", "$.resolution.controls.applications", "Expected applications array");
      else controls.applications.forEach((entry, index) => {
        const path = `$.resolution.controls.applications[${index}]`;
        const application = object(entry, path, issues);
        if (!application) return;
        exact(application, ["control", "disposition", "notes", "evidenceRefs", "approvedBy"], path, issues);
        string(application.control, `${path}.control`, issues);
        if (!CONTROL_DISPOSITIONS.includes(application.disposition as never)) issue(issues, "INVALID_CONTROL_DISPOSITION", `${path}.disposition`, "Expected satisfied or exception");
        string(application.notes, `${path}.notes`, issues);
        stringArray(application.evidenceRefs, `${path}.evidenceRefs`, issues);
        string(application.approvedBy, `${path}.approvedBy`, issues, true);
      });
    }
    for (const key of ["baselines", "defaults", "knowledge", "integrations"] as const) stringArray(resolution[key], `$.resolution.${key}`, issues);
    if (!Array.isArray(resolution.contextApplications)) issue(issues, "EXPECTED_ARRAY", "$.resolution.contextApplications", "Expected context applications array");
    else {
      const stages: string[] = [];
      resolution.contextApplications.forEach((entry, index) => {
        validateStageContextReceiptFields(entry, `$.resolution.contextApplications[${index}]`, issues, true);
        if (isObject(entry) && typeof entry.stage === "string") stages.push(entry.stage);
      });
      if (new Set(stages).size !== stages.length) issue(issues, "DUPLICATE_STAGE_CONTEXT_APPLICATION", "$.resolution.contextApplications", "Only one current Context Application is allowed per Stage");
    }
  }

  const design = object(record.design, "$.design", issues);
  if (design) {
    exact(design, ["summary", "decisions", "technologies", "disciplines"], "$.design", issues);
    string(design.summary, "$.design.summary", issues, !requirementsApproved);
    stringArray(design.decisions, "$.design.decisions", issues);
    stringArray(design.technologies, "$.design.technologies", issues);
    stringArray(design.disciplines, "$.design.disciplines", issues);
  }

  const evidence = object(record.evidence, "$.evidence", issues);
  if (evidence) {
    exact(evidence, ["tests", "build", "security", "demo"], "$.evidence", issues);
    for (const key of ["tests", "build", "security", "demo"] as const) validateEvidenceList(evidence[key], `$.evidence.${key}`, issues);
  }

  const decision = object(record.decision, "$.decision", issues);
  if (decision) {
    exact(decision, ["outcome", "rationale", "followUp", "productizationPackage"], "$.decision", issues);
    if (!["", "park", "recommend-productization"].includes(String(decision.outcome))) issue(issues, "INVALID_OUTCOME", "$.decision.outcome", "Unsupported outcome");
    string(decision.rationale, "$.decision.rationale", issues, true);
    string(decision.followUp, "$.decision.followUp", issues, true);
    const productizationPackage = object(decision.productizationPackage, "$.decision.productizationPackage", issues);
    if (productizationPackage) {
      exact(productizationPackage, ["artifactType", "documentRef", "contentHash"], "$.decision.productizationPackage", issues);
      if (productizationPackage.artifactType !== "product-management.productization-package") issue(issues, "INVALID_ARTIFACT_TYPE", "$.decision.productizationPackage.artifactType", "Expected product-management.productization-package");
      string(productizationPackage.documentRef, "$.decision.productizationPackage.documentRef", issues, true);
      string(productizationPackage.contentHash, "$.decision.productizationPackage.contentHash", issues, true);
      if (decision.outcome === "recommend-productization") {
        if (typeof productizationPackage.documentRef !== "string" || !productizationPackage.documentRef.endsWith(".md")) issue(issues, "INVALID_PRODUCTIZATION_PACKAGE_REF", "$.decision.productizationPackage.documentRef", "Productization Package must reference a Markdown document");
        if (typeof productizationPackage.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(productizationPackage.contentHash)) issue(issues, "INVALID_PRODUCTIZATION_PACKAGE_HASH", "$.decision.productizationPackage.contentHash", "Expected a SHA-256 digest");
      } else if (productizationPackage.contentHash !== "") {
        issue(issues, "UNBOUND_PRODUCTIZATION_PACKAGE", "$.decision.productizationPackage.contentHash", "Package content hash is written only by the recommend-productization checkpoint");
      }
    }
    const terminalOutcome = record.status === "PARKED"
      ? "park"
      : record.status === "PRODUCTIZATION_RECOMMENDED"
        ? "recommend-productization"
        : "";
    if (decision.outcome !== terminalOutcome) {
      issue(issues, "OUTCOME_STATUS_MISMATCH", "$.decision.outcome", `Outcome must be ${terminalOutcome || "empty"} while status is ${String(record.status)}`);
    }
  }
  return result<PocDeliveryRecord>(value, issues);
}

/** @deprecated Compatibility-only validator. The executable source of truth is Flow-owned `record-validator.ts`; the Flow Engine never calls this function. */
export function validateRequirementsAnalysisRecord(value: unknown): ValidationResult<RequirementsAnalysisRecord> {
  const issues: ValidationIssue[] = [];
  const record = object(value, "$", issues);
  if (!record) return result(value, issues);
  exact(record, ["schemaVersion", "id", "deliveryFlow", "status", "title", "revision", "createdAt", "updatedAt", "assignments", "source", "requirements", "risk", "resolution", "design", "stories", "scope", "changes"], "$", issues);
  if (record.schemaVersion !== 1) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 1");
  if (!string(record.id, "$.id", issues) || !/^REQ-[A-Z0-9][A-Z0-9-]*$/.test(record.id)) issue(issues, "INVALID_RECORD_ID", "$.id", "Expected REQ- followed by uppercase letters, digits, or hyphens");
  if (record.deliveryFlow !== "product-requirements-analysis") issue(issues, "INVALID_DELIVERY_FLOW", "$.deliveryFlow", "Expected product-requirements-analysis");
  if (!REQUIREMENTS_ANALYSIS_STATUSES.includes(record.status as never)) issue(issues, "INVALID_STATUS", "$.status", "Unsupported Requirements Analysis status");
  string(record.title, "$.title", issues);
  if (!Number.isInteger(record.revision) || Number(record.revision) < 0) issue(issues, "INVALID_REVISION", "$.revision", "Expected a non-negative integer");
  isoDate(record.createdAt, "$.createdAt", issues);
  isoDate(record.updatedAt, "$.updatedAt", issues);
  const assignments = object(record.assignments, "$.assignments", issues);
  if (assignments) Object.entries(assignments).forEach(([role, identity]) => { roleId(role, `$.assignments.${role}`, issues); string(identity, `$.assignments.${role}`, issues, true); });
  validateSourceLineage(record.source, "$.source", issues, String(record.id));

  const requirements = object(record.requirements, "$.requirements", issues);
  if (requirements) {
    exact(requirements, ["artifactType", "documentRef", "profile", "status", "clarification", "approvedBy", "approvedAt", "approvedContentHash", "approvedContractHash"], "$.requirements", issues);
    if (requirements.artifactType !== "product-management.requirements") issue(issues, "INVALID_ARTIFACT_TYPE", "$.requirements.artifactType", "Expected product-management.requirements");
    relativePath(requirements.documentRef, "$.requirements.documentRef", issues);
    if (!REQUIREMENTS_DEPTHS.includes(requirements.profile as never)) issue(issues, "INVALID_REQUIREMENTS_PROFILE", "$.requirements.profile", "Unsupported requirements profile");
    if (!REQUIREMENTS_STATUSES.includes(requirements.status as never)) issue(issues, "INVALID_REQUIREMENTS_STATUS", "$.requirements.status", "Unsupported requirements status");
    const clarification = object(requirements.clarification, "$.requirements.clarification", issues);
    if (clarification) {
      exact(clarification, ["questionsAnswered", "coverage", "openQuestions", "contradictions"], "$.requirements.clarification", issues);
      if (!Number.isInteger(clarification.questionsAnswered) || Number(clarification.questionsAnswered) < 0) issue(issues, "INVALID_QUESTION_COUNT", "$.requirements.clarification.questionsAnswered", "Expected a non-negative integer");
      const coverage = object(clarification.coverage, "$.requirements.clarification.coverage", issues);
      if (coverage) {
        exact(coverage, REQUIREMENTS_COVERAGE_TOPICS, "$.requirements.clarification.coverage", issues);
        REQUIREMENTS_COVERAGE_TOPICS.forEach((topic) => { if (!COVERAGE_STATUSES.includes(coverage[topic] as never)) issue(issues, "INVALID_COVERAGE_STATUS", `$.requirements.clarification.coverage.${topic}`, "Expected pending or complete"); });
      }
      stringArray(clarification.openQuestions, "$.requirements.clarification.openQuestions", issues);
      stringArray(clarification.contradictions, "$.requirements.clarification.contradictions", issues);
    }
    string(requirements.approvedBy, "$.requirements.approvedBy", issues, true);
    isoDate(requirements.approvedAt, "$.requirements.approvedAt", issues, true);
    string(requirements.approvedContentHash, "$.requirements.approvedContentHash", issues, true);
    if (requirements.approvedContractHash !== undefined) string(requirements.approvedContractHash, "$.requirements.approvedContractHash", issues, true);
    if (record.status !== "DRAFT" && requirements.status !== "approved") issue(issues, "REQUIREMENTS_NOT_APPROVED", "$.requirements.status", "Requirements must be approved after the first checkpoint");
    if (requirements.status === "approved") {
      if (!requirements.approvedBy || !requirements.approvedAt) issue(issues, "REQUIREMENTS_APPROVAL_INCOMPLETE", "$.requirements", "Approved Requirements require an actor and timestamp");
      if (typeof requirements.approvedContentHash !== "string" || !/^[a-f0-9]{64}$/.test(requirements.approvedContentHash)) issue(issues, "INVALID_REQUIREMENTS_HASH", "$.requirements.approvedContentHash", "Expected a SHA-256 digest");
      if (typeof requirements.approvedContractHash !== "string" || !/^[a-f0-9]{64}$/.test(requirements.approvedContractHash)) issue(issues, "INVALID_REQUIREMENTS_CONTRACT_HASH", "$.requirements.approvedContractHash", "Expected a SHA-256 digest");
    }
  }
  validateRiskResolutionDesign(record, issues);

  const storyIds: string[] = [];
  if (!Array.isArray(record.stories)) issue(issues, "EXPECTED_ARRAY", "$.stories", "Expected stories array");
  else record.stories.forEach((entry, index) => {
    const path = `$.stories[${index}]`;
    const story = object(entry, path, issues);
    if (!story) return;
    exact(story, ["localId", "artifactRef", "externalKey", "revision", "contentHash", "requirementRefs", "acceptanceCriteria", "dependencies"], path, issues);
    if (string(story.localId, `${path}.localId`, issues) && !/^STORY-[A-Z0-9][A-Z0-9-]*$/.test(story.localId)) issue(issues, "INVALID_STORY_ID", `${path}.localId`, "Expected STORY- followed by uppercase letters, digits, or hyphens");
    else if (typeof story.localId === "string") storyIds.push(story.localId);
    relativePath(story.artifactRef, `${path}.artifactRef`, issues);
    string(story.externalKey, `${path}.externalKey`, issues, true);
    if (!Number.isInteger(story.revision) || Number(story.revision) < 1) issue(issues, "INVALID_STORY_REVISION", `${path}.revision`, "Expected a positive integer");
    if (typeof story.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(story.contentHash)) issue(issues, "INVALID_STORY_HASH", `${path}.contentHash`, "Expected a SHA-256 digest");
    stringArray(story.requirementRefs, `${path}.requirementRefs`, issues, 1);
    stringArray(story.acceptanceCriteria, `${path}.acceptanceCriteria`, issues, 1);
    stringArray(story.dependencies, `${path}.dependencies`, issues);
  });
  if (new Set(storyIds).size !== storyIds.length) issue(issues, "DUPLICATE_STORY", "$.stories", "Story ids must be unique");
  if (["WORK_ITEMS_PREPARED", "SCOPED"].includes(String(record.status)) && storyIds.length === 0) issue(issues, "STORIES_MISSING", "$.stories", "Prepared work items require at least one Story");

  const scope = object(record.scope, "$.scope", issues);
  if (scope) {
    exact(scope, ["artifactType", "documentRef", "version", "previousScopeHash", "scopeHash", "epicRef", "sprint", "storyIds", "approvedBy", "approvedAt"], "$.scope", issues);
    if (scope.artifactType !== "product-management.sprint-scope") issue(issues, "INVALID_ARTIFACT_TYPE", "$.scope.artifactType", "Expected product-management.sprint-scope");
    if (scope.documentRef !== "") relativePath(scope.documentRef, "$.scope.documentRef", issues);
    if (!Number.isInteger(scope.version) || Number(scope.version) < 0) issue(issues, "INVALID_SCOPE_VERSION", "$.scope.version", "Expected a non-negative integer");
    for (const key of ["previousScopeHash", "scopeHash"] as const) if (typeof scope[key] !== "string" || (scope[key] !== "" && !/^[a-f0-9]{64}$/.test(scope[key] as string))) issue(issues, "INVALID_SCOPE_HASH", `$.scope.${key}`, "Expected an empty value or SHA-256 digest");
    string(scope.epicRef, "$.scope.epicRef", issues, true);
    stringArray(scope.storyIds, "$.scope.storyIds", issues);
    const sprint = object(scope.sprint, "$.scope.sprint", issues);
    if (sprint) { exact(sprint, ["id", "name", "capturedAt"], "$.scope.sprint", issues); string(sprint.id, "$.scope.sprint.id", issues, true); string(sprint.name, "$.scope.sprint.name", issues, true); isoDate(sprint.capturedAt, "$.scope.sprint.capturedAt", issues, true); }
    string(scope.approvedBy, "$.scope.approvedBy", issues, true);
    isoDate(scope.approvedAt, "$.scope.approvedAt", issues, true);
    if (scope.storyIds && Array.isArray(scope.storyIds)) scope.storyIds.forEach((storyId, index) => { if (!storyIds.includes(storyId)) issue(issues, "SCOPE_STORY_UNKNOWN", `$.scope.storyIds[${index}]`, `Story is not present in the Record: ${String(storyId)}`); });
    if (record.status === "SCOPED" && (Number(scope.version) < 1 || !scope.documentRef || !scope.scopeHash || !scope.approvedBy || !scope.approvedAt)) issue(issues, "SCOPE_NOT_APPROVED", "$.scope", "SCOPED requires a versioned, hashed, approved Sprint Scope");
    if (record.status === "SCOPED" && isObject(record.source) && !record.source.deliveredRevision) issue(issues, "DELIVERED_REVISION_MISSING", "$.source.deliveredRevision", "SCOPED requires an immutable Git source revision");
  }

  const changeIds: string[] = [];
  if (!Array.isArray(record.changes)) issue(issues, "EXPECTED_ARRAY", "$.changes", "Expected changes array");
  else record.changes.forEach((entry, index) => {
    const path = `$.changes[${index}]`;
    const change = object(entry, path, issues);
    if (!change) return;
    exact(change, ["id", "type", "status", "storyIds", "reason", "impact", "proposedBy", "createdAt", "approvedBy", "approvedAt"], path, issues);
    if (string(change.id, `${path}.id`, issues)) changeIds.push(change.id);
    if (!CHANGE_TYPES.includes(change.type as never)) issue(issues, "INVALID_CHANGE_TYPE", `${path}.type`, "Unsupported change type");
    if (!CHANGE_STATUSES.includes(change.status as never)) issue(issues, "INVALID_CHANGE_STATUS", `${path}.status`, "Unsupported change status");
    stringArray(change.storyIds, `${path}.storyIds`, issues);
    string(change.reason, `${path}.reason`, issues);
    string(change.impact, `${path}.impact`, issues, change.status === "proposed");
    string(change.proposedBy, `${path}.proposedBy`, issues);
    isoDate(change.createdAt, `${path}.createdAt`, issues);
    string(change.approvedBy, `${path}.approvedBy`, issues, true);
    isoDate(change.approvedAt, `${path}.approvedAt`, issues, true);
    if (["approved", "applied"].includes(String(change.status)) && (!change.approvedBy || !change.approvedAt)) issue(issues, "CHANGE_APPROVAL_INCOMPLETE", path, "Approved or applied changes require an approval actor and timestamp");
    if (Array.isArray(change.storyIds)) change.storyIds.forEach((storyId, storyIndex) => { if (!storyIds.includes(storyId)) issue(issues, "CHANGE_STORY_UNKNOWN", `${path}.storyIds[${storyIndex}]`, `Story is not present in the Record: ${String(storyId)}`); });
  });
  if (new Set(changeIds).size !== changeIds.length) issue(issues, "DUPLICATE_CHANGE", "$.changes", "Change ids must be unique");
  return result<RequirementsAnalysisRecord>(value, issues);
}

/** @deprecated Closed-union compatibility API. Storage and Flow Engine use the generic envelope plus a Flow-owned validator. */
export function validateDeliveryRecord(value: unknown): ValidationResult<DeliveryRecord> {
  if (isObject(value) && value.deliveryFlow === "product-requirements-analysis") return validateRequirementsAnalysisRecord(value);
  return validatePocDeliveryRecord(value);
}

/**
 * Stable storage envelope. Flow-owned executors validate fields beyond this
 * contract, so adding a Delivery Flow never requires extending Core's Record
 * union or this validator.
 */
export function validateDeliveryRecordEnvelope(value: unknown): ValidationResult<BaseDeliveryRecord> {
  const issues: ValidationIssue[] = [];
  const record = object(value, "$", issues);
  if (!record) return result(value, issues);
  if (!Number.isInteger(record.schemaVersion) || Number(record.schemaVersion) < 1) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected a positive integer schemaVersion");
  if (string(record.id, "$.id", issues)) {
    try { safeRecordId(record.id); }
    catch { issue(issues, "INVALID_RECORD_ID", "$.id", "Expected a safe Delivery Record id"); }
  }
  id(record.deliveryFlow, "$.deliveryFlow", issues);
  string(record.status, "$.status", issues);
  string(record.title, "$.title", issues);
  if (!Number.isInteger(record.revision) || Number(record.revision) < 0) issue(issues, "INVALID_REVISION", "$.revision", "Expected a non-negative integer");
  isoDate(record.createdAt, "$.createdAt", issues);
  isoDate(record.updatedAt, "$.updatedAt", issues);
  const assignments = object(record.assignments, "$.assignments", issues);
  if (assignments) Object.entries(assignments).forEach(([role, identity]) => { roleId(role, `$.assignments.${role}`, issues); string(identity, `$.assignments.${role}`, issues, true); });
  validateSourceLineage(record.source, "$.source", issues, String(record.id));
  return result<BaseDeliveryRecord>(value, issues);
}

export function validateSourceLineage(value: unknown, path: string, issues: ValidationIssue[], recordId: string): void {
  const source = object(value, path, issues);
  if (!source) return;
  exact(source, ["baseRevision", "derivedFromRecord", "deliveredRevision"], path, issues);
  for (const key of ["baseRevision", "deliveredRevision"] as const) if (string(source[key], `${path}.${key}`, issues, true) && source[key] !== "" && !/^[a-f0-9]{7,64}$/.test(source[key] as string)) issue(issues, "INVALID_SOURCE_REVISION", `${path}.${key}`, "Expected an empty value or a Git object id");
  if (string(source.derivedFromRecord, `${path}.derivedFromRecord`, issues, true) && source.derivedFromRecord !== "") {
    try { safeRecordId(source.derivedFromRecord as string); } catch { issue(issues, "INVALID_SOURCE_RECORD", `${path}.derivedFromRecord`, "Expected a valid Delivery Record id"); }
    if (source.derivedFromRecord === recordId) issue(issues, "SELF_DERIVED_RECORD", `${path}.derivedFromRecord`, "A Delivery Record cannot derive from itself");
  }
}

export function validateRiskResolutionDesign(record: Record<string, unknown>, issues: ValidationIssue[]): void {
  const risk = object(record.risk, "$.risk", issues);
  if (risk) { exact(risk, ["level", "triggers"], "$.risk", issues); if (!RISK_LEVELS.includes(risk.level as never)) issue(issues, "INVALID_RISK_LEVEL", "$.risk.level", "Unsupported risk level"); stringArray(risk.triggers, "$.risk.triggers", issues); }
  const resolution = object(record.resolution, "$.resolution", issues);
  if (resolution) {
    exact(resolution, ["controls", "baselines", "defaults", "knowledge", "integrations", "contextApplications"], "$.resolution", issues);
    const controls = object(resolution.controls, "$.resolution.controls", issues);
    if (controls) { exact(controls, ["applicable", "exceptions", "applications"], "$.resolution.controls", issues); stringArray(controls.applicable, "$.resolution.controls.applicable", issues); stringArray(controls.exceptions, "$.resolution.controls.exceptions", issues); if (!Array.isArray(controls.applications)) issue(issues, "EXPECTED_ARRAY", "$.resolution.controls.applications", "Expected applications array"); }
    for (const key of ["baselines", "defaults", "knowledge", "integrations"] as const) stringArray(resolution[key], `$.resolution.${key}`, issues);
    if (!Array.isArray(resolution.contextApplications)) issue(issues, "EXPECTED_ARRAY", "$.resolution.contextApplications", "Expected context applications array");
    else resolution.contextApplications.forEach((entry, index) => validateStageContextReceiptFields(entry, `$.resolution.contextApplications[${index}]`, issues, true));
  }
  const design = object(record.design, "$.design", issues);
  if (design) { exact(design, ["summary", "decisions", "technologies", "disciplines"], "$.design", issues); string(design.summary, "$.design.summary", issues, true); stringArray(design.decisions, "$.design.decisions", issues); stringArray(design.technologies, "$.design.technologies", issues); stringArray(design.disciplines, "$.design.disciplines", issues); }
}

export function validateRequirementsFlowControl(value: unknown): ValidationResult<RequirementsFlowControl> {
  const issues: ValidationIssue[] = [];
  const control = object(value, "$", issues);
  if (!control) return result(value, issues);
  exact(control, ["schemaVersion", "id", "owner", "version", "artifactType", "profiles", "questionRules"], "$", issues);
  if (control.schemaVersion !== 1) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 1");
  id(control.id, "$.id", issues);
  string(control.owner, "$.owner", issues);
  version(control.version, "$.version", issues);
  if (control.artifactType !== "product-management.requirements") issue(issues, "INVALID_ARTIFACT_TYPE", "$.artifactType", "Expected product-management.requirements");
  const profiles = object(control.profiles, "$.profiles", issues);
  if (profiles) {
    exact(profiles, REQUIREMENTS_DEPTHS, "$.profiles", issues);
    REQUIREMENTS_DEPTHS.forEach((profile) => {
      const path = `$.profiles.${profile}`;
      const entry = object(profiles[profile], path, issues);
      if (!entry) return;
      exact(entry, ["minimumAnsweredQuestions", "requiredTopics"], path, issues);
      if (!Number.isInteger(entry.minimumAnsweredQuestions) || Number(entry.minimumAnsweredQuestions) < 0) issue(issues, "INVALID_QUESTION_COUNT", `${path}.minimumAnsweredQuestions`, "Expected a non-negative integer");
      if (stringArray(entry.requiredTopics, `${path}.requiredTopics`, issues, 1)) entry.requiredTopics.forEach((topic, index) => {
        if (!REQUIREMENTS_COVERAGE_TOPICS.includes(topic as never)) issue(issues, "INVALID_COVERAGE_TOPIC", `${path}.requiredTopics[${index}]`, "Unsupported coverage topic");
      });
    });
  }
  const rules = object(control.questionRules, "$.questionRules", issues);
  if (rules) {
    exact(rules, ["maxQuestionsPerRound", "requireOtherOption", "analyzeContradictions", "requireFinalDocumentReview", "allowDocumentAnswers", "questionDocumentPattern", "answerTag"], "$.questionRules", issues);
    if (!Number.isInteger(rules.maxQuestionsPerRound) || Number(rules.maxQuestionsPerRound) < 1 || Number(rules.maxQuestionsPerRound) > 3) issue(issues, "INVALID_QUESTION_LIMIT", "$.questionRules.maxQuestionsPerRound", "Expected an integer from 1 to 3");
    for (const key of ["requireOtherOption", "analyzeContradictions", "requireFinalDocumentReview", "allowDocumentAnswers"] as const) if (typeof rules[key] !== "boolean") issue(issues, "EXPECTED_BOOLEAN", `$.questionRules.${key}`, "Expected a boolean");
    relativePath(rules.questionDocumentPattern, "$.questionRules.questionDocumentPattern", issues);
    if (rules.answerTag !== "[Answer]:") issue(issues, "INVALID_ANSWER_TAG", "$.questionRules.answerTag", "Expected [Answer]:");
  }
  return result<RequirementsFlowControl>(value, issues);
}

export function validateStageCatalog(value: unknown): ValidationResult<StageCatalog> {
  const issues: ValidationIssue[] = [];
  const catalog = object(value, "$", issues);
  if (!catalog) return result(value, issues);
  exact(catalog, ["schemaVersion", "catalogVersion", "owner", "stages"], "$", issues);
  if (catalog.schemaVersion !== 2) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 2");
  version(catalog.catalogVersion, "$.catalogVersion", issues);
  string(catalog.owner, "$.owner", issues);
  if (!Array.isArray(catalog.stages) || catalog.stages.length === 0) issue(issues, "EXPECTED_STAGES", "$.stages", "Expected at least one canonical Stage");
  else {
    const ids: string[] = [];
    catalog.stages.forEach((entry, index) => {
      const path = `$.stages[${index}]`;
      const stage = object(entry, path, issues);
      if (!stage) return;
      exact(stage, ["id", "name", "description", "phase", "roleSlots", "requirements", "outputs", "inputArtifacts", "outputArtifacts"], path, issues);
      if (id(stage.id, `${path}.id`, issues)) ids.push(stage.id);
      string(stage.name, `${path}.name`, issues);
      string(stage.description, `${path}.description`, issues);
      if (!STAGE_PHASES.includes(stage.phase as never)) issue(issues, "INVALID_STAGE_PHASE", `${path}.phase`, "Unsupported Stage phase");
      if (stringArray(stage.roleSlots, `${path}.roleSlots`, issues, 1)) stage.roleSlots.forEach((role, roleIndex) => roleId(role, `${path}.roleSlots[${roleIndex}]`, issues));
      stringArray(stage.requirements, `${path}.requirements`, issues, 1);
      stringArray(stage.outputs, `${path}.outputs`, issues, 1);
      if (stage.inputArtifacts !== undefined) stringArray(stage.inputArtifacts, `${path}.inputArtifacts`, issues);
      if (stage.outputArtifacts !== undefined) stringArray(stage.outputArtifacts, `${path}.outputArtifacts`, issues);
    });
    if (new Set(ids).size !== ids.length) issue(issues, "DUPLICATE_STAGE", "$.stages", "Canonical Stage ids must be unique");
  }
  return result<StageCatalog>(value, issues);
}

export function validateDeliveryFlowCatalog(value: unknown): ValidationResult<DeliveryFlowCatalog> {
  const issues: ValidationIssue[] = [];
  const catalog = object(value, "$", issues);
  if (!catalog) return result(value, issues);
  exact(catalog, ["schemaVersion", "owner", "flows"], "$", issues);
  if (catalog.schemaVersion !== 1) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 1");
  string(catalog.owner, "$.owner", issues);
  if (!Array.isArray(catalog.flows) || catalog.flows.length === 0) issue(issues, "EXPECTED_DELIVERY_FLOWS", "$.flows", "Expected at least one registered Delivery Flow");
  else {
    const ids: string[] = [];
    const definitions: string[] = [];
    catalog.flows.forEach((entry, index) => {
      const path = `$.flows[${index}]`;
      const flow = object(entry, path, issues);
      if (!flow) return;
      exact(flow, ["id", "definition"], path, issues);
      if (id(flow.id, `${path}.id`, issues)) ids.push(flow.id);
      if (relativePath(flow.definition, `${path}.definition`, issues)) definitions.push(flow.definition);
    });
    if (new Set(ids).size !== ids.length) issue(issues, "DUPLICATE_DELIVERY_FLOW", "$.flows", "Delivery Flow ids must be unique");
    if (new Set(definitions).size !== definitions.length) issue(issues, "DUPLICATE_DELIVERY_FLOW_DEFINITION", "$.flows", "Delivery Flow definition paths must be unique");
  }
  return result<DeliveryFlowCatalog>(value, issues);
}

export function validateDeliveryFlowDefinition(value: unknown): ValidationResult<DeliveryFlowDefinition> {
  const issues: ValidationIssue[] = [];
  const flow = object(value, "$", issues);
  if (!flow) return result(value, issues);
  exact(flow, ["schemaVersion", "id", "name", "description", "status", "stageSequence", "controls", "runtime"], "$", issues);
  if (flow.schemaVersion !== 2) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 2");
  id(flow.id, "$.id", issues);
  string(flow.name, "$.name", issues);
  string(flow.description, "$.description", issues);
  if (!DELIVERY_FLOW_STATUSES.includes(flow.status as never)) issue(issues, "INVALID_DELIVERY_FLOW_STATUS", "$.status", "Expected active, planned, or deprecated");
  if (!Array.isArray(flow.stageSequence) || flow.stageSequence.length === 0) issue(issues, "EXPECTED_STAGE_SEQUENCE", "$.stageSequence", "Expected at least one Stage reference");
  else {
    const ids: string[] = [];
    flow.stageSequence.forEach((entry, index) => {
      const path = `$.stageSequence[${index}]`;
      const reference = object(entry, path, issues);
      if (!reference) return;
      exact(reference, ["stageId", "inclusion", "activationTags"], path, issues);
      if (id(reference.stageId, `${path}.stageId`, issues)) ids.push(reference.stageId);
      if (!DELIVERY_FLOW_STAGE_INCLUSIONS.includes(reference.inclusion as never)) issue(issues, "INVALID_STAGE_INCLUSION", `${path}.inclusion`, "Expected required or conditional");
      if (reference.inclusion === "conditional") stringArray(reference.activationTags, `${path}.activationTags`, issues, 1);
      else if (reference.activationTags !== undefined) issue(issues, "UNEXPECTED_ACTIVATION_TAGS", `${path}.activationTags`, "Required Stages must not define activation tags");
    });
    if (new Set(ids).size !== ids.length) issue(issues, "DUPLICATE_STAGE_REF", "$.stageSequence", "A Delivery Flow may reference each Stage once");
  }
  if (flow.status !== "active") {
    if (flow.controls !== undefined || flow.runtime !== undefined) issue(issues, "NON_ACTIVE_DELIVERY_FLOW_CONTROLS", "$", "Only active Delivery Flows may declare executable controls or runtime");
    return result<DeliveryFlowDefinition>(value, issues);
  }
  const controls = object(flow.controls, "$.controls", issues);
  if (controls) {
    exact(controls, ["initialStatus", "terminalStatuses", "checkpoints", "deliveryDefaults", "constraints"], "$.controls", issues);
    const initialStatusValid = string(controls.initialStatus, "$.controls.initialStatus", issues);
    const terminalStatusesValid = stringArray(controls.terminalStatuses, "$.controls.terminalStatuses", issues, 1);
    const checkpointIds: string[] = [];
    const transitions = new Map<string, Set<string>>();
    if (!Array.isArray(controls.checkpoints) || controls.checkpoints.length === 0) issue(issues, "EXPECTED_CHECKPOINTS", "$.controls.checkpoints", "Expected at least one checkpoint");
    else controls.checkpoints.forEach((entry, index) => {
      const path = `$.controls.checkpoints[${index}]`;
      const checkpoint = object(entry, path, issues);
      if (!checkpoint) return;
      exact(checkpoint, ["id", "from", "to", "toByOutcome", "ownerRole", "contextStages"], path, issues);
      if (id(checkpoint.id, `${path}.id`, issues)) checkpointIds.push(checkpoint.id);
      const fromValid = stringArray(checkpoint.from, `${path}.from`, issues, 1);
      if ((checkpoint.to === undefined) === (checkpoint.toByOutcome === undefined)) issue(issues, "INVALID_TRANSITION", path, "Define exactly one of to or toByOutcome");
      const targets: string[] = [];
      if (checkpoint.to !== undefined && string(checkpoint.to, `${path}.to`, issues)) targets.push(checkpoint.to);
      if (checkpoint.toByOutcome !== undefined) {
        const outcomes = object(checkpoint.toByOutcome, `${path}.toByOutcome`, issues);
        if (outcomes) Object.entries(outcomes).forEach(([key, status]) => {
          if (string(status, `${path}.toByOutcome.${key}`, issues)) targets.push(status);
        });
      }
      if (fromValid) for (const source of checkpoint.from as string[]) {
        let destinations = transitions.get(source);
        if (!destinations) transitions.set(source, destinations = new Set());
        targets.forEach((target) => destinations!.add(target));
      }
      roleId(checkpoint.ownerRole, `${path}.ownerRole`, issues);
      if (checkpoint.contextStages !== undefined) stringArray(checkpoint.contextStages, `${path}.contextStages`, issues, 1);
    });
    if (new Set(checkpointIds).size !== checkpointIds.length) issue(issues, "DUPLICATE_CHECKPOINT", "$.controls.checkpoints", "Checkpoint ids must be unique");
    if (initialStatusValid && terminalStatusesValid && Array.isArray(controls.checkpoints) && controls.checkpoints.length > 0) {
      const initialStatus = controls.initialStatus as string;
      const terminalStatuses = controls.terminalStatuses as string[];
      const terminalSet = new Set(terminalStatuses);
      if (terminalSet.has(initialStatus)) issue(issues, "INITIAL_STATUS_TERMINAL", "$.controls.initialStatus", "The initial status must not also be terminal");
      const reachable = new Set([initialStatus]);
      const pending = [initialStatus];
      while (pending.length > 0) {
        const source = pending.shift()!;
        for (const target of transitions.get(source) ?? []) if (!reachable.has(target)) {
          reachable.add(target);
          pending.push(target);
        }
      }
      terminalStatuses.forEach((status, index) => {
        if (!reachable.has(status)) issue(issues, "UNREACHABLE_TERMINAL_STATUS", `$.controls.terminalStatuses[${index}]`, `Terminal status is not reachable from ${initialStatus}: ${status}`);
      });
      for (const source of transitions.keys()) if (!reachable.has(source)) {
        issue(issues, "UNREACHABLE_CHECKPOINT_SOURCE", "$.controls.checkpoints", `Checkpoint source status is not reachable from ${initialStatus}: ${source}`);
      }
      for (const status of reachable) if (!terminalSet.has(status) && (transitions.get(status)?.size ?? 0) === 0) {
        issue(issues, "DEAD_END_STATUS", "$.controls.checkpoints", `Reachable non-terminal status has no outgoing checkpoint: ${status}`);
      }
    }
    const deliveryDefaults = object(controls.deliveryDefaults, "$.controls.deliveryDefaults", issues);
    if (deliveryDefaults) {
      exact(deliveryDefaults, ["roleAssignmentMode", "timebox", "collectDuringRequirements", "requirementsProfile"], "$.controls.deliveryDefaults", issues);
      roleId(deliveryDefaults.roleAssignmentMode, "$.controls.deliveryDefaults.roleAssignmentMode", issues);
      string(deliveryDefaults.timebox, "$.controls.deliveryDefaults.timebox", issues);
      if (typeof deliveryDefaults.collectDuringRequirements !== "boolean") issue(issues, "EXPECTED_BOOLEAN", "$.controls.deliveryDefaults.collectDuringRequirements", "Expected a boolean");
      if (deliveryDefaults.requirementsProfile !== undefined && !REQUIREMENTS_DEPTHS.includes(deliveryDefaults.requirementsProfile as never)) issue(issues, "INVALID_REQUIREMENTS_PROFILE", "$.controls.deliveryDefaults.requirementsProfile", "Unsupported requirements profile");
    }
    const constraints = object(controls.constraints, "$.controls.constraints", issues);
    if (constraints) {
      exact(constraints, ["productionUse", "externalIntegrations", "allowSinglePersonAllRoles"], "$.controls.constraints", issues);
      if (typeof constraints.productionUse !== "boolean") issue(issues, "EXPECTED_BOOLEAN", "$.controls.constraints.productionUse", "Expected a boolean");
      stringArray(constraints.externalIntegrations, "$.controls.constraints.externalIntegrations", issues);
      if (typeof constraints.allowSinglePersonAllRoles !== "boolean") issue(issues, "EXPECTED_BOOLEAN", "$.controls.constraints.allowSinglePersonAllRoles", "Expected a boolean");
    }
  }
  if (flow.runtime !== undefined) {
    const runtime = object(flow.runtime, "$.runtime", issues);
    if (runtime) {
      exact(runtime, ["executor", "recordSchema", "actions"], "$.runtime", issues);
      if (runtime.executor !== undefined) relativePath(runtime.executor, "$.runtime.executor", issues);
      if (runtime.recordSchema !== undefined) relativePath(runtime.recordSchema, "$.runtime.recordSchema", issues);
      const actionsValid = runtime.actions === undefined || stringArray(runtime.actions, "$.runtime.actions", issues);
      if (actionsValid && Array.isArray(runtime.actions) && runtime.actions.length > 0 && runtime.executor === undefined) issue(issues, "FLOW_ACTION_EXECUTOR_MISSING", "$.runtime.executor", "A Flow declaring actions must provide an executor");
    }
  }
  return result<DeliveryFlowDefinition>(value, issues);
}

export function validateRoleCatalog(value: unknown): ValidationResult<RoleCatalog> {
  const issues: ValidationIssue[] = [];
  const catalog = object(value, "$", issues);
  if (!catalog) return result(value, issues);
  exact(catalog, ["schemaVersion", "owner", "roles"], "$", issues);
  if (catalog.schemaVersion !== 1) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 1");
  string(catalog.owner, "$.owner", issues);
  if (!Array.isArray(catalog.roles) || catalog.roles.length === 0) issue(issues, "EXPECTED_ROLES", "$.roles", "Expected at least one registered Role");
  else {
    const ids: string[] = [];
    const definitions: string[] = [];
    catalog.roles.forEach((entry, index) => {
      const path = `$.roles[${index}]`;
      const role = object(entry, path, issues);
      if (!role) return;
      exact(role, ["id", "name", "definition"], path, issues);
      if (roleId(role.id, `${path}.id`, issues)) ids.push(role.id);
      string(role.name, `${path}.name`, issues);
      if (relativePath(role.definition, `${path}.definition`, issues)) {
        definitions.push(role.definition);
        if (!role.definition.endsWith(".md")) issue(issues, "INVALID_ROLE_DEFINITION", `${path}.definition`, "Role definition must be a Markdown file");
      }
    });
    if (new Set(ids).size !== ids.length) issue(issues, "DUPLICATE_ROLE", "$.roles", "Role ids must be unique");
    if (new Set(definitions).size !== definitions.length) issue(issues, "DUPLICATE_ROLE_DEFINITION", "$.roles", "Role definition paths must be unique");
  }
  return result<RoleCatalog>(value, issues);
}

export function validateDisciplineManifest(value: unknown): ValidationResult<DisciplineManifest> {
  const issues: ValidationIssue[] = [];
  const discipline = object(value, "$", issues);
  if (!discipline) return result(value, issues);
  exact(discipline, ["schemaVersion", "id", "name", "description", "owners", "policyApprovers", "maintainers", "contributionMode", "defaultApplicability"], "$", issues);
  if (discipline.schemaVersion !== 1) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 1");
  id(discipline.id, "$.id", issues);
  string(discipline.name, "$.name", issues);
  string(discipline.description, "$.description", issues);
  stringArray(discipline.owners, "$.owners", issues, 1);
  stringArray(discipline.policyApprovers, "$.policyApprovers", issues, 1);
  stringArray(discipline.maintainers, "$.maintainers", issues, 1);
  const contributionMode = object(discipline.contributionMode, "$.contributionMode", issues);
  if (contributionMode) {
    exact(contributionMode, ["artifacts", "policies", "knowledge", "skills", "agents", "hooks"], "$.contributionMode", issues);
    for (const key of ["artifacts", "policies", "knowledge", "skills", "agents", "hooks"] as const) {
      if (!CONTRIBUTION_MODES.includes(contributionMode[key] as never)) issue(issues, "INVALID_CONTRIBUTION_MODE", `$.contributionMode.${key}`, "Expected restricted, reviewed, or open");
    }
  }
  applicability(discipline.defaultApplicability, "$.defaultApplicability", issues, true);
  return result<DisciplineManifest>(value, issues);
}

export function validateArtifactDefinition(value: unknown): ValidationResult<ArtifactDefinition> {
  const issues: ValidationIssue[] = [];
  const artifact = object(value, "$", issues);
  if (!artifact) return result(value, issues);
  exact(artifact, ["schemaVersion", "id", "name", "description", "ownerDiscipline", "version", "format", "schemaRef", "profiles", "defaultTemplate", "examples"], "$", issues);
  if (artifact.schemaVersion !== 1) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 1");
  id(artifact.id, "$.id", issues);
  string(artifact.name, "$.name", issues);
  string(artifact.description, "$.description", issues);
  id(artifact.ownerDiscipline, "$.ownerDiscipline", issues);
  version(artifact.version, "$.version", issues);
  if (!["markdown", "json", "reference"].includes(String(artifact.format))) issue(issues, "INVALID_ARTIFACT_FORMAT", "$.format", "Unsupported Artifact format");
  if (artifact.schemaRef !== undefined) relativePath(artifact.schemaRef, "$.schemaRef", issues);
  stringArray(artifact.profiles, "$.profiles", issues, 1);
  if (artifact.defaultTemplate !== undefined) relativePath(artifact.defaultTemplate, "$.defaultTemplate", issues);
  if (artifact.examples !== undefined) stringArray(artifact.examples, "$.examples", issues);
  return result<ArtifactDefinition>(value, issues);
}

export function validateControlPolicy(value: unknown): ValidationResult<ControlPolicy> {
  const issues: ValidationIssue[] = [];
  const policy = object(value, "$", issues);
  if (!policy) return result(value, issues);
  exact(policy, ["schemaVersion", "id", "title", "description", "ownerDiscipline", "version", "appliesTo", "rules"], "$", issues);
  if (policy.schemaVersion !== 1) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 1");
  id(policy.id, "$.id", issues);
  string(policy.title, "$.title", issues);
  string(policy.description, "$.description", issues);
  id(policy.ownerDiscipline, "$.ownerDiscipline", issues);
  version(policy.version, "$.version", issues);
  applicability(policy.appliesTo, "$.appliesTo", issues);
  if (!Array.isArray(policy.rules) || policy.rules.length === 0) issue(issues, "EXPECTED_CONTROL_RULES", "$.rules", "Expected at least one Control rule");
  else {
    const ids: string[] = [];
    policy.rules.forEach((entry, index) => {
      const path = `$.rules[${index}]`;
      const rule = object(entry, path, issues);
      if (!rule) return;
      exact(rule, ["id", "statement", "enforcement", "enforceAt", "requiredEvidence", "exceptionApprovers", "standardDefault"], path, issues);
      if (id(rule.id, `${path}.id`, issues)) ids.push(rule.id);
      string(rule.statement, `${path}.statement`, issues);
      if (!CONTROL_ENFORCEMENT_TYPES.includes(rule.enforcement as never)) issue(issues, "INVALID_CONTROL_ENFORCEMENT", `${path}.enforcement`, "Expected automatic, evidence, or approval");
      stringArray(rule.enforceAt, `${path}.enforceAt`, issues, 1);
      if (rule.requiredEvidence !== undefined) stringArray(rule.requiredEvidence, `${path}.requiredEvidence`, issues, 1);
      if (rule.exceptionApprovers !== undefined) stringArray(rule.exceptionApprovers, `${path}.exceptionApprovers`, issues, 1);
      if (rule.standardDefault !== undefined) {
        const standard = object(rule.standardDefault, `${path}.standardDefault`, issues);
        if (standard) {
          exact(standard, ["key", "topic"], `${path}.standardDefault`, issues);
          id(standard.key, `${path}.standardDefault.key`, issues);
          if (!REQUIREMENTS_COVERAGE_TOPICS.includes(standard.topic as never)) issue(issues, "INVALID_COVERAGE_TOPIC", `${path}.standardDefault.topic`, "Unsupported coverage topic");
        }
      }
    });
    if (new Set(ids).size !== ids.length) issue(issues, "DUPLICATE_CONTROL_RULE", "$.rules", "Control rule ids must be unique");
  }
  return result<ControlPolicy>(value, issues);
}

function validateDefaultEntries(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issue(issues, "EXPECTED_DEFAULTS", path, "Expected at least one default");
    return;
  }
  const keys: string[] = [];
  value.forEach((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const item = object(entry, itemPath, issues);
    if (!item) return;
    exact(item, ["key", "title", "topic", "statement", "rationale", "controlRefs"], itemPath, issues);
    if (id(item.key, `${itemPath}.key`, issues)) keys.push(item.key);
    string(item.title, `${itemPath}.title`, issues);
    if (!REQUIREMENTS_COVERAGE_TOPICS.includes(item.topic as never)) issue(issues, "INVALID_COVERAGE_TOPIC", `${itemPath}.topic`, "Unsupported coverage topic");
    string(item.statement, `${itemPath}.statement`, issues);
    string(item.rationale, `${itemPath}.rationale`, issues);
    stringArray(item.controlRefs, `${itemPath}.controlRefs`, issues);
  });
  if (new Set(keys).size !== keys.length) issue(issues, "DUPLICATE_STANDARD_KEY", path, "Default keys must be unique");
}

export function validateKnowledgeAsset(value: unknown): ValidationResult<KnowledgeAsset> {
  const issues: ValidationIssue[] = [];
  const asset = object(value, "$", issues);
  if (!asset) return result(value, issues);
  exact(asset, ["schemaVersion", "id", "title", "description", "ownerDiscipline", "version", "kind", "appliesTo", "contentRef", "defaults"], "$", issues);
  if (asset.schemaVersion !== 1) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 1");
  id(asset.id, "$.id", issues);
  string(asset.title, "$.title", issues);
  string(asset.description, "$.description", issues);
  id(asset.ownerDiscipline, "$.ownerDiscipline", issues);
  version(asset.version, "$.version", issues);
  if (!KNOWLEDGE_KINDS.includes(asset.kind as never)) issue(issues, "INVALID_KNOWLEDGE_KIND", "$.kind", "Unsupported Knowledge kind");
  applicability(asset.appliesTo, "$.appliesTo", issues);
  if (asset.contentRef !== undefined) relativePath(asset.contentRef, "$.contentRef", issues);
  if (asset.kind === "default") validateDefaultEntries(asset.defaults, "$.defaults", issues);
  else if (asset.defaults !== undefined) issue(issues, "UNEXPECTED_DEFAULTS", "$.defaults", "Only default Knowledge may declare defaults");
  if (asset.kind !== "default" && asset.contentRef === undefined) issue(issues, "KNOWLEDGE_CONTENT_MISSING", "$.contentRef", "Non-default Knowledge requires contentRef");
  return result<KnowledgeAsset>(value, issues);
}

export function validateIntegrationCatalog(value: unknown): ValidationResult<IntegrationCatalog> {
  const issues: ValidationIssue[] = [];
  const catalog = object(value, "$", issues);
  if (!catalog) return result(value, issues);
  exact(catalog, ["schemaVersion", "owner", "integrations"], "$", issues);
  if (catalog.schemaVersion !== 1) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 1");
  string(catalog.owner, "$.owner", issues);
  if (!Array.isArray(catalog.integrations)) issue(issues, "EXPECTED_ARRAY", "$.integrations", "Expected integrations array");
  else {
    const ids: string[] = [];
    const definitions: string[] = [];
    catalog.integrations.forEach((entry, index) => {
      const path = `$.integrations[${index}]`;
      const integration = object(entry, path, issues);
      if (!integration) return;
      exact(integration, ["id", "definition"], path, issues);
      if (id(integration.id, `${path}.id`, issues)) ids.push(integration.id);
      if (relativePath(integration.definition, `${path}.definition`, issues)) definitions.push(integration.definition);
    });
    if (new Set(ids).size !== ids.length) issue(issues, "DUPLICATE_INTEGRATION", "$.integrations", "Integration ids must be unique");
    if (new Set(definitions).size !== definitions.length) issue(issues, "DUPLICATE_INTEGRATION_DEFINITION", "$.integrations", "Integration definition paths must be unique");
  }
  return result<IntegrationCatalog>(value, issues);
}

export function validateIntegrationManifest(value: unknown): ValidationResult<IntegrationManifest> {
  const issues: ValidationIssue[] = [];
  const manifest = object(value, "$", issues);
  if (!manifest) return result(value, issues);
  exact(manifest, ["schemaVersion", "kind", "id", "version", "description", "owners", "maintainers", "appliesTo", "skills", "permissions"], "$", issues);
  if (manifest.schemaVersion !== 1) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 1");
  if (manifest.kind !== "integration") issue(issues, "INVALID_INTEGRATION_KIND", "$.kind", "Expected integration");
  id(manifest.id, "$.id", issues);
  version(manifest.version, "$.version", issues);
  string(manifest.description, "$.description", issues);
  stringArray(manifest.owners, "$.owners", issues, 1);
  stringArray(manifest.maintainers, "$.maintainers", issues, 1);
  applicability(manifest.appliesTo, "$.appliesTo", issues);
  if (!Array.isArray(manifest.skills)) issue(issues, "EXPECTED_ARRAY", "$.skills", "Expected skills array");
  else {
    const skillIds: string[] = [];
    manifest.skills.forEach((entry, index) => {
      const path = `$.skills[${index}]`;
      const skill = object(entry, path, issues);
      if (!skill) return;
      exact(skill, ["id", "path"], path, issues);
      if (id(skill.id, `${path}.id`, issues)) skillIds.push(skill.id);
      relativePath(skill.path, `${path}.path`, issues);
    });
    if (new Set(skillIds).size !== skillIds.length) issue(issues, "DUPLICATE_INTEGRATION_SKILL", "$.skills", "Integration Skill ids must be unique");
  }
  const permissions = object(manifest.permissions, "$.permissions", issues);
  if (permissions) {
    exact(permissions, ["network", "credentialRefs", "externalWrites"], "$.permissions", issues);
    if (typeof permissions.network !== "boolean") issue(issues, "EXPECTED_BOOLEAN", "$.permissions.network", "Expected a boolean");
    stringArray(permissions.credentialRefs, "$.permissions.credentialRefs", issues);
    if (typeof permissions.externalWrites !== "boolean") issue(issues, "EXPECTED_BOOLEAN", "$.permissions.externalWrites", "Expected a boolean");
  }
  return result<IntegrationManifest>(value, issues);
}

export function validateProjectBaseline(value: unknown): ValidationResult<ProjectBaseline> {
  const issues: ValidationIssue[] = [];
  const baseline = object(value, "$", issues);
  if (!baseline) return result(value, issues);
  exact(baseline, ["schemaVersion", "discipline", "status", "approvedBy", "approvedAt", "decisions", "references"], "$", issues);
  if (baseline.schemaVersion !== 1) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 1");
  id(baseline.discipline, "$.discipline", issues);
  if (baseline.status !== "approved") issue(issues, "INVALID_BASELINE_STATUS", "$.status", "Expected approved");
  string(baseline.approvedBy, "$.approvedBy", issues);
  isoDate(baseline.approvedAt, "$.approvedAt", issues);
  const decisions = object(baseline.decisions, "$.decisions", issues);
  if (decisions && Object.keys(decisions).length === 0) issue(issues, "EMPTY_BASELINE", "$.decisions", "Expected at least one approved decision");
  if (decisions) Object.entries(decisions).forEach(([key, decision]) => {
    if (!["string", "number", "boolean"].includes(typeof decision)) issue(issues, "INVALID_BASELINE_VALUE", `$.decisions.${key}`, "Expected string, number, or boolean");
  });
  stringArray(baseline.references, "$.references", issues);
  return result<ProjectBaseline>(value, issues);
}

export function validateProjectDefaultProfile(value: unknown): ValidationResult<ProjectDefaultProfile> {
  const issues: ValidationIssue[] = [];
  const profile = object(value, "$", issues);
  if (!profile) return result(value, issues);
  exact(profile, ["schemaVersion", "id", "discipline", "version", "appliesTo", "defaults"], "$", issues);
  if (profile.schemaVersion !== 1) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 1");
  id(profile.id, "$.id", issues);
  id(profile.discipline, "$.discipline", issues);
  version(profile.version, "$.version", issues);
  applicability(profile.appliesTo, "$.appliesTo", issues);
  validateDefaultEntries(profile.defaults, "$.defaults", issues);
  return result<ProjectDefaultProfile>(value, issues);
}

export function validateDisciplineStageHooks(value: unknown): ValidationResult<DisciplineStageHooksDescriptor> {
  const issues: ValidationIssue[] = [];
  const descriptor = object(value, "$", issues);
  if (!descriptor) return result(value, issues);
  exact(descriptor, ["schemaVersion", "discipline", "version", "deliveryFlows", "enabled", "permissions", "bindings"], "$", issues);
  if (descriptor.schemaVersion !== 2) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 2");
  id(descriptor.discipline, "$.discipline", issues);
  version(descriptor.version, "$.version", issues);
  stringArray(descriptor.deliveryFlows, "$.deliveryFlows", issues, 1);
  if (typeof descriptor.enabled !== "boolean") issue(issues, "EXPECTED_BOOLEAN", "$.enabled", "Expected a boolean");
  const permissions = object(descriptor.permissions, "$.permissions", issues);
  if (permissions) {
    exact(permissions, ["filesystem", "network", "externalWrites"], "$.permissions", issues);
    if (!["read", "write"].includes(String(permissions.filesystem))) issue(issues, "INVALID_FILESYSTEM_PERMISSION", "$.permissions.filesystem", "Expected read or write");
    if (typeof permissions.network !== "boolean") issue(issues, "EXPECTED_BOOLEAN", "$.permissions.network", "Expected a boolean");
    if (typeof permissions.externalWrites !== "boolean") issue(issues, "EXPECTED_BOOLEAN", "$.permissions.externalWrites", "Expected a boolean");
  }
  if (!Array.isArray(descriptor.bindings)) issue(issues, "EXPECTED_ARRAY", "$.bindings", "Expected bindings array");
  else descriptor.bindings.forEach((entry, index) => {
    const path = `$.bindings[${index}]`;
    const binding = object(entry, path, issues);
    if (!binding) return;
    exact(binding, ["stage", "capability", "invocation", "agent", "candidateSkills", "mode", "handoff", "approvalBoundary"], path, issues);
    id(binding.stage, `${path}.stage`, issues);
    id(binding.capability, `${path}.capability`, issues);
    if (binding.invocation !== "required") issue(issues, "INVALID_AGENT_INVOCATION", `${path}.invocation`, "Expected required");
    id(binding.agent, `${path}.agent`, issues);
    stringArray(binding.candidateSkills, `${path}.candidateSkills`, issues, 1);
    if (!DISCIPLINE_GUIDANCE_MODES.includes(binding.mode as never)) issue(issues, "INVALID_DISCIPLINE_GUIDANCE_MODE", `${path}.mode`, "Unsupported Discipline guidance mode");
    string(binding.handoff, `${path}.handoff`, issues);
    string(binding.approvalBoundary, `${path}.approvalBoundary`, issues);
  });
  return result<DisciplineStageHooksDescriptor>(value, issues);
}

export function validateAuditEvent(value: unknown): ValidationResult<AuditEvent> {
  const issues: ValidationIssue[] = [];
  const event = object(value, "$", issues);
  if (!event) return result(value, issues);
  exact(event, ["schemaVersion", "eventId", "recordId", "eventType", "checkpoint", "stage", "contextHash", "fromStatus", "toStatus", "actor", "timestamp", "riskLevel", "evidenceRefs", "recordHash", "decision", "failureReason"], "$", issues);
  if (event.schemaVersion !== 1) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "Expected schemaVersion 1");
  for (const field of ["eventId", "recordId", "eventType", "actor", "recordHash"] as const) string(event[field], `$.${field}`, issues);
  for (const field of ["checkpoint", "stage", "fromStatus", "toStatus", "decision", "failureReason"] as const) {
    if (event[field] !== undefined) string(event[field], `$.${field}`, issues);
  }
  if (event.contextHash !== undefined && (typeof event.contextHash !== "string" || !/^[a-f0-9]{64}$/.test(event.contextHash))) issue(issues, "INVALID_CONTEXT_HASH", "$.contextHash", "Expected a SHA-256 digest");
  if (event.riskLevel !== undefined && !RISK_LEVELS.includes(event.riskLevel as never)) issue(issues, "INVALID_RISK_LEVEL", "$.riskLevel", "Unsupported risk level");
  if (event.evidenceRefs !== undefined) stringArray(event.evidenceRefs, "$.evidenceRefs", issues);
  isoDate(event.timestamp, "$.timestamp", issues);
  if (typeof event.recordHash === "string" && !/^[a-f0-9]{64}$/.test(event.recordHash)) issue(issues, "INVALID_HASH", "$.recordHash", "Expected a SHA-256 digest");
  return result<AuditEvent>(value, issues);
}
