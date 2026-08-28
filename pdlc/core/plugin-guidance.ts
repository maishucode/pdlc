import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { PdlcError } from "./errors.ts";
import { StageRegistry } from "./stage-registry.ts";
import {
  PLUGIN_GUIDANCE_MODES,
  type DiscoveredPlugin,
  type PluginGuidanceResolution,
  type PluginManifest,
  type PluginStageBinding,
  type PluginStageBindingsDescriptor,
} from "./types.ts";

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
type JsonObject = Record<string, unknown>;

export async function discoverPlugins(stages: StageRegistry, pluginsRoot: string): Promise<DiscoveredPlugin[]> {
  let entries;
  try {
    entries = await readdir(pluginsRoot, { withFileTypes: true });
  } catch {
    throw new PdlcError("PLUGIN_ROOT_NOT_FOUND", `Plugins root not found: ${pluginsRoot}`);
  }

  const plugins: DiscoveredPlugin[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const root = join(pluginsRoot, entry.name);
    const manifest = await readManifest(root, entry.name);
    const descriptor = await readDescriptor(root, manifest);
    const bindings = await validateBindings(root, manifest, descriptor.bindings, stages);
    plugins.push({ manifest, root, bindings });
  }
  return plugins;
}

export async function resolvePluginGuidance(
  stages: StageRegistry,
  pluginsRoot: string,
  requestedStage: string,
): Promise<PluginGuidanceResolution> {
  const stage = stages.get(requestedStage);
  const harnessRoot = dirname(pluginsRoot);
  const plugins = await discoverPlugins(stages, pluginsRoot);
  const contributions = plugins
    .filter(({ manifest }) => manifest.pdlc.defaultEnabled && manifest.pdlc.workflows.includes("poc"))
    .flatMap(({ manifest, root, bindings }) => bindings
      .filter((binding) => binding.stage === stage.id)
      .map((binding) => ({
        plugin: manifest.name,
        version: manifest.version,
        agent: {
          id: binding.agent,
          path: relative(harnessRoot, agentPath(root, manifest, binding.agent)),
        },
        skills: binding.skills.map((skill) => ({
          name: skill,
          path: relative(harnessRoot, skillPath(root, manifest, skill)),
        })),
        mode: binding.mode,
        handoff: binding.handoff,
        approvalBoundary: binding.approvalBoundary,
      })));

  return { workflow: "poc", stage, contributions };
}

async function readManifest(root: string, directoryName: string): Promise<PluginManifest> {
  const raw = asObject(await readJson(join(root, "plugin.json"), "PLUGIN_MANIFEST_NOT_FOUND", "plugin manifest"), "Plugin manifest must be an object");
  requireExactKeys(raw, ["schemaVersion", "name", "version", "description", "pdlc"], "manifest");
  if (raw.schemaVersion !== 1 || !isName(raw.name) || raw.name !== directoryName || !isNonEmptyString(raw.version) || !isNonEmptyString(raw.description)) {
    throw new PdlcError("INVALID_PLUGIN_MANIFEST", "Plugin manifest requires schemaVersion 1, a directory-matching kebab-case name, version, and description");
  }
  const pdlc = asObject(raw.pdlc, "Plugin manifest pdlc must be an object");
  requireExactKeys(pdlc, ["workflows", "defaultEnabled", "contributes"], "manifest pdlc block");
  if (!Array.isArray(pdlc.workflows) || pdlc.workflows.length !== 1 || pdlc.workflows[0] !== "poc" || typeof pdlc.defaultEnabled !== "boolean") {
    throw new PdlcError("INVALID_PLUGIN_MANIFEST", "Phase 1 Plugins must declare workflows: ['poc'] and defaultEnabled");
  }
  const contributes = asObject(pdlc.contributes, "Plugin manifest contributes must be an object");
  requireExactKeys(contributes, ["stageBindings", "agents", "skills"], "manifest contributes block");
  for (const key of ["stageBindings", "agents", "skills"] as const) {
    if (!isSafeRelativePath(contributes[key])) throw new PdlcError("INVALID_PLUGIN_MANIFEST", `Plugin contribution path must stay inside the Plugin: ${key}`);
  }
  return raw as unknown as PluginManifest;
}

