import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { PdlcError } from "./errors.ts";
import {
  validateArtifactDefinition,
  validateControlPolicy,
  validateDomainStageHooks,
  validateDomainManifest,
  validateKnowledgeAsset,
} from "./schema.ts";
import type {
  Applicability,
  ArtifactDefinition,
  ControlPolicy,
  DomainStageHooksDescriptor,
  DomainManifest,
  KnowledgeAsset,
} from "./types.ts";

export interface DomainArtifactEntry {
  definition: ArtifactDefinition;
  root: string;
}

export interface DomainPolicyEntry {
  policy: ControlPolicy;
  path: string;
}

export interface DomainKnowledgeEntry {
  asset: KnowledgeAsset;
  metadataPath: string;
  contentPath?: string;
}

export interface DomainSkillEntry {
  id: string;
  path: string;
}

export interface DomainAgentEntry {
  id: string;
  path: string;
}

export interface DomainHookEntry {
  descriptor: DomainStageHooksDescriptor;
  path: string;
}

export interface DomainBundle {
  manifest: DomainManifest;
  root: string;
  artifacts: DomainArtifactEntry[];
  policies: DomainPolicyEntry[];
  knowledge: DomainKnowledgeEntry[];
  skills: DomainSkillEntry[];
  agents: DomainAgentEntry[];
  hooks: DomainHookEntry[];
}

export class DomainRegistry {
  private constructor(
    readonly root: string,
    private readonly domains: Map<string, DomainBundle>,
  ) {}

  static async load(root: string): Promise<DomainRegistry> {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      throw new PdlcError("DOMAIN_ROOT_NOT_FOUND", `Domain root not found: ${root}`);
    }

    const domains = new Map<string, DomainBundle>();
    for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const domainRoot = join(root, entry.name);
      const manifest = await loadValidated(join(domainRoot, "domain.json"), validateDomainManifest, "Domain manifest");
      await rejectLegacyDomainCategories(domainRoot);
      if (manifest.id !== entry.name) {
        throw validationError(join(domainRoot, "domain.json"), "DOMAIN_DIRECTORY_MISMATCH", "$.id", `Domain id '${manifest.id}' must match directory '${entry.name}'`);
      }
      if (domains.has(manifest.id)) throw new PdlcError("DUPLICATE_DOMAIN", `Duplicate Domain: ${manifest.id}`);

      const artifacts = await loadArtifacts(domainRoot, manifest);
      const policies = await loadPolicies(domainRoot, manifest);
      const knowledge = await loadKnowledge(domainRoot, manifest);
      const skills = await loadSkills(domainRoot);
      const agents = await loadAgents(domainRoot);
      const hooks = await loadHooks(domainRoot, manifest);
      domains.set(manifest.id, { manifest, root: domainRoot, artifacts, policies, knowledge, skills, agents, hooks });
    }
    return new DomainRegistry(root, domains);
  }

  get(id: string): DomainBundle {
    const domain = this.domains.get(id);
    if (!domain) throw new PdlcError("DOMAIN_NOT_FOUND", `Domain not found: ${id}`);
    return domain;
  }

  has(id: string): boolean {
    return this.domains.has(id);
  }

  list(): DomainBundle[] {
    return [...this.domains.values()];
  }

  artifacts(): DomainArtifactEntry[] {
    return this.list().flatMap((domain) => domain.artifacts);
  }

  policies(): DomainPolicyEntry[] {
    return this.list().flatMap((domain) => domain.policies);
  }

  knowledge(): DomainKnowledgeEntry[] {
    return this.list().flatMap((domain) => domain.knowledge);
  }

  skills(): DomainSkillEntry[] {
    return this.list().flatMap((domain) => domain.skills);
  }

  agents(): DomainAgentEntry[] {
    return this.list().flatMap((domain) => domain.agents);
  }

  hooks(): DomainHookEntry[] {
    return this.list().flatMap((domain) => domain.hooks);
  }

  artifact(id: string): DomainArtifactEntry {
    const matches = this.artifacts().filter((entry) => entry.definition.id === id);
    if (matches.length === 0) throw new PdlcError("ARTIFACT_DEFINITION_NOT_FOUND", `Artifact Definition not found: ${id}`);
    if (matches.length > 1) throw new PdlcError("DUPLICATE_ARTIFACT_DEFINITION", `Artifact Definition is owned by more than one Domain: ${id}`);
    return matches[0];
  }
}

export function effectiveApplicability(domain: DomainManifest, asset: Applicability): Applicability {
  const defaults = domain.defaultApplicability ?? {};
  return {
    deliveryFlows: asset.deliveryFlows ?? defaults.deliveryFlows,
    stages: asset.stages ?? defaults.stages,
    riskTriggers: asset.riskTriggers ?? defaults.riskTriggers,
    technologies: asset.technologies ?? defaults.technologies,
    domains: asset.domains ?? defaults.domains,
  };
}

