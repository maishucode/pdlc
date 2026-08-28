import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AdapterValidationIssue, AdapterValidationResult } from "./contract.ts";

interface EntrypointExpectation {
  path: string;
  markers: string[];
  maximumBytes?: number;
}

const EXPECTATIONS: EntrypointExpectation[] = [
  {
    path: "AGENTS.md",
    markers: ["/pdlc", "lean-pdlc", "Never ask an end user to run Bun"],
  },
  {
    path: ".agents/skills/lean-pdlc/SKILL.md",
    markers: ["## Activate conversationally", "/pdlc <workflow>", "Never show Bun commands"],
  },
  {
    path: ".github/copilot-instructions.md",
    markers: [".agents/skills/lean-pdlc/SKILL.md", "When a request begins with `/pdlc`", "Phase 1 supports the POC workflow only"],
    maximumBytes: 2_500,
  },
  {
    path: ".github/prompts/pdlc.prompt.md",
    markers: ["name: pdlc", "agent: \"agent\"", "../../.agents/skills/lean-pdlc/SKILL.md", "Do not expose or ask the user to run Bun"],
    maximumBytes: 3_000,
  },
  {
    path: ".github/agents/lean-pdlc.agent.md",
    markers: [
      "../../.agents/skills/lean-pdlc/SKILL.md",
      "tools: [\"read\", \"edit\", \"search\", \"execute\"]",
      "user-invocable: true",
      "disable-model-invocation: true",
    ],
    maximumBytes: 4_000,
  },
  {
    path: ".github/workflows/copilot-setup-steps.yml",
    markers: [
      "copilot-setup-steps:",
      "uses: oven-sh/setup-bun@v2",
      "bun test pdlc/tests",
      "bun pdlc/cli.ts validate",
    ],
    maximumBytes: 3_000,
  },
];

const FORBIDDEN_LEGACY_ENTRYPOINTS = [".github/agents/lean-pdlc.md"];

export async function validateConversationEntrypoints(workspaceRoot: string): Promise<AdapterValidationResult> {
  const issues: AdapterValidationIssue[] = [];
  for (const expectation of EXPECTATIONS) {
    const path = join(workspaceRoot, expectation.path);
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch {
      issues.push({ code: "MISSING_ENTRYPOINT", path: expectation.path, message: "Conversational entrypoint file is missing" });
      continue;
    }
    for (const marker of expectation.markers) {
      if (!content.includes(marker)) {
        issues.push({ code: "ENTRYPOINT_DRIFT", path: expectation.path, message: `Required canonical reference or behavior is missing: ${marker}` });
      }
    }
    if (expectation.maximumBytes && Buffer.byteLength(content, "utf8") > expectation.maximumBytes) {
      issues.push({ code: "ADAPTER_NOT_THIN", path: expectation.path, message: `Platform adapter exceeds ${expectation.maximumBytes} bytes` });
    }
  }
  for (const legacyPath of FORBIDDEN_LEGACY_ENTRYPOINTS) {
    try {
      await access(join(workspaceRoot, legacyPath));
      issues.push({
        code: "LEGACY_ENTRYPOINT_PRESENT",
        path: legacyPath,
        message: "Legacy Copilot entrypoint would duplicate the canonical .agent.md profile",
      });
    } catch {
      // The legacy path must remain absent.
    }
  }
  return { ok: issues.length === 0, issues };
}
