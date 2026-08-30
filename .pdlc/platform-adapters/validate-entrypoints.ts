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
    markers: ["/atlas-pdlc", "legacy text alias `/pdlc`", "atlas-pdlc", "Never ask an end user to run Bun"],
  },
  {
    path: ".agents/skills/atlas-pdlc/SKILL.md",
    markers: ["## Activate conversationally", "/atlas-pdlc <delivery-flow>", "Never show Bun commands"],
  },
  {
    path: ".github/copilot-instructions.md",
    markers: [".agents/skills/atlas-pdlc/SKILL.md", "legacy text alias `/pdlc`", "POC Delivery Flow and the local Product Requirements Analysis Flow"],
    maximumBytes: 2_500,
  },
  {
    path: ".github/prompts/atlas-pdlc.prompt.md",
    markers: ["name: atlas-pdlc", "agent: \"agent\"", "tools: [\"read\", \"edit\", \"search\", \"execute\", \"agent\"]", "../../.agents/skills/atlas-pdlc/SKILL.md", "Do not expose or ask the user to run Bun"],
    maximumBytes: 3_000,
  },
  {
    path: ".github/agents/atlas-pdlc.agent.md",
    markers: [
      "../../.agents/skills/atlas-pdlc/SKILL.md",
      "tools: [\"read\", \"edit\", \"search\", \"execute\", \"agent\"]",
      "user-invocable: true",
      "disable-model-invocation: true",
      "requiredStageInvocation",
    ],
    maximumBytes: 4_000,
  },
  {
    path: ".github/workflows/copilot-setup-steps.yml",
    markers: [
      "copilot-setup-steps:",
      "uses: oven-sh/setup-bun@v2",
      "bun run --cwd .pdlc test",
      "bun .pdlc/cli.ts validate",
    ],
    maximumBytes: 3_000,
  },
];

const FORBIDDEN_LEGACY_PATHS = [
  ".github/agents/atlas-pdlc.md",
  ".pdlc/audit",
  ".pdlc/config",
  ".pdlc/current",
  ".pdlc/evidence",
  ".pdlc/locks",
  ".pdlc/project",
  ".pdlc/questions",
  ".pdlc/records",
  ".pdlc/requirements",
  ".pdlc/core/plugin-guidance.ts",
  ".pdlc/disciplines/ux/capabilities",
  ".pdlc/schemas/integration-adapter.schema.json",
  ".pdlc/schemas/plugin.schema.json",
  "pdlc/cli.ts",
  "pdlc/config",
  "pdlc/core",
  "pdlc/defaults",
  "pdlc/delivery-flows",
  "pdlc/examples",
  "pdlc/harnesses",
  "pdlc/integrations",
  "pdlc/journeys",
  "pdlc/platform-adapters",
  "pdlc/principles",
  "pdlc/roles",
  "pdlc/schemas",
  "pdlc/stages",
  "pdlc/templates",
  "pdlc/tests",
  "pdlc/workflows",
  "plugins",
];

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
  for (const legacyPath of FORBIDDEN_LEGACY_PATHS) {
    try {
      await access(join(workspaceRoot, legacyPath));
      issues.push({
        code: "LEGACY_PATH_PRESENT",
        path: legacyPath,
        message: "Legacy or obsolete path is present; v2 must keep Harness and Runner content under .pdlc and project-owned content under pdlc",
      });
    } catch {
      // The legacy path must remain absent.
    }
  }
  return { ok: issues.length === 0, issues };
}
