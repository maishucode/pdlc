import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitSourceSnapshot {
  revision: string;
  dirtyApplicationPaths: string[];
}

/** Inspect application source while excluding Harness and PDLC metadata changes. */
export async function inspectGitSource(workspaceRoot: string): Promise<GitSourceSnapshot | undefined> {
  let revision: string;
  try {
    const result = await execFileAsync("git", ["-C", workspaceRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
    revision = result.stdout.trim();
  } catch {
    return undefined;
  }
  const status = await execFileAsync("git", ["-C", workspaceRoot, "status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" });
  const dirtyApplicationPaths = status.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").at(-1) ?? "")
    .map((path) => path.replace(/^"|"$/g, ""))
    .filter((path) => path !== ".pdlc" && !path.startsWith(".pdlc/") && path !== "pdlc" && !path.startsWith("pdlc/"))
    .sort();
  return { revision, dirtyApplicationPaths };
}
