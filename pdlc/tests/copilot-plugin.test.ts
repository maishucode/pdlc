import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runCli } from "../cli.ts";

const projectRoot = resolve(import.meta.dirname, "../..");
const pluginRoot = join(projectRoot, "pdlc/domains/ux/capabilities/plugins/lean-pdlc-ux");

test("keeps the complete UX Plugin inside its owning Domain", async () => {
  const manifest = JSON.parse(await readFile(join(pluginRoot, "plugin.json"), "utf8"));
  assert.deepEqual(manifest, {
    schemaVersion: 2,
    kind: "plugin",
    id: "lean-pdlc-ux",
    ownerDomain: "ux",
    version: "0.3.0",
    description: "Stage-aware UX design, React delivery, and verification contributions for Lean PDLC.",
    deliveryFlows: ["poc"],
    defaultEnabled: true,
    permissions: {
      filesystem: "write",
      network: false,
      externalWrites: false,
    },
    contributes: {
      stageBindings: "pdlc-stage-bindings.json",
      agents: "agents",
      skills: "skills",
    },
  });
  await readFile(join(pluginRoot, "pdlc-stage-bindings.json"), "utf8");
  await readFile(join(pluginRoot, "agents/lean-pdlc-ux.agent.md"), "utf8");
  for (const skill of ["lean-pdlc-ux-spec", "lean-pdlc-ux-react-ui-delivery", "lean-pdlc-ux-review"]) {
    const contents = await readFile(join(pluginRoot, "skills", skill, "SKILL.md"), "utf8");
    assert.match(contents, new RegExp(`name: ${skill}`));
  }
});

test("lists Domain-owned Plugins with permissions", async () => {
  const result = await runCli(["plugin", "list"], projectRoot);
  assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  assert.deepEqual(result.output, {
    ok: true,
    plugins: [{
      id: "lean-pdlc-ux",
      ownerDomain: "ux",
      version: "0.3.0",
      enabled: true,
      permissions: { filesystem: "write", network: false, externalWrites: false },
      deliveryFlows: ["poc"],
      stages: [
        "requirements-clarification",
        "ux-design",
        "implementation",
        "developer-verification",
        "acceptance-verification",
      ],
    }],
  });
});

test("requires the main POC entry point to compose Plugins at every Stage", async () => {
  const skill = await readFile(join(projectRoot, ".agents/skills/lean-pdlc/SKILL.md"), "utf8");
  const agent = await readFile(join(projectRoot, ".github/agents/lean-pdlc.agent.md"), "utf8");
  assert.match(skill, /context <stage-id>/);
  assert.match(skill, /Never ask the end user to select a Plugin Agent manually/);
  assert.match(agent, /Plugins extend this Agent; they do not replace it/);
});

test("syncs enabled Plugin assets as a VS Code projection", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "lean-pdlc-plugin-sync-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const first = await runCli(["plugin", "sync", "--root", workspace], projectRoot);
  assert.equal(first.exitCode, 0, JSON.stringify(first.output));
  assert.deepEqual((first.output as { installed: string[] }).installed, [
    ".github/agents/lean-pdlc-ux.agent.md",
    ".github/skills/lean-pdlc-ux-react-ui-delivery/SKILL.md",
    ".github/skills/lean-pdlc-ux-review/SKILL.md",
    ".github/skills/lean-pdlc-ux-spec/SKILL.md",
  ]);
  const repeated = await runCli(["plugin", "sync", "--root", workspace], projectRoot);
  assert.equal(repeated.exitCode, 0, JSON.stringify(repeated.output));
  assert.deepEqual((repeated.output as { installed: string[] }).installed, []);
  assert.equal((repeated.output as { unchanged: string[] }).unchanged.length, 4);
});