async function readDescriptor(root: string, manifest: PluginManifest): Promise<PluginStageBindingsDescriptor> {
  const raw = asObject(
    await readJson(join(root, manifest.pdlc.contributes.stageBindings), "PLUGIN_DESCRIPTOR_NOT_FOUND", "plugin Stage bindings descriptor"),
    "Plugin Stage bindings descriptor must be an object",
  );
  requireExactKeys(raw, ["schemaVersion", "plugin", "bindings"]);
  if (raw.schemaVersion !== 1 || raw.plugin !== manifest.name || !Array.isArray(raw.bindings)) {
    throw new PdlcError("INVALID_PLUGIN_BINDINGS_DESCRIPTOR", "Plugin Stage bindings require schemaVersion 1, the manifest Plugin name, and a bindings array");
  }
  return raw as unknown as PluginStageBindingsDescriptor;
}

async function validateBindings(
  root: string,
  manifest: PluginManifest,
  bindings: PluginStageBinding[],
  stages: StageRegistry,
): Promise<PluginStageBinding[]> {
  const validated: PluginStageBinding[] = [];
  const seenStages = new Set<string>();
  for (const candidate of bindings) {
    const binding = asObject(candidate, "Plugin Stage binding must be an object");
    requireExactKeys(binding, ["stage", "agent", "skills", "mode", "handoff", "approvalBoundary"], "binding");
    if (!isNonEmptyString(binding.stage)) throw new PdlcError("INVALID_PLUGIN_BINDING", "Plugin Stage binding requires a Stage");
    stages.get(binding.stage);
    if (seenStages.has(binding.stage)) throw new PdlcError("DUPLICATE_PLUGIN_STAGE_BINDING", `Plugin defines more than one binding for Stage: ${binding.stage}`);
    seenStages.add(binding.stage);
    if (!isOwnedName(binding.agent, manifest.name)) throw new PdlcError("INVALID_PLUGIN_AGENT", `Plugin Agent must be prefixed '${manifest.name}-' or equal the Plugin name`);
    if (!Array.isArray(binding.skills) || binding.skills.length === 0 || !binding.skills.every((skill) => isOwnedName(skill, manifest.name)) || new Set(binding.skills).size !== binding.skills.length) {
      throw new PdlcError("INVALID_PLUGIN_BINDING", `Plugin Skills must be unique and prefixed '${manifest.name}-'`);
    }
    if (!PLUGIN_GUIDANCE_MODES.includes(binding.mode as never) || !isNonEmptyString(binding.handoff) || !isNonEmptyString(binding.approvalBoundary)) {
      throw new PdlcError("INVALID_PLUGIN_BINDING", "Plugin Stage binding requires a supported mode, handoff, and approval boundary");
    }
    await requireFile(agentPath(root, manifest, binding.agent), "PLUGIN_AGENT_NOT_FOUND", `plugin Agent '${binding.agent}'`);
    for (const skill of binding.skills) await requireFile(skillPath(root, manifest, skill), "PLUGIN_SKILL_NOT_FOUND", `plugin Skill '${skill}'`);
    validated.push(binding as unknown as PluginStageBinding);
  }
  return validated;
}

export function agentPath(root: string, manifest: PluginManifest, agent: string): string {
  return join(root, manifest.pdlc.contributes.agents, `${agent}.agent.md`);
}

export function skillPath(root: string, manifest: PluginManifest, skill: string): string {
  return join(root, manifest.pdlc.contributes.skills, skill, "SKILL.md");
}

async function requireFile(path: string, code: string, label: string): Promise<void> {
  try {
    if (!(await stat(path)).isFile()) throw new Error("not a file");
  } catch {
    throw new PdlcError(code, `${label} not found: ${path}`);
  }
}

async function readJson(path: string, missingCode: string, label: string): Promise<unknown> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    throw new PdlcError(missingCode, `${label} not found: ${path}`);
  }
  try {
    return JSON.parse(contents) as unknown;
  } catch {
    throw new PdlcError("INVALID_PLUGIN_MANIFEST", `Invalid JSON in ${label}: ${path}`);
  }
}

function asObject(value: unknown, message: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new PdlcError("INVALID_PLUGIN_MANIFEST", message);
  return value as JsonObject;
}

function requireExactKeys(value: JsonObject, expected: string[], label = "descriptor"): void {
  if (!expected.every((key) => key in value) || !Object.keys(value).every((key) => expected.includes(key))) {
    throw new PdlcError("INVALID_PLUGIN_MANIFEST", `Plugin ${label} has unsupported or missing fields`);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isName(value: unknown): value is string {
  return isNonEmptyString(value) && NAME_PATTERN.test(value);
}

function isOwnedName(value: unknown, plugin: string): value is string {
  return isName(value) && (value === plugin || value.startsWith(`${plugin}-`));
}

function isSafeRelativePath(value: unknown): value is string {
  return isNonEmptyString(value) && !value.startsWith("/") && !value.split(/[\\/]/).includes("..");
}
