import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { PdlcError } from "./errors.ts";
import { StageRegistry } from "./stage-registry.ts";
import {
  PLUGIN_GUIDANCE_MODES,
  type PluginGuidanceResolution,
  type PluginStageBinding,
  type PluginStageBindingsDescriptor,
} from "./types.ts";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type JsonObject = Record<string, unknown>;

export async function resolvePluginGuidance(
  stages: StageRegistry,
  pluginRoot: string,
  requestedStage: string,
): Promise<PluginGuidanceResolution> {
  await requirePluginRoot(pluginRoot);

  const manifest = await readJson(join(pluginRoot, "plugin.json"), "PLUGIN_MANIFEST_NOT_FOUND", "plugin manifest");
  const pluginName = requirePluginName(manifest, "plugin manifest");
  const descriptor = await readDescriptor(pluginRoot, pluginName);
  const bindings = validateBindings(descriptor.bindings, stages);

  for (const binding of bindings) {
    for (const skill of binding.skills) {
      await requireAsset(join(pluginRoot, "skills", skill, "SKILL.md"), "PLUGIN_SKILL_NOT_FOUND", `plugin skill '${skill}'`);
    }
  }

  const stage = stages.get(requestedStage);
  const binding = bindings.find((candidate) => candidate.stage === stage.id);
  if (!binding) {
    throw new PdlcError("PLUGIN_STAGE_UNBOUND", `Plugin '${pluginName}' does not provide guidance for Stage: ${stage.id}`);
  }

  return {
    stage,
    guidance: {
      plugin: pluginName,
      agent: binding.agent,
      skills: binding.skills,
      mode: binding.mode,
      handoff: binding.handoff,
      approvalBoundary: binding.approvalBoundary,
    },
  };
}

async function requirePluginRoot(pluginRoot: string): Promise<void> {
  try {
    if (!(await stat(pluginRoot)).isDirectory()) {
      throw new PdlcError("PLUGIN_ROOT_NOT_FOUND", `Plugin root is not a directory: ${pluginRoot}`);
    }
  } catch (error) {
    if (error instanceof PdlcError) throw error;
    throw new PdlcError("PLUGIN_ROOT_NOT_FOUND", `Plugin root not found: ${pluginRoot}`);
  }
}

async function readDescriptor(pluginRoot: string, pluginName: string): Promise<PluginStageBindingsDescriptor> {
  const raw = await readJson(
    join(pluginRoot, "pdlc-stage-bindings.json"),
    "PLUGIN_DESCRIPTOR_NOT_FOUND",
    "plugin Stage bindings descriptor",
  );
  const descriptor = asObject(raw, "Plugin Stage bindings descriptor must be an object");
  requireExactKeys(descriptor, ["schemaVersion", "plugin", "bindings"]);
  if (descriptor.schemaVersion !== 1) {
    throw new PdlcError("UNSUPPORTED_PLUGIN_BINDINGS_SCHEMA", "Plugin Stage bindings descriptor must use schemaVersion 1");
  }
  if (typeof descriptor.plugin !== "string" || descriptor.plugin.trim().length === 0 || !Array.isArray(descriptor.bindings)) {
    throw new PdlcError("INVALID_PLUGIN_BINDINGS_DESCRIPTOR", "Plugin Stage bindings descriptor requires a plugin name and bindings array");
  }
  if (descriptor.plugin !== pluginName) {
    throw new PdlcError("PLUGIN_NAME_MISMATCH", `Plugin manifest name '${pluginName}' does not match descriptor plugin '${descriptor.plugin}'`);
  }
  return {
    schemaVersion: 1,
    plugin: descriptor.plugin,
    bindings: descriptor.bindings as PluginStageBinding[],
  };
}

