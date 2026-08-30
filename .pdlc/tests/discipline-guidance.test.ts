import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { runCli } from "../cli.ts";
import { buildRequiredStageInvocation } from "../platform-adapters/github-copilot-stage-agent.ts";
import type { DisciplineGuidanceContribution } from "../core/types.ts";

const projectRoot = resolve(import.meta.dirname, "../..");

test("POC Stage entry automatically composes UX Discipline guidance", async () => {
  const result = await runCli(["guidance", "ux-design"], projectRoot);
  assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  assert.deepEqual(result.output, {
    ok: true,
    deliveryFlow: "poc",
    stage: {
      id: "ux-design",
      name: "UX design",
      description: "Define applicable interaction, visual, accessibility, and responsive behavior.",
      phase: "design",
      roleSlots: ["product", "developer", "qa"],
      requirements: ["Apply enterprise UX standards and specify relevant interaction states."],
      outputs: ["ux-design-decisions"],
    },
    contributions: [{
      discipline: "ux",
      version: "1.0.0",
      permissions: {
        filesystem: "write",
        network: false,
        externalWrites: false,
      },
      capability: "ux-design",
      invocation: "required",
      agent: {
        id: "atlas-pdlc-ux",
        path: ".pdlc/disciplines/ux/agents/atlas-pdlc-ux.agent.md",
      },
      candidateSkills: [
        { name: "atlas-pdlc-ux-spec", path: ".pdlc/disciplines/ux/skills/atlas-pdlc-ux-spec/SKILL.md" },
        { name: "atlas-pdlc-ux-review", path: ".pdlc/disciplines/ux/skills/atlas-pdlc-ux-review/SKILL.md" },
        { name: "atlas-pdlc-ux-react-ui-delivery", path: ".pdlc/disciplines/ux/skills/atlas-pdlc-ux-react-ui-delivery/SKILL.md" },
      ],
      mode: "draft",
      handoff: "Draft a reviewable UX specification and textual mockup proposal for product review.",
      approvalBoundary: "The Discipline contribution drafts guidance only; product approval and PDLC state remain outside the Discipline Agent.",
    }],
  });
});

test("an unbound POC Stage continues with core behavior", async () => {
  const result = await runCli(["guidance", "solution-design"], projectRoot);
  assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  assert.deepEqual((result.output as { contributions: unknown[] }).contributions, []);
});

test("requirements, build, and verification Stages expose candidate Skills for Agent selection", async () => {
  const stages = ["requirements-clarification", "implementation", "developer-verification", "acceptance-verification"];
  for (const stage of stages) {
    const result = await runCli(["guidance", stage], projectRoot);
    assert.equal(result.exitCode, 0, `${stage}: ${JSON.stringify(result.output)}`);
    const contributions = (result.output as { contributions: Array<{ candidateSkills: Array<{ name: string }> }> }).contributions;
    assert.deepEqual(contributions[0]?.candidateSkills.map(({ name }) => name), [
      "atlas-pdlc-ux-spec",
      "atlas-pdlc-ux-review",
      "atlas-pdlc-ux-react-ui-delivery",
    ], stage);
  }
});

test("Stage context emits exactly one invocation containing every required capability", async () => {
  const result = await runCli(["context", "ux-design"], projectRoot);
  assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  const invocation = (result.output as { requiredStageInvocation: { stage: string; capabilities: Array<{ capability: string }> } }).requiredStageInvocation;
  assert.equal(invocation.stage, "ux-design");
  assert.deepEqual(invocation.capabilities.map(({ capability }) => capability), ["ux-design"]);
});

test("one Stage invocation batches multiple capabilities and aggregates permissions", async () => {
  const result = await runCli(["guidance", "ux-design"], projectRoot);
  assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  const ux = (result.output as { contributions: DisciplineGuidanceContribution[] }).contributions[0]!;
  const security: DisciplineGuidanceContribution = {
    ...structuredClone(ux),
    discipline: "security",
    capability: "security-design-review",
    permissions: { filesystem: "read", network: true, externalWrites: false },
  };
  const invocation = buildRequiredStageInvocation("a".repeat(64), "ux-design", [ux, security])!;
  assert.deepEqual(invocation.capabilities.map(({ capability }) => capability), ["security-design-review", "ux-design"]);
  assert.deepEqual(invocation.permissions, { filesystem: "write", network: true, externalWrites: false });
});
