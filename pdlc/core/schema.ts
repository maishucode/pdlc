import {
  ENFORCEMENT_LEVELS,
  COVERAGE_STATUSES,
  JOURNEY_STAGE_INCLUSIONS,
  JOURNEY_STATUSES,
  POC_STATUSES,
  PRINCIPLE_DISPOSITIONS,
  REQUIREMENTS_COVERAGE_TOPICS,
  REQUIREMENTS_DEPTHS,
  REQUIREMENTS_STATUSES,
  RISK_LEVELS,
  ROLE_SLOTS,
  STANDARD_DEFAULT_POLICIES,
  STANDARD_PROFILE_LAYERS,
  STAGE_PHASES,
  WORKFLOW_IDS,
  type AuditEvent,
  type EvidenceRef,
  type JourneyDefinition,
  type PocDeliveryRecord,
  type PrinciplePack,
  type RequirementsPolicy,
  type StandardProfile,
  type StageCatalog,
  type ValidationIssue,
  type ValidationResult,
  type WorkflowDefinition,
} from "./types.ts";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: JsonObject,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.push({ code: "UNKNOWN_FIELD", path: `${path}.${key}`, message: "Unknown field" });
    }
  }
}

function requireObject(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): JsonObject | undefined {
  if (!isObject(value)) {
    issues.push({ code: "EXPECTED_OBJECT", path, message: "Expected an object" });
    return undefined;
  }
  return value;
}

function requireString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  allowEmpty = false,
): value is string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    issues.push({ code: "EXPECTED_STRING", path, message: allowEmpty ? "Expected a string" : "Expected a non-empty string" });
    return false;
  }
  return true;
}

function requireStringArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  minItems = 0,
): value is string[] {
  if (!Array.isArray(value)) {
    issues.push({ code: "EXPECTED_ARRAY", path, message: "Expected an array" });
    return false;
  }
  if (value.length < minItems) {
    issues.push({ code: "TOO_FEW_ITEMS", path, message: `Expected at least ${minItems} item(s)` });
  }
  value.forEach((item, index) => requireString(item, `${path}[${index}]`, issues));
  if (new Set(value).size !== value.length) {
    issues.push({ code: "DUPLICATE_ITEM", path, message: "Array items must be unique" });
  }
  return true;
}

function requireIsoDate(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!requireString(value, path, issues)) return;
  if (Number.isNaN(Date.parse(value))) {
    issues.push({ code: "INVALID_DATE_TIME", path, message: "Expected an ISO 8601 date-time" });
  }
}

function result<T>(value: unknown, issues: ValidationIssue[]): ValidationResult<T> {
  return issues.length === 0
    ? { ok: true, value: value as T, issues: [] }
    : { ok: false, issues };
}

function validateEvidenceList(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ code: "EXPECTED_ARRAY", path, message: "Expected an evidence array" });
    return;
  }
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    const evidence = requireObject(item, itemPath, issues);
    if (!evidence) return;
    hasExactKeys(evidence, ["kind", "ref", "description", "capturedAt"], itemPath, issues);
    if (!["file", "url", "ci", "demo"].includes(String(evidence.kind))) {
      issues.push({ code: "INVALID_ENUM", path: `${itemPath}.kind`, message: "Unsupported evidence kind" });
    }
    requireString(evidence.ref, `${itemPath}.ref`, issues);
    requireString(evidence.description, `${itemPath}.description`, issues);
    if (evidence.capturedAt !== undefined) requireIsoDate(evidence.capturedAt, `${itemPath}.capturedAt`, issues);
  });
}