function validateBindings(bindings: PluginStageBinding[], stages: StageRegistry): PluginStageBinding[] {
  const validated: PluginStageBinding[] = [];
  const seenStages = new Set<string>();

  for (const candidate of bindings) {
    const binding = asBindingObject(candidate);
    requireBindingKeys(binding);
    if (!isNonEmptyString(binding.stage)) {
      throw new PdlcError("INVALID_PLUGIN_BINDING", "Plugin Stage binding requires a non-empty stage");
    }
    stages.get(binding.stage);
    if (seenStages.has(binding.stage)) {
      throw new PdlcError("DUPLICATE_PLUGIN_STAGE_BINDING", `Plugin defines more than one binding for Stage: ${binding.stage}`);
    }
    seenStages.add(binding.stage);
    if (!isAgentId(binding.agent)) {
      throw new PdlcError("INVALID_PLUGIN_AGENT", "Plugin Stage binding requires a kebab-case agent id");
    }
    if (!Array.isArray(binding.skills) || binding.skills.length === 0 || !binding.skills.every(isSkillName) || new Set(binding.skills).size !== binding.skills.length) {
      throw new PdlcError("INVALID_PLUGIN_BINDING", "Plugin Stage binding requires unique, non-empty skill names");
    }
    if (!PLUGIN_GUIDANCE_MODES.includes(binding.mode as never)) {
      throw new PdlcError("INVALID_PLUGIN_BINDING", "Plugin Stage binding mode must be draft, implement, or verify");
    }
    if (!isNonEmptyString(binding.handoff) || !isNonEmptyString(binding.approvalBoundary)) {
      throw new PdlcError("INVALID_PLUGIN_BINDING", "Plugin Stage binding requires a handoff and approval boundary");
    }
    validated.push({
      stage: binding.stage,
      agent: binding.agent,
      skills: binding.skills,
      mode: binding.mode as PluginStageBinding["mode"],
      handoff: binding.handoff,
      approvalBoundary: binding.approvalBoundary,
    });
  }

  return validated;
}

async function readJson(path: string, missingCode: "PLUGIN_MANIFEST_NOT_FOUND" | "PLUGIN_DESCRIPTOR_NOT_FOUND", label: string): Promise<unknown> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    throw new PdlcError(missingCode, `${label} not found: ${path}`);
  }
  try {
    return JSON.parse(contents) as unknown;
  } catch {
    throw new PdlcError("INVALID_PLUGIN_BINDINGS_DESCRIPTOR", `Invalid JSON in ${label}: ${path}`);
  }
}

async function requireAsset(path: string, code: "PLUGIN_SKILL_NOT_FOUND", label: string): Promise<void> {
  try {
    if (!(await stat(path)).isFile()) {
      throw new PdlcError(code, `${label} not found: ${path}`);
    }
  } catch (error) {
    if (error instanceof PdlcError) throw error;
    throw new PdlcError(code, `${label} not found: ${path}`);
  }
}

function requirePluginName(value: unknown, label: string): string {
  const manifest = asObject(value, `${label} must be an object`);
  if (!isNonEmptyString(manifest.name)) {
    throw new PdlcError("INVALID_PLUGIN_BINDINGS_DESCRIPTOR", `${label} requires a non-empty name`);
  }
  return manifest.name;
}

function asObject(value: unknown, message: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PdlcError("INVALID_PLUGIN_BINDINGS_DESCRIPTOR", message);
  }
  return value as JsonObject;
}

function requireExactKeys(value: JsonObject, expected: string[], label = "descriptor"): void {
  const hasExpectedKeys = expected.every((key) => key in value);
  const hasOnlyExpectedKeys = Object.keys(value).every((key) => expected.includes(key));
  if (!hasExpectedKeys || !hasOnlyExpectedKeys) {
    throw new PdlcError("INVALID_PLUGIN_BINDINGS_DESCRIPTOR", `Plugin ${label} has unsupported or missing fields`);
  }
}

function requireBindingKeys(binding: JsonObject): void {
  const expected = ["stage", "agent", "skills", "mode", "handoff", "approvalBoundary"];
  const hasExpectedKeys = expected.every((key) => key in binding);
  const hasOnlyExpectedKeys = Object.keys(binding).every((key) => expected.includes(key));
  if (!hasExpectedKeys || !hasOnlyExpectedKeys) {
    throw new PdlcError("INVALID_PLUGIN_BINDING", "Plugin Stage binding has unsupported or missing fields");
  }
}

function asBindingObject(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PdlcError("INVALID_PLUGIN_BINDING", "Plugin Stage binding must be an object");
  }
  return value as JsonObject;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSkillName(value: unknown): value is string {
  return isNonEmptyString(value) && SKILL_NAME_PATTERN.test(value);
}

function isAgentId(value: unknown): value is string {
  return isNonEmptyString(value) && SKILL_NAME_PATTERN.test(value);
}
