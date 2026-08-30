import { stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { PdlcError, type PdlcErrorCode } from "./errors.ts";
import type { DisciplineRegistry } from "./discipline-registry.ts";
import type { StageRegistry } from "./stage-registry.ts";
import {
  DISCIPLINE_GUIDANCE_MODES,
  type DiscoveredDisciplineHooks,
  type DisciplineGuidanceResolution,
  type DisciplineStageHookBinding,
  type DisciplineStageHooksDescriptor,
} from "./types.ts";

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function discoverDisciplineHooks(stages: StageRegistry, disciplines: DisciplineRegistry): Promise<DiscoveredDisciplineHooks[]> {
  const discovered: DiscoveredDisciplineHooks[] = [];
  for (const discipline of disciplines.list()) {
    const seenStages = new Set<string>();
    for (const { descriptor } of discipline.hooks) {
      const bindings = await validateBindings(discipline.root, descriptor, seenStages, stages);
      discovered.push({ discipline: discipline.manifest.id, descriptor, root: discipline.root, bindings });
    }
  }
  return discovered.sort((left, right) => left.discipline.localeCompare(right.discipline));
}

export async function resolveDisciplineGuidance(
  stages: StageRegistry,
  disciplines: DisciplineRegistry,
  harnessRoot: string,
  requestedStage: string,
  deliveryFlow = "poc",
): Promise<DisciplineGuidanceResolution> {
  const stage = stages.get(requestedStage);
  const hooks = await discoverDisciplineHooks(stages, disciplines);
  const contributions = hooks
    .filter(({ descriptor }) => descriptor.enabled && descriptor.deliveryFlows.includes(deliveryFlow))
    .flatMap(({ discipline, descriptor, root, bindings }) => bindings
      .filter((binding) => binding.stage === stage.id)
      .map((binding) => ({
        discipline,
        version: descriptor.version,
        permissions: descriptor.permissions,
        agent: {
          id: binding.agent,
          path: relative(harnessRoot, disciplineAgentPath(root, binding.agent)),
        },
        skills: binding.skills.map((skill) => ({
          name: skill,
          path: relative(harnessRoot, disciplineSkillPath(root, skill)),
        })),
        mode: binding.mode,
        handoff: binding.handoff,
        approvalBoundary: binding.approvalBoundary,
      })));

  return { deliveryFlow, stage, contributions };
}

async function validateBindings(
  root: string,
  descriptor: DisciplineStageHooksDescriptor,
  seenStages: Set<string>,
  stages: StageRegistry,
): Promise<DisciplineStageHookBinding[]> {
  for (const binding of descriptor.bindings) {
    stages.get(binding.stage);
    if (seenStages.has(binding.stage)) {
      throw new PdlcError("DUPLICATE_DISCIPLINE_STAGE_HOOK", `Discipline '${descriptor.discipline}' defines more than one Hook for Stage: ${binding.stage}`);
    }
    seenStages.add(binding.stage);
    if (!NAME_PATTERN.test(binding.agent)) throw new PdlcError("INVALID_DISCIPLINE_AGENT", `Invalid Discipline Agent id: ${binding.agent}`);
    if (binding.skills.length === 0 || !binding.skills.every((skill) => NAME_PATTERN.test(skill)) || new Set(binding.skills).size !== binding.skills.length) {
      throw new PdlcError("INVALID_DISCIPLINE_HOOK", "Discipline Hook Skills must be unique kebab-case identifiers");
    }
    if (!DISCIPLINE_GUIDANCE_MODES.includes(binding.mode)) throw new PdlcError("INVALID_DISCIPLINE_HOOK", `Unsupported Discipline guidance mode: ${binding.mode}`);
    await requireFile(disciplineAgentPath(root, binding.agent), "DISCIPLINE_AGENT_NOT_FOUND", `Discipline Agent '${binding.agent}'`);
    for (const skill of binding.skills) await requireFile(disciplineSkillPath(root, skill), "DISCIPLINE_SKILL_NOT_FOUND", `Discipline Skill '${skill}'`);
  }
  return descriptor.bindings;
}

export function disciplineAgentPath(root: string, agent: string): string {
  return join(root, "agents", `${agent}.agent.md`);
}

export function disciplineSkillPath(root: string, skill: string): string {
  return join(root, "skills", skill, "SKILL.md");
}

async function requireFile(path: string, code: PdlcErrorCode, label: string): Promise<void> {
  try {
    if (!(await stat(path)).isFile()) throw new Error("not a file");
  } catch {
    throw new PdlcError(code, `${label} not found: ${path}`);
  }
}
