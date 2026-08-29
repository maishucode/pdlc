import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PocDeliveryRecord, ValidationIssue } from "./types.ts";

const PACKAGE_MARKERS = [
  "<!-- pdlc:productization-package:v1 -->",
  "<!-- pdlc:section:validated-outcome -->",
  "<!-- pdlc:section:evidence -->",
  "<!-- pdlc:section:gaps -->",
  "<!-- pdlc:section:reuse -->",
  "<!-- pdlc:section:control-handoff -->",
  "<!-- pdlc:section:delivery-handoff -->",
  "<!-- pdlc:productization-review:presented -->",
] as const;

export interface ProductizationPackageAssessment {
  ok: boolean;
  issues: ValidationIssue[];
  documentRef?: string;
  contentHash?: string;
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}

function isInsideWorkspace(workspaceRoot: string, target: string): boolean {
  const pathFromRoot = relative(resolve(workspaceRoot), target);
  return pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
}

export async function assessProductizationPackage(
  workspaceRoot: string,
  record: PocDeliveryRecord,
): Promise<ProductizationPackageAssessment> {
  const issues: ValidationIssue[] = [];
  const expectedRef = `pdlc/artifacts/${record.id}/productization-package.md`;
  const configuredRef = record.decision.productizationPackage.documentRef;
  if (configuredRef && configuredRef !== expectedRef) {
    issues.push(issue("PRODUCTIZATION_PACKAGE_LOCATION", "$.decision.productizationPackage.documentRef", `Productization Package must be stored at ${expectedRef}`));
    return { ok: false, issues };
  }
  const documentRef = expectedRef;
  if (isAbsolute(documentRef)) {
    issues.push(issue("UNSAFE_PRODUCTIZATION_PACKAGE_REF", "$.decision.productizationPackage.documentRef", "Productization Package reference must be relative to the workspace"));
    return { ok: false, issues };
  }
  const documentPath = resolve(workspaceRoot, documentRef);
  if (!isInsideWorkspace(workspaceRoot, documentPath)) {
    issues.push(issue("UNSAFE_PRODUCTIZATION_PACKAGE_REF", "$.decision.productizationPackage.documentRef", "Productization Package reference escapes the workspace"));
    return { ok: false, issues };
  }

  let contents: string;
  try {
    contents = await readFile(documentPath, "utf8");
  } catch (error) {
    issues.push(issue("PRODUCTIZATION_PACKAGE_UNREADABLE", "$.decision.productizationPackage.documentRef", error instanceof Error ? error.message : String(error)));
    return { ok: false, issues };
  }
  for (const marker of PACKAGE_MARKERS) {
    if (!contents.includes(marker)) issues.push(issue("PRODUCTIZATION_PACKAGE_SECTION_MISSING", "$.decision.productizationPackage.documentRef", `Missing required package marker: ${marker}`));
  }
  if (!contents.includes(`- Source POC: \`${record.id}\``)) issues.push(issue("PRODUCTIZATION_PACKAGE_SOURCE_MISMATCH", "$.decision.productizationPackage.documentRef", `Package must identify source POC ${record.id}`));
  if (!contents.includes(`- Source revision: \`${record.revision}\``)) issues.push(issue("PRODUCTIZATION_PACKAGE_REVISION_MISMATCH", "$.decision.productizationPackage.documentRef", `Package must identify source revision ${record.revision}`));

  const requiredRefs = [
    record.requirements.documentRef,
    ...record.evidence.tests.map(({ ref }) => ref),
    ...record.evidence.build.map(({ ref }) => ref),
    ...record.evidence.security.map(({ ref }) => ref),
    ...record.evidence.demo.map(({ ref }) => ref),
    ...record.resolution.controls.applicable,
    ...record.resolution.controls.exceptions,
  ];
  for (const ref of new Set(requiredRefs)) {
    if (!contents.includes(ref)) issues.push(issue("PRODUCTIZATION_PACKAGE_REF_MISSING", "$.decision.productizationPackage.documentRef", `Package must reference source material: ${ref}`));
  }
  for (const asset of ["Requirements", "Design", "Code"] as const) {
    const disposition = new RegExp(`\\|\\s*${asset}\\s*\\|\\s*[\\x60]?(adopt|refine|replace)[\\x60]?\\s*\\|`, "i");
    if (!disposition.test(contents)) issues.push(issue("PRODUCTIZATION_REUSE_DISPOSITION_MISSING", "$.decision.productizationPackage.documentRef", `Package must record adopt, refine, or replace for ${asset}`));
  }
  if (!/- Recommended Delivery Flow:\s*`(?:implementation|pdlc)`/i.test(contents)) {
    issues.push(issue("PRODUCTIZATION_FLOW_RECOMMENDATION_MISSING", "$.decision.productizationPackage.documentRef", "Package must recommend implementation or pdlc as the formal Delivery Flow"));
  }
  const visibleContents = contents.replace(/<!--[\s\S]*?-->/g, "");
  if (/<[^>]+>|\bTBD\b|Pending confirmation|Pending review/i.test(visibleContents)) {
    issues.push(issue("PRODUCTIZATION_PACKAGE_PLACEHOLDER_REMAINS", "$.decision.productizationPackage.documentRef", "Productization Package still contains draft placeholders"));
  }
  const contentHash = createHash("sha256").update(contents).digest("hex");
  return { ok: issues.length === 0, issues, documentRef, contentHash };
}
