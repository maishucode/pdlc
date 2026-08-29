import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { assessApprovedBuildContract } from "../core/approval-contract.ts";
import { discoverDomainHooks } from "../core/domain-guidance.ts";
import { resolveDomainContext } from "../core/domain-resolver.ts";
import { PdlcError } from "../core/errors.ts";
import { HarnessContext } from "../core/harness-context.ts";
import { contextClassificationIssues, contextTags, operationalContextStages } from "../core/poc-progress.ts";
import { loadRequirementsFlowControl } from "../core/requirements.ts";
import { validatePocDeliveryRecord } from "../core/schema.ts";
import { FileStateStore } from "../core/state.ts";
import type { ValidationIssue } from "../core/types.ts";
import { validateConversationEntrypoints } from "../platform-adapters/validate-entrypoints.ts";
import { validateCorePortability } from "../platform-adapters/validate-portability.ts";
import type { RunnerOptions } from "./types.ts";

function unknownStageReferences(stages: HarnessContext["model"]["stages"], sources: Array<{ source: string; stageIds?: string[] }>): ValidationIssue[] {
  return sources.flatMap(({ source, stageIds = [] }) => stageIds.flatMap((stageId, index) => stages.has(stageId) ? [] : [{
    code: "UNKNOWN_STAGE_REF",
    path: `${source}.stages[${index}]`,
    message: `Stage is not defined in the canonical Stage Catalog: ${stageId}`,
  }]));
}

async function validationRecordSource(harnessRoot: string, options: RunnerOptions): Promise<{ path: string; operational: boolean }> {
  const store = new FileStateStore(options.root);
  if (options.record) {
    const path = isAbsolute(options.record) || options.record.endsWith(".json") ? resolve(options.root, options.record) : store.recordPath(options.record);
    return { path, operational: true };
  }
  try {
    return { path: store.recordPath(await store.currentRecordId()), operational: true };
  } catch (error) {
    if (!(error instanceof PdlcError) || error.code !== "CURRENT_RECORD_NOT_SET") throw error;
    return { path: join(harnessRoot, ".pdlc", "examples", "poc-delivery-record.json"), operational: false };
  }
}