export function validatePocDeliveryRecord(value: unknown): ValidationResult<PocDeliveryRecord> {
  const issues: ValidationIssue[] = [];
  const record = requireObject(value, "$", issues);
  if (!record) return result(value, issues);

  hasExactKeys(record, ["schemaVersion", "id", "workflow", "status", "title", "revision", "createdAt", "updatedAt", "assignments", "idea", "requirements", "scope", "risk", "principles", "design", "evidence", "decision"], "$", issues);
  if (record.schemaVersion !== 1) issues.push({ code: "UNSUPPORTED_SCHEMA", path: "$.schemaVersion", message: "Expected schemaVersion 1" });
  if (!requireString(record.id, "$.id", issues) || !/^POC-[A-Z0-9][A-Z0-9-]*$/.test(record.id)) {
    issues.push({ code: "INVALID_RECORD_ID", path: "$.id", message: "Expected POC- followed by uppercase letters, digits, or hyphens" });
  }
  if (record.workflow !== "poc") issues.push({ code: "INVALID_WORKFLOW", path: "$.workflow", message: "Expected poc" });
  if (!POC_STATUSES.includes(record.status as never)) issues.push({ code: "INVALID_STATUS", path: "$.status", message: "Unsupported POC status" });
  const requirementsApproved = isObject(record.requirements) && record.requirements.status === "approved";
  requireString(record.title, "$.title", issues);
  if (!Number.isInteger(record.revision) || Number(record.revision) < 0) issues.push({ code: "INVALID_REVISION", path: "$.revision", message: "Expected a non-negative integer" });
  requireIsoDate(record.createdAt, "$.createdAt", issues);
  requireIsoDate(record.updatedAt, "$.updatedAt", issues);

  const assignments = requireObject(record.assignments, "$.assignments", issues);
  if (assignments) {
    hasExactKeys(assignments, ROLE_SLOTS, "$.assignments", issues);
    ROLE_SLOTS.forEach((role) => requireString(assignments[role], `$.assignments.${role}`, issues, !requirementsApproved));
  }

  const idea = requireObject(record.idea, "$.idea", issues);
  if (idea) {
    hasExactKeys(idea, ["problem", "hypothesis", "expectedOutcome", "successCriteria", "timebox"], "$.idea", issues);
    requireString(idea.problem, "$.idea.problem", issues, !requirementsApproved);
    requireString(idea.hypothesis, "$.idea.hypothesis", issues, !requirementsApproved);
    requireString(idea.expectedOutcome, "$.idea.expectedOutcome", issues, !requirementsApproved);
    requireStringArray(idea.successCriteria, "$.idea.successCriteria", issues, requirementsApproved ? 1 : 0);
    requireString(idea.timebox, "$.idea.timebox", issues, !requirementsApproved);
  }

  const requirements = requireObject(record.requirements, "$.requirements", issues);
  if (requirements) {
    hasExactKeys(requirements, ["documentRef", "depth", "status", "clarification", "approvedBy", "approvedAt", "approvedContentHash"], "$.requirements", issues);
    if (requireString(requirements.documentRef, "$.requirements.documentRef", issues) && !requirements.documentRef.endsWith(".md")) {
      issues.push({ code: "INVALID_REQUIREMENTS_REF", path: "$.requirements.documentRef", message: "Requirements document must be a Markdown file" });
    }
    if (!REQUIREMENTS_DEPTHS.includes(requirements.depth as never)) issues.push({ code: "INVALID_REQUIREMENTS_DEPTH", path: "$.requirements.depth", message: "Unsupported requirements depth" });
    if (!REQUIREMENTS_STATUSES.includes(requirements.status as never)) issues.push({ code: "INVALID_REQUIREMENTS_STATUS", path: "$.requirements.status", message: "Unsupported requirements status" });
    const clarification = requireObject(requirements.clarification, "$.requirements.clarification", issues);
    if (clarification) {
      hasExactKeys(clarification, ["questionsAnswered", "coverage", "openQuestions", "contradictions"], "$.requirements.clarification", issues);
      if (!Number.isInteger(clarification.questionsAnswered) || Number(clarification.questionsAnswered) < 0) {
        issues.push({ code: "INVALID_QUESTION_COUNT", path: "$.requirements.clarification.questionsAnswered", message: "Expected a non-negative integer" });
      }
      const coverage = requireObject(clarification.coverage, "$.requirements.clarification.coverage", issues);
      if (coverage) {
        hasExactKeys(coverage, REQUIREMENTS_COVERAGE_TOPICS, "$.requirements.clarification.coverage", issues);
        REQUIREMENTS_COVERAGE_TOPICS.forEach((topic) => {
          if (!COVERAGE_STATUSES.includes(coverage[topic] as never)) {
            issues.push({ code: "INVALID_COVERAGE_STATUS", path: `$.requirements.clarification.coverage.${topic}`, message: "Expected pending or complete" });
          }
        });
      }
      requireStringArray(clarification.openQuestions, "$.requirements.clarification.openQuestions", issues);
      requireStringArray(clarification.contradictions, "$.requirements.clarification.contradictions", issues);
    }
    requireString(requirements.approvedBy, "$.requirements.approvedBy", issues, true);
    requireString(requirements.approvedAt, "$.requirements.approvedAt", issues, true);
    requireString(requirements.approvedContentHash, "$.requirements.approvedContentHash", issues, true);
    if (requirements.status === "approved") {
      requireString(requirements.approvedBy, "$.requirements.approvedBy", issues);
      requireIsoDate(requirements.approvedAt, "$.requirements.approvedAt", issues);
      if (typeof requirements.approvedContentHash !== "string" || !/^[a-f0-9]{64}$/.test(requirements.approvedContentHash)) {
        issues.push({ code: "INVALID_REQUIREMENTS_HASH", path: "$.requirements.approvedContentHash", message: "Expected a SHA-256 hex digest" });
      }
    } else if (requirements.approvedBy !== "" || requirements.approvedAt !== "" || requirements.approvedContentHash !== "") {
      issues.push({ code: "DRAFT_REQUIREMENTS_HAVE_APPROVAL", path: "$.requirements", message: "Draft requirements cannot contain approval metadata" });
    }
  }

  const scope = requireObject(record.scope, "$.scope", issues);
  if (scope) {
    hasExactKeys(scope, ["inScope", "outOfScope", "productionUse"], "$.scope", issues);
    requireStringArray(scope.inScope, "$.scope.inScope", issues, requirementsApproved ? 1 : 0);
    requireStringArray(scope.outOfScope, "$.scope.outOfScope", issues, requirementsApproved ? 1 : 0);
    if (scope.productionUse !== false) issues.push({ code: "POC_PRODUCTION_FORBIDDEN", path: "$.scope.productionUse", message: "POC productionUse must be false" });
  }

  const risk = requireObject(record.risk, "$.risk", issues);
  if (risk) {
    hasExactKeys(risk, ["level", "triggers"], "$.risk", issues);
    if (!RISK_LEVELS.includes(risk.level as never)) issues.push({ code: "INVALID_RISK", path: "$.risk.level", message: "Unsupported risk level" });
    requireStringArray(risk.triggers, "$.risk.triggers", issues);
  }

  const principles = requireObject(record.principles, "$.principles", issues);
  if (principles) {
    hasExactKeys(principles, ["applicable", "exceptions", "applications"], "$.principles", issues);
    requireStringArray(principles.applicable, "$.principles.applicable", issues);
    requireStringArray(principles.exceptions, "$.principles.exceptions", issues);
    if (!Array.isArray(principles.applications)) {
      issues.push({ code: "EXPECTED_ARRAY", path: "$.principles.applications", message: "Expected an applications array" });
    } else {
      principles.applications.forEach((entry, index) => {
        const path = `$.principles.applications[${index}]`;
        const application = requireObject(entry, path, issues);
        if (!application) return;
        hasExactKeys(application, ["pack", "disposition", "notes"], path, issues);
        requireString(application.pack, `${path}.pack`, issues);
        if (!PRINCIPLE_DISPOSITIONS.includes(application.disposition as never)) issues.push({ code: "INVALID_PRINCIPLE_DISPOSITION", path: `${path}.disposition`, message: "Unsupported principle disposition" });
        requireString(application.notes, `${path}.notes`, issues);
      });
    }
  }

  const design = requireObject(record.design, "$.design", issues);
  if (design) {
    hasExactKeys(design, ["summary", "decisions", "technologies", "domains"], "$.design", issues);
    requireString(design.summary, "$.design.summary", issues, true);
    requireStringArray(design.decisions, "$.design.decisions", issues);
    requireStringArray(design.technologies, "$.design.technologies", issues);
    requireStringArray(design.domains, "$.design.domains", issues);
  }

  const evidence = requireObject(record.evidence, "$.evidence", issues);
  if (evidence) {
    hasExactKeys(evidence, ["tests", "build", "security", "demo"], "$.evidence", issues);
    (["tests", "build", "security", "demo"] as const).forEach((key) => validateEvidenceList(evidence[key], `$.evidence.${key}`, issues));
  }

  const decision = requireObject(record.decision, "$.decision", issues);
  if (decision) {
    hasExactKeys(decision, ["outcome", "rationale", "followUp"], "$.decision", issues);
    if (!["", "kill", "pivot", "productize"].includes(String(decision.outcome))) issues.push({ code: "INVALID_OUTCOME", path: "$.decision.outcome", message: "Unsupported POC outcome" });
    requireString(decision.rationale, "$.decision.rationale", issues, true);
    requireString(decision.followUp, "$.decision.followUp", issues, true);
  }

  return result<PocDeliveryRecord>(value, issues);
}

