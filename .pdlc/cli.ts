import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AuditLog } from "./core/audit.ts";
import { DeliveryFlowRegistry } from "./core/delivery-flow-registry.ts";
import { discoverDomainHooks, domainAgentPath, domainSkillPath, resolveDomainGuidance } from "./core/domain-guidance.ts";
import { DomainRegistry } from "./core/domain-registry.ts";
import { projectKnowledgeRefs, resolveDomainContext } from "./core/domain-resolver.ts";
import { PdlcError } from "./core/errors.ts";
import { IntegrationRegistry } from "./core/integration-registry.ts";
import { ProjectOverlay } from "./core/project-overlay.ts";
import { assessPocBuildReadiness, hashRequirementsDocument } from "./core/readiness.ts";
import { loadRequirementsFlowControl } from "./core/requirements.ts";
import { validatePocDeliveryRecord } from "./core/schema.ts";
import { FileStateStore } from "./core/state.ts";
import { StageRegistry } from "./core/stage-registry.ts";
import type { PocDeliveryRecord, ValidationIssue } from "./core/types.ts";
import { validateConversationEntrypoints } from "./platform-adapters/validate-entrypoints.ts";
import { validateCorePortability } from "./platform-adapters/validate-portability.ts";

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = resolve(MODULE_DIRECTORY, "..");

interface CliOptions { root: string; record?: string; actor?: string }
interface ParsedArguments { command?: string; subcommand?: string; options: CliOptions }

function parseArguments(args: string[], currentDirectory: string): ParsedArguments {
  const positional: string[] = [];
  const options: CliOptions = { root: currentDirectory };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") positional.push("help");
    else if (["--root", "--record", "--actor"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new PdlcError("INVALID_ARGUMENT", `Missing value for ${argument}`);
      if (argument === "--root") options.root = resolve(currentDirectory, value);
      else if (argument === "--record") options.record = value;
      else options.actor = value;
      index += 1;
    } else if (argument.startsWith("--")) throw new PdlcError("INVALID_ARGUMENT", `Unknown option: ${argument}`);
    else positional.push(argument);
  }
  if (positional.length > 2) throw new PdlcError("INVALID_ARGUMENT", `Too many positional arguments: ${positional.slice(2).join(" ")}`);
  return { command: positional[0], subcommand: positional[1], options };
}

function stageFor(record: PocDeliveryRecord): string {
  if (record.status === "DRAFT") return record.requirements.status === "approved" ? "build-readiness" : "requirements-clarification";
  if (record.status === "COMMITTED") return "implementation";
  return "outcome-review-and-disposition";
}

function contextTags(record: PocDeliveryRecord): string[] {
  return [
    ...record.risk.triggers.map((value) => `risk:${value}`),
    ...record.design.technologies.map((value) => `technology:${value}`),
    ...record.design.domains.map((value) => `domain:${value}`),
  ];
}

async function loadHarnessModel(projectRoot = HARNESS_ROOT) {
  const stages = await StageRegistry.load(join(HARNESS_ROOT, ".pdlc", "stages", "catalog.json"));
  const deliveryFlows = await DeliveryFlowRegistry.load(join(HARNESS_ROOT, ".pdlc", "delivery-flows", "catalog.json"), stages);
  const domains = await DomainRegistry.load(join(HARNESS_ROOT, ".pdlc", "domains"));
  const integrations = await IntegrationRegistry.load(join(HARNESS_ROOT, ".pdlc", "integrations", "catalog.json"));
  const project = await ProjectOverlay.load(projectRoot, new Set(domains.list().map(({ manifest }) => manifest.id)));
  return { stages, deliveryFlows, domains, integrations, project };
}

