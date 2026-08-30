import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256 } from "./hash.ts";
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
  ValidationIssue,
} from "./types.ts";

export interface HashedContextAsset {
  ref: string;
  hash: string;
}

export interface HashedDisciplineContribution extends HashedContextAsset {
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
    const skillContents = await Promise.all(contribution.skills.map(async ({ name, path }) => ({
      name,
      content: await readFile(resolve(input.harnessRoot, path), "utf8"),
    })));
    return {
      ref: `${contribution.discipline}@${contribution.version}:${contribution.agent.id}`,
      agent: contribution.agent.id,
      skills: contribution.skills.map(({ name }) => name).sort(),
      hash: sha256({ permissions: contribution.permissions, agentContent, skillContents, mode: contribution.mode, handoff: contribution.handoff, approvalBoundary: contribution.approvalBoundary }),
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
    if (!sameStrings(entry.skills, expected.skills)) issues.push({ code: "CONTEXT_SKILLS_MISMATCH", path: `$.disciplineContributions[${index}].skills`, message: "Discipline Skill set does not match the resolved Hook" });
  });
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
