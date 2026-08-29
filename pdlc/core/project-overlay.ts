import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PdlcError } from "./errors.ts";
import { validateControlPolicy, validateProjectBaseline, validateProjectDefaultProfile } from "./schema.ts";
import type { ControlPolicy, ProjectBaseline, ProjectDefaultProfile } from "./types.ts";

export interface ProjectControlEntry {
  policy: ControlPolicy;
  path: string;
}

export interface ProjectDefaultEntry {
  profile: ProjectDefaultProfile;
  path: string;
}

export interface ProjectKnowledgeEntry {
  domain: string;
  path: string;
}

export interface ProjectDomainOverlay {
  domain: string;
  root: string;
  baseline?: ProjectBaseline;
  controls: ProjectControlEntry[];
  defaults: ProjectDefaultEntry[];
  knowledge: ProjectKnowledgeEntry[];
}

export class ProjectOverlay {
  private constructor(readonly domains: ProjectDomainOverlay[]) {}

  static async load(projectRoot: string, knownDomains: Set<string>): Promise<ProjectOverlay> {
    const domainsRoot = join(projectRoot, ".pdlc", "project", "domains");
    const directories = await listDirectories(domainsRoot);
    const domains: ProjectDomainOverlay[] = [];
    for (const domain of directories) {
      if (!knownDomains.has(domain)) {
        throw new PdlcError("UNKNOWN_PROJECT_DOMAIN", `Project Overlay references an unknown Domain: ${domain}`);
      }
      const root = join(domainsRoot, domain);
      const baseline = await optionalJson(join(root, "baseline.json"), validateProjectBaseline, "Project Baseline");
      if (baseline && baseline.domain !== domain) throw mismatch("Project Baseline", domain, baseline.domain);

      const controls: ProjectControlEntry[] = [];
      for (const file of await listJsonFiles(join(root, "controls"))) {
        const path = join(root, "controls", file);
        const policy = await requiredJson(path, validateControlPolicy, "Project Control");
        if (policy.ownerDomain !== domain) throw mismatch("Project Control", domain, policy.ownerDomain);
        controls.push({ policy, path });
      }

      const defaults: ProjectDefaultEntry[] = [];
      for (const file of await listJsonFiles(join(root, "defaults"))) {
        const path = join(root, "defaults", file);
        const profile = await requiredJson(path, validateProjectDefaultProfile, "Project Default");
        if (profile.domain !== domain) throw mismatch("Project Default", domain, profile.domain);
        defaults.push({ profile, path });
      }

      const knowledge = (await listFiles(join(root, "knowledge"))).map((path) => ({ domain, path }));
      domains.push({ domain, root, baseline, controls, defaults, knowledge });
    }
    return new ProjectOverlay(domains);
  }

  baselines(): Array<{ domain: string; baseline: ProjectBaseline }> {
    return this.domains.flatMap((entry) => entry.baseline ? [{ domain: entry.domain, baseline: entry.baseline }] : []);
  }

  controls(): ProjectControlEntry[] {
    return this.domains.flatMap((entry) => entry.controls);
  }

  defaults(): ProjectDefaultEntry[] {
    return this.domains.flatMap((entry) => entry.defaults);
  }

  knowledge(): ProjectKnowledgeEntry[] {
    return this.domains.flatMap((entry) => entry.knowledge);
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

async function listJsonFiles(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name).sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function listFiles(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => join(path, entry.name)).sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
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
  return new PdlcError("PROJECT_DOMAIN_MISMATCH", `${label} belongs to '${actual}' but is stored under '${expected}'`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
