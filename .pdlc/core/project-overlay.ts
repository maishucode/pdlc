import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PdlcError } from "./errors.ts";
import { validateControlPolicy, validateKnowledgeAsset, validateProjectBaseline, validateProjectDefaultProfile } from "./schema.ts";
import type { ControlPolicy, KnowledgeAsset, ProjectBaseline, ProjectDefaultProfile } from "./types.ts";

export interface ProjectPolicyEntry {
  policy: ControlPolicy;
  path: string;
}

export interface ProjectDefaultEntry {
  profile: ProjectDefaultProfile;
  path: string;
}

export interface ProjectKnowledgeEntry {
  discipline: string;
  asset: KnowledgeAsset;
  metadataPath: string;
  contentPath: string;
}

export interface ProjectDisciplineOverlay {
  discipline: string;
  root: string;
  baseline?: ProjectBaseline;
  policies: ProjectPolicyEntry[];
  defaults: ProjectDefaultEntry[];
  knowledge: ProjectKnowledgeEntry[];
}

export class ProjectOverlay {
  private constructor(readonly disciplines: ProjectDisciplineOverlay[]) {}

  static async load(projectRoot: string, knownDisciplines: Set<string>): Promise<ProjectOverlay> {
    const legacyRoot = join(projectRoot, "pdlc", "config");
    if (await exists(legacyRoot)) {
      throw new PdlcError("LEGACY_PROJECT_OVERLAY_PATH", `Legacy Project Overlay path is present: ${legacyRoot}. Move its Discipline folders to pdlc/disciplines/.`);
    }
    const disciplinesRoot = join(projectRoot, "pdlc", "disciplines");
    const directories = await listDirectories(disciplinesRoot);
    const disciplines: ProjectDisciplineOverlay[] = [];
    const knowledgeRefs = new Set<string>();
    for (const discipline of directories) {
      if (!knownDisciplines.has(discipline)) {
        throw new PdlcError("UNKNOWN_PROJECT_DISCIPLINE", `Project Overlay references an unknown Discipline: ${discipline}`);
      }
      const root = join(disciplinesRoot, discipline);
      await rejectLegacyProjectCategories(root);
      const baseline = await optionalJson(join(root, "baseline.json"), validateProjectBaseline, "Project Baseline");
      if (baseline && baseline.discipline !== discipline) throw mismatch("Project Baseline", discipline, baseline.discipline);

      const policies: ProjectPolicyEntry[] = [];
      for (const file of await listJsonFiles(join(root, "policies"))) {
        const path = join(root, "policies", file);
        const policy = await requiredJson(path, validateControlPolicy, "Project Policy");
        if (policy.ownerDiscipline !== discipline) throw mismatch("Project Policy", discipline, policy.ownerDiscipline);
        policies.push({ policy, path });
      }

      const defaults: ProjectDefaultEntry[] = [];
      for (const file of await listJsonFiles(join(root, "defaults"))) {
        const path = join(root, "defaults", file);
        const profile = await requiredJson(path, validateProjectDefaultProfile, "Project Default");
        if (profile.discipline !== discipline) throw mismatch("Project Default", discipline, profile.discipline);
        defaults.push({ profile, path });
      }

      const knowledge = await loadProjectKnowledge(root, discipline);
      for (const entry of knowledge) {
        const ref = `${entry.asset.id}@${entry.asset.version}`;
        if (knowledgeRefs.has(ref)) throw new PdlcError("DUPLICATE_PROJECT_KNOWLEDGE", `Duplicate Project Knowledge: ${ref}`);
        knowledgeRefs.add(ref);
      }
      disciplines.push({ discipline, root, baseline, policies, defaults, knowledge });
    }
    return new ProjectOverlay(disciplines);
  }

  baselines(): Array<{ discipline: string; baseline: ProjectBaseline }> {
    return this.disciplines.flatMap((entry) => entry.baseline ? [{ discipline: entry.discipline, baseline: entry.baseline }] : []);
  }

  policies(): ProjectPolicyEntry[] {
    return this.disciplines.flatMap((entry) => entry.policies);
  }

  defaults(): ProjectDefaultEntry[] {
    return this.disciplines.flatMap((entry) => entry.defaults);
  }

  knowledge(): ProjectKnowledgeEntry[] {
    return this.disciplines.flatMap((entry) => entry.knowledge);
  }
}

async function listDirectories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function rejectLegacyProjectCategories(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.some((entry) => entry.isDirectory() && entry.name === "controls")) {
    throw new PdlcError("VALIDATION_FAILED", `Project configuration uses obsolete controls/ folder: ${root}. Rename it to policies/.`);
  }
}

