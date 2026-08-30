import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { runCli } from "../cli.ts";

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
      agent: {
        id: "lean-pdlc-ux",
        path: ".pdlc/disciplines/ux/agents/lean-pdlc-ux.agent.md",
      },
      skills: [{
        name: "lean-pdlc-ux-spec",
        path: ".pdlc/disciplines/ux/skills/lean-pdlc-ux-spec/SKILL.md",
      }],
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

test("requirements, build, and verification Stages resolve their Discipline-owned Skills", async () => {
  const expected: Record<string, string> = {
    "requirements-clarification": "lean-pdlc-ux-spec",
    implementation: "lean-pdlc-ux-react-ui-delivery",
    "developer-verification": "lean-pdlc-ux-react-ui-delivery",
    "acceptance-verification": "lean-pdlc-ux-review",
  };
  for (const [stage, skill] of Object.entries(expected)) {
    const result = await runCli(["guidance", stage], projectRoot);
    assert.equal(result.exitCode, 0, `${stage}: ${JSON.stringify(result.output)}`);
    const contributions = (result.output as { contributions: Array<{ skills: Array<{ name: string }> }> }).contributions;
    assert.equal(contributions[0]?.skills[0]?.name, skill, stage);
  }
});
