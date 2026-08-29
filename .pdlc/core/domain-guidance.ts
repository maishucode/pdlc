import { stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { PdlcError } from "./errors.ts";
import type { DomainRegistry } from "./domain-registry.ts";
import type { StageRegistry } from "./stage-registry.ts";
import {
  DOMAIN_GUIDANCE_MODES,
  type DiscoveredDomainHooks,
  type DomainGuidanceResolution,
  type DomainStageHookBinding,
  type DomainStageHooksDescriptor,
} from "./types.ts";

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function discoverDomainHooks(stages: StageRegistry, domains: DomainRegistry): Promise<DiscoveredDomainHooks[]> {
  const discovered: DiscoveredDomainHooks[] = [];
  const seenCapabilities = new Set<string>();
  for (const domain of domains.list()) {
    const seenStages = new Set<string>();
    for (const { descriptor } of domain.hooks) {
      const bindings = await validateBindings(domain.root, descriptor, seenStages, seenCapabilities, stages);
      discovered.push({ domain: domain.manifest.id, descriptor, root: domain.root, bindings });
    }
  }
  return discovered.sort((left, right) => left.domain.localeCompare(right.domain));
}

export async function resolveDomainGuidance(
  stages: StageRegistry,
  domains: DomainRegistry,
  harnessRoot: string,
  requestedStage: string,
  deliveryFlow = "poc",
): Promise<DomainGuidanceResolution> {
  const stage = stages.get(requestedStage);
  const hooks = await discoverDomainHooks(stages, domains);
  const contributions = hooks
    .filter(({ descriptor }) => descriptor.enabled && descriptor.deliveryFlows.includes(deliveryFlow))
    .flatMap(({ domain, descriptor, root, bindings }) => bindings
      .filter((binding) => binding.stage === stage.id)
      .map((binding) => ({
        domain,
        version: descriptor.version,
        capability: binding.capability,
        invocation: binding.invocation,
        permissions: descriptor.permissions,
        agent: {
          id: binding.agent,
          path: relative(harnessRoot, domainAgentPath(root, binding.agent)),
        },
        skills: binding.skills.map((skill) => ({
          name: skill,
          path: relative(harnessRoot, domainSkillPath(root, skill)),
        })),
        mode: binding.mode,
        handoff: binding.handoff,
        approvalBoundary: binding.approvalBoundary,
      })));

  return { deliveryFlow, stage, contributions };
}

async function validateBindings(
  root: string,
  descriptor: DomainStageHooksDescriptor,
  seenStages: Set<string>,
  seenCapabilities: Set<string>,
  stages: StageRegistry,
): Promise<DomainStageHookBinding[]> {
  for (const binding of descriptor.bindings) {
    stages.get(binding.stage);
    if (seenStages.has(binding.stage)) {
      throw new PdlcError("DUPLICATE_DOMAIN_STAGE_HOOK", `Domain '${descriptor.domain}' defines more than one Hook for Stage: ${binding.stage}`);
    }
    seenStages.add(binding.stage);
    if (descriptor.enabled && seenCapabilities.has(binding.capability)) {
      throw new PdlcError("DUPLICATE_AGENT_CAPABILITY", `Agent capability id is bound more than once: ${binding.capability}`);
    }
    if (descriptor.enabled) seenCapabilities.add(binding.capability);
    if (!NAME_PATTERN.test(binding.capability)) throw new PdlcError("INVALID_AGENT_CAPABILITY", `Invalid Agent capability id: ${binding.capability}`);
    if (binding.invocation !== "required") throw new PdlcError("INVALID_DOMAIN_HOOK", `Unsupported Domain invocation policy: ${binding.invocation}`);
    if (!NAME_PATTERN.test(binding.agent)) throw new PdlcError("INVALID_DOMAIN_AGENT", `Invalid Domain Agent id: ${binding.agent}`);
    if (binding.skills.length === 0 || !binding.skills.every((skill) => NAME_PATTERN.test(skill)) || new Set(binding.skills).size !== binding.skills.length) {
      throw new PdlcError("INVALID_DOMAIN_HOOK", "Domain Hook Skills must be unique kebab-case identifiers");
    }
    if (!DOMAIN_GUIDANCE_MODES.includes(binding.mode)) throw new PdlcError("INVALID_DOMAIN_HOOK", `Unsupported Domain guidance mode: ${binding.mode}`);
    await requireFile(domainAgentPath(root, binding.agent), "DOMAIN_AGENT_NOT_FOUND", `Domain Agent '${binding.agent}'`);
    for (const skill of binding.skills) await requireFile(domainSkillPath(root, skill), "DOMAIN_SKILL_NOT_FOUND", `Domain Skill '${skill}'`);
  }
  return descriptor.bindings;
}

export function domainAgentPath(root: string, agent: string): string {
  return join(root, "agents", `${agent}.agent.md`);
}

export function domainSkillPath(root: string, skill: string): string {
  return join(root, "skills", skill, "SKILL.md");
}

async function requireFile(path: string, code: string, label: string): Promise<void> {
  try {
    if (!(await stat(path)).isFile()) throw new Error("not a file");
  } catch {
    throw new PdlcError(code, `${label} not found: ${path}`);
  }
}
