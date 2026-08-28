import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PdlcError } from "./core/errors.ts";
import { AuditLog } from "./core/audit.ts";
import { loadPrinciplePacks } from "./core/principles.ts";
import { loadStandardProfiles, resolveStandardDefaultsForStages } from "./core/defaults.ts";
import { JourneyRegistry } from "./core/journey-registry.ts";
import { assessPocBuildReadiness, hashRequirementsDocument } from "./core/readiness.ts";
import { loadRequirementsPolicy } from "./core/requirements.ts";
import { resolvePluginGuidance } from "./core/plugin-guidance.ts";
import { validatePocDeliveryRecord } from "./core/schema.ts";
import { FileStateStore } from "./core/state.ts";
import { StageRegistry } from "./core/stage-registry.ts";
import type { PocDeliveryRecord, ValidationIssue } from "./core/types.ts";
import { WorkflowRegistry } from "./core/workflow-registry.ts";
import { validateCorePortability } from "./harnesses/validate-portability.ts";
import { validateConversationEntrypoints } from "./harnesses/validate-entrypoints.ts";

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = resolve(MODULE_DIRECTORY, "..");

interface CliOptions {
  root: string;
  record?: string;
  actor?: string;
  plugin?: string;
}

interface ParsedArguments {
  command?: string;
  subcommand?: string;
  options: CliOptions;
}

function parseArguments(args: string[], currentDirectory: string): ParsedArguments {
  const positional: string[] = [];
  const options: CliOptions = { root: currentDirectory };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      positional.push("help");
    } else if (argument === "--root" || argument === "--record" || argument === "--actor" || argument === "--plugin") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new PdlcError("INVALID_ARGUMENT", `Missing value for ${argument}`);
      if (argument === "--root") options.root = resolve(currentDirectory, value);
      else if (argument === "--record") options.record = value;
      else if (argument === "--actor") options.actor = value;
      else options.plugin = resolve(currentDirectory, value);
      index += 1;
    } else if (argument.startsWith("--")) {
      throw new PdlcError("INVALID_ARGUMENT", `Unknown option: ${argument}`);
    } else {
      positional.push(argument);
    }
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

async function loadDeliveryModel(): Promise<{
  stages: StageRegistry;
  journeys: JourneyRegistry;
}> {
  const stages = await StageRegistry.load(join(HARNESS_ROOT, "pdlc", "stages", "catalog.json"));
  const journeys = await JourneyRegistry.load(join(HARNESS_ROOT, "pdlc", "journeys"), stages);
  return { stages, journeys };
}

function unknownStageReferences(
  stages: StageRegistry,
  sources: Array<{ source: string; stageIds: string[] }>,
): ValidationIssue[] {
  return sources.flatMap(({ source, stageIds }) => stageIds.flatMap((stageId, index) =>
    stages.has(stageId)
      ? []
      : [{
        code: "UNKNOWN_STAGE_REF",
        path: `${source}.stages[${index}]`,
        message: `Stage is not defined in the canonical Stage Catalog: ${stageId}`,
      }],
  ));
}

async function readRecord(options: CliOptions): Promise<PocDeliveryRecord> {
  const store = new FileStateStore(options.root);
  return options.record ? store.readRecord(options.record) : store.readCurrentRecord();
}