function unknownStageReferences(stages: StageRegistry, sources: Array<{ source: string; stageIds?: string[] }>): ValidationIssue[] {
  return sources.flatMap(({ source, stageIds = [] }) => stageIds.flatMap((stageId, index) => stages.has(stageId) ? [] : [{
    code: "UNKNOWN_STAGE_REF",
    path: `${source}.stages[${index}]`,
    message: `Stage is not defined in the canonical Stage Catalog: ${stageId}`,
  }]));
}

async function readRecord(options: CliOptions): Promise<PocDeliveryRecord> {
  const store = new FileStateStore(options.root);
  return options.record ? store.readRecord(options.record) : store.readCurrentRecord();
}

async function readiness(options: CliOptions, target?: string): Promise<unknown> {
  if (target !== "build") throw new PdlcError("INVALID_ARGUMENT", "Readiness target must be 'build'");
  const original = await readRecord(options);
  const { deliveryFlows, domains, integrations, project } = await loadHarnessModel(options.root);
  const flow = deliveryFlows.getExecutable("poc");
  let record = original;
  const activeStages = deliveryFlows.resolve(flow.id, contextTags(record)).map(({ definition }) => definition.id);
  const resolution = resolveDomainContext(domains, integrations, project, {
    deliveryFlow: flow.id,
    stages: activeStages,
    riskTriggers: record.risk.triggers,
    technologies: record.design.technologies,
    domains: record.design.domains,
  });
  if (resolution.issues.length > 0) throw new PdlcError("BUILD_NOT_READY", "Domain context contains unresolved conflicts", resolution.issues);

  if (options.actor) {
    let approvedContentHash: string;
    try {
      approvedContentHash = await hashRequirementsDocument(options.root, original.requirements.documentRef);
    } catch (error) {
      throw new PdlcError("BUILD_NOT_READY", "Requirements document cannot be approved", [{
        code: "REQUIREMENTS_DOCUMENT_UNREADABLE",
        path: "$.requirements.documentRef",
        message: error instanceof Error ? error.message : String(error),
      }]);
    }
    if (original.requirements.status === "approved" && original.requirements.approvedContentHash === approvedContentHash) throw new PdlcError("INVALID_ARGUMENT", "Requirements content is already approved; no new approval is needed");
    const timestamp = new Date().toISOString();
    record = {
      ...original,
      revision: original.revision + 1,
      updatedAt: timestamp,
      assignments: { product: options.actor, developer: options.actor, qa: options.actor },
      idea: { ...original.idea, timebox: flow.controls.deliveryDefaults.timebox },
      requirements: { ...original.requirements, status: "approved", approvedBy: options.actor, approvedAt: timestamp, approvedContentHash },
      resolution: {
        controls: { ...original.resolution.controls, applicable: resolution.controls.map(({ ref }) => ref) },
        baselines: resolution.baselines.map(({ ref }) => ref),
        defaults: resolution.defaults.map(({ sourceRef, key }) => `${sourceRef}:${key}`),
        knowledge: resolution.knowledge.map(({ ref }) => ref),
        integrations: resolution.integrations.map(({ ref }) => ref),
      },
    };
  }

  const policy = await loadRequirementsFlowControl(join(HARNESS_ROOT, ".pdlc", "delivery-flows", "poc", "controls", "requirements.json"));
  const result = await assessPocBuildReadiness(record, options.root, resolution.controls, policy, resolution.defaults);
  if (!result.ok) throw new PdlcError("BUILD_NOT_READY", "POC requirements or mandatory Controls are not ready for build", result.issues);
  if (options.actor) {
    await new FileStateStore(options.root).writeRecord(record, original.revision);
    await new AuditLog(options.root).append(new AuditLog(options.root).create(record, {
      recordId: record.id,
      eventType: "BUILD_READINESS_APPROVED",
      actor: options.actor,
      riskLevel: record.risk.level,
      evidenceRefs: [record.requirements.documentRef, ...record.resolution.controls.applicable],
    }));
  }
  return {
    ok: true,
    recordId: record.id,
    target,
    deliveryFlow: { id: flow.id, activeStages },
    approval: { status: record.requirements.status, approvedBy: record.requirements.approvedBy, approvedAt: record.requirements.approvedAt, contentHash: record.requirements.approvedContentHash },
    deliveryControls: { roleAssignmentMode: flow.controls.deliveryDefaults.roleAssignmentMode, assignments: record.assignments, timebox: record.idea.timebox },
    requirements: result.requirementsDocument,
    controls: result.controls,
    projectBaselines: resolution.baselines.map(({ ref }) => ref),
    defaults: resolution.defaults.map(({ key, sourceRef, locked }) => ({ key, source: sourceRef, locked })),
    knowledge: [...resolution.knowledge.map(({ ref }) => ref), ...projectKnowledgeRefs(project, options.root)],
    integrations: resolution.integrations.map(({ ref, owners, permissions, skills }) => ({ ref, owners, permissions, skills: skills.map(({ id }) => id) })),
  };
}

