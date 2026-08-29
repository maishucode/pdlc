import { agentInvocationId } from "../core/agent-capability.ts";
import type { DomainGuidanceContribution } from "../core/types.ts";

export interface RequiredAgentInvocationContract {
  invocationId: string;
  capability: string;
  invocation: "required";
  platform: "github-copilot";
  tool: "agent";
  agent: DomainGuidanceContribution["agent"];
  skills: DomainGuidanceContribution["skills"];
  mode: DomainGuidanceContribution["mode"];
  handoff: string;
  approvalBoundary: string;
}

export function buildRequiredAgentInvocations(
  contextHash: string,
  contributions: DomainGuidanceContribution[],
): RequiredAgentInvocationContract[] {
  return contributions.map((contribution) => {
    const ref = `${contribution.domain}@${contribution.version}:${contribution.agent.id}`;
    return {
      invocationId: agentInvocationId(contextHash, {
        ref,
        capability: contribution.capability,
        agent: contribution.agent.id,
        skills: contribution.skills.map(({ name }) => name),
      }),
      capability: contribution.capability,
      invocation: contribution.invocation,
      platform: "github-copilot",
      tool: "agent",
      agent: contribution.agent,
      skills: contribution.skills,
      mode: contribution.mode,
      handoff: contribution.handoff,
      approvalBoundary: contribution.approvalBoundary,
    };
  }).sort((left, right) => left.capability.localeCompare(right.capability));
}