async function readiness(options: CliOptions, target?: string): Promise<unknown> {
  if (target !== "build") throw new PdlcError("INVALID_ARGUMENT", "Readiness target must be 'build'");
  const original = await readRecord(options);
  const registry = await WorkflowRegistry.load(join(HARNESS_ROOT, "pdlc", "workflows"));
  const workflow = registry.get("poc");
  const { journeys } = await loadDeliveryModel();
  let record = original;
  if (options.actor) {
    let approvedContentHash: string;
    try {
      approvedContentHash = await hashRequirementsDocument(options.root, original.requirements.documentRef);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PdlcError("BUILD_NOT_READY", "Requirements document cannot be approved", [
        { code: "REQUIREMENTS_DOCUMENT_UNREADABLE", path: "$.requirements.documentRef", message },
      ]);
    }
    if (original.requirements.status === "approved" && original.requirements.approvedContentHash === approvedContentHash) {
      throw new PdlcError("INVALID_ARGUMENT", "Requirements content is already approved; no new approval is needed");
    }
    const timestamp = new Date().toISOString();
    record = {
      ...original,
      revision: original.revision + 1,
      updatedAt: timestamp,
      assignments: {
        product: options.actor,
        developer: options.actor,
        qa: options.actor,
      },
      idea: {
        ...original.idea,
        timebox: workflow.deliveryDefaults.timebox,
      },
      requirements: {
        ...original.requirements,
        status: "approved",
        approvedBy: options.actor,
        approvedAt: timestamp,
        approvedContentHash,
      },
    };
  }
  const packs = await loadPrinciplePacks(join(HARNESS_ROOT, "pdlc", "principles"));
  const profiles = [
    ...await loadStandardProfiles(join(HARNESS_ROOT, "pdlc", "defaults", "harness"), "harness"),
    ...await loadStandardProfiles(join(options.root, ".pdlc", "project", "standards"), "project"),
  ];
  const resolvedStages = journeys.resolve(workflow.journeyId, contextTags(record));
  const stageIds = resolvedStages.map((stage) => stage.definition.id);
  const standards = resolveStandardDefaultsForStages(packs, profiles, {
    workflow: "poc",
    stages: stageIds,
    riskTriggers: record.risk.triggers,
    technologies: record.design.technologies,
    domains: record.design.domains,
  });
  if (standards.issues.length > 0) {
    throw new PdlcError("BUILD_NOT_READY", "Standard defaults contain unresolved conflicts", standards.issues);
  }
  const policy = await loadRequirementsPolicy(join(HARNESS_ROOT, "pdlc", "workflows", "poc", "requirements-policy.json"));
  const result = await assessPocBuildReadiness(record, options.root, packs, policy, standards.defaults, stageIds);
  if (!result.ok) throw new PdlcError("BUILD_NOT_READY", "POC requirements or principles are not ready for build", result.issues);
  if (options.actor) {
    const store = new FileStateStore(options.root);
    await store.writeRecord(record, original.revision);
    const audit = new AuditLog(options.root);
    await audit.append(audit.create(record, {
      recordId: record.id,
      eventType: "BUILD_READINESS_APPROVED",
      actor: options.actor,
      riskLevel: record.risk.level,
      evidenceRefs: [record.requirements.documentRef, ...record.principles.applicable],
    }));
  }
  return {
    ok: true,
    recordId: record.id,
    target,
    approval: {
      status: record.requirements.status,
      approvedBy: record.requirements.approvedBy,
      approvedAt: record.requirements.approvedAt,
      contentHash: record.requirements.approvedContentHash,
    },
    deliveryControls: {
      roleAssignmentMode: workflow.deliveryDefaults.roleAssignmentMode,
      assignments: record.assignments,
      timebox: record.idea.timebox,
    },
    journey: {
      id: workflow.journeyId,
      activeStages: stageIds,
    },
    requirements: result.requirementsDocument,
    principlePacks: result.principlePacks,
    standardDefaults: standards.defaults.map((standard) => ({
      key: standard.key,
      source: standard.sourceRef,
      locked: standard.locked,
    })),
  };
}

async function status(options: CliOptions): Promise<unknown> {
  const store = new FileStateStore(options.root);
  let record: PocDeliveryRecord;
  try {
    record = options.record ? await store.readRecord(options.record) : await store.readCurrentRecord();
  } catch (error) {
    if (error instanceof PdlcError && error.code === "CURRENT_RECORD_NOT_SET") {
      return { ok: true, initialized: false, message: error.message };
    }
    throw error;
  }
  return {
    ok: true,
    initialized: true,
    record: {
      id: record.id,
      workflow: record.workflow,
      status: record.status,
      stage: stageFor(record),
      title: record.title,
      revision: record.revision,
      risk: record.risk,
      assignments: record.assignments,
      updatedAt: record.updatedAt,
    },
  };
}

async function guidance(options: CliOptions, stageId?: string): Promise<unknown> {
  if (!options.plugin) throw new PdlcError("PLUGIN_REQUIRED", "Guidance requires --plugin <path>");
  if (!stageId) throw new PdlcError("INVALID_ARGUMENT", "Guidance requires a canonical Stage id");
  const { stages } = await loadDeliveryModel();
  const resolution = await resolvePluginGuidance(stages, options.plugin, stageId);
  return { ok: true, ...resolution };
}

