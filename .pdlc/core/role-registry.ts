import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { PdlcError } from "./errors.ts";
import { validateRoleCatalog } from "./schema.ts";
import type { PocDeliveryRecord, RoleCatalog, RoleCatalogEntry, RoleSlot, ValidationIssue } from "./types.ts";

export interface ResolvedRole extends RoleCatalogEntry {
  path: string;
}

export class RoleRegistry {
  readonly catalog: RoleCatalog;
  readonly definitions: ReadonlyMap<RoleSlot, ResolvedRole>;

  private constructor(catalog: RoleCatalog, definitions: ReadonlyMap<RoleSlot, ResolvedRole>) {
    this.catalog = catalog;
    this.definitions = definitions;
  }

  static async load(catalogFile: string): Promise<RoleRegistry> {
    const validation = validateRoleCatalog(JSON.parse(await readFile(catalogFile, "utf8")) as unknown);
    if (!validation.ok) throw new PdlcError("VALIDATION_FAILED", `Invalid Role Catalog: ${catalogFile}`, validation.issues);
    const root = dirname(catalogFile);
    const definitions = new Map<RoleSlot, ResolvedRole>();
    for (const [index, role] of validation.value.roles.entries()) {
      const path = resolve(root, role.definition);
      const fromRoot = relative(root, path);
      if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
        throw new PdlcError("INVALID_ROLE_DEFINITION", `Role definition escapes the Role Catalog directory: ${role.definition}`);
      }
      let content: string;
      try { content = await readFile(path, "utf8"); }
      catch (error) {
        throw new PdlcError("ROLE_DEFINITION_NOT_FOUND", `Role definition not found: ${path}`, [{ code: "ROLE_DEFINITION_NOT_FOUND", path: `$.roles[${index}].definition`, message: error instanceof Error ? error.message : String(error) }]);
      }
      if (!content.trim()) throw new PdlcError("INVALID_ROLE_DEFINITION", `Role definition is empty: ${path}`);
      definitions.set(role.id, { ...role, path });
    }
    return new RoleRegistry(validation.value, definitions);
  }

  get(id: RoleSlot): ResolvedRole {
    const role = this.definitions.get(id);
    if (!role) throw new PdlcError("ROLE_NOT_FOUND", `Registered Role not found: ${id}`);
    return role;
  }

  has(id: RoleSlot): boolean {
    return this.definitions.has(id);
  }

  list(): ResolvedRole[] {
    return [...this.definitions.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  validateAssignments(record: Pick<PocDeliveryRecord, "assignments">, requiredRoles: readonly RoleSlot[] = [], requireIdentities = true): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const role of Object.keys(record.assignments)) if (!this.has(role)) {
      issues.push({ code: "UNKNOWN_ROLE_ASSIGNMENT", path: `$.assignments.${role}`, message: `Assignment references an unregistered Role: ${role}` });
    }
    for (const role of requiredRoles) if (!(role in record.assignments)) {
      issues.push({ code: "ROLE_ASSIGNMENT_MISSING", path: `$.assignments.${role}`, message: `The ${role} Role slot is missing for the active Delivery Flow` });
    } else if (requireIdentities && !record.assignments[role]?.trim()) {
      issues.push({ code: "ROLE_IDENTITY_MISSING", path: `$.assignments.${role}`, message: `The ${role} Role must be assigned before the controlled decision` });
    }
    return issues;
  }
}
