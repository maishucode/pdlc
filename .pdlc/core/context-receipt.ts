import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256 } from "./hash.ts";
import { aggregateStageInvocationPermissions, stageAgentInvocationId } from "./stage-agent.ts";
import type { ResolvedIntegration } from "./discipline-resolver.ts";
import type {
  DisciplineGuidanceResolution,
  ExecutableDeliveryFlowDefinition,
  ResolvedControl,
  ResolvedKnowledge,
  ResolvedBaseline,
  ResolvedStandardDefault,
  StageDefinition,
  StageContextReceipt,
  EvidenceRef,
  ValidationIssue,
} from "./types.ts";

export interface HashedContextAsset {
  ref: string;
  hash: string;
}

export interface HashedDisciplineContribution extends HashedContextAsset {
  capability: string;
  invocation: "required";
  permissions: DisciplineGuidanceResolution["contributions"][number]["permissions"];
  agent: string;
  candidateSkills: string[];
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
    disciplines: string[];
  };
  stage: string;
  stageDefinitionHash: string;
  roles: HashedContextAsset[];
  policies: HashedContextAsset[];
  baselines: HashedContextAsset[];
  defaults: HashedContextAsset[];
  knowledge: HashedContextAsset[];
  disciplineContributions: HashedDisciplineContribution[];
  integrations: HashedIntegration[];
  contextHash: string;
}

export function contextReceiptEvidenceEntries(receipt: StageContextReceipt): EvidenceRef[] {
  const refs = [...new Set([
    ...receipt.knowledge.flatMap((entry) => entry.evidenceRefs),
    ...receipt.disciplineContributions.flatMap((entry) => entry.evidenceRefs),
    ...receipt.integrations.flatMap((entry) => entry.evidenceRefs),
  ])];
  return refs.map((ref) => ({
    kind: /^https?:\/\//.test(ref) ? "url" : "file",
    ref,
    description: `Stage context evidence for ${receipt.stage}`,
  }));
}

