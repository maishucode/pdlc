import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { runCli } from "../cli.ts";
import { discoverDomainHooks } from "../core/domain-guidance.ts";
import type { DomainRegistry } from "../core/domain-registry.ts";
import type { StageRegistry } from "../core/stage-registry.ts";
import type { DomainStageHooksDescriptor } from "../core/types.ts";

const projectRoot = resolve(import.meta.dirname, "../..");

test("POC Stage entry automatically composes UX Domain guidance", async () => {
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
      domain: "ux",
      version: "1.0.0",
      permissions: {
        filesystem: "write",
        network: false,
        externalWrites: false,
      },
      agent: {
        id: "atlas-pdlc-ux",
        path: ".pdlc/domains/ux/agents/atlas-pdlc-ux.agent.md",
      },
      skills: [{
        name: "atlas-pdlc-ux-spec",
        path: ".pdlc/domains/ux/skills/atlas-pdlc-ux-spec/SKILL.md",
      }],
      capability: "ux-design-spec",
      invocation: "required",
      mode: "draft",
      handoff: "Draft a reviewable UX specification and textual mockup proposal for product review.",
      approvalBoundary: "The Domain contribution drafts guidance only; product approval and PDLC state remain outside the Domain Agent.",
    }],
  });
});

test("rejects duplicate Agent capability ids across active Domain Hook bindings", async () => {
  const descriptor = {
    schemaVersion: 2,
    domain: "ux",
    version: "1.0.0",
    deliveryFlows: ["poc"],
    enabled: true,
    permissions: { filesystem: "write", network: false, externalWrites: false },
    bindings: [{
      stage: "ux-design",
      capability: "duplicate-capability",
      invocation: "required",
      agent: "atlas-pdlc-ux",
      skills: ["atlas-pdlc-ux-spec"],
      mode: "draft",
      handoff: "Draft UX guidance.",
      approvalBoundary: "Do not approve the Stage.",
    }],
  } as DomainStageHooksDescriptor;
  const domains = {
    list: () => [
      { manifest: { id: "ux" }, root: join(projectRoot, ".pdlc/domains/ux"), hooks: [{ descriptor }] },
      { manifest: { id: "frontend" }, root: join(projectRoot, ".pdlc/domains/ux"), hooks: [{ descriptor: { ...descriptor, domain: "frontend" } }] },
    ],
  } as unknown as DomainRegistry;
  const stages = { get: (id: string) => ({ id }) } as unknown as StageRegistry;

  await assert.rejects(
    discoverDomainHooks(stages, domains),
    (error: unknown) => error instanceof Error && error.message.includes("duplicate-capability"),
  );
});

test("an unbound POC Stage continues with core behavior", async () => {
  const result = await runCli(["guidance", "solution-design"], projectRoot);
  assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  assert.deepEqual((result.output as { contributions: unknown[] }).contributions, []);
});

test("requirements, build, and verification Stages resolve their Domain-owned Skills", async () => {
  const expected: Record<string, string> = {
    "requirements-clarification": "atlas-pdlc-ux-spec",
    implementation: "atlas-pdlc-ux-react-ui-delivery",
    "developer-verification": "atlas-pdlc-ux-react-ui-delivery",
    "acceptance-verification": "atlas-pdlc-ux-review",
  };
  for (const [stage, skill] of Object.entries(expected)) {
    const result = await runCli(["guidance", stage], projectRoot);
    assert.equal(result.exitCode, 0, `${stage}: ${JSON.stringify(result.output)}`);
    const contributions = (result.output as { contributions: Array<{ skills: Array<{ name: string }> }> }).contributions;
    assert.equal(contributions[0]?.skills[0]?.name, skill, stage);
  }
});
