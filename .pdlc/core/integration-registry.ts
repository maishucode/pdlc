import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PdlcError } from "./errors.ts";
import { validateIntegrationCatalog, validateIntegrationManifest } from "./schema.ts";
import type { IntegrationCatalog, IntegrationManifest } from "./types.ts";

export interface IntegrationEntry {
  manifest: IntegrationManifest;
  root: string;
}

export class IntegrationRegistry {
  readonly catalog: IntegrationCatalog;
  private readonly integrations: ReadonlyMap<string, IntegrationEntry>;

  private constructor(catalog: IntegrationCatalog, entries: IntegrationEntry[]) {
    const integrations = new Map<string, IntegrationEntry>();
    for (const entry of entries) {
      if (integrations.has(entry.manifest.id)) {
        throw new PdlcError("DUPLICATE_INTEGRATION", `Duplicate Integration: ${entry.manifest.id}`);
      }
      integrations.set(entry.manifest.id, entry);
    }
    this.catalog = catalog;
    this.integrations = integrations;
  }

  static async load(catalogFile: string): Promise<IntegrationRegistry> {
    const catalogValidation = validateIntegrationCatalog(JSON.parse(await readFile(catalogFile, "utf8")) as unknown);
    if (!catalogValidation.ok) {
      throw new PdlcError("VALIDATION_FAILED", `Invalid Integration Catalog: ${catalogFile}`, catalogValidation.issues);
    }
    const entries: IntegrationEntry[] = [];
    for (const [index, catalogEntry] of catalogValidation.value.integrations.entries()) {
      const definition = resolve(dirname(catalogFile), catalogEntry.definition);
      const validation = validateIntegrationManifest(JSON.parse(await readFile(definition, "utf8")) as unknown);
      if (!validation.ok) {
        throw new PdlcError("VALIDATION_FAILED", `Invalid Integration manifest: ${definition}`, validation.issues);
      }
      if (validation.value.id !== catalogEntry.id) {
        throw new PdlcError("INTEGRATION_ID_MISMATCH", `Integration Catalog entry ${catalogEntry.id} points to ${validation.value.id}`, [{
          code: "INTEGRATION_ID_MISMATCH",
          path: `$.integrations[${index}]`,
          message: `Catalog id ${catalogEntry.id} must match manifest id ${validation.value.id}`,
        }]);
      }
      const root = dirname(definition);
      for (const skill of validation.value.skills) {
        const skillPath = join(root, skill.path, "SKILL.md");
        try {
          if (!(await stat(skillPath)).isFile()) throw new Error("not a file");
        } catch {
          throw new PdlcError("INTEGRATION_SKILL_NOT_FOUND", `Integration Skill '${skill.id}' not found: ${skillPath}`);
        }
      }
      entries.push({ manifest: validation.value, root });
    }
    return new IntegrationRegistry(catalogValidation.value, entries);
  }

  get(id: string): IntegrationEntry {
    const entry = this.integrations.get(id);
    if (!entry) throw new PdlcError("INTEGRATION_NOT_FOUND", `Integration not found: ${id}`);
    return entry;
  }

  list(): IntegrationEntry[] {
    return [...this.integrations.values()].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
  }
}
