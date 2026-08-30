import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { validateReceiptAgainstSnapshot } from "../core/context-receipt.ts";
import { persistRecordAndAudit } from "../core/controlled-mutation.ts";
import { discoverDisciplineHooks, disciplineAgentPath, disciplineSkillPath, resolveDisciplineGuidance } from "../core/discipline-guidance.ts";
import { PdlcError } from "../core/errors.ts";
import { HarnessContext } from "../core/harness-context.ts";
import { validateStageContextReceipt } from "../core/schema.ts";
import { FileStateStore } from "../core/state.ts";
import type { DeliveryRecord, StageContextReceipt } from "../core/types.ts";
import type { RunnerOptions } from "./types.ts";

async function readRecord(options: RunnerOptions): Promise<DeliveryRecord> {
  const store = new FileStateStore(options.root);
  return options.record ? store.readRecord(options.record) : store.readCurrentRecord();
}

export async function stageContext(harnessRoot: string, options: RunnerOptions, stageId?: string): Promise<unknown> {
  if (!stageId) throw new PdlcError("INVALID_ARGUMENT", "Context requires a canonical Stage id");
  let record: DeliveryRecord | undefined;
  try { record = await readRecord(options); } catch (error) {
    if (!(error instanceof PdlcError) || error.code !== "CURRENT_RECORD_NOT_SET") throw error;
  }
  const harness = await HarnessContext.load(harnessRoot, options.root);
  const { deliveryFlow, stage, resolved, disciplineGuidance, snapshot, roles } = await harness.resolveStage(stageId, record);
  return {
    ok: true,
    deliveryFlow,
    stage,
    contextHash: snapshot.contextHash,
    roles: roles.map(({ id, name, path }) => ({ id, name, path: relative(harnessRoot, path) })),
    controls: resolved.controls.map(({ ref, ownerDiscipline, source, policy }) => ({ ref, ownerDiscipline, source, rules: policy.rules })),
    baselines: resolved.baselines.map(({ ref, baseline }) => ({ ref, decisions: baseline.decisions })),
    defaults: resolved.defaults,
    knowledge: resolved.knowledge.map(({ ref, asset, contentPath, source }) => ({
      ref,
      kind: asset.kind,
      source,
      contentPath: contentPath ? relative(source === "project" ? options.root : harnessRoot, contentPath) : undefined,
    })),
    disciplineContributions: disciplineGuidance.contributions,
    integrations: resolved.integrations.map(({ ref, owners, permissions, skills }) => ({
      ref,
      owners,
      permissions,
      skills: skills.map(({ id, path }) => ({ id, path: relative(harnessRoot, path) })),
    })),
  };
}

export async function applyStageContext(harnessRoot: string, options: RunnerOptions, stageId?: string): Promise<unknown> {
  if (!stageId) throw new PdlcError("INVALID_ARGUMENT", "Context apply requires a canonical Stage id");
  if (!options.receipt) throw new PdlcError("INVALID_ARGUMENT", "Context apply requires --receipt <path>");
  if (!options.actor?.trim()) throw new PdlcError("INVALID_ARGUMENT", "Context apply requires --actor <identity>");
  const original = await readRecord(options);
  let raw: unknown;
  try {
    const receiptPath = isAbsolute(options.receipt) ? options.receipt : resolve(options.root, options.receipt);
    const receiptFromRoot = relative(resolve(options.root), receiptPath);
    if (receiptFromRoot === ".." || receiptFromRoot.startsWith(`..${sep}`) || isAbsolute(receiptFromRoot)) throw new Error("Receipt path must remain inside the project workspace");
    raw = JSON.parse(await readFile(receiptPath, "utf8")) as unknown;
  } catch (error) {
    throw new PdlcError("CONTEXT_RECEIPT_INVALID", "Stage context receipt cannot be read", [{ code: "CONTEXT_RECEIPT_UNREADABLE", path: "--receipt", message: error instanceof Error ? error.message : String(error) }]);
  }
  const validation = validateStageContextReceipt(raw);
  if (!validation.ok) throw new PdlcError("CONTEXT_RECEIPT_INVALID", "Stage context receipt is invalid", validation.issues);
  const receipt: StageContextReceipt = validation.value;
  const material = await (await HarnessContext.load(harnessRoot, options.root)).resolveStage(stageId, original);
  const issues = validateReceiptAgainstSnapshot(receipt, material.snapshot);
  if (issues.length > 0) throw new PdlcError("CONTEXT_RECEIPT_INVALID", "Stage context receipt does not match the current resolved context", issues);

  const appliedAt = new Date().toISOString();
  const application = { ...receipt, actor: options.actor, appliedAt };
  const contextApplications = original.resolution.contextApplications.filter((entry) => entry.stage !== stageId);
  contextApplications.push(application);
  contextApplications.sort((left, right) => left.stage.localeCompare(right.stage));
  const updated: DeliveryRecord = {
    ...original,
    revision: original.revision + 1,
    updatedAt: appliedAt,
    resolution: { ...original.resolution, contextApplications },
  };
  const evidenceRefs = [
    ...receipt.knowledge.flatMap((entry) => entry.evidenceRefs),
    ...receipt.disciplineContributions.flatMap((entry) => entry.evidenceRefs),
    ...receipt.integrations.flatMap((entry) => entry.evidenceRefs),
  ];
  await persistRecordAndAudit(options.root, original, updated, {
    eventType: "STAGE_CONTEXT_APPLIED",
    stage: stageId,
    contextHash: receipt.contextHash,
    actor: options.actor,
    riskLevel: updated.risk.level,
    evidenceRefs: [...new Set(evidenceRefs)],
  });
  return { ok: true, recordId: updated.id, stage: stageId, contextHash: receipt.contextHash, revision: updated.revision, appliedAt };
}