export async function validateHarness(harnessRoot: string, options: RunnerOptions): Promise<unknown> {
  const checks: Record<string, unknown> = {};
  const schemaNames = ["audit-event", "artifact-definition", "control-policy", "delivery-flow-catalog", "delivery-flow", "domain", "domain-stage-hooks", "integration-catalog", "integration", "knowledge-metadata", "poc-delivery-record", "project-baseline", "project-default", "requirements-flow-control", "role-catalog", "stage-catalog", "stage-context-receipt"];
  await Promise.all(schemaNames.map(async (schemaName) => {
    const path = join(harnessRoot, ".pdlc", "schemas", `${schemaName}.schema.json`);
    const schema = JSON.parse(await readFile(path, "utf8")) as { $schema?: unknown; type?: unknown };
    if (typeof schema.$schema !== "string" || schema.type !== "object") throw new PdlcError("VALIDATION_FAILED", `Invalid JSON Schema metadata: ${path}`);
  }));
  checks.schemas = { ok: true, loaded: schemaNames };

  const harness = await HarnessContext.load(harnessRoot, options.root);
  const { roles, stages, deliveryFlows, domains, integrations, project } = harness.model;
  checks.roles = { ok: true, owner: roles.catalog.owner, loaded: roles.list().map(({ id, name, definition }) => ({ id, name, definition })) };
  checks.deliveryModel = { ok: true, catalogVersion: stages.catalog.catalogVersion, canonicalStages: stages.list().length, catalog: deliveryFlows.catalog.flows, deliveryFlows: deliveryFlows.list().map(({ id, status, stageSequence }) => ({ id, status, stageCount: stageSequence.length })) };
  checks.domains = { ok: true, loaded: domains.list().map(({ manifest, artifacts, policies, knowledge, skills, agents, hooks }) => ({ id: manifest.id, artifacts: artifacts.length, policies: policies.length, knowledge: knowledge.length, skills: skills.length, agents: agents.length, hooks: hooks.length })) };
  checks.integrations = { ok: true, loaded: integrations.list().map(({ manifest }) => ({ ref: `${manifest.id}@${manifest.version}`, owners: manifest.owners, skills: manifest.skills.map(({ id }) => id) })) };

  const stageIssues = unknownStageReferences(stages, [
    ...domains.policies().map(({ policy }) => ({ source: `policy:${policy.id}@${policy.version}`, stageIds: policy.appliesTo.stages })),
    ...domains.knowledge().map(({ asset }) => ({ source: `knowledge:${asset.id}@${asset.version}`, stageIds: asset.appliesTo.stages })),
    ...integrations.list().map(({ manifest }) => ({ source: `integration:${manifest.id}@${manifest.version}`, stageIds: manifest.appliesTo.stages })),
    ...project.policies().map(({ policy }) => ({ source: `project-policy:${policy.id}@${policy.version}`, stageIds: policy.appliesTo.stages })),
    ...project.defaults().map(({ profile }) => ({ source: `project-default:${profile.id}@${profile.version}`, stageIds: profile.appliesTo.stages })),
    ...domains.policies().flatMap(({ policy }) => policy.rules.map((rule) => ({ source: `policy-rule:${policy.id}@${policy.version}#${rule.id}.enforceAt`, stageIds: rule.enforceAt }))),
    ...project.policies().flatMap(({ policy }) => policy.rules.map((rule) => ({ source: `project-policy-rule:${policy.id}@${policy.version}#${rule.id}.enforceAt`, stageIds: rule.enforceAt }))),
  ]);
  const artifactIssues = stages.list().flatMap((stage) => [...(stage.inputArtifacts ?? []), ...(stage.outputArtifacts ?? [])].flatMap((artifact) => {
    try { domains.artifact(artifact); return []; } catch { return [{ code: "UNKNOWN_ARTIFACT_REF", path: `stage:${stage.id}`, message: `Unknown Artifact Definition: ${artifact}` }]; }
  }));
  if (stageIssues.length + artifactIssues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Domain assets reference unknown Stages or Artifacts", [...stageIssues, ...artifactIssues]);
  checks.references = { ok: true };

  const [domainHooks, requirementsControl] = await Promise.all([
    discoverDomainHooks(stages, domains),
    loadRequirementsFlowControl(join(harnessRoot, ".pdlc", "delivery-flows", "poc", "controls", "requirements.json")),
  ]);
  checks.domainHooks = { ok: true, loaded: domainHooks.map(({ domain, descriptor, bindings }) => ({ domain, version: descriptor.version, stages: bindings.map(({ stage }) => stage) })) };
  checks.requirementsFlowControl = { ok: true, loaded: `${requirementsControl.id}@${requirementsControl.version}` };

  const selectedRecord = await validationRecordSource(harnessRoot, options);
  const recordValidation = validatePocDeliveryRecord(JSON.parse(await readFile(selectedRecord.path, "utf8")) as unknown);
  checks.record = { ok: recordValidation.ok, source: selectedRecord.path, issues: recordValidation.issues };
  if (!recordValidation.ok) throw new PdlcError("VALIDATION_FAILED", `Invalid Delivery Record: ${selectedRecord.path}`, recordValidation.issues);
  const record = recordValidation.value;
  const tagIssues = contextClassificationIssues(record);
  checks.contextTags = { ok: tagIssues.length === 0, values: contextTags(record), issues: tagIssues };
  if (tagIssues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Delivery Record uses non-canonical context tags", tagIssues);
  const activeStages = deliveryFlows.resolve(record.deliveryFlow, contextTags(record)).map(({ definition }) => definition.id);
  const requiredRoles = deliveryFlows.requiredRoles(record.deliveryFlow, contextTags(record));
  const roleIssues = roles.validateAssignments(record, requiredRoles, record.requirements.status === "approved");
  checks.roleAssignments = { ok: roleIssues.length === 0, required: requiredRoles, assigned: Object.keys(record.assignments).sort(), issues: roleIssues };
  if (roleIssues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Delivery Record contains invalid or missing Role assignments", roleIssues);
  const resolution = resolveDomainContext(domains, integrations, project, { deliveryFlow: record.deliveryFlow, stages: activeStages, riskTriggers: record.risk.triggers, technologies: record.design.technologies, domains: record.design.domains });
  checks.resolution = { ok: resolution.issues.length === 0, controls: resolution.controls.map(({ ref }) => ref), defaults: resolution.defaults.map(({ key, sourceRef }) => ({ key, sourceRef })), knowledge: resolution.knowledge.map(({ ref }) => ref), baselines: resolution.baselines.map(({ ref }) => ref), integrations: resolution.integrations.map(({ ref }) => ref), issues: resolution.issues };
  if (resolution.issues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Domain context contains unresolved conflicts", resolution.issues);
  if (selectedRecord.operational) {
    const requiredContextStages = operationalContextStages(record);
    const [contextIssues, approvalIssues] = await Promise.all([
      harness.contextIssues(record, requiredContextStages),
      assessApprovedBuildContract(record, options.root),
    ]);
    checks.contextApplications = { ok: contextIssues.length === 0, requiredStages: requiredContextStages, issues: contextIssues };
    checks.approvedBuildContract = { ok: approvalIssues.length === 0, issues: approvalIssues };
    const operationalIssues = [...contextIssues, ...approvalIssues];
    if (operationalIssues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Delivery Record operational integrity failed", operationalIssues);
  } else {
    checks.contextApplications = { ok: true, requiredStages: [], issues: [], skipped: "No active Delivery Record; validated the canonical example." };
    checks.approvedBuildContract = { ok: true, issues: [], skipped: "No active approved Delivery Record." };
  }

  const [portability, entrypoints] = await Promise.all([
    validateCorePortability(join(harnessRoot, ".pdlc", "core")),
    validateConversationEntrypoints(harnessRoot),
  ]);
  checks.portability = portability;
  if (!portability.ok) throw new PdlcError("PORTABILITY_VIOLATION", "Shared Core contains platform-specific content", portability.issues);
  checks.entrypoints = entrypoints;
  if (!entrypoints.ok) throw new PdlcError("PORTABILITY_VIOLATION", "Conversational entrypoints are missing or have drifted", entrypoints.issues);
  return { ok: true, checks };
}