async function installPlugin(options: CliOptions, pluginName?: string): Promise<unknown> {
  if (!pluginName || !/^[a-z0-9][a-z0-9-]*$/.test(pluginName)) {
    throw new PdlcError("INVALID_ARGUMENT", "Plugin install requires a kebab-case plugin name");
  }
  const pluginRoot = join(HARNESS_ROOT, "plugins", pluginName);
  let manifest: { name?: unknown; kind?: unknown };
  try {
    manifest = JSON.parse(await readFile(join(pluginRoot, "plugin.json"), "utf8")) as { name?: unknown; kind?: unknown };
  } catch {
    throw new PdlcError("PLUGIN_NOT_FOUND", `Bundled plugin was not found: ${pluginName}`);
  }
  if (manifest.name !== pluginName || manifest.kind !== "lean-pdlc-plugin") {
    throw new PdlcError("INVALID_PLUGIN", `Plugin manifest is not a Lean PDLC plugin: ${pluginName}`);
  }

  const agentDirectory = join(pluginRoot, "agents");
  const skillDirectory = join(pluginRoot, "skills");
  const agents = (await readdir(agentDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".agent.md"))
    .map((entry) => join("agents", entry.name));
  const skills = (await readdir(skillDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join("skills", entry.name, "SKILL.md"));
  const sources = [...agents, ...skills].sort();
  if (sources.length === 0) throw new PdlcError("INVALID_PLUGIN", `Plugin has no installable Agent or Skills: ${pluginName}`);

  const installed: string[] = [];
  const unchanged: string[] = [];
  for (const sourceRelativePath of sources) {
    const source = join(pluginRoot, sourceRelativePath);
    const destination = join(options.root, ".github", sourceRelativePath);
    const sourceContent = await readFile(source, "utf8");
    try {
      const destinationContent = await readFile(destination, "utf8");
      if (destinationContent !== sourceContent) {
        throw new PdlcError("PLUGIN_FILE_CONFLICT", `Plugin will not overwrite an existing file: ${relative(options.root, destination)}`);
      }
      unchanged.push(relative(options.root, destination));
    } catch (error) {
      if (error instanceof PdlcError) throw error;
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
      installed.push(relative(options.root, destination));
    }
  }
  return { ok: true, plugin: pluginName, target: options.root, installed, unchanged };
}

async function validate(options: CliOptions): Promise<unknown> {
  const checks: Record<string, unknown> = {};

  const schemaNames = ["audit-event", "journey", "poc-delivery-record", "principle-pack", "requirements-policy", "stage-catalog", "standard-profile", "workflow"];
  for (const schemaName of schemaNames) {
    const schemaPath = join(HARNESS_ROOT, "pdlc", "schemas", `${schemaName}.schema.json`);
    const schema = JSON.parse(await readFile(schemaPath, "utf8")) as { $schema?: unknown; type?: unknown };
    if (typeof schema.$schema !== "string" || schema.type !== "object") {
      throw new PdlcError("VALIDATION_FAILED", `Invalid JSON Schema metadata: ${schemaPath}`);
    }
  }
  checks.schemas = { ok: true, loaded: schemaNames };

  const { stages, journeys } = await loadDeliveryModel();
  const registry = await WorkflowRegistry.load(join(HARNESS_ROOT, "pdlc", "workflows"));
  const pocWorkflow = registry.get("poc");
  for (const workflow of registry.list()) {
    const journey = journeys.get(workflow.journeyId);
    if (journey.id !== workflow.id || journey.status !== "active") {
      throw new PdlcError("VALIDATION_FAILED", `Executable workflow ${workflow.id} must reference its active User Journey`);
    }
  }
  checks.workflows = { ok: true, loaded: registry.list().map((workflow) => workflow.id) };
  checks.deliveryModel = {
    ok: true,
    catalogVersion: stages.catalog.catalogVersion,
    canonicalStages: stages.list().length,
    journeys: journeys.list().map((journey) => ({
      id: journey.id,
      status: journey.status,
      stageCount: journey.stageSequence.length,
    })),
  };

  const packs = await loadPrinciplePacks(join(HARNESS_ROOT, "pdlc", "principles"));
  checks.principles = { ok: true, loaded: packs.map((pack) => `${pack.id}@${pack.version}`) };
  checks.principleStageMapping = {
    ok: true,
    source: "Principle Pack appliesTo.stages",
    stages: stages.list().map((stage) => ({
      stageId: stage.id,
      principlePacks: packs
        .filter((pack) => pack.appliesTo.stages.includes(stage.id))
        .map((pack) => `${pack.id}@${pack.version}`),
    })),
  };

  const requirementsPolicy = await loadRequirementsPolicy(join(HARNESS_ROOT, "pdlc", "workflows", "poc", "requirements-policy.json"));
  checks.requirementsPolicy = { ok: true, loaded: `${requirementsPolicy.id}@${requirementsPolicy.version}` };

  const standardProfiles = [
    ...await loadStandardProfiles(join(HARNESS_ROOT, "pdlc", "defaults", "harness"), "harness"),
    ...await loadStandardProfiles(join(options.root, ".pdlc", "project", "standards"), "project"),
  ];
  const referenceIssues = unknownStageReferences(stages, [
    ...packs.map((pack) => ({ source: `principle:${pack.id}@${pack.version}`, stageIds: pack.appliesTo.stages })),
    ...standardProfiles.map((profile) => ({ source: `${profile.layer}:${profile.id}@${profile.version}`, stageIds: profile.appliesTo.stages })),
  ]);
  if (referenceIssues.length > 0) {
    throw new PdlcError("VALIDATION_FAILED", "Principles or standards reference unknown canonical Stages", referenceIssues);
  }
  checks.standardProfiles = {
    ok: true,
    loaded: standardProfiles.map((profile) => `${profile.layer}:${profile.id}@${profile.version}`),
  };

  const portability = await validateCorePortability(join(HARNESS_ROOT, "pdlc", "core"));
  checks.portability = portability;
  if (!portability.ok) throw new PdlcError("PORTABILITY_VIOLATION", "Shared Core contains platform-specific content", portability.issues);

  const entrypoints = await validateConversationEntrypoints(HARNESS_ROOT);
  checks.entrypoints = entrypoints;
  if (!entrypoints.ok) throw new PdlcError("PORTABILITY_VIOLATION", "Conversational entrypoints are missing or have drifted", entrypoints.issues);

  const recordSource = options.record
    ? (isAbsolute(options.record) || options.record.endsWith(".json")
      ? resolve(options.root, options.record)
      : new FileStateStore(options.root).recordPath(options.record))
    : join(HARNESS_ROOT, "pdlc", "examples", "poc-delivery-record.json");
  const recordValidation = validatePocDeliveryRecord(JSON.parse(await readFile(recordSource, "utf8")) as unknown);
  checks.record = { ok: recordValidation.ok, source: recordSource, issues: recordValidation.issues };
  if (!recordValidation.ok) throw new PdlcError("VALIDATION_FAILED", `Invalid Delivery Record: ${recordSource}`, recordValidation.issues);

  const resolvedStages = journeys.resolve(pocWorkflow.journeyId, contextTags(recordValidation.value));
  const standardResolution = resolveStandardDefaultsForStages(packs, standardProfiles, {
    workflow: "poc",
    stages: resolvedStages.map((stage) => stage.definition.id),
    riskTriggers: recordValidation.value.risk.triggers,
    technologies: recordValidation.value.design.technologies,
    domains: recordValidation.value.design.domains,
  });
  checks.standardDefaults = {
    ok: standardResolution.issues.length === 0,
    resolved: standardResolution.defaults.map((standard) => ({
      key: standard.key,
      source: standard.sourceRef,
      locked: standard.locked,
    })),
    issues: standardResolution.issues,
  };
  if (standardResolution.issues.length > 0) {
    throw new PdlcError("VALIDATION_FAILED", "Standard defaults contain unresolved conflicts", standardResolution.issues);
  }

  return { ok: true, checks };
}

export async function runCli(args: string[], currentDirectory = process.cwd()): Promise<{ exitCode: number; output: unknown }> {
  try {
    const parsed = parseArguments(args, currentDirectory);
    if (!parsed.command || parsed.command === "help" || parsed.command === "--help") {
      return {
        exitCode: 0,
        output: {
          name: "Lean PDLC Runner",
          phase: 1,
          commands: [
            "status [--root <path>] [--record <POC-ID>]",
            "validate [--root <path>] [--record <POC-ID|path.json>]",
            "readiness build [--root <path>] [--record <POC-ID>] [--actor <identity>]",
            "guidance <stage> --plugin <path>",
            "plugin <name> [--root <target-project>]",
            "checkpoint <commit|verify|decide> (Phase 2)",
          ],
        },
      };
    }
    if (parsed.command === "status") return { exitCode: 0, output: await status(parsed.options) };
    if (parsed.command === "validate") return { exitCode: 0, output: await validate(parsed.options) };
    if (parsed.command === "readiness") return { exitCode: 0, output: await readiness(parsed.options, parsed.subcommand) };
    if (parsed.command === "guidance") return { exitCode: 0, output: await guidance(parsed.options, parsed.subcommand) };
    if (parsed.command === "plugin") return { exitCode: 0, output: await installPlugin(parsed.options, parsed.subcommand) };
    if (parsed.command === "checkpoint") {
      throw new PdlcError("CHECKPOINT_NOT_IMPLEMENTED", `Checkpoint '${parsed.subcommand ?? ""}' is defined for Phase 2 and cannot change state yet`);
    }
    throw new PdlcError("INVALID_ARGUMENT", `Unknown command: ${parsed.command}`);
  } catch (error) {
    if (error instanceof PdlcError) {
      return { exitCode: 2, output: { ok: false, error: { code: error.code, message: error.message, details: error.details } } };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, output: { ok: false, error: { code: "UNEXPECTED_ERROR", message } } };
  }
}

async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2));
  const destination = result.exitCode === 0 ? process.stdout : process.stderr;
  destination.write(`${JSON.stringify(result.output, null, 2)}\n`);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
