import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { PdlcError } from "./errors.ts";
import {
  validateArtifactDefinition,
  validateControlPolicy,
  validateDisciplineStageHooks,
  validateDisciplineManifest,
  validateKnowledgeAsset,
} from "./schema.ts";
import type {
  Applicability,
  ArtifactDefinition,
  ControlPolicy,
  DisciplineStageHooksDescriptor,
  DisciplineManifest,
  KnowledgeAsset,
} from "./types.ts";

export interface DisciplineArtifactEntry {
  definition: ArtifactDefinition;
  root: string;
}

export interface DisciplinePolicyEntry {
  policy: ControlPolicy;
  path: string;
}

export interface DisciplineKnowledgeEntry {
  asset: KnowledgeAsset;
  metadataPath: string;
  contentPath?: string;
}

export interface DisciplineSkillEntry {
  id: string;
  path: string;
}

export interface DisciplineAgentEntry {
  id: string;
  path: string;
}

export interface DisciplineHookEntry {
  descriptor: DisciplineStageHooksDescriptor;
  path: string;
}

export interface DisciplineBundle {
  manifest: DisciplineManifest;
  root: string;
  artifacts: DisciplineArtifactEntry[];
  policies: DisciplinePolicyEntry[];
  knowledge: DisciplineKnowledgeEntry[];
  skills: DisciplineSkillEntry[];
  agents: DisciplineAgentEntry[];
  hooks: DisciplineHookEntry[];
}

export class DisciplineRegistry {
  private constructor(
    readonly root: string,
    private readonly disciplines: Map<string, DisciplineBundle>,
  ) {}

  static async load(root: string): Promise<DisciplineRegistry> {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      throw new PdlcError("DISCIPLINE_ROOT_NOT_FOUND", `Discipline root not found: ${root}`);
    }

    const disciplines = new Map<string, DisciplineBundle>();
    for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const disciplineRoot = join(root, entry.name);
      const manifest = await loadValidated(join(disciplineRoot, "discipline.json"), validateDisciplineManifest, "Discipline manifest");
      await rejectLegacyDisciplineCategories(disciplineRoot);
      if (manifest.id !== entry.name) {
        throw validationError(join(disciplineRoot, "discipline.json"), "DISCIPLINE_DIRECTORY_MISMATCH", "$.id", `Discipline id '${manifest.id}' must match directory '${entry.name}'`);
      }
      if (disciplines.has(manifest.id)) throw new PdlcError("DUPLICATE_DISCIPLINE", `Duplicate Discipline: ${manifest.id}`);

      const artifacts = await loadArtifacts(disciplineRoot, manifest);
      const policies = await loadPolicies(disciplineRoot, manifest);
      const knowledge = await loadKnowledge(disciplineRoot, manifest);
      const skills = await loadSkills(disciplineRoot);
      const agents = await loadAgents(disciplineRoot);
      const hooks = await loadHooks(disciplineRoot, manifest);
      disciplines.set(manifest.id, { manifest, root: disciplineRoot, artifacts, policies, knowledge, skills, agents, hooks });
    }
    return new DisciplineRegistry(root, disciplines);
  }

  get(id: string): DisciplineBundle {
    const discipline = this.disciplines.get(id);
    if (!discipline) throw new PdlcError("DISCIPLINE_NOT_FOUND", `Discipline not found: ${id}`);
    return discipline;
  }

  has(id: string): boolean {
    return this.disciplines.has(id);
  }

  list(): DisciplineBundle[] {
    return [...this.disciplines.values()];
  }

  artifacts(): DisciplineArtifactEntry[] {
    return this.list().flatMap((discipline) => discipline.artifacts);
  }

  policies(): DisciplinePolicyEntry[] {
    return this.list().flatMap((discipline) => discipline.policies);
  }

  knowledge(): DisciplineKnowledgeEntry[] {
    return this.list().flatMap((discipline) => discipline.knowledge);
  }

  skills(): DisciplineSkillEntry[] {
    return this.list().flatMap((discipline) => discipline.skills);
  }

  agents(): DisciplineAgentEntry[] {
    return this.list().flatMap((discipline) => discipline.agents);
  }

  hooks(): DisciplineHookEntry[] {
    return this.list().flatMap((discipline) => discipline.hooks);
  }

  artifact(id: string): DisciplineArtifactEntry {
    const matches = this.artifacts().filter((entry) => entry.definition.id === id);
    if (matches.length === 0) throw new PdlcError("ARTIFACT_DEFINITION_NOT_FOUND", `Artifact Definition not found: ${id}`);
    if (matches.length > 1) throw new PdlcError("DUPLICATE_ARTIFACT_DEFINITION", `Artifact Definition is owned by more than one Discipline: ${id}`);
    return matches[0];
  }
}

export function effectiveApplicability(discipline: DisciplineManifest, asset: Applicability): Applicability {
  const defaults = discipline.defaultApplicability ?? {};
  return {
    deliveryFlows: asset.deliveryFlows ?? defaults.deliveryFlows,
    stages: asset.stages ?? defaults.stages,
    riskTriggers: asset.riskTriggers ?? defaults.riskTriggers,
    technologies: asset.technologies ?? defaults.technologies,
    disciplines: asset.disciplines ?? defaults.disciplines,
  };
}

