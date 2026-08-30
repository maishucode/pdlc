import { aggregateStageInvocationPermissions, stageAgentInvocationId } from "../core/stage-agent.ts";
import type { DisciplineGuidanceContribution } from "../core/types.ts";

export interface RequiredStageCapabilityContract {
  ref: string;
  capability: string;
  discipline: string;
  version: string;
  permissions: DisciplineGuidanceContribution["permissions"];
  agent: DisciplineGuidanceContribution["agent"];
  candidateSkills: DisciplineGuidanceContribution["candidateSkills"];
  mode: DisciplineGuidanceContribution["mode"];
  handoff: string;
  approvalBoundary: string;
}

export interface RequiredStageAgentInvocationContract {
  invocationId: string;
  stage: string;
  invocation: "required";
  platform: "github-copilot";
  tool: "task";
  executor: "generic-subagent";
  agentType: "general-purpose";
  permissions: DisciplineGuidanceContribution["permissions"];
  capabilities: RequiredStageCapabilityContract[];
}

export function buildRequiredStageInvocation(
  contextHash: string,
  stage: string,
  contributions: DisciplineGuidanceContribution[],
): RequiredStageAgentInvocationContract | undefined {
  if (contributions.length === 0) return undefined;
  const capabilities = contributions.map((contribution) => ({
    ref: `${contribution.discipline}@${contribution.version}:${contribution.capability}`,
    capability: contribution.capability,
    discipline: contribution.discipline,
    version: contribution.version,
    permissions: contribution.permissions,
    agent: contribution.agent,
    candidateSkills: contribution.candidateSkills,
    mode: contribution.mode,
    handoff: contribution.handoff,
    approvalBoundary: contribution.approvalBoundary,
  })).sort((left, right) => left.capability.localeCompare(right.capability));
  return {
    invocationId: stageAgentInvocationId(contextHash, stage),
    stage,
    invocation: "required",
    platform: "github-copilot",
    tool: "task",
    executor: "generic-subagent",
    agentType: "general-purpose",
    permissions: aggregateStageInvocationPermissions(contributions),
    capabilities,
  };
}