async function loadProjectKnowledge(root: string, discipline: string): Promise<ProjectKnowledgeEntry[]> {
  const knowledgeRoot = join(root, "knowledge");
  const kinds = ["guidance", "references", "kb"] as const;
  await rejectUnsupportedKnowledgeLayout(knowledgeRoot, kinds);
  const entries: ProjectKnowledgeEntry[] = [];
  for (const kind of kinds) {
    const directory = join(knowledgeRoot, kind);
    for (const file of await listJsonFiles(directory)) {
      const metadataPath = join(directory, file);
      const asset = await requiredJson(metadataPath, validateKnowledgeAsset, "Project Knowledge");
      if (asset.ownerDiscipline !== discipline) throw mismatch("Project Knowledge", discipline, asset.ownerDiscipline);
      if (!asset.id.startsWith(`${discipline}.`)) {
        throw new PdlcError("VALIDATION_FAILED", `Project Knowledge id '${asset.id}' must be prefixed '${discipline}.'`);
      }
      if (!Object.values(asset.appliesTo).some((value) => Array.isArray(value) && value.length > 0)) {
        throw new PdlcError("VALIDATION_FAILED", `Project Knowledge '${asset.id}' must declare at least one non-empty appliesTo selector`);
      }
      const expectedKind = kind === "references" ? "reference" : kind;
      if (asset.kind !== expectedKind) {
        throw new PdlcError("PROJECT_KNOWLEDGE_DIRECTORY_MISMATCH", `Project Knowledge '${asset.id}' has kind '${asset.kind}' but is stored under '${kind}/'`);
      }
      if (!asset.contentRef) throw new PdlcError("PROJECT_KNOWLEDGE_CONTENT_MISSING", `Project Knowledge '${asset.id}' requires contentRef`);
      const contentPath = join(directory, asset.contentRef);
      await requireRegularFile(contentPath, `Project Knowledge content not found or not a regular file: ${asset.contentRef}`);
      entries.push({ discipline, asset, metadataPath, contentPath });
    }
  }
  await rejectOrphanKnowledgeContent(knowledgeRoot, kinds, entries);
  return entries;
}

async function rejectUnsupportedKnowledgeLayout(knowledgeRoot: string, allowedKinds: readonly string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(knowledgeRoot, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  const unsupported = entries.filter((entry) => !entry.isDirectory() || !allowedKinds.includes(entry.name)).map((entry) => entry.name).sort();
  if (unsupported.length > 0) {
    throw new PdlcError(
      "VALIDATION_FAILED",
      `Project Knowledge contains unsupported entries: ${unsupported.join(", ")}. Use knowledge/guidance/, knowledge/references/, or knowledge/kb/; put project Defaults in the sibling defaults/ folder.`,
    );
  }
}

async function rejectOrphanKnowledgeContent(
  knowledgeRoot: string,
  kinds: readonly string[],
  entries: ProjectKnowledgeEntry[],
): Promise<void> {
  const referenced = new Set(entries.flatMap(({ metadataPath, contentPath }) => [metadataPath, contentPath]));
  const orphans: string[] = [];
  for (const kind of kinds) {
    const directory = join(knowledgeRoot, kind);
    let files;
    try {
      files = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      throw error;
    }
    for (const file of files) {
      const path = join(directory, file.name);
      if (!file.isFile() || !referenced.has(path)) orphans.push(path);
    }
  }
  if (orphans.length > 0) {
    throw new PdlcError("VALIDATION_FAILED", `Project Knowledge contains unreferenced or non-regular content: ${orphans.sort().join(", ")}`);
  }
}

async function listJsonFiles(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name).sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function requireRegularFile(path: string, message: string): Promise<void> {
  try {
    if (!(await lstat(path)).isFile()) throw new Error(message);
  } catch (error) {
    if (error instanceof PdlcError) throw error;
    throw new PdlcError("VALIDATION_FAILED", message);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function requiredJson<T>(
  path: string,
  validator: (value: unknown) => { ok: true; value: T; issues: [] } | { ok: false; issues: Array<{ code: string; path: string; message: string }> },
  label: string,
): Promise<T> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  const validation = validator(raw);
  if (!validation.ok) throw new PdlcError("VALIDATION_FAILED", `Invalid ${label}: ${path}`, validation.issues);
  return validation.value;
}

async function optionalJson<T>(
  path: string,
  validator: (value: unknown) => { ok: true; value: T; issues: [] } | { ok: false; issues: Array<{ code: string; path: string; message: string }> },
  label: string,
): Promise<T | undefined> {
  try {
    return await requiredJson(path, validator, label);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function mismatch(label: string, expected: string, actual: string): PdlcError {
  return new PdlcError("PROJECT_DISCIPLINE_MISMATCH", `${label} belongs to '${actual}' but is stored under '${expected}'`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