export function validatePrinciplePack(value: unknown): ValidationResult<PrinciplePack> {
  const issues: ValidationIssue[] = [];
  const pack = requireObject(value, "$", issues);
  if (!pack) return result(value, issues);
  hasExactKeys(pack, ["schemaVersion", "id", "name", "owner", "version", "appliesTo", "enforcement", "principles"], "$", issues);
  if (pack.schemaVersion !== 1) issues.push({ code: "UNSUPPORTED_SCHEMA", path: "$.schemaVersion", message: "Expected schemaVersion 1" });
  requireString(pack.id, "$.id", issues);
  requireString(pack.name, "$.name", issues);
  requireString(pack.owner, "$.owner", issues);
  if (!requireString(pack.version, "$.version", issues) || !/^\d+\.\d+\.\d+$/.test(pack.version)) issues.push({ code: "INVALID_VERSION", path: "$.version", message: "Expected semantic version x.y.z" });
  const appliesTo = requireObject(pack.appliesTo, "$.appliesTo", issues);
  if (appliesTo) {
    hasExactKeys(appliesTo, ["workflows", "stages", "riskTriggers", "technologies", "domains"], "$.appliesTo", issues);
    requireStringArray(appliesTo.workflows, "$.appliesTo.workflows", issues, 1);
    if (Array.isArray(appliesTo.workflows)) appliesTo.workflows.forEach((id, index) => { if (!WORKFLOW_IDS.includes(id as never)) issues.push({ code: "INVALID_WORKFLOW", path: `$.appliesTo.workflows[${index}]`, message: "Unsupported workflow" }); });
    requireStringArray(appliesTo.stages, "$.appliesTo.stages", issues, 1);
    for (const key of ["riskTriggers", "technologies", "domains"] as const) if (appliesTo[key] !== undefined) requireStringArray(appliesTo[key], `$.appliesTo.${key}`, issues);
  }
  const enforcement = requireObject(pack.enforcement, "$.enforcement", issues);
  if (enforcement) {
    hasExactKeys(enforcement, WORKFLOW_IDS, "$.enforcement", issues);
    WORKFLOW_IDS.forEach((id) => { if (!ENFORCEMENT_LEVELS.includes(enforcement[id] as never)) issues.push({ code: "INVALID_ENFORCEMENT", path: `$.enforcement.${id}`, message: "Unsupported enforcement level" }); });
  }
  if (!Array.isArray(pack.principles) || pack.principles.length === 0) {
    issues.push({ code: "EXPECTED_PRINCIPLES", path: "$.principles", message: "Expected at least one principle" });
  } else {
    pack.principles.forEach((entry, index) => {
      const principle = requireObject(entry, `$.principles[${index}]`, issues);
      if (!principle) return;
      hasExactKeys(principle, ["id", "title", "requirement", "standardDefault"], `$.principles[${index}]`, issues);
      requireString(principle.id, `$.principles[${index}].id`, issues);
      requireString(principle.title, `$.principles[${index}].title`, issues);
      requireString(principle.requirement, `$.principles[${index}].requirement`, issues);
      if (principle.standardDefault !== undefined) {
        const defaultPath = `$.principles[${index}].standardDefault`;
        const standardDefault = requireObject(principle.standardDefault, defaultPath, issues);
        if (standardDefault) {
          hasExactKeys(standardDefault, ["key", "topic", "policy"], defaultPath, issues);
          if (requireString(standardDefault.key, `${defaultPath}.key`, issues)
            && !/^[a-z][a-z0-9.-]*$/.test(standardDefault.key)) {
            issues.push({ code: "INVALID_STANDARD_KEY", path: `${defaultPath}.key`, message: "Expected a lowercase dotted standard key" });
          }
          if (!REQUIREMENTS_COVERAGE_TOPICS.includes(standardDefault.topic as never)) {
            issues.push({ code: "INVALID_COVERAGE_TOPIC", path: `${defaultPath}.topic`, message: "Unsupported requirements coverage topic" });
          }
          if (!STANDARD_DEFAULT_POLICIES.includes(standardDefault.policy as never)) {
            issues.push({ code: "INVALID_STANDARD_POLICY", path: `${defaultPath}.policy`, message: "Expected constraint or default" });
          }
        }
      }
    });
  }
  return result<PrinciplePack>(value, issues);
}

