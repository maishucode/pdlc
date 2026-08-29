import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { sha256 } from "./hash.ts";
import { agentInvocationId } from "./agent-capability.ts";
import type { ProjectOverlay } from "./project-overlay.ts";
import type { ResolvedIntegration } from "./domain-resolver.ts";
import type {
  DomainGuidanceResolution,
  ExecutableDeliveryFlowDefinition,
  ResolvedControl,
  ResolvedKnowledge,
  ResolvedBaseline,
  ResolvedStandardDefault,
  StageDefinition,
  StageContextReceipt,
  ValidationIssue,
} from "./types.ts";

export interface HashedContextAsset {
  ref: string;
  hash: string;
}

export interface HashedDomainContribution extends HashedContextAsset {
  capability: string;
  invocation: "required";
  permissions: DomainGuidanceResolution["contributions"][number]["permissions"];
  agent: string;
  skills: string[];
}

export interface HashedIntegration extends HashedContextAsset {
  skills: string[];
}

export interface StageContextSnapshot {
  deliveryFlow: string;
  deliveryFlowDefinitionHash: string;
  activation: {
    riskTriggers: string[];
    technologies: string[];
    domains: string[];
  };
  stage: string;
  stageDefinitionHash: string;
  roles: HashedContextAsset[];
  policies: HashedContextAsset[];
  baselines: HashedContextAsset[];
  defaults: HashedContextAsset[];
  knowledge: HashedContextAsset[];
  domainContributions: HashedDomainContribution[];
  integrations: HashedIntegration[];
  contextHash: string;
}

export async function createStageContextSnapshot(input: {
  harnessRoot: string;
  projectRoot: string;
  deliveryFlow: string;
  deliveryFlowDefinition: ExecutableDeliveryFlowDefinition;
  riskTriggers: string[];
  technologies: string[];
  domains: string[];
  stage: string;
  stageDefinition: StageDefinition;
  roles: Array<{ id: string; path: string }>;
  controls: ResolvedControl[];
  baselines: ResolvedBaseline[];
  defaults: ResolvedStandardDefault[];
  knowledge: ResolvedKnowledge[];
  project: ProjectOverlay;
  domainGuidance: DomainGuidanceResolution;
  integrations: ResolvedIntegration[];
}): Promise<StageContextSnapshot> {
  const policies = input.controls.map(({ ref, policy }) => ({ ref, hash: sha256(policy) })).sort(byRef);
  const roles = await Promise.all(input.roles.map(async ({ id, path }) => ({ ref: id, hash: sha256(await readFile(path, "utf8")) })));
  const baselines = input.baselines.map(({ ref, baseline }) => ({ ref, hash: sha256(baseline) })).sort(byRef);
  const defaults = input.defaults.map((entry) => ({ ref: `${entry.sourceRef}:${entry.key}`, hash: sha256(entry) })).sort(byRef);
  const domainKnowledge = await Promise.all(input.knowledge.map(async ({ ref, asset, contentPath }) => ({
    ref,
    hash: sha256({ metadata: asset, content: contentPath ? await readFile(contentPath, "utf8") : undefined }),
  })));
  const projectKnowledge = await Promise.all(input.project.knowledge().map(async ({ domain, path }) => ({
    ref: `project:${domain}:${relative(input.projectRoot, path)}`,
    hash: sha256(await readFile(path, "utf8")),
  })));
  const knowledge = [...domainKnowledge, ...projectKnowledge].sort(byRef);

  const domainContributions = await Promise.all(input.domainGuidance.contributions.map(async (contribution) => {
    const agentContent = await readFile(resolve(input.harnessRoot, contribution.agent.path), "utf8");
    const skillContents = await Promise.all(contribution.skills.map(async ({ name, path }) => ({
      name,
      content: await readFile(resolve(input.harnessRoot, path), "utf8"),
    })));
    return {
      ref: `${contribution.domain}@${contribution.version}:${contribution.agent.id}`,
      capability: contribution.capability,
      invocation: contribution.invocation,
      permissions: contribution.permissions,
      agent: contribution.agent.id,
      skills: contribution.skills.map(({ name }) => name).sort(),
      hash: sha256({ capability: contribution.capability, invocation: contribution.invocation, permissions: contribution.permissions, agentContent, skillContents, mode: contribution.mode, handoff: contribution.handoff, approvalBoundary: contribution.approvalBoundary }),
    };
  }));

  const integrations = await Promise.all(input.integrations.map(async (integration) => ({
    ref: integration.ref,
    skills: integration.skills.map(({ id }) => id).sort(),
    hash: sha256({
      manifest: await readFile(join(integration.root, "integration.json"), "utf8"),
      skills: await Promise.all(integration.skills.map(async ({ id, path }) => ({ id, content: await readFile(path, "utf8") }))),
    }),
  })));

  const material = {
    deliveryFlow: input.deliveryFlow,
    deliveryFlowDefinitionHash: sha256(input.deliveryFlowDefinition),
    activation: {
      riskTriggers: [...new Set(input.riskTriggers)].sort(),
      technologies: [...new Set(input.technologies)].sort(),
      domains: [...new Set(input.domains)].sort(),
    },
    stage: input.stage,
    stageDefinitionHash: sha256(input.stageDefinition),
    roles: roles.sort(byRef),
    policies,
    baselines,
    defaults,
    knowledge,
    domainContributions: domainContributions.sort(byRef),
    integrations: integrations.sort(byRef),
  };
  return { ...material, contextHash: sha256(material) };
}

