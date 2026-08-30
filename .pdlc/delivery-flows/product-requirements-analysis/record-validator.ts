import {
  COVERAGE_STATUSES,
  REQUIREMENTS_COVERAGE_TOPICS,
  REQUIREMENTS_DEPTHS,
  REQUIREMENTS_STATUSES,
  type ValidationIssue,
  type ValidationResult,
} from "../../core/types.ts";
import { exact, isObject, isoDate, issue, object, relativePath, result, roleId, string, stringArray, validateRiskResolutionDesign, validateSourceLineage } from "../../core/schema.ts";
import { CHANGE_STATUSES, CHANGE_TYPES, REQUIREMENTS_ANALYSIS_STATUSES, type RequirementsAnalysisRecord } from "./types.ts";

/** Flow-owned structural and lifecycle validation for its controlled Record. */
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
    if (Array.isArray(scope.storyIds)) scope.storyIds.forEach((storyId, index) => { if (!storyIds.includes(storyId)) issue(issues, "SCOPE_STORY_UNKNOWN", `$.scope.storyIds[${index}]`, `Story is not present in the Record: ${String(storyId)}`); });
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
