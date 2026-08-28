import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../cli.ts";

interface StageBinding {
  stage: string;
  agent: string;
  skills: string[];
  mode: "draft" | "implement" | "verify";
  handoff: string;
  approvalBoundary: string;
}

interface GuidanceOutput {
  ok: true;
  stage: {
    id: string;
    name: string;
    description: string;
    phase: string;
    roleSlots: string[];
    requirements: string[];
    outputs: string[];
  };
  guidance: {
    plugin: string;
    agent: string;
    skills: string[];
    mode: "draft" | "implement" | "verify";
    handoff: string;
    approvalBoundary: string;
  };
}

interface PluginFixtureOptions {
  manifestName?: string;
  descriptorName?: string;
  bindings?: StageBinding[];
  skillNames?: string[];
  descriptor?: boolean;
}

const defaultBindings: StageBinding[] = [
  {
    stage: "ux-design",
    agent: "lean-pdlc-ux",
    skills: ["ux-spec"],
    mode: "draft",
    handoff: "Review the UX specification and mockup proposal before implementation.",
    approvalBoundary: "The plugin drafts guidance only; PDLC approval remains with the accountable product role.",
  },
  {
    stage: "implementation",
    agent: "lean-pdlc-ux",
    skills: ["react-ui-delivery"],
    mode: "implement",
    handoff: "Implement only the approved UX specification and report focused test evidence.",
    approvalBoundary: "The plugin may edit approved React UI work but cannot approve scope, gates, or PDLC state.",
  },
];

async function createPluginFixture(workspace: string, options: PluginFixtureOptions = {}): Promise<string> {
  const pluginRoot = join(workspace, "lean-pdlc-ux");
  const bindings = options.bindings ?? defaultBindings;
  const skillNames = options.skillNames ?? [...new Set(bindings.flatMap((binding) => binding.skills))];
  const manifestName = options.manifestName ?? "lean-pdlc-ux";
  const descriptorName = options.descriptorName ?? "lean-pdlc-ux";

  await mkdir(pluginRoot, { recursive: true });
  await writeFile(join(pluginRoot, "plugin.json"), JSON.stringify({ name: manifestName }, null, 2));
  if (options.descriptor !== false) {
    await writeFile(
      join(pluginRoot, "pdlc-stage-bindings.json"),
      JSON.stringify({ schemaVersion: 1, plugin: descriptorName, bindings }, null, 2),
    );
  }
  await Promise.all(skillNames.map(async (skill) => {
    const skillRoot = join(pluginRoot, "skills", skill);
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), `---\nname: ${skill}\ndescription: Test fixture skill.\n---\n`);
  }));
  return pluginRoot;
}

function errorCode(result: { output: unknown }): string {
  return (result.output as { error: { code: string } }).error.code;
}

test("guidance resolves canonical UX design and React implementation bindings", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "lean-pdlc-plugin-guidance-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const pluginRoot = await createPluginFixture(workspace);

  const design = await runCli(["guidance", "ux-design", "--plugin", pluginRoot], workspace);
  assert.equal(design.exitCode, 0, JSON.stringify(design.output));
  assert.deepEqual(design.output, {
    ok: true,
    stage: {
      id: "ux-design",
      name: "UX design",
      description: "Define applicable interaction, visual, accessibility, and responsive behavior.",
      phase: "design",
      roleSlots: ["product", "developer", "qa"],
      requirements: ["Apply enterprise UX standards and specify relevant interaction states."],
      outputs: ["ux-design-decisions"],
    },
    guidance: {
      plugin: "lean-pdlc-ux",
      agent: "lean-pdlc-ux",
      skills: ["ux-spec"],
      mode: "draft",
      handoff: "Review the UX specification and mockup proposal before implementation.",
      approvalBoundary: "The plugin drafts guidance only; PDLC approval remains with the accountable product role.",
    },
  } satisfies GuidanceOutput);

  const implementation = await runCli(["guidance", "implementation", "--plugin", pluginRoot], workspace);
  assert.equal(implementation.exitCode, 0, JSON.stringify(implementation.output));
  assert.deepEqual(implementation.output, {
    ok: true,
    stage: {
      id: "implementation",
      name: "Implementation",
      description: "Implement the approved scope and applicable standards.",
      phase: "build",
      roleSlots: ["developer"],
      requirements: ["Build only approved behavior and route material deviations through the controlled requirements process."],
      outputs: ["implementation"],
    },
    guidance: {
      plugin: "lean-pdlc-ux",
      agent: "lean-pdlc-ux",
      skills: ["react-ui-delivery"],
      mode: "implement",
      handoff: "Implement only the approved UX specification and report focused test evidence.",
      approvalBoundary: "The plugin may edit approved React UI work but cannot approve scope, gates, or PDLC state.",
    },
  } satisfies GuidanceOutput);
});