async function status(options: CliOptions): Promise<unknown> {
  try {
    const record = await readRecord(options);
    return { ok: true, initialized: true, record: { id: record.id, deliveryFlow: record.deliveryFlow, status: record.status, stage: stageFor(record), title: record.title, revision: record.revision, risk: record.risk, assignments: record.assignments, updatedAt: record.updatedAt } };
  } catch (error) {
    if (error instanceof PdlcError && error.code === "CURRENT_RECORD_NOT_SET") return { ok: true, initialized: false, message: error.message };
    throw error;
  }
}

async function stageContext(options: CliOptions, stageId?: string): Promise<unknown> {
  if (!stageId) throw new PdlcError("INVALID_ARGUMENT", "Context requires a canonical Stage id");
  const { stages, domains, integrations, project } = await loadHarnessModel(options.root);
  stages.get(stageId);
  let record: PocDeliveryRecord | undefined;
  try { record = await readRecord(options); } catch (error) {
    if (!(error instanceof PdlcError) || error.code !== "CURRENT_RECORD_NOT_SET") throw error;
  }
  const deliveryFlow = record?.deliveryFlow ?? "poc";
  const resolved = resolveDomainContext(domains, integrations, project, {
    deliveryFlow,
    stages: [stageId],
    riskTriggers: record?.risk.triggers ?? [],
    technologies: record?.design.technologies ?? [],
    domains: record?.design.domains ?? [],
  });
  if (resolved.issues.length > 0) throw new PdlcError("CONTEXT_RESOLUTION_FAILED", `Cannot resolve context for Stage ${stageId}`, resolved.issues);
  const domainGuidance = await resolveDomainGuidance(stages, domains, HARNESS_ROOT, stageId, deliveryFlow);
  return {
    ok: true,
    deliveryFlow,
    stage: stages.get(stageId),
    controls: resolved.controls.map(({ ref, ownerDomain, source, policy }) => ({ ref, ownerDomain, source, rules: policy.rules })),
    baselines: resolved.baselines.map(({ ref, baseline }) => ({ ref, decisions: baseline.decisions })),
    defaults: resolved.defaults,
    knowledge: [...resolved.knowledge.map(({ ref, asset, contentPath }) => ({ ref, kind: asset.kind, contentPath: contentPath ? relative(HARNESS_ROOT, contentPath) : undefined })), ...projectKnowledgeRefs(project, options.root).map((ref) => ({ ref, kind: "project" }))],
    domainContributions: domainGuidance.contributions,
    integrations: resolved.integrations.map(({ ref, owners, permissions, skills }) => ({
      ref,
      owners,
      permissions,
      skills: skills.map(({ id, path }) => ({ id, path: relative(HARNESS_ROOT, path) })),
    })),
  };
}