export async function createStageContextSnapshot(input: {
  harnessRoot: string;
  deliveryFlow: string;
  deliveryFlowDefinition: ExecutableDeliveryFlowDefinition;
  riskTriggers: string[];
  technologies: string[];
  disciplines: string[];
  stage: string;
  stageDefinition: StageDefinition;
  roles: Array<{ id: string; path: string }>;
  controls: ResolvedControl[];
  baselines: ResolvedBaseline[];
  defaults: ResolvedStandardDefault[];
  knowledge: ResolvedKnowledge[];
  disciplineGuidance: DisciplineGuidanceResolution;
  integrations: ResolvedIntegration[];
}): Promise<StageContextSnapshot> {
  const policies = input.controls.map(({ ref, policy }) => ({ ref, hash: sha256(policy) })).sort(byRef);
  const roles = await Promise.all(input.roles.map(async ({ id, path }) => ({ ref: id, hash: sha256(await readFile(path, "utf8")) })));
  const baselines = input.baselines.map(({ ref, baseline }) => ({ ref, hash: sha256(baseline) })).sort(byRef);
  const defaults = input.defaults.map((entry) => ({ ref: `${entry.sourceRef}:${entry.key}`, hash: sha256(entry) })).sort(byRef);
  const knowledge = await Promise.all(input.knowledge.map(async ({ ref, asset, contentPath }) => ({
    ref,
    hash: sha256({ metadata: asset, content: contentPath ? await readFile(contentPath, "utf8") : undefined }),
  })));

  const disciplineContributions = await Promise.all(input.disciplineGuidance.contributions.map(async (contribution) => {
    const agentContent = await readFile(resolve(input.harnessRoot, contribution.agent.path), "utf8");
    const skillContents = await Promise.all(contribution.candidateSkills.map(async ({ name, path }) => ({
      name,
      content: await readFile(resolve(input.harnessRoot, path), "utf8"),
    })));
    return {
      ref: `${contribution.discipline}@${contribution.version}:${contribution.capability}`,
      capability: contribution.capability,
      invocation: contribution.invocation,
      permissions: contribution.permissions,
      agent: contribution.agent.id,
      candidateSkills: contribution.candidateSkills.map(({ name }) => name).sort(),
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
      disciplines: [...new Set(input.disciplines)].sort(),
    },
    stage: input.stage,
    stageDefinitionHash: sha256(input.stageDefinition),
    roles: roles.sort(byRef),
    policies,
    baselines,
    defaults,
    knowledge: knowledge.sort(byRef),
    disciplineContributions: disciplineContributions.sort(byRef),
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
  compareRefs("disciplineContributions", receipt.disciplineContributions, snapshot.disciplineContributions, issues);
  compareRefs("integrations", receipt.integrations, snapshot.integrations, issues);

  const disciplines = new Map(snapshot.disciplineContributions.map((entry) => [entry.ref, entry]));
  receipt.disciplineContributions.forEach((entry, index) => {
    const expected = disciplines.get(entry.ref);
    if (!expected) return;
    if (entry.agent !== expected.agent) issues.push({ code: "CONTEXT_AGENT_MISMATCH", path: `$.disciplineContributions[${index}].agent`, message: `Expected Agent ${expected.agent}` });
    if (entry.capability !== expected.capability) issues.push({ code: "CONTEXT_CAPABILITY_MISMATCH", path: `$.disciplineContributions[${index}].capability`, message: `Expected capability ${expected.capability}` });
    const invalidSkills = entry.selectedSkills.filter((skill) => !expected.candidateSkills.includes(skill));
    if (entry.selectedSkills.length === 0 || invalidSkills.length > 0) issues.push({
      code: "CONTEXT_SKILLS_MISMATCH",
      path: `$.disciplineContributions[${index}].selectedSkills`,
      message: invalidSkills.length > 0
        ? `Selected Skills are outside the resolved candidate set: ${invalidSkills.join(", ")}`
        : "A required Agent capability must select at least one candidate Skill",
    });
  });
  if (snapshot.disciplineContributions.length > 0) {
    const execution = receipt.stageInvocation;
    if (!execution) issues.push({ code: "CONTEXT_STAGE_INVOCATION_MISSING", path: "$.stageInvocation", message: "Required Stage capabilities must be executed by one generic subagent invocation" });
    else {
      const expectedInvocationId = stageAgentInvocationId(snapshot.contextHash, snapshot.stage);
      if (execution.invocationId !== expectedInvocationId) issues.push({ code: "CONTEXT_INVOCATION_MISMATCH", path: "$.stageInvocation.invocationId", message: "Stage Agent invocation does not belong to the current Stage context" });
      const expectedPermissions = aggregateStageInvocationPermissions(snapshot.disciplineContributions);
      if (execution.permissions.filesystem !== expectedPermissions.filesystem || execution.permissions.network !== expectedPermissions.network || execution.permissions.externalWrites !== expectedPermissions.externalWrites) {
        issues.push({ code: "CONTEXT_PERMISSION_MISMATCH", path: "$.stageInvocation.permissions", message: "Stage Agent permissions do not match the aggregate permissions of the required capabilities" });
      }
      if (execution.platform !== "github-copilot") issues.push({ code: "CONTEXT_PLATFORM_MISMATCH", path: "$.stageInvocation.platform", message: "Stage Agent did not run on the declared platform" });
      if (execution.executor !== "generic-subagent") issues.push({ code: "CONTEXT_EXECUTOR_MISMATCH", path: "$.stageInvocation.executor", message: "Stage capabilities must run in one generic native subagent" });
      if (execution.agentType !== "general-purpose") issues.push({ code: "CONTEXT_SUBAGENT_TYPE_MISMATCH", path: "$.stageInvocation.agentType", message: "Stage capabilities must use the general-purpose subagent type" });
      if (execution.status !== "completed") issues.push({ code: "CONTEXT_INVOCATION_INCOMPLETE", path: "$.stageInvocation.status", message: "Stage Agent invocation must be completed" });
      if (!/^github-copilot:subagent:\S+$/.test(execution.platformExecutionRef)) issues.push({ code: "CONTEXT_EXECUTION_REF_MISMATCH", path: "$.stageInvocation.platformExecutionRef", message: "Platform execution reference must identify a native subagent trace" });
    }
  } else if (receipt.stageInvocation) {
    issues.push({ code: "CONTEXT_STAGE_INVOCATION_UNEXPECTED", path: "$.stageInvocation", message: "A Stage without required capabilities must not claim a subagent invocation" });
  }
  const integrationMap = new Map(snapshot.integrations.map((entry) => [entry.ref, entry]));
  receipt.integrations.forEach((entry, index) => {
    const expected = integrationMap.get(entry.ref);
    if (expected && !sameStrings(entry.skills, expected.skills)) issues.push({ code: "CONTEXT_SKILLS_MISMATCH", path: `$.integrations[${index}].skills`, message: "Integration Skill set does not match the resolved Integration" });
  });
  return issues;
}

function compareRefs(
  field: "policies" | "knowledge" | "disciplineContributions" | "integrations",
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
