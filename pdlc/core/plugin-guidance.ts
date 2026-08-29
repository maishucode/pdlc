import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { PdlcError } from "./errors.ts";
import { validatePluginStageBindings } from "./schema.ts";
import type { DomainRegistry } from "./domain-registry.ts";
import type { StageRegistry } from "./stage-registry.ts";
import {
  PLUGIN_GUIDANCE_MODES,
  type DiscoveredPlugin,
  type PluginGuidanceResolution,
  type PluginManifest,
  type PluginStageBinding,
  type PluginStageBindingsDescriptor,
} from "./types.ts";

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function discoverPlugins(stages: StageRegistry, domains: DomainRegistry): Promise<DiscoveredPlugin[]> {
  const plugins: DiscoveredPlugin[] = [];
  for (const { manifest, root } of domains.plugins().sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))) {
    const descriptor = await readDescriptor(root, manifest);
    const bindings = await validateBindings(root, manifest, descriptor.bindings, stages);
    plugins.push({ manifest, root, bindings });
  }
  return plugins;
}

export async function resolvePluginGuidance(
  stages: StageRegistry,
  domains: DomainRegistry,
  harnessRoot: string,
  requestedStage: string,
  deliveryFlow = "poc",
): Promise<PluginGuidanceResolution> {
  const stage = stages.get(requestedStage);
  const plugins = await discoverPlugins(stages, domains);
  const contributions = plugins
    .filter(({ manifest }) => manifest.defaultEnabled && manifest.deliveryFlows.includes(deliveryFlow))
    .flatMap(({ manifest, root, bindings }) => bindings
      .filter((binding) => binding.stage === stage.id)
      .map((binding) => ({
        plugin: manifest.id,
        ownerDomain: manifest.ownerDomain,
        version: manifest.version,
        permissions: manifest.permissions,
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

  return { deliveryFlow, stage, contributions };
}

async function readDescriptor(root: string, manifest: PluginManifest): Promise<PluginStageBindingsDescriptor> {
  const path = join(root, manifest.contributes.stageBindings);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new PdlcError("PLUGIN_DESCRIPTOR_NOT_FOUND", `Plugin Stage bindings descriptor not found or invalid: ${path}`);
  }
  const validation = validatePluginStageBindings(raw);
  if (!validation.ok) throw new PdlcError("INVALID_PLUGIN_BINDINGS_DESCRIPTOR", `Invalid Plugin Stage bindings: ${path}`, validation.issues);
  if (validation.value.plugin !== manifest.id) {
    throw new PdlcError("PLUGIN_ID_MISMATCH", `Plugin descriptor '${validation.value.plugin}' does not match manifest '${manifest.id}'`);
  }
  return validation.value as PluginStageBindingsDescriptor;
}

async function validateBindings(
  root: string,
  manifest: PluginManifest,
  bindings: PluginStageBinding[],
  stages: StageRegistry,
): Promise<PluginStageBinding[]> {
  const seenStages = new Set<string>();
  for (const binding of bindings) {
    stages.get(binding.stage);
    if (seenStages.has(binding.stage)) throw new PdlcError("DUPLICATE_PLUGIN_STAGE_BINDING", `Plugin defines more than one binding for Stage: ${binding.stage}`);
    seenStages.add(binding.stage);
    if (!isOwnedName(binding.agent, manifest.id)) throw new PdlcError("INVALID_PLUGIN_AGENT", `Plugin Agent must be prefixed '${manifest.id}-' or equal the Plugin id`);
    if (binding.skills.length === 0 || !binding.skills.every((skill) => isOwnedName(skill, manifest.id)) || new Set(binding.skills).size !== binding.skills.length) {
      throw new PdlcError("INVALID_PLUGIN_BINDING", `Plugin Skills must be unique and prefixed '${manifest.id}-'`);
    }
    if (!PLUGIN_GUIDANCE_MODES.includes(binding.mode)) throw new PdlcError("INVALID_PLUGIN_BINDING", `Unsupported Plugin mode: ${binding.mode}`);
    await requireFile(agentPath(root, manifest, binding.agent), "PLUGIN_AGENT_NOT_FOUND", `Plugin Agent '${binding.agent}'`);
    for (const skill of binding.skills) await requireFile(skillPath(root, manifest, skill), "PLUGIN_SKILL_NOT_FOUND", `Plugin Skill '${skill}'`);
  }
  return bindings;
}

export function agentPath(root: string, manifest: PluginManifest, agent: string): string {
  return join(root, manifest.contributes.agents, `${agent}.agent.md`);
}

export function skillPath(root: string, manifest: PluginManifest, skill: string): string {
  return join(root, manifest.contributes.skills, skill, "SKILL.md");
}

async function requireFile(path: string, code: string, label: string): Promise<void> {
  try {
    if (!(await stat(path)).isFile()) throw new Error("not a file");
  } catch {
    throw new PdlcError(code, `${label} not found: ${path}`);
  }
}

function isOwnedName(value: string, plugin: string): boolean {
  return NAME_PATTERN.test(value) && (value === plugin || value.startsWith(`${plugin}-`));
}