test("guidance rejects invalid plugin-stage contracts with stable error codes", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "lean-pdlc-plugin-guidance-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const pluginRoot = await createPluginFixture(workspace);

  const cases: Array<{ name: string; args: string[]; expectedCode: string }> = [
    {
      name: "known but unbound stage",
      args: ["guidance", "solution-design", "--plugin", pluginRoot],
      expectedCode: "PLUGIN_STAGE_UNBOUND",
    },
    {
      name: "unknown canonical stage",
      args: ["guidance", "not-a-canonical-stage", "--plugin", pluginRoot],
      expectedCode: "STAGE_NOT_FOUND",
    },
    {
      name: "missing plugin option",
      args: ["guidance", "ux-design"],
      expectedCode: "PLUGIN_REQUIRED",
    },
  ];

  for (const scenario of cases) {
    const result = await runCli(scenario.args, workspace);
    assert.equal(result.exitCode, 2, `${scenario.name}: ${JSON.stringify(result.output)}`);
    assert.equal(errorCode(result), scenario.expectedCode, scenario.name);
  }

  const missingDescriptor = await createPluginFixture(join(workspace, "missing-descriptor"), { descriptor: false });
  const missingDescriptorResult = await runCli(["guidance", "ux-design", "--plugin", missingDescriptor], workspace);
  assert.equal(missingDescriptorResult.exitCode, 2, JSON.stringify(missingDescriptorResult.output));
  assert.equal(errorCode(missingDescriptorResult), "PLUGIN_DESCRIPTOR_NOT_FOUND");

  const mismatchedNames = await createPluginFixture(join(workspace, "mismatched-names"), { descriptorName: "other-plugin" });
  const mismatchResult = await runCli(["guidance", "ux-design", "--plugin", mismatchedNames], workspace);
  assert.equal(mismatchResult.exitCode, 2, JSON.stringify(mismatchResult.output));
  assert.equal(errorCode(mismatchResult), "PLUGIN_NAME_MISMATCH");

  const invalidAgent = await createPluginFixture(join(workspace, "invalid-agent"), {
    bindings: [{ ...defaultBindings[0], agent: "other-agent" }],
  });
  const invalidAgentResult = await runCli(["guidance", "ux-design", "--plugin", invalidAgent], workspace);
  assert.equal(invalidAgentResult.exitCode, 2, JSON.stringify(invalidAgentResult.output));
  assert.equal(errorCode(invalidAgentResult), "INVALID_PLUGIN_AGENT");

  const missingSkill = await createPluginFixture(join(workspace, "missing-skill"), {
    bindings: [defaultBindings[0]],
    skillNames: [],
  });
  const missingSkillResult = await runCli(["guidance", "ux-design", "--plugin", missingSkill], workspace);
  assert.equal(missingSkillResult.exitCode, 2, JSON.stringify(missingSkillResult.output));
  assert.equal(errorCode(missingSkillResult), "PLUGIN_SKILL_NOT_FOUND");

  const duplicateStage = await createPluginFixture(join(workspace, "duplicate-stage"), {
    bindings: [defaultBindings[0], { ...defaultBindings[0], handoff: "A duplicate binding must be rejected." }],
  });
  const duplicateStageResult = await runCli(["guidance", "ux-design", "--plugin", duplicateStage], workspace);
  assert.equal(duplicateStageResult.exitCode, 2, JSON.stringify(duplicateStageResult.output));
  assert.equal(errorCode(duplicateStageResult), "DUPLICATE_PLUGIN_STAGE_BINDING");
});