export function validateStandardProfile(value: unknown): ValidationResult<StandardProfile> {
  const issues: ValidationIssue[] = [];
  const profile = requireObject(value, "$", issues);
  if (!profile) return result(value, issues);

  hasExactKeys(profile, ["schemaVersion", "id", "name", "owner", "version", "layer", "appliesTo", "defaults"], "$", issues);
  if (profile.schemaVersion !== 1) issues.push({ code: "UNSUPPORTED_SCHEMA", path: "$.schemaVersion", message: "Expected schemaVersion 1" });
  requireString(profile.id, "$.id", issues);
  requireString(profile.name, "$.name", issues);
  requireString(profile.owner, "$.owner", issues);
  if (!requireString(profile.version, "$.version", issues) || !/^\d+\.\d+\.\d+$/.test(profile.version)) {
    issues.push({ code: "INVALID_VERSION", path: "$.version", message: "Expected semantic version x.y.z" });
  }
  if (!STANDARD_PROFILE_LAYERS.includes(profile.layer as never)) {
    issues.push({ code: "INVALID_STANDARD_LAYER", path: "$.layer", message: "Expected harness or project" });
  }

  const appliesTo = requireObject(profile.appliesTo, "$.appliesTo", issues);
  if (appliesTo) {
    hasExactKeys(appliesTo, ["workflows", "stages", "technologies", "domains"], "$.appliesTo", issues);
    requireStringArray(appliesTo.workflows, "$.appliesTo.workflows", issues, 1);
    if (Array.isArray(appliesTo.workflows)) appliesTo.workflows.forEach((id, index) => {
      if (!WORKFLOW_IDS.includes(id as never)) issues.push({ code: "INVALID_WORKFLOW", path: `$.appliesTo.workflows[${index}]`, message: "Unsupported workflow" });
    });
    requireStringArray(appliesTo.stages, "$.appliesTo.stages", issues, 1);
    for (const key of ["technologies", "domains"] as const) {
      if (appliesTo[key] !== undefined) requireStringArray(appliesTo[key], `$.appliesTo.${key}`, issues);
    }
  }

  if (!Array.isArray(profile.defaults)) {
    issues.push({ code: "EXPECTED_ARRAY", path: "$.defaults", message: "Expected a defaults array" });
  } else {
    const keys = new Set<string>();
    profile.defaults.forEach((entry, index) => {
      const entryPath = `$.defaults[${index}]`;
      const standard = requireObject(entry, entryPath, issues);
      if (!standard) return;
      hasExactKeys(standard, ["key", "title", "topic", "statement", "rationale", "principleRefs"], entryPath, issues);
      if (requireString(standard.key, `${entryPath}.key`, issues)) {
        if (!/^[a-z][a-z0-9.-]*$/.test(String(standard.key))) {
          issues.push({ code: "INVALID_STANDARD_KEY", path: `${entryPath}.key`, message: "Expected a lowercase dotted standard key" });
        }
        if (keys.has(String(standard.key))) {
          issues.push({ code: "DUPLICATE_STANDARD_KEY", path: `${entryPath}.key`, message: "A profile may define each standard key once" });
        }
        keys.add(String(standard.key));
      }
      requireString(standard.title, `${entryPath}.title`, issues);
      if (!REQUIREMENTS_COVERAGE_TOPICS.includes(standard.topic as never)) {
        issues.push({ code: "INVALID_COVERAGE_TOPIC", path: `${entryPath}.topic`, message: "Unsupported requirements coverage topic" });
      }
      requireString(standard.statement, `${entryPath}.statement`, issues);
      requireString(standard.rationale, `${entryPath}.rationale`, issues);
      requireStringArray(standard.principleRefs, `${entryPath}.principleRefs`, issues);
    });
  }

  return result<StandardProfile>(value, issues);
}

