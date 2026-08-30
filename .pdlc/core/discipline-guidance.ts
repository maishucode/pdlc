import { stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { PdlcError, type PdlcErrorCode } from "./errors.ts";
import type { DisciplineRegistry } from "./discipline-registry.ts";
import type { DeliveryFlowRegistry } from "./delivery-flow-registry.ts";
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
  const seenCapabilities = new Set<string>();
  for (const discipline of disciplines.list()) {
    const seenStages = new Set<string>();
    for (const { descriptor } of discipline.hooks) {
      const bindings = await validateBindings(discipline.root, descriptor, seenStages, seenCapabilities, stages);
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
        capability: binding.capability,
        invocation: binding.invocation,
        agent: {
          id: binding.agent,
          path: relative(harnessRoot, disciplineAgentPath(root, binding.agent)),
        },
        candidateSkills: binding.candidateSkills.map((skill) => ({
          name: skill,
          path: relative(harnessRoot, disciplineSkillPath(root, skill)),
        })),
        mode: binding.mode,
        handoff: binding.handoff,
        approvalBoundary: binding.approvalBoundary,
      })));

  return { deliveryFlow, stage, contributions };
}

export async function validateDisciplineCapabilityGates(
  stages: StageRegistry,
  disciplines: DisciplineRegistry,
  deliveryFlows: DeliveryFlowRegistry,
): Promise<void> {
  const hooks = await discoverDisciplineHooks(stages, disciplines);
  for (const { descriptor, bindings } of hooks) {
    if (!descriptor.enabled) continue;
    for (const flowId of descriptor.deliveryFlows) {
      const flow = deliveryFlows.get(flowId);
      if (flow.status !== "active") continue;
      const flowStages = new Set(flow.stageSequence.map(({ stageId }) => stageId));
      for (const binding of bindings) {
        if (!flowStages.has(binding.stage)) {
          throw new PdlcError("INVALID_DISCIPLINE_HOOK", `Capability ${binding.capability} binds Stage ${binding.stage}, which is not part of Delivery Flow ${flow.id}`);
        }
        if (flow.runtime?.executor) continue;
        const gated = flow.controls?.checkpoints.some(({ contextStages }) => contextStages?.includes(binding.stage));
        if (!gated) {
          throw new PdlcError("UNGATED_AGENT_CAPABILITY", `Configuration-only Flow ${flow.id} does not gate required Capability ${binding.capability}`, [{
            code: "UNGATED_AGENT_CAPABILITY",
            path: `$.controls.checkpoints`,
            message: `At least one checkpoint must include contextStages '${binding.stage}'`,
          }]);
        }
      }
    }
  }
}

async function validateBindings(
  root: string,
  descriptor: DisciplineStageHooksDescriptor,
  seenStages: Set<string>,
  seenCapabilities: Set<string>,
  stages: StageRegistry,
): Promise<DisciplineStageHookBinding[]> {
  for (const binding of descriptor.bindings) {
    stages.get(binding.stage);
    if (seenStages.has(binding.stage)) {
      throw new PdlcError("DUPLICATE_DISCIPLINE_STAGE_HOOK", `Discipline '${descriptor.discipline}' defines more than one Hook for Stage: ${binding.stage}`);
    }
    seenStages.add(binding.stage);
    if (descriptor.enabled && seenCapabilities.has(binding.capability)) {
      throw new PdlcError("DUPLICATE_AGENT_CAPABILITY", `Agent capability id is bound more than once: ${binding.capability}`);
    }
    if (descriptor.enabled) seenCapabilities.add(binding.capability);
    if (!NAME_PATTERN.test(binding.capability)) throw new PdlcError("INVALID_AGENT_CAPABILITY", `Invalid Agent capability id: ${binding.capability}`);
    if (binding.invocation !== "required") throw new PdlcError("INVALID_DISCIPLINE_HOOK", `Unsupported Agent invocation policy: ${binding.invocation}`);
    if (!NAME_PATTERN.test(binding.agent)) throw new PdlcError("INVALID_DISCIPLINE_AGENT", `Invalid Discipline Agent id: ${binding.agent}`);
    if (binding.candidateSkills.length === 0 || !binding.candidateSkills.every((skill) => NAME_PATTERN.test(skill)) || new Set(binding.candidateSkills).size !== binding.candidateSkills.length) {
      throw new PdlcError("INVALID_DISCIPLINE_HOOK", "Discipline Hook candidate Skills must be unique kebab-case identifiers");
    }
    if (!DISCIPLINE_GUIDANCE_MODES.includes(binding.mode)) throw new PdlcError("INVALID_DISCIPLINE_HOOK", `Unsupported Discipline guidance mode: ${binding.mode}`);
    await requireFile(disciplineAgentPath(root, binding.agent), "DISCIPLINE_AGENT_NOT_FOUND", `Discipline Agent '${binding.agent}'`);
    for (const skill of binding.candidateSkills) await requireFile(disciplineSkillPath(root, skill), "DISCIPLINE_SKILL_NOT_FOUND", `Discipline Skill '${skill}'`);
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