export function validateReceiptAgainstSnapshot(receipt: StageContextReceipt, snapshot: StageContextSnapshot): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (receipt.stage !== snapshot.stage) issues.push({ code: "CONTEXT_STAGE_MISMATCH", path: "$.stage", message: `Expected Stage ${snapshot.stage}` });
  if (receipt.contextHash !== snapshot.contextHash) issues.push({ code: "STALE_CONTEXT_RECEIPT", path: "$.contextHash", message: "Stage context changed after the receipt was prepared" });
  compareRefs("policies", receipt.policies, snapshot.policies, issues);
  compareRefs("knowledge", receipt.knowledge, snapshot.knowledge, issues);
  compareRefs("domainContributions", receipt.domainContributions, snapshot.domainContributions, issues);
  compareRefs("integrations", receipt.integrations, snapshot.integrations, issues);

  const domains = new Map(snapshot.domainContributions.map((entry) => [entry.ref, entry]));
  receipt.domainContributions.forEach((entry, index) => {
    const expected = domains.get(entry.ref);
    if (!expected) return;
    if (entry.agent !== expected.agent) issues.push({ code: "CONTEXT_AGENT_MISMATCH", path: `$.domainContributions[${index}].agent`, message: `Expected Agent ${expected.agent}` });
    if (!sameStrings(entry.skills, expected.skills)) issues.push({ code: "CONTEXT_SKILLS_MISMATCH", path: `$.domainContributions[${index}].skills`, message: "Domain Skill set does not match the resolved Hook" });
    if (entry.capability !== expected.capability) issues.push({ code: "CONTEXT_CAPABILITY_MISMATCH", path: `$.domainContributions[${index}].capability`, message: `Expected capability ${expected.capability}` });
    if (entry.execution.permissions.filesystem !== expected.permissions.filesystem || entry.execution.permissions.network !== expected.permissions.network || entry.execution.permissions.externalWrites !== expected.permissions.externalWrites) {
      issues.push({ code: "CONTEXT_PERMISSION_MISMATCH", path: `$.domainContributions[${index}].execution.permissions`, message: "Agent execution permissions do not match the resolved Hook" });
    }
    const expectedInvocationId = agentInvocationId(snapshot.contextHash, expected);
    if (entry.execution.invocationId !== expectedInvocationId) issues.push({ code: "CONTEXT_INVOCATION_MISMATCH", path: `$.domainContributions[${index}].execution.invocationId`, message: "Agent invocation does not belong to the current Stage context" });
    if (!entry.execution.platformExecutionRef.startsWith(`github-copilot:agent:${expected.agent}:${expectedInvocationId}:`)) {
      issues.push({ code: "CONTEXT_EXECUTION_REF_MISMATCH", path: `$.domainContributions[${index}].execution.platformExecutionRef`, message: "Platform execution reference does not match the resolved Agent invocation" });
    }
  });
  const integrationMap = new Map(snapshot.integrations.map((entry) => [entry.ref, entry]));
  receipt.integrations.forEach((entry, index) => {
    const expected = integrationMap.get(entry.ref);
    if (expected && !sameStrings(entry.skills, expected.skills)) issues.push({ code: "CONTEXT_SKILLS_MISMATCH", path: `$.integrations[${index}].skills`, message: "Integration Skill set does not match the resolved Integration" });
  });
  return issues;
}

function compareRefs(
  field: "policies" | "knowledge" | "domainContributions" | "integrations",
  actual: Array<{ ref: string }>,
  expected: Array<{ ref: string }>,
  issues: ValidationIssue[],
): void {
  const actualRefs = actual.map(({ ref }) => ref).sort();
  const expectedRefs = expected.map(({ ref }) => ref).sort();
  if (!sameStrings(actualRefs, expectedRefs)) issues.push({
    code: "CONTEXT_ASSET_COVERAGE_MISMATCH",
    path: `$.${field}`,
    message: `Receipt must cover exactly the resolved ${field}: expected ${expectedRefs.join(", ") || "none"}`,
  });
}

function sameStrings(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index]);
}

function byRef<T extends { ref: string }>(left: T, right: T): number {
  return left.ref.localeCompare(right.ref);
}
