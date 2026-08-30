import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { discoverDisciplineHooks } from "../core/discipline-guidance.ts";
import { resolveDisciplineContext } from "../core/discipline-resolver.ts";
import { PdlcError } from "../core/errors.ts";
import { FlowEngine } from "../core/flow-engine.ts";
import { loadFlowExecutor } from "../core/flow-executor.ts";
import { HarnessContext } from "../core/harness-context.ts";
import { contextClassificationIssues, contextTags } from "../core/poc-progress.ts";
import { validateDeliveryRecordEnvelope } from "../core/schema.ts";
import { FileStateStore } from "../core/state.ts";
import type { BaseDeliveryRecord, ContextualDeliveryRecord, ValidationIssue } from "../core/types.ts";
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
  const schemaNames = ["audit-event", "artifact-definition", "control-policy", "delivery-flow-catalog", "delivery-flow", "discipline", "discipline-stage-hooks", "integration-catalog", "integration", "knowledge-metadata", "poc-delivery-record", "requirements-analysis-record", "project-baseline", "project-default", "requirements-flow-control", "role-catalog", "stage-catalog", "stage-context-receipt"];
  await Promise.all(schemaNames.map(async (schemaName) => {
    const path = join(harnessRoot, ".pdlc", "schemas", `${schemaName}.schema.json`);
    const schema = JSON.parse(await readFile(path, "utf8")) as { $schema?: unknown; type?: unknown };
    if (typeof schema.$schema !== "string" || schema.type !== "object") throw new PdlcError("VALIDATION_FAILED", `Invalid JSON Schema metadata: ${path}`);
  }));
  checks.schemas = { ok: true, loaded: schemaNames };

  const harness = await HarnessContext.load(harnessRoot, options.root);
  const { roles, stages, deliveryFlows, disciplines, integrations, project } = harness.model;
  const runtimeFlows = deliveryFlows.list().filter(({ status }) => status === "active");
  const flowRuntimeChecks = await Promise.all(runtimeFlows.map(async (definition) => {
    const flow = deliveryFlows.getExecutable(definition.id);
    const executor = await loadFlowExecutor(harnessRoot, flow);
    if (flow.runtime?.recordSchema) {
      const schemaPath = resolve(harnessRoot, ".pdlc", flow.runtime.recordSchema);
      const schema = JSON.parse(await readFile(schemaPath, "utf8")) as { type?: unknown };
      if (schema.type !== "object") throw new PdlcError("VALIDATION_FAILED", `Invalid Flow Record schema: ${schemaPath}`);
    }
    const configuration = await executor?.validateConfiguration?.(harnessRoot, flow);
    return { id: flow.id, executor: flow.runtime?.executor ?? "generic", recordSchema: flow.runtime?.recordSchema, configuration };
  }));
  checks.flowRuntime = { ok: true, loaded: flowRuntimeChecks };
  checks.roles = { ok: true, owner: roles.catalog.owner, loaded: roles.list().map(({ id, name, definition }) => ({ id, name, definition })) };
  checks.deliveryModel = { ok: true, catalogVersion: stages.catalog.catalogVersion, canonicalStages: stages.list().length, catalog: deliveryFlows.catalog.flows, deliveryFlows: deliveryFlows.list().map(({ id, status, stageSequence }) => ({ id, status, stageCount: stageSequence.length })) };
  checks.disciplines = { ok: true, loaded: disciplines.list().map(({ manifest, artifacts, policies, knowledge, skills, agents, hooks }) => ({ id: manifest.id, artifacts: artifacts.length, policies: policies.length, knowledge: knowledge.length, skills: skills.length, agents: agents.length, hooks: hooks.length })) };
  checks.integrations = { ok: true, loaded: integrations.list().map(({ manifest }) => ({ ref: `${manifest.id}@${manifest.version}`, owners: manifest.owners, skills: manifest.skills.map(({ id }) => id) })) };

  const stageIssues = unknownStageReferences(stages, [
    ...disciplines.policies().map(({ policy }) => ({ source: `policy:${policy.id}@${policy.version}`, stageIds: policy.appliesTo.stages })),
    ...disciplines.knowledge().map(({ asset }) => ({ source: `knowledge:${asset.id}@${asset.version}`, stageIds: asset.appliesTo.stages })),
    ...integrations.list().map(({ manifest }) => ({ source: `integration:${manifest.id}@${manifest.version}`, stageIds: manifest.appliesTo.stages })),
    ...project.policies().map(({ policy }) => ({ source: `project-policy:${policy.id}@${policy.version}`, stageIds: policy.appliesTo.stages })),
    ...project.defaults().map(({ profile }) => ({ source: `project-default:${profile.id}@${profile.version}`, stageIds: profile.appliesTo.stages })),
    ...disciplines.policies().flatMap(({ policy }) => policy.rules.map((rule) => ({ source: `policy-rule:${policy.id}@${policy.version}#${rule.id}.enforceAt`, stageIds: rule.enforceAt }))),
    ...project.policies().flatMap(({ policy }) => policy.rules.map((rule) => ({ source: `project-policy-rule:${policy.id}@${policy.version}#${rule.id}.enforceAt`, stageIds: rule.enforceAt }))),
  ]);
  const artifactIssues = stages.list().flatMap((stage) => [...(stage.inputArtifacts ?? []), ...(stage.outputArtifacts ?? [])].flatMap((artifact) => {
    try { disciplines.artifact(artifact); return []; } catch { return [{ code: "UNKNOWN_ARTIFACT_REF", path: `stage:${stage.id}`, message: `Unknown Artifact Definition: ${artifact}` }]; }
  }));
  if (stageIssues.length + artifactIssues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Discipline assets reference unknown Stages or Artifacts", [...stageIssues, ...artifactIssues]);
  checks.references = { ok: true };

  const disciplineHooks = await discoverDisciplineHooks(stages, disciplines);
  checks.disciplineHooks = { ok: true, loaded: disciplineHooks.map(({ discipline, descriptor, bindings }) => ({ discipline, version: descriptor.version, stages: bindings.map(({ stage }) => stage) })) };

  const selectedRecord = await validationRecordSource(harnessRoot, options);
  const rawRecord = JSON.parse(await readFile(selectedRecord.path, "utf8")) as unknown;
  const envelope = validateDeliveryRecordEnvelope(rawRecord);
  if (!envelope.ok) throw new PdlcError("VALIDATION_FAILED", `Invalid Delivery Record envelope: ${selectedRecord.path}`, envelope.issues);
  const flow = deliveryFlows.getExecutable(envelope.value.deliveryFlow);
  const executor = await loadFlowExecutor(harnessRoot, flow);
  const recordValidation = executor?.validateRecord?.(rawRecord) ?? envelope;
  checks.record = { ok: recordValidation.ok, source: selectedRecord.path, issues: recordValidation.issues };
  if (!recordValidation.ok) throw new PdlcError("VALIDATION_FAILED", `Invalid Delivery Record: ${selectedRecord.path}`, recordValidation.issues);
  const record = recordValidation.value;
  const contextual = asContextualRecord(record);
  const tags = contextual ? contextTags(contextual) : [];
  const tagIssues = contextual ? contextClassificationIssues(contextual) : [];
  checks.contextTags = { ok: tagIssues.length === 0, values: tags, issues: tagIssues, skipped: contextual ? undefined : "Flow Record does not declare contextual resolution fields." };
  if (tagIssues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Delivery Record uses non-canonical context tags", tagIssues);
  const activeStages = deliveryFlows.resolve(record.deliveryFlow, tags).map(({ definition }) => definition.id);
  const requiredRoles = deliveryFlows.requiredRoles(record.deliveryFlow, tags);
  const roleIssues = roles.validateAssignments(record, requiredRoles, record.status !== flow.controls.initialStatus);
  checks.roleAssignments = { ok: roleIssues.length === 0, required: requiredRoles, assigned: Object.keys(record.assignments).sort(), issues: roleIssues };
  if (roleIssues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Delivery Record contains invalid or missing Role assignments", roleIssues);
  const resolution = contextual ? resolveDisciplineContext(disciplines, integrations, project, { deliveryFlow: record.deliveryFlow, stages: activeStages, riskTriggers: contextual.risk.triggers, technologies: contextual.design.technologies, disciplines: contextual.design.disciplines }) : undefined;
  checks.resolution = resolution
    ? { ok: resolution.issues.length === 0, controls: resolution.controls.map(({ ref }) => ref), defaults: resolution.defaults.map(({ key, sourceRef }) => ({ key, sourceRef })), knowledge: resolution.knowledge.map(({ ref }) => ref), baselines: resolution.baselines.map(({ ref }) => ref), integrations: resolution.integrations.map(({ ref }) => ref), issues: resolution.issues }
    : { ok: true, skipped: "Flow Record does not declare contextual resolution fields." };
  if (resolution && resolution.issues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Discipline context contains unresolved conflicts", resolution.issues);
  if (selectedRecord.operational) {
    const engine = await FlowEngine.load(harnessRoot, options.root);
    const operationalIssues = executor?.operationalIssues ? await executor.operationalIssues({
      harnessRoot,
      projectRoot: options.root,
      harness,
      flow,
      store: new FileStateStore(options.root),
      audit: engine.audit,
      activeRecords: () => engine.activeRecords(),
    }, record) : [];
    checks.operationalIntegrity = { ok: operationalIssues.length === 0, issues: operationalIssues, owner: executor?.operationalIssues ? `flow:${flow.id}` : "generic-engine" };
    const contextIssues = operationalIssues.filter(({ code }) => code.includes("CONTEXT"));
    checks.contextApplications = { ok: contextIssues.length === 0, issues: contextIssues, owner: `flow:${flow.id}` };
    checks.approvedBuildContract = { ok: operationalIssues.length === contextIssues.length, issues: operationalIssues.filter(({ code }) => !code.includes("CONTEXT")), owner: `flow:${flow.id}` };
    if (operationalIssues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Delivery Record operational integrity failed", operationalIssues);
  } else {
    checks.operationalIntegrity = { ok: true, issues: [], skipped: "No active Delivery Record; validated the canonical example." };
    checks.contextApplications = { ok: true, issues: [], skipped: "No active Delivery Record." };
    checks.approvedBuildContract = { ok: true, issues: [], skipped: "No active Delivery Record." };
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

function asContextualRecord(record: BaseDeliveryRecord): ContextualDeliveryRecord | undefined {
  const candidate = record as BaseDeliveryRecord & Partial<ContextualDeliveryRecord>;
  return candidate.risk && candidate.resolution && candidate.design ? candidate as ContextualDeliveryRecord : undefined;
}