export function validateRequirementsPolicy(value: unknown): ValidationResult<RequirementsPolicy> {
  const issues: ValidationIssue[] = [];
  const policy = requireObject(value, "$", issues);
  if (!policy) return result(value, issues);
  hasExactKeys(policy, ["schemaVersion", "id", "owner", "version", "depths", "questionRules"], "$", issues);
  if (policy.schemaVersion !== 1) issues.push({ code: "UNSUPPORTED_SCHEMA", path: "$.schemaVersion", message: "Expected schemaVersion 1" });
  requireString(policy.id, "$.id", issues);
  requireString(policy.owner, "$.owner", issues);
  if (!requireString(policy.version, "$.version", issues) || !/^\d+\.\d+\.\d+$/.test(policy.version)) {
    issues.push({ code: "INVALID_VERSION", path: "$.version", message: "Expected semantic version x.y.z" });
  }
  const depths = requireObject(policy.depths, "$.depths", issues);
  if (depths) {
    hasExactKeys(depths, REQUIREMENTS_DEPTHS, "$.depths", issues);
    REQUIREMENTS_DEPTHS.forEach((depth) => {
      const depthPolicy = requireObject(depths[depth], `$.depths.${depth}`, issues);
      if (!depthPolicy) return;
      hasExactKeys(depthPolicy, ["minimumAnsweredQuestions", "requiredTopics"], `$.depths.${depth}`, issues);
      if (!Number.isInteger(depthPolicy.minimumAnsweredQuestions) || Number(depthPolicy.minimumAnsweredQuestions) < 1) {
        issues.push({ code: "INVALID_QUESTION_COUNT", path: `$.depths.${depth}.minimumAnsweredQuestions`, message: "Expected a positive integer" });
      }
      if (requireStringArray(depthPolicy.requiredTopics, `$.depths.${depth}.requiredTopics`, issues, 1)) {
        depthPolicy.requiredTopics.forEach((topic, index) => {
          if (!REQUIREMENTS_COVERAGE_TOPICS.includes(topic as never)) {
            issues.push({ code: "INVALID_COVERAGE_TOPIC", path: `$.depths.${depth}.requiredTopics[${index}]`, message: "Unsupported requirements coverage topic" });
          }
        });
      }
    });
  }
  const questionRules = requireObject(policy.questionRules, "$.questionRules", issues);
  if (questionRules) {
    hasExactKeys(questionRules, ["maxQuestionsPerRound", "requireOtherOption", "analyzeContradictions", "requireFinalDocumentReview", "allowDocumentAnswers", "questionDocumentPattern", "answerTag"], "$.questionRules", issues);
    if (!Number.isInteger(questionRules.maxQuestionsPerRound) || Number(questionRules.maxQuestionsPerRound) < 1 || Number(questionRules.maxQuestionsPerRound) > 3) {
      issues.push({ code: "INVALID_QUESTION_LIMIT", path: "$.questionRules.maxQuestionsPerRound", message: "Expected an integer from 1 to 3" });
    }
    for (const key of ["requireOtherOption", "analyzeContradictions", "requireFinalDocumentReview", "allowDocumentAnswers"] as const) {
      if (typeof questionRules[key] !== "boolean") issues.push({ code: "EXPECTED_BOOLEAN", path: `$.questionRules.${key}`, message: "Expected a boolean" });
    }
    if (questionRules.allowDocumentAnswers !== true) {
      issues.push({ code: "DOCUMENT_ANSWERS_DISABLED", path: "$.questionRules.allowDocumentAnswers", message: "POC requirements must support document answer mode" });
    }
    if (requireString(questionRules.questionDocumentPattern, "$.questionRules.questionDocumentPattern", issues)
      && (!questionRules.questionDocumentPattern.startsWith(".pdlc/questions/") || !questionRules.questionDocumentPattern.includes("{recordId}") || !questionRules.questionDocumentPattern.endsWith(".md"))) {
      issues.push({ code: "INVALID_QUESTION_DOCUMENT_PATTERN", path: "$.questionRules.questionDocumentPattern", message: "Expected a .pdlc/questions Markdown pattern containing {recordId}" });
    }
    if (questionRules.answerTag !== "[Answer]:") {
      issues.push({ code: "INVALID_ANSWER_TAG", path: "$.questionRules.answerTag", message: "Expected [Answer]:" });
    }
  }
  return result<RequirementsPolicy>(value, issues);
}