async function guidance(options: CliOptions, stageId?: string): Promise<unknown> {
  if (!stageId) throw new PdlcError("INVALID_ARGUMENT", "Guidance requires a canonical Stage id");
  const { stages, domains } = await loadHarnessModel(options.root);
  return { ok: true, ...await resolveDomainGuidance(stages, domains, HARNESS_ROOT, stageId) };
}

async function domainList(): Promise<unknown> {
  const { stages, domains } = await loadHarnessModel();
  const hooks = await discoverDomainHooks(stages, domains);
  return { ok: true, domains: domains.list().map(({ manifest, artifacts, policies, knowledge, skills, agents, hooks: domainHooks }) => ({
    id: manifest.id,
    artifacts: artifacts.length,
    policies: policies.length,
    knowledge: knowledge.length,
    skills: skills.map(({ id }) => id),
    agents: agents.map(({ id }) => id),
    hooks: domainHooks.length,
    stages: hooks.filter(({ domain }) => domain === manifest.id).flatMap(({ bindings }) => bindings.map(({ stage }) => stage)),
  })) };
}

async function domainSync(options: CliOptions): Promise<unknown> {
  const { stages, domains } = await loadHarnessModel(options.root);
  const hooks = (await discoverDomainHooks(stages, domains)).filter(({ descriptor }) => descriptor.enabled && descriptor.deliveryFlows.includes("poc"));
  const sources = new Map<string, { domain: string; source: string; destination: string }>();
  for (const { domain, root, bindings } of hooks) for (const binding of bindings) {
    const agentDestination = join(".github", "agents", `${binding.agent}.agent.md`);
    sources.set(agentDestination, { domain, source: domainAgentPath(root, binding.agent), destination: agentDestination });
    for (const skill of binding.skills) {
      const skillDestination = join(".github", "skills", skill, "SKILL.md");
      sources.set(skillDestination, { domain, source: domainSkillPath(root, skill), destination: skillDestination });
    }
  }
  const installed: string[] = [];
  const unchanged: string[] = [];
  for (const item of [...sources.values()].sort((a, b) => a.destination.localeCompare(b.destination))) {
    const destination = join(options.root, item.destination);
    const sourceContent = await readFile(item.source, "utf8");
    try {
      if (await readFile(destination, "utf8") !== sourceContent) throw new PdlcError("DOMAIN_FILE_CONFLICT", `Domain '${item.domain}' will not overwrite an existing file: ${relative(options.root, destination)}`);
      unchanged.push(relative(options.root, destination));
    } catch (error) {
      if (error instanceof PdlcError) throw error;
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(item.source, destination);
      installed.push(relative(options.root, destination));
    }
  }
  return { ok: true, domains: [...new Set(hooks.map(({ domain }) => domain))], target: options.root, installed, unchanged };
}

async function integrationList(): Promise<unknown> {
  const { integrations } = await loadHarnessModel();
  return { ok: true, integrations: integrations.list().map(({ manifest }) => ({
    id: manifest.id,
    version: manifest.version,
    owners: manifest.owners,
    maintainers: manifest.maintainers,
    permissions: manifest.permissions,
    skills: manifest.skills.map(({ id }) => id),
  })) };
}

