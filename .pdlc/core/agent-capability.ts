import { sha256 } from "./hash.ts";

export interface AgentInvocationIdentity {
  ref: string;
  capability: string;
  agent: string;
  skills: string[];
}

export function agentInvocationId(contextHash: string, identity: AgentInvocationIdentity): string {
  return sha256({
    schemaVersion: 1,
    contextHash,
    ref: identity.ref,
    capability: identity.capability,
    agent: identity.agent,
    skills: [...identity.skills].sort(),
  });
}