export function validateStageCatalog(value: unknown): ValidationResult<StageCatalog> {
  const issues: ValidationIssue[] = [];
  const catalog = requireObject(value, "$", issues);
  if (!catalog) return result(value, issues);
  hasExactKeys(catalog, ["schemaVersion", "catalogVersion", "owner", "stages"], "$", issues);
  if (catalog.schemaVersion !== 1) issues.push({ code: "UNSUPPORTED_SCHEMA", path: "$.schemaVersion", message: "Expected schemaVersion 1" });
  if (!requireString(catalog.catalogVersion, "$.catalogVersion", issues) || !/^\d+\.\d+\.\d+$/.test(String(catalog.catalogVersion))) {
    issues.push({ code: "INVALID_VERSION", path: "$.catalogVersion", message: "Expected semantic version x.y.z" });
  }
  requireString(catalog.owner, "$.owner", issues);
  if (!Array.isArray(catalog.stages) || catalog.stages.length === 0) {
    issues.push({ code: "EXPECTED_STAGES", path: "$.stages", message: "Expected at least one canonical Stage" });
  } else {
    const stageIds: string[] = [];
    catalog.stages.forEach((entry, index) => {
      const path = `$.stages[${index}]`;
      const stage = requireObject(entry, path, issues);
      if (!stage) return;
      hasExactKeys(stage, ["id", "name", "description", "phase", "roleSlots", "requirements", "outputs"], path, issues);
      if (requireString(stage.id, `${path}.id`, issues)) {
        stageIds.push(String(stage.id));
        if (!/^[a-z][a-z0-9-]*$/.test(String(stage.id))) {
          issues.push({ code: "INVALID_STAGE_ID", path: `${path}.id`, message: "Expected a lowercase kebab-case Stage id" });
        }
      }
      requireString(stage.name, `${path}.name`, issues);
      requireString(stage.description, `${path}.description`, issues);
      if (!STAGE_PHASES.includes(stage.phase as never)) issues.push({ code: "INVALID_STAGE_PHASE", path: `${path}.phase`, message: "Unsupported Stage phase" });
      requireStringArray(stage.roleSlots, `${path}.roleSlots`, issues, 1);
      if (Array.isArray(stage.roleSlots)) stage.roleSlots.forEach((role, roleIndex) => {
        if (!ROLE_SLOTS.includes(role as never)) issues.push({ code: "INVALID_ROLE", path: `${path}.roleSlots[${roleIndex}]`, message: "Unsupported role slot" });
      });
      requireStringArray(stage.requirements, `${path}.requirements`, issues, 1);
      requireStringArray(stage.outputs, `${path}.outputs`, issues, 1);
    });
    if (new Set(stageIds).size !== stageIds.length) issues.push({ code: "DUPLICATE_STAGE", path: "$.stages", message: "Canonical Stage ids must be unique" });
  }
  return result<StageCatalog>(value, issues);
}