async function loadArtifacts(root: string, domain: DomainManifest): Promise<DomainArtifactEntry[]> {
  const entries = await directories(join(root, "artifacts"));
  return Promise.all(entries.map(async (entry) => {
    const artifactRoot = join(root, "artifacts", entry);
    const definition = await loadValidated(join(artifactRoot, "artifact.json"), validateArtifactDefinition, "Artifact Definition");
    requireOwnerDomain(definition.ownerDomain, domain.id, join(artifactRoot, "artifact.json"));
    if (!definition.id.startsWith(`${domain.id}.`)) {
      throw validationError(join(artifactRoot, "artifact.json"), "ARTIFACT_DOMAIN_PREFIX", "$.id", `Artifact id must be prefixed '${domain.id}.'`);
    }
    for (const ref of [definition.schemaRef, definition.defaultTemplate, ...(definition.examples ?? [])].filter((item): item is string => Boolean(item))) {
      await requireFile(join(artifactRoot, ref), `Artifact reference not found: ${ref}`);
    }
    return { definition, root: artifactRoot };
  }));
}

async function loadPolicies(root: string, domain: DomainManifest): Promise<DomainPolicyEntry[]> {
  const directory = join(root, "policies");
  const entries = await jsonFiles(directory);
  return Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry);
    const policy = await loadValidated(path, validateControlPolicy, "Domain Policy");
    requireOwnerDomain(policy.ownerDomain, domain.id, path);
    if (!policy.id.startsWith(`${domain.id}.`)) throw validationError(path, "CONTROL_DOMAIN_PREFIX", "$.id", `Policy id must be prefixed '${domain.id}.'`);
    return { policy, path };
  }));
}

async function loadKnowledge(root: string, domain: DomainManifest): Promise<DomainKnowledgeEntry[]> {
  const knowledgeRoot = join(root, "knowledge");
  const kinds = ["guidance", "defaults", "references", "kb"];
  const assets: DomainKnowledgeEntry[] = [];
  for (const kind of kinds) {
    const directory = join(knowledgeRoot, kind);
    for (const entry of await jsonFiles(directory)) {
      const metadataPath = join(directory, entry);
      const asset = await loadValidated(metadataPath, validateKnowledgeAsset, "Knowledge Asset");
      requireOwnerDomain(asset.ownerDomain, domain.id, metadataPath);
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

async function loadSkills(root: string): Promise<DomainSkillEntry[]> {
  const directory = join(root, "skills");
  return Promise.all((await directories(directory)).map(async (id) => {
    const path = join(directory, id, "SKILL.md");
    await requireFile(path, `Domain Skill not found: ${id}`);
    return { id, path };
  }));
}

async function loadAgents(root: string): Promise<DomainAgentEntry[]> {
  const directory = join(root, "agents");
  return (await filesWithSuffix(directory, ".agent.md")).map((entry) => ({
    id: entry.slice(0, -".agent.md".length),
    path: join(directory, entry),
  }));
}

async function loadHooks(root: string, domain: DomainManifest): Promise<DomainHookEntry[]> {
  const directory = join(root, "hooks");
  return Promise.all((await jsonFiles(directory)).map(async (entry) => {
    const path = join(directory, entry);
    const descriptor = await loadValidated(path, validateDomainStageHooks, "Domain Stage Hooks");
    if (descriptor.domain !== domain.id) throw validationError(path, "HOOK_DOMAIN_MISMATCH", "$.domain", `Expected Domain '${domain.id}' but found '${descriptor.domain}'`);
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

async function rejectLegacyDomainCategories(root: string): Promise<void> {
  const legacy = new Set(["controls", "capabilities", "plugins", "adapters"]);
  const entries = await readdir(root, { withFileTypes: true });
  const found = entries.filter((entry) => entry.isDirectory() && legacy.has(entry.name)).map((entry) => entry.name).sort();
  if (found.length > 0) {
    throw new PdlcError("VALIDATION_FAILED", `Domain contains obsolete v2 categories: ${found.join(", ")}. Use policies/, knowledge/, skills/, agents/, and hooks/ directly.`);
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

function requireOwnerDomain(actual: string, expected: string, path: string): void {
  if (actual !== expected) throw validationError(path, "OWNER_DOMAIN_MISMATCH", "$.ownerDomain", `Expected ownerDomain '${expected}' but found '${actual}'`);
}

async function requireFile(path: string, message: string): Promise<void> {
  try {
    if (!(await stat(path)).isFile()) throw new Error("not a file");
  } catch {
    throw new PdlcError("REFERENCE_NOT_FOUND", `${message} (${path})`);
  }
}

function validationError(file: string, code: string, path: string, message: string): PdlcError {
  return new PdlcError("VALIDATION_FAILED", `Invalid Domain asset: ${relative(resolve(file, ".."), file) || file}`, [{ code, path, message }]);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
