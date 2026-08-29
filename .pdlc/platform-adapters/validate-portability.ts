import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import type { AdapterValidationIssue, AdapterValidationResult } from "./contract.ts";

const FORBIDDEN_CORE_MARKERS: ReadonlyArray<{ code: string; marker: string }> = [
  { code: "PLATFORM_PATH_IN_CORE", marker: ".co" + "dex" },
  { code: "PLATFORM_PATH_IN_CORE", marker: ".git" + "hub" },
  { code: "PLATFORM_NAME_IN_CORE", marker: "Co" + "dex" },
  { code: "PLATFORM_NAME_IN_CORE", marker: "Cop" + "ilot" },
];

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if ([".ts", ".json", ".md"].includes(extname(entry.name))) files.push(path);
  }
  return files.sort();
}

export async function validateCorePortability(coreDirectory: string): Promise<AdapterValidationResult> {
  const issues: AdapterValidationIssue[] = [];
  for (const file of await sourceFiles(coreDirectory)) {
    const content = await readFile(file, "utf8");
    const lines = content.split("\n");
    for (const { code, marker } of FORBIDDEN_CORE_MARKERS) {
      lines.forEach((line, index) => {
        if (line.includes(marker)) {
          issues.push({
            code,
            path: `${relative(coreDirectory, file)}:${index + 1}`,
            message: `Shared Core contains platform-specific marker: ${marker}`,
          });
        }
      });
    }
  }
  return { ok: issues.length === 0, issues };
}