export function validateJourneyDefinition(value: unknown): ValidationResult<JourneyDefinition> {
  const issues: ValidationIssue[] = [];
  const journey = requireObject(value, "$", issues);
  if (!journey) return result(value, issues);
  hasExactKeys(journey, ["schemaVersion", "id", "name", "description", "status", "stageSequence"], "$", issues);
  if (journey.schemaVersion !== 1) issues.push({ code: "UNSUPPORTED_SCHEMA", path: "$.schemaVersion", message: "Expected schemaVersion 1" });
  for (const field of ["id", "name", "description"] as const) requireString(journey[field], `$.${field}`, issues);
  if (!WORKFLOW_IDS.includes(journey.id as never)) issues.push({ code: "INVALID_JOURNEY", path: "$.id", message: "Unsupported User Journey" });
  if (!JOURNEY_STATUSES.includes(journey.status as never)) issues.push({ code: "INVALID_JOURNEY_STATUS", path: "$.status", message: "Expected active or planned" });
  if (!Array.isArray(journey.stageSequence) || journey.stageSequence.length === 0) {
    issues.push({ code: "EXPECTED_STAGE_SEQUENCE", path: "$.stageSequence", message: "Expected at least one Stage reference" });
  } else {
    const stageIds: string[] = [];
    journey.stageSequence.forEach((entry, index) => {
      const path = `$.stageSequence[${index}]`;
      const reference = requireObject(entry, path, issues);
      if (!reference) return;
      hasExactKeys(reference, ["stageId", "inclusion", "activationTags"], path, issues);
      if (requireString(reference.stageId, `${path}.stageId`, issues)) stageIds.push(String(reference.stageId));
      if (!JOURNEY_STAGE_INCLUSIONS.includes(reference.inclusion as never)) {
        issues.push({ code: "INVALID_STAGE_INCLUSION", path: `${path}.inclusion`, message: "Expected required or conditional" });
      }
      if (reference.inclusion === "conditional") {
        requireStringArray(reference.activationTags, `${path}.activationTags`, issues, 1);
      } else if (reference.activationTags !== undefined) {
        issues.push({ code: "UNEXPECTED_ACTIVATION_TAGS", path: `${path}.activationTags`, message: "Required Stages must not define activation tags" });
      }
    });
    if (new Set(stageIds).size !== stageIds.length) issues.push({ code: "DUPLICATE_STAGE_REF", path: "$.stageSequence", message: "A User Journey may reference each Stage once" });
  }
  return result<JourneyDefinition>(value, issues);
}