async function loadArtifacts(root: string, discipline: DisciplineManifest): Promise<DisciplineArtifactEntry[]> {
  const entries = await directories(join(root, "artifacts"));
  return Promise.all(entries.map(async (entry) => {
    const artifactRoot = join(root, "artifacts", entry);
    const definition = await loadValidated(join(artifactRoot, "artifact.json"), validateArtifactDefinition, "Artifact Definition");
    requireOwnerDiscipline(definition.ownerDiscipline, discipline.id, join(artifactRoot, "artifact.json"));
    if (!definition.id.startsWith(`${discipline.id}.`)) {
      throw validationError(join(artifactRoot, "artifact.json"), "ARTIFACT_DISCIPLINE_PREFIX", "$.id", `Artifact id must be prefixed '${discipline.id}.'`);
    }
    for (const ref of [definition.schemaRef, definition.defaultTemplate, ...(definition.examples ?? [])].filter((item): item is string => Boolean(item))) {
      await requireFile(join(artifactRoot, ref), `Artifact reference not found: ${ref}`);
    }
    return { definition, root: artifactRoot };
  }));
}

async function loadPolicies(root: string, discipline: DisciplineManifest): Promise<DisciplinePolicyEntry[]> {
  const directory = join(root, "policies");
  const entries = await jsonFiles(directory);
  return Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry);
    const policy = await loadValidated(path, validateControlPolicy, "Discipline Policy");
    requireOwnerDiscipline(policy.ownerDiscipline, discipline.id, path);
    if (!policy.id.startsWith(`${discipline.id}.`)) throw validationError(path, "CONTROL_DISCIPLINE_PREFIX", "$.id", `Policy id must be prefixed '${discipline.id}.'`);
    return { policy, path };
  }));
}

async function loadKnowledge(root: string, discipline: DisciplineManifest): Promise<DisciplineKnowledgeEntry[]> {
  const knowledgeRoot = join(root, "knowledge");
  const kinds = ["guidance", "defaults", "references", "kb"];
  const assets: DisciplineKnowledgeEntry[] = [];
  for (const kind of kinds) {
    const directory = join(knowledgeRoot, kind);
    for (const entry of await jsonFiles(directory)) {
      const metadataPath = join(directory, entry);
      const asset = await loadValidated(metadataPath, validateKnowledgeAsset, "Knowledge Asset");
      requireOwnerDiscipline(asset.ownerDiscipline, discipline.id, metadataPath);
      const expectedKind = kind === "defaults" ? "default" : kind === "references" ? "reference" : kind;
      if (asset.kind !== expectedKind) throw validationError(metadataPath, "KNOWLEDGE_DIRECTORY_MISMATCH", "$.kind", `Expected kind '${expectedKind}' in ${kind}/`);
      let contentPath: string | undefined;
      if (asset.contentRef) {
        contentPath = join(directory, asset.contentRef);
        await requireFile(contentPath, `Knowledge content not found: ${asset.contentRef}`);
      }
      assets.push({ asset, metadataPath, contentPath });
    }
  }
  return assets;
}

async function loadSkills(root: string): Promise<DisciplineSkillEntry[]> {
  const directory = join(root, "skills");
  return Promise.all((await directories(directory)).map(async (id) => {
    const path = join(directory, id, "SKILL.md");
    await requireFile(path, `Discipline Skill not found: ${id}`);
    return { id, path };
  }));
}

async function loadAgents(root: string): Promise<DisciplineAgentEntry[]> {
  const directory = join(root, "agents");
  return (await filesWithSuffix(directory, ".agent.md")).map((entry) => ({
    id: entry.slice(0, -".agent.md".length),
    path: join(directory, entry),
  }));
}

async function loadHooks(root: string, discipline: DisciplineManifest): Promise<DisciplineHookEntry[]> {
  const directory = join(root, "hooks");
  return Promise.all((await jsonFiles(directory)).map(async (entry) => {
    const path = join(directory, entry);
    const descriptor = await loadValidated(path, validateDisciplineStageHooks, "Discipline Stage Hooks");
    if (descriptor.discipline !== discipline.id) throw validationError(path, "HOOK_DISCIPLINE_MISMATCH", "$.discipline", `Expected Discipline '${discipline.id}' but found '${descriptor.discipline}'`);
    return { descriptor, path };
  }));
}

async function directories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function jsonFiles(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function filesWithSuffix(path: string, suffix: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function rejectLegacyDisciplineCategories(root: string): Promise<void> {
  const legacy = new Set(["controls", "capabilities", "plugins", "adapters"]);
  const entries = await readdir(root, { withFileTypes: true });
  const found = entries.filter((entry) => entry.isDirectory() && legacy.has(entry.name)).map((entry) => entry.name).sort();
  if (found.length > 0) {
    throw new PdlcError("VALIDATION_FAILED", `Discipline contains obsolete v2 categories: ${found.join(", ")}. Use policies/, knowledge/, skills/, agents/, and hooks/ directly.`);
  }
}

async function loadValidated<T>(
  path: string,
  validator: (value: unknown) => { ok: true; value: T; issues: [] } | { ok: false; issues: Array<{ code: string; path: string; message: string }> },
  label: string,
): Promise<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PdlcError("DEFINITION_NOT_FOUND", `${label} cannot be read: ${path}: ${message}`);
  }
  const validation = validator(raw);
  if (!validation.ok) throw new PdlcError("VALIDATION_FAILED", `Invalid ${label}: ${path}`, validation.issues);
  return validation.value;
}

function requireOwnerDiscipline(actual: string, expected: string, path: string): void {
  if (actual !== expected) throw validationError(path, "OWNER_DISCIPLINE_MISMATCH", "$.ownerDiscipline", `Expected ownerDiscipline '${expected}' but found '${actual}'`);
}

async function requireFile(path: string, message: string): Promise<void> {
  try {
    if (!(await stat(path)).isFile()) throw new Error("not a file");
  } catch {
    throw new PdlcError("REFERENCE_NOT_FOUND", `${message} (${path})`);
  }
}

function validationError(file: string, code: string, path: string, message: string): PdlcError {
  return new PdlcError("VALIDATION_FAILED", `Invalid Discipline asset: ${relative(resolve(file, ".."), file) || file}`, [{ code, path, message }]);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