export async function guidance(harnessRoot: string, stageId?: string): Promise<unknown> {
  if (!stageId) throw new PdlcError("INVALID_ARGUMENT", "Guidance requires a canonical Stage id");
  const { stages, disciplines } = await HarnessContext.loadDisciplineView(harnessRoot);
  return { ok: true, ...await resolveDisciplineGuidance(stages, disciplines, harnessRoot, stageId) };
}

export async function disciplineList(harnessRoot: string): Promise<unknown> {
  const { stages, disciplines } = await HarnessContext.loadDisciplineView(harnessRoot);
  const hooks = await discoverDisciplineHooks(stages, disciplines);
  return { ok: true, disciplines: disciplines.list().map(({ manifest, artifacts, policies, knowledge, skills, agents, hooks: disciplineHooks }) => ({
    id: manifest.id,
    artifacts: artifacts.length,
    policies: policies.length,
    knowledge: knowledge.length,
    skills: skills.map(({ id }) => id),
    agents: agents.map(({ id }) => id),
    hooks: disciplineHooks.length,
    stages: hooks.filter(({ discipline }) => discipline === manifest.id).flatMap(({ bindings }) => bindings.map(({ stage }) => stage)),
  })) };
}

export async function disciplineSync(harnessRoot: string, options: RunnerOptions): Promise<unknown> {
  const { stages, disciplines } = await HarnessContext.loadDisciplineView(harnessRoot);
  const hooks = (await discoverDisciplineHooks(stages, disciplines)).filter(({ descriptor }) => descriptor.enabled);
  const sources = new Map<string, { discipline: string; source: string; destination: string }>();
  for (const { discipline, root, bindings } of hooks) for (const binding of bindings) {
    const agentDestination = join(".github", "agents", `${binding.agent}.agent.md`);
    sources.set(agentDestination, { discipline, source: disciplineAgentPath(root, binding.agent), destination: agentDestination });
    for (const skill of binding.skills) {
      const skillDestination = join(".github", "skills", skill, "SKILL.md");
      sources.set(skillDestination, { discipline, source: disciplineSkillPath(root, skill), destination: skillDestination });
    }
  }
  const installed: string[] = [];
  const unchanged: string[] = [];
  for (const item of [...sources.values()].sort((left, right) => left.destination.localeCompare(right.destination))) {
    const destination = join(options.root, item.destination);
    const sourceContent = await readFile(item.source, "utf8");
    try {
      if (await readFile(destination, "utf8") !== sourceContent) throw new PdlcError("DISCIPLINE_FILE_CONFLICT", `Discipline '${item.discipline}' will not overwrite an existing file: ${relative(options.root, destination)}`);
      unchanged.push(relative(options.root, destination));
    } catch (error) {
      if (error instanceof PdlcError) throw error;
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(item.source, destination);
      installed.push(relative(options.root, destination));
    }
  }
  return { ok: true, disciplines: [...new Set(hooks.map(({ discipline }) => discipline))], target: options.root, installed, unchanged };
}

export async function integrationList(harnessRoot: string): Promise<unknown> {
  const integrations = await HarnessContext.loadIntegrationView(harnessRoot);
  return { ok: true, integrations: integrations.list().map(({ manifest }) => ({
    id: manifest.id,
    version: manifest.version,
    owners: manifest.owners,
    maintainers: manifest.maintainers,
    permissions: manifest.permissions,
    skills: manifest.skills.map(({ id }) => id),
  })) };
}