async function validate(options: CliOptions): Promise<unknown> {
  const checks: Record<string, unknown> = {};
  const schemaNames = ["audit-event", "artifact-definition", "control-policy", "delivery-flow-catalog", "delivery-flow", "domain", "domain-stage-hooks", "integration-catalog", "integration", "knowledge-metadata", "poc-delivery-record", "project-baseline", "project-default", "requirements-flow-control", "stage-catalog"];
  for (const schemaName of schemaNames) {
    const path = join(HARNESS_ROOT, ".pdlc", "schemas", `${schemaName}.schema.json`);
    const schema = JSON.parse(await readFile(path, "utf8")) as { $schema?: unknown; type?: unknown };
    if (typeof schema.$schema !== "string" || schema.type !== "object") throw new PdlcError("VALIDATION_FAILED", `Invalid JSON Schema metadata: ${path}`);
  }
  checks.schemas = { ok: true, loaded: schemaNames };

  const { stages, deliveryFlows, domains, integrations, project } = await loadHarnessModel(options.root);
  checks.deliveryModel = { ok: true, catalogVersion: stages.catalog.catalogVersion, canonicalStages: stages.list().length, catalog: deliveryFlows.catalog.flows, deliveryFlows: deliveryFlows.list().map(({ id, status, stageSequence }) => ({ id, status, stageCount: stageSequence.length })) };
  checks.domains = { ok: true, loaded: domains.list().map(({ manifest, artifacts, policies, knowledge, skills, agents, hooks }) => ({ id: manifest.id, artifacts: artifacts.length, policies: policies.length, knowledge: knowledge.length, skills: skills.length, agents: agents.length, hooks: hooks.length })) };
  checks.integrations = { ok: true, loaded: integrations.list().map(({ manifest }) => ({ ref: `${manifest.id}@${manifest.version}`, owners: manifest.owners, skills: manifest.skills.map(({ id }) => id) })) };

  const stageIssues = unknownStageReferences(stages, [
    ...domains.policies().map(({ policy }) => ({ source: `policy:${policy.id}@${policy.version}`, stageIds: policy.appliesTo.stages })),
    ...domains.knowledge().map(({ asset }) => ({ source: `knowledge:${asset.id}@${asset.version}`, stageIds: asset.appliesTo.stages })),
    ...integrations.list().map(({ manifest }) => ({ source: `integration:${manifest.id}@${manifest.version}`, stageIds: manifest.appliesTo.stages })),
    ...project.policies().map(({ policy }) => ({ source: `project-policy:${policy.id}@${policy.version}`, stageIds: policy.appliesTo.stages })),
    ...project.defaults().map(({ profile }) => ({ source: `project-default:${profile.id}@${profile.version}`, stageIds: profile.appliesTo.stages })),
  ]);
  const artifactIssues = stages.list().flatMap((stage) => [...(stage.inputArtifacts ?? []), ...(stage.outputArtifacts ?? [])].flatMap((artifact) => {
    try { domains.artifact(artifact); return []; } catch { return [{ code: "UNKNOWN_ARTIFACT_REF", path: `stage:${stage.id}`, message: `Unknown Artifact Definition: ${artifact}` }]; }
  }));
  if (stageIssues.length + artifactIssues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Domain assets reference unknown Stages or Artifacts", [...stageIssues, ...artifactIssues]);
  checks.references = { ok: true };

  const domainHooks = await discoverDomainHooks(stages, domains);
  checks.domainHooks = { ok: true, loaded: domainHooks.map(({ domain, descriptor, bindings }) => ({ domain, version: descriptor.version, stages: bindings.map(({ stage }) => stage) })) };
  const requirementsControl = await loadRequirementsFlowControl(join(HARNESS_ROOT, ".pdlc", "delivery-flows", "poc", "controls", "requirements.json"));
  checks.requirementsFlowControl = { ok: true, loaded: `${requirementsControl.id}@${requirementsControl.version}` };

  const recordSource = options.record ? (isAbsolute(options.record) || options.record.endsWith(".json") ? resolve(options.root, options.record) : new FileStateStore(options.root).recordPath(options.record)) : join(HARNESS_ROOT, ".pdlc", "examples", "poc-delivery-record.json");
  const recordValidation = validatePocDeliveryRecord(JSON.parse(await readFile(recordSource, "utf8")) as unknown);
  checks.record = { ok: recordValidation.ok, source: recordSource, issues: recordValidation.issues };
  if (!recordValidation.ok) throw new PdlcError("VALIDATION_FAILED", `Invalid Delivery Record: ${recordSource}`, recordValidation.issues);
  const activeStages = deliveryFlows.resolve(recordValidation.value.deliveryFlow, contextTags(recordValidation.value)).map(({ definition }) => definition.id);
  const resolution = resolveDomainContext(domains, integrations, project, { deliveryFlow: recordValidation.value.deliveryFlow, stages: activeStages, riskTriggers: recordValidation.value.risk.triggers, technologies: recordValidation.value.design.technologies, domains: recordValidation.value.design.domains });
  checks.resolution = { ok: resolution.issues.length === 0, controls: resolution.controls.map(({ ref }) => ref), defaults: resolution.defaults.map(({ key, sourceRef }) => ({ key, sourceRef })), knowledge: resolution.knowledge.map(({ ref }) => ref), baselines: resolution.baselines.map(({ ref }) => ref), integrations: resolution.integrations.map(({ ref }) => ref), issues: resolution.issues };
  if (resolution.issues.length > 0) throw new PdlcError("VALIDATION_FAILED", "Domain context contains unresolved conflicts", resolution.issues);

  const portability = await validateCorePortability(join(HARNESS_ROOT, ".pdlc", "core"));
  checks.portability = portability;
  if (!portability.ok) throw new PdlcError("PORTABILITY_VIOLATION", "Shared Core contains platform-specific content", portability.issues);
  const entrypoints = await validateConversationEntrypoints(HARNESS_ROOT);
  checks.entrypoints = entrypoints;
  if (!entrypoints.ok) throw new PdlcError("PORTABILITY_VIOLATION", "Conversational entrypoints are missing or have drifted", entrypoints.issues);
  return { ok: true, checks };
}

export async function runCli(args: string[], currentDirectory = process.cwd()): Promise<{ exitCode: number; output: unknown }> {
  try {
    const parsed = parseArguments(args, currentDirectory);
    if (!parsed.command || parsed.command === "help") return { exitCode: 0, output: { name: "Lean PDLC Runner v2", commands: ["status", "validate", "context <stage>", "readiness build", "guidance <stage>", "domain list", "domain sync", "integration list"] } };
    if (parsed.command === "status") return { exitCode: 0, output: await status(parsed.options) };
    if (parsed.command === "validate") return { exitCode: 0, output: await validate(parsed.options) };
    if (parsed.command === "context") return { exitCode: 0, output: await stageContext(parsed.options, parsed.subcommand) };
    if (parsed.command === "readiness") return { exitCode: 0, output: await readiness(parsed.options, parsed.subcommand) };
    if (parsed.command === "guidance") return { exitCode: 0, output: await guidance(parsed.options, parsed.subcommand) };
    if (parsed.command === "domain" && parsed.subcommand === "list") return { exitCode: 0, output: await domainList() };
    if (parsed.command === "domain" && parsed.subcommand === "sync") return { exitCode: 0, output: await domainSync(parsed.options) };
    if (parsed.command === "domain") throw new PdlcError("INVALID_ARGUMENT", "Domain command must be list or sync");
    if (parsed.command === "integration" && parsed.subcommand === "list") return { exitCode: 0, output: await integrationList() };
    if (parsed.command === "integration") throw new PdlcError("INVALID_ARGUMENT", "Integration command must be list");
    if (parsed.command === "checkpoint") throw new PdlcError("CHECKPOINT_NOT_IMPLEMENTED", `Checkpoint '${parsed.subcommand ?? ""}' cannot change state yet`);
    throw new PdlcError("INVALID_ARGUMENT", `Unknown command: ${parsed.command}`);
  } catch (error) {
    if (error instanceof PdlcError) return { exitCode: 2, output: { ok: false, error: { code: error.code, message: error.message, details: error.details } } };
    return { exitCode: 1, output: { ok: false, error: { code: "UNEXPECTED_ERROR", message: error instanceof Error ? error.message : String(error) } } };
  }
}

async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2));
  (result.exitCode === 0 ? process.stdout : process.stderr).write(`${JSON.stringify(result.output, null, 2)}\n`);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
