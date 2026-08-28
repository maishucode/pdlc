import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runCli } from "../cli.ts";

const projectRoot = resolve(import.meta.dirname, "../..");
const pluginRoot = join(projectRoot, "plugins/lean-pdlc-ux");

test("ships a Lean PDLC UX plugin with VS Code-native components", async () => {
  const manifest = JSON.parse(await readFile(join(pluginRoot, "plugin.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(manifest, {
    name: "lean-pdlc-ux",
    description: "Stage-aware UX design, React delivery, and verification guidance for Lean PDLC.",
    version: "0.2.0",
    kind: "lean-pdlc-plugin",
  });
  await readFile(join(pluginRoot, "agents/lean-pdlc-ux.agent.md"), "utf8");
  for (const skill of ["lean-pdlc-ux-spec", "lean-pdlc-react-ui-delivery", "lean-pdlc-ux-review"]) {
    await readFile(join(pluginRoot, "skills", skill, "SKILL.md"), "utf8");
  }
});

test("installs plugin Agent and Skills into VS Code native directories", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "lean-pdlc-plugin-install-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const installed = await runCli(["plugin", "lean-pdlc-ux", "--root", workspace], workspace);
  assert.equal(installed.exitCode, 0, JSON.stringify(installed.output));
  assert.deepEqual((installed.output as { installed: string[] }).installed, [
    ".github/agents/lean-pdlc-ux.agent.md",
    ".github/skills/lean-pdlc-react-ui-delivery/SKILL.md",
    ".github/skills/lean-pdlc-ux-review/SKILL.md",
    ".github/skills/lean-pdlc-ux-spec/SKILL.md",
  ]);
  assert.match(await readFile(join(workspace, ".github/agents/lean-pdlc-ux.agent.md"), "utf8"), /name: Lean PDLC UX/);
  const repeated = await runCli(["plugin", "lean-pdlc-ux", "--root", workspace], workspace);
  assert.equal(repeated.exitCode, 0, JSON.stringify(repeated.output));
  assert.deepEqual((repeated.output as { installed: string[] }).installed, []);
  assert.equal((repeated.output as { unchanged: string[] }).unchanged.length, 4);
});

test("keeps UX stage bindings narrow and installable", async () => {
  const descriptor = JSON.parse(await readFile(join(pluginRoot, "pdlc-stage-bindings.json"), "utf8")) as { bindings: Array<{ stage: string; skills: string[] }> };
  assert.deepEqual(descriptor.bindings.map(({ stage, skills }) => ({ stage, skills })), [
    { stage: "requirements-clarification", skills: ["lean-pdlc-ux-spec"] },
    { stage: "ux-design", skills: ["lean-pdlc-ux-spec"] },
    { stage: "implementation", skills: ["lean-pdlc-react-ui-delivery"] },
    { stage: "developer-verification", skills: ["lean-pdlc-react-ui-delivery"] },
    { stage: "acceptance-verification", skills: ["lean-pdlc-ux-review"] },
  ]);
});
