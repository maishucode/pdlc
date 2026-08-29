import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { EvidenceRef, ValidationIssue } from "./types.ts";

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}

function isInside(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}

function validWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function localEvidenceIssues(workspaceRoot: string, evidence: EvidenceRef, path: string): Promise<ValidationIssue[]> {
  if (isAbsolute(evidence.ref)) return [issue("EVIDENCE_REF_UNSAFE", `${path}.ref`, "Local evidence must use a workspace-relative path")];
  const workspacePath = resolve(workspaceRoot);
  const candidate = resolve(workspacePath, evidence.ref);
  if (!isInside(workspacePath, candidate)) return [issue("EVIDENCE_REF_UNSAFE", `${path}.ref`, "Local evidence reference escapes the project workspace")];
  try {
    const [workspaceRealPath, evidenceRealPath] = await Promise.all([realpath(workspacePath), realpath(candidate)]);
    if (!isInside(workspaceRealPath, evidenceRealPath)) return [issue("EVIDENCE_REF_UNSAFE", `${path}.ref`, "Local evidence resolves outside the project workspace")];
    const details = await stat(evidenceRealPath);
    if (!details.isFile()) return [issue("EVIDENCE_NOT_FILE", `${path}.ref`, "Local evidence must reference a regular file")];
    await access(evidenceRealPath, constants.R_OK);
    return [];
  } catch (error) {
    return [issue("EVIDENCE_UNREADABLE", `${path}.ref`, `Evidence cannot be read: ${error instanceof Error ? error.message : String(error)}`)];
  }
}

export async function assessEvidenceIntegrity(
  workspaceRoot: string,
  groups: Array<{ name: string; entries: EvidenceRef[] }>,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  for (const { name, entries } of groups) {
    for (let index = 0; index < entries.length; index += 1) {
      const evidence = entries[index];
      const path = `$.evidence.${name}[${index}]`;
      if (evidence.kind === "url" || evidence.kind === "ci" || (evidence.kind === "demo" && validWebUrl(evidence.ref))) {
        if (!validWebUrl(evidence.ref)) issues.push(issue("EVIDENCE_URL_INVALID", `${path}.ref`, "URL and CI evidence must use an absolute HTTP or HTTPS URL"));
      } else {
        issues.push(...await localEvidenceIssues(workspaceRoot, evidence, path));
      }
    }
  }
  return issues;
}
