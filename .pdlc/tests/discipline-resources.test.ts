import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { runCli } from "../cli.ts";
import { disciplineSync } from "../commands/context.ts";

const projectRoot = resolve(import.meta.dirname, "../..");
const uxRoot = join(projectRoot, ".pdlc/disciplines/ux");

test("keeps UX Skills, Agent, and Stage Hooks directly in its Discipline", async () => {
  const hooks = JSON.parse(await readFile(join(uxRoot, "hooks/stages.json"), "utf8"));
  assert.equal(hooks.discipline, "ux");
  assert.equal(hooks.enabled, true);
  assert.deepEqual(hooks.deliveryFlows, ["poc"]);
  assert.deepEqual(hooks.permissions, { filesystem: "write", network: false, externalWrites: false });
  await readFile(join(uxRoot, "agents/lean-pdlc-ux.agent.md"), "utf8");
  for (const skill of ["lean-pdlc-ux-spec", "lean-pdlc-ux-react-ui-delivery", "lean-pdlc-ux-review"]) {
    const contents = await readFile(join(uxRoot, "skills", skill, "SKILL.md"), "utf8");
    assert.match(contents, new RegExp(`name: ${skill}`));
  }
});

test("lists direct Discipline resources without Plugin wrappers", async () => {
  const result = await runCli(["discipline", "list"], projectRoot);
  assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  const ux = (result.output as { disciplines: Array<Record<string, unknown>> }).disciplines.find(({ id }) => id === "ux");
  assert.deepEqual(ux, {
    id: "ux",
    artifacts: 0,
    policies: 1,
    knowledge: 2,
    skills: ["lean-pdlc-ux-react-ui-delivery", "lean-pdlc-ux-review", "lean-pdlc-ux-spec"],
    agents: ["lean-pdlc-ux"],
    hooks: 1,
    stages: ["requirements-clarification", "ux-design", "implementation", "developer-verification", "acceptance-verification"],
  });
});

test("requires the main POC entry point to compose Discipline resources at every Stage", async () => {
  const skill = await readFile(join(projectRoot, ".agents/skills/lean-pdlc/SKILL.md"), "utf8");
  const agent = await readFile(join(projectRoot, ".github/agents/lean-pdlc.agent.md"), "utf8");
  assert.match(skill, /context <stage-id>/);
  assert.match(skill, /Never ask the end user to select a Discipline Agent manually/);
  assert.match(agent, /Discipline contributions extend this Agent; they do not replace it/);
});

test("syncs enabled Discipline assets as a VS Code projection", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "lean-pdlc-discipline-sync-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const first = await runCli(["discipline", "sync", "--root", workspace], projectRoot);
  assert.equal(first.exitCode, 0, JSON.stringify(first.output));
  assert.deepEqual((first.output as { installed: string[] }).installed, [
    ".github/agents/lean-pdlc-ux.agent.md",
    ".github/skills/lean-pdlc-ux-react-ui-delivery/SKILL.md",
    ".github/skills/lean-pdlc-ux-review/SKILL.md",
    ".github/skills/lean-pdlc-ux-spec/SKILL.md",
  ]);
  const repeated = await runCli(["discipline", "sync", "--root", workspace], projectRoot);
  assert.equal(repeated.exitCode, 0, JSON.stringify(repeated.output));
  assert.deepEqual((repeated.output as { installed: string[] }).installed, []);
  assert.equal((repeated.output as { unchanged: string[] }).unchanged.length, 4);
});

test("syncs enabled Discipline assets for non-POC Delivery Flows", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "lean-pdlc-discipline-sync-flow-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const harnessRoot = join(workspace, "harness");
  await cp(join(projectRoot, ".pdlc"), join(harnessRoot, ".pdlc"), {
    recursive: true,
    filter: (source) => basename(source) !== "node_modules",
  });
  const hooksPath = join(harnessRoot, ".pdlc/disciplines/ux/hooks/stages.json");
  const hooks = JSON.parse(await readFile(hooksPath, "utf8"));
  hooks.deliveryFlows = ["product-requirements-analysis"];
  await writeFile(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`);
  const result = await disciplineSync(harnessRoot, { root: join(workspace, "project") });
  assert.equal((result as { installed: string[] }).installed.length, 4);
  assert.deepEqual((result as { disciplines: string[] }).disciplines, ["ux"]);
});

test("lists top-level Integrations and their bundled Skills", async () => {
  const result = await runCli(["integration", "list"], projectRoot);
  assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  assert.deepEqual(result.output, {
    ok: true,
    integrations: [{
      id: "databricks",
      version: "1.0.0",
      owners: ["data-platform-leadership"],
      maintainers: ["data-platform-engineering"],
      permissions: { network: true, credentialRefs: ["DATABRICKS_CONNECTION_PROFILE"], externalWrites: false },
      skills: [],
    }],
  });
});