export function validateWorkflowDefinition(value: unknown): ValidationResult<WorkflowDefinition> {
  const issues: ValidationIssue[] = [];
  const workflow = requireObject(value, "$", issues);
  if (!workflow) return result(value, issues);
  hasExactKeys(workflow, ["schemaVersion", "id", "name", "description", "journeyId", "initialStatus", "terminalStatuses", "checkpoints", "deliveryDefaults", "constraints"], "$", issues);
  if (workflow.schemaVersion !== 1) issues.push({ code: "UNSUPPORTED_SCHEMA", path: "$.schemaVersion", message: "Expected schemaVersion 1" });
  for (const field of ["id", "name", "description", "initialStatus"] as const) requireString(workflow[field], `$.${field}`, issues);
  if (!WORKFLOW_IDS.includes(workflow.id as never)) issues.push({ code: "INVALID_WORKFLOW", path: "$.id", message: "Unsupported workflow" });
  if (!WORKFLOW_IDS.includes(workflow.journeyId as never)) issues.push({ code: "INVALID_JOURNEY", path: "$.journeyId", message: "Unsupported User Journey" });
  requireStringArray(workflow.terminalStatuses, "$.terminalStatuses", issues, 1);

  if (!Array.isArray(workflow.checkpoints) || workflow.checkpoints.length === 0) {
    issues.push({ code: "EXPECTED_CHECKPOINTS", path: "$.checkpoints", message: "Expected at least one checkpoint" });
  } else {
    const checkpointIds: string[] = [];
    workflow.checkpoints.forEach((entry, index) => {
      const path = `$.checkpoints[${index}]`;
      const checkpoint = requireObject(entry, path, issues);
      if (!checkpoint) return;
      hasExactKeys(checkpoint, ["id", "from", "to", "toByOutcome", "ownerRole"], path, issues);
      if (requireString(checkpoint.id, `${path}.id`, issues)) checkpointIds.push(checkpoint.id);
      requireStringArray(checkpoint.from, `${path}.from`, issues, 1);
      if ((checkpoint.to === undefined) === (checkpoint.toByOutcome === undefined)) issues.push({ code: "INVALID_TRANSITION", path, message: "Define exactly one of to or toByOutcome" });
      if (checkpoint.to !== undefined) requireString(checkpoint.to, `${path}.to`, issues);
      if (checkpoint.toByOutcome !== undefined) {
        const outcomes = requireObject(checkpoint.toByOutcome, `${path}.toByOutcome`, issues);
        if (outcomes) {
          if (Object.keys(outcomes).length === 0) issues.push({ code: "EMPTY_OUTCOMES", path: `${path}.toByOutcome`, message: "Expected at least one outcome" });
          Object.entries(outcomes).forEach(([outcome, status]) => requireString(status, `${path}.toByOutcome.${outcome}`, issues));
        }
      }
      if (!ROLE_SLOTS.includes(checkpoint.ownerRole as never)) issues.push({ code: "INVALID_ROLE", path: `${path}.ownerRole`, message: "Unsupported role slot" });
    });
    if (new Set(checkpointIds).size !== checkpointIds.length) issues.push({ code: "DUPLICATE_CHECKPOINT", path: "$.checkpoints", message: "Checkpoint ids must be unique" });
  }

  const deliveryDefaults = requireObject(workflow.deliveryDefaults, "$.deliveryDefaults", issues);
  if (deliveryDefaults) {
    hasExactKeys(deliveryDefaults, ["roleAssignmentMode", "timebox", "collectDuringRequirements"], "$.deliveryDefaults", issues);
    if (deliveryDefaults.roleAssignmentMode !== "approval-actor-all-roles") {
      issues.push({ code: "INVALID_ROLE_ASSIGNMENT_MODE", path: "$.deliveryDefaults.roleAssignmentMode", message: "Expected approval-actor-all-roles" });
    }
    requireString(deliveryDefaults.timebox, "$.deliveryDefaults.timebox", issues);
    if (deliveryDefaults.collectDuringRequirements !== false) {
      issues.push({ code: "INVALID_REQUIREMENTS_CONTROL", path: "$.deliveryDefaults.collectDuringRequirements", message: "POC delivery controls must not be collected as product requirements" });
    }
  }

  const constraints = requireObject(workflow.constraints, "$.constraints", issues);
  if (constraints) {
    hasExactKeys(constraints, ["productionUse", "externalIntegrations", "allowSinglePersonAllRoles"], "$.constraints", issues);
    if (typeof constraints.productionUse !== "boolean") issues.push({ code: "EXPECTED_BOOLEAN", path: "$.constraints.productionUse", message: "Expected a boolean" });
    requireStringArray(constraints.externalIntegrations, "$.constraints.externalIntegrations", issues);
    if (typeof constraints.allowSinglePersonAllRoles !== "boolean") issues.push({ code: "EXPECTED_BOOLEAN", path: "$.constraints.allowSinglePersonAllRoles", message: "Expected a boolean" });
  }
  return result<WorkflowDefinition>(value, issues);
}

export function validateAuditEvent(value: unknown): ValidationResult<AuditEvent> {
  const issues: ValidationIssue[] = [];
  const event = requireObject(value, "$", issues);
  if (!event) return result(value, issues);
  if (event.schemaVersion !== 1) issues.push({ code: "UNSUPPORTED_SCHEMA", path: "$.schemaVersion", message: "Expected schemaVersion 1" });
  for (const field of ["eventId", "recordId", "eventType", "actor", "recordHash"] as const) requireString(event[field], `$.${field}`, issues);
  requireIsoDate(event.timestamp, "$.timestamp", issues);
  if (typeof event.recordHash === "string" && !/^[a-f0-9]{64}$/.test(event.recordHash)) issues.push({ code: "INVALID_HASH", path: "$.recordHash", message: "Expected a SHA-256 hex digest" });
  return result<AuditEvent>(value, issues);
}

export type { EvidenceRef };
