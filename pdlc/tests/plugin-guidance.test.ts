import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  agent?: boolean;
  bindings?: unknown[];
  descriptorBindings?: unknown;
  descriptor?: boolean;
  descriptorPlugin?: unknown;
  manifestName?: string;
  manifest?: boolean;
  descriptorName?: string;
  omitDescriptorBindings?: boolean;
  omitDescriptorPlugin?: boolean;
  schemaVersion?: number;
  skillNames?: string[];
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

function referencedSkillNames(bindings: unknown[]): string[] {
  return [...new Set(bindings.flatMap((binding) => {
    if (typeof binding !== "object" || binding === null || !("skills" in binding)) return [];
    const skills = (binding as { skills?: unknown }).skills;
    return Array.isArray(skills) ? skills.filter((skill): skill is string => typeof skill === "string") : [];
  }))];
}

async function createPluginFixture(workspace: string, options: PluginFixtureOptions = {}): Promise<string> {
  const pluginRoot = join(workspace, "lean-pdlc-ux");
  const bindings = options.bindings ?? defaultBindings;
  const descriptorBindings = options.descriptorBindings ?? bindings;
  const skillNames = options.skillNames ?? referencedSkillNames(Array.isArray(descriptorBindings) ? descriptorBindings : []);
  const manifestName = options.manifestName ?? "lean-pdlc-ux";
  const descriptorName = options.descriptorName ?? "lean-pdlc-ux";

  await mkdir(pluginRoot, { recursive: true });
  if (options.manifest !== false) {
    await writeFile(join(pluginRoot, "plugin.json"), JSON.stringify({ name: manifestName }, null, 2));
  }
  if (options.descriptor !== false) {
    const descriptor: Record<string, unknown> = { schemaVersion: options.schemaVersion ?? 1 };
    if (!options.omitDescriptorPlugin) descriptor.plugin = options.descriptorPlugin ?? descriptorName;
    if (!options.omitDescriptorBindings) descriptor.bindings = descriptorBindings;
    await writeFile(
      join(pluginRoot, "pdlc-stage-bindings.json"),
      JSON.stringify(descriptor, null, 2),
    );
  }
  if (options.agent !== false) {
    const agentRoot = join(pluginRoot, "com.github.copilot", "agents");
    await mkdir(agentRoot, { recursive: true });
    await writeFile(
      join(agentRoot, "lean-pdlc-ux.agent.md"),
      "---\nname: Lean PDLC UX\ndescription: Test fixture agent.\ntarget: vscode\n---\n",
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

async function assertGuidanceError(
  workspace: string,
  args: string[],
  expectedCode: string,
  scenario: string,
): Promise<void> {
  const result = await runCli(args, workspace);
  assert.equal(result.exitCode, 2, `${scenario}: ${JSON.stringify(result.output)}`);
  assert.equal(errorCode(result), expectedCode, scenario);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("guidance resolves canonical UX design and React implementation bindings", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "lean-pdlc-plugin-guidance-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const pluginRoot = await createPluginFixture(workspace);

  assert.equal(await pathExists(join(workspace, ".pdlc")), false, "fixture must start without PDLC state");
  assert.equal(await pathExists(join(workspace, ".pdlc", "audit.jsonl")), false, "fixture must start without audit state");

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

  const implementation = await runCli(["guidance", "implementation", "--plugin", "lean-pdlc-ux"], workspace);
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

  assert.equal(await pathExists(join(workspace, ".pdlc")), false, "guidance must not create PDLC state");
  assert.equal(await pathExists(join(workspace, ".pdlc", "audit.jsonl")), false, "guidance must not append audit state");
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
    await assertGuidanceError(workspace, scenario.args, scenario.expectedCode, scenario.name);
  }

  const unknownBindingStage = await createPluginFixture(join(workspace, "unknown-binding-stage"), {
    bindings: [...defaultBindings, { ...defaultBindings[0]!, stage: "not-a-canonical-stage" }],
  });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", unknownBindingStage],
    "STAGE_NOT_FOUND",
    "unknown stage binding rejects a request for an otherwise valid stage",
  );

  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", join(workspace, "plugin-root-does-not-exist")],
    "PLUGIN_ROOT_NOT_FOUND",
    "plugin root not found",
  );

  const missingManifest = await createPluginFixture(join(workspace, "missing-manifest"), { manifest: false });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", missingManifest],
    "PLUGIN_MANIFEST_NOT_FOUND",
    "plugin manifest missing",
  );

  const missingDescriptor = await createPluginFixture(join(workspace, "missing-descriptor"), { descriptor: false });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", missingDescriptor],
    "PLUGIN_DESCRIPTOR_NOT_FOUND",
    "plugin descriptor missing",
  );

  const mismatchedNames = await createPluginFixture(join(workspace, "mismatched-names"), { descriptorName: "other-plugin" });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", mismatchedNames],
    "PLUGIN_NAME_MISMATCH",
    "plugin manifest and descriptor names differ",
  );

  const missingDescriptorPlugin = await createPluginFixture(join(workspace, "missing-descriptor-plugin"), {
    omitDescriptorPlugin: true,
  });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", missingDescriptorPlugin],
    "INVALID_PLUGIN_BINDINGS_DESCRIPTOR",
    "descriptor plugin missing",
  );

  const nonStringDescriptorPlugin = await createPluginFixture(join(workspace, "non-string-descriptor-plugin"), {
    descriptorPlugin: 42,
  });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", nonStringDescriptorPlugin],
    "INVALID_PLUGIN_BINDINGS_DESCRIPTOR",
    "descriptor plugin is not a string",
  );

  const missingBindings = await createPluginFixture(join(workspace, "missing-bindings"), {
    omitDescriptorBindings: true,
  });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", missingBindings],
    "INVALID_PLUGIN_BINDINGS_DESCRIPTOR",
    "descriptor bindings missing",
  );

  const nonArrayBindings = await createPluginFixture(join(workspace, "non-array-bindings"), {
    descriptorBindings: { stage: "ux-design" },
  });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", nonArrayBindings],
    "INVALID_PLUGIN_BINDINGS_DESCRIPTOR",
    "descriptor bindings is not an array",
  );

  const missingAgent = await createPluginFixture(join(workspace, "missing-agent"), { agent: false });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", missingAgent],
    "PLUGIN_AGENT_NOT_FOUND",
    "fixed plugin agent file missing",
  );

  const invalidAgent = await createPluginFixture(join(workspace, "invalid-agent"), {
    bindings: [{ ...defaultBindings[0]!, agent: "other-agent" }],
  });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", invalidAgent],
    "INVALID_PLUGIN_AGENT",
    "invalid plugin agent id",
  );

  const missingSkill = await createPluginFixture(join(workspace, "missing-skill"), {
    bindings: [defaultBindings[0]!],
    skillNames: [],
  });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", missingSkill],
    "PLUGIN_SKILL_NOT_FOUND",
    "referenced plugin skill missing",
  );

  const duplicateStage = await createPluginFixture(join(workspace, "duplicate-stage"), {
    bindings: [defaultBindings[0]!, { ...defaultBindings[0]!, handoff: "A duplicate binding must be rejected." }],
  });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", duplicateStage],
    "DUPLICATE_PLUGIN_STAGE_BINDING",
    "duplicate plugin stage binding",
  );

  const unsupportedSchema = await createPluginFixture(join(workspace, "unsupported-schema"), { schemaVersion: 2 });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", unsupportedSchema],
    "UNSUPPORTED_PLUGIN_BINDINGS_SCHEMA",
    "unsupported descriptor schema version",
  );

  const invalidMode = await createPluginFixture(join(workspace, "invalid-mode"), {
    bindings: [{ ...defaultBindings[0]!, mode: "automatic" }],
  });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", invalidMode],
    "INVALID_PLUGIN_BINDING",
    "invalid plugin binding mode",
  );

  const { handoff: _handoff, ...bindingWithoutHandoff } = defaultBindings[0]!;
  const missingHandoff = await createPluginFixture(join(workspace, "missing-handoff"), {
    bindings: [bindingWithoutHandoff],
  });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", missingHandoff],
    "INVALID_PLUGIN_BINDING",
    "plugin binding handoff missing",
  );

  const emptyHandoff = await createPluginFixture(join(workspace, "empty-handoff"), {
    bindings: [{ ...defaultBindings[0]!, handoff: "" }],
  });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", emptyHandoff],
    "INVALID_PLUGIN_BINDING",
    "plugin binding handoff empty",
  );

  const { approvalBoundary: _approvalBoundary, ...bindingWithoutApprovalBoundary } = defaultBindings[0]!;
  const missingApprovalBoundary = await createPluginFixture(join(workspace, "missing-approval-boundary"), {
    bindings: [bindingWithoutApprovalBoundary],
  });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", missingApprovalBoundary],
    "INVALID_PLUGIN_BINDING",
    "plugin binding approval boundary missing",
  );

  const emptyApprovalBoundary = await createPluginFixture(join(workspace, "empty-approval-boundary"), {
    bindings: [{ ...defaultBindings[0]!, approvalBoundary: "" }],
  });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", emptyApprovalBoundary],
    "INVALID_PLUGIN_BINDING",
    "plugin binding approval boundary empty",
  );

  const emptySkills = await createPluginFixture(join(workspace, "empty-skills"), {
    bindings: [{ ...defaultBindings[0]!, skills: [] }],
  });
  await assertGuidanceError(
    workspace,
    ["guidance", "ux-design", "--plugin", emptySkills],
    "INVALID_PLUGIN_BINDING",
    "plugin binding skills empty",
  );
});
