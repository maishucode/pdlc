import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "../..");
const pluginRoot = join(projectRoot, "examples/copilot-plugins/lean-pdlc-ux");

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat();
}

function splitFrontmatter(source: string): { frontmatter: string; body: string } {
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  assert(match, "expected Markdown frontmatter");
  return { frontmatter: match[1], body: match[2] };
}

test("ships one minimal Agent Plugins 1.0 UX Copilot plugin", async () => {
  const expectedFiles = [
    "README.md",
    "com.github.copilot/agents/lean-pdlc-ux.agent.md",
    "plugin.json",
    "skills/ux-review/SKILL.md",
    "skills/ux-spec/SKILL.md",
  ];
  const files = (await listFiles(pluginRoot))
    .map((path) => relative(pluginRoot, path))
    .sort();

  assert.deepEqual(files, expectedFiles);
  assert.equal(files.filter((path) => path.endsWith(".agent.md")).length, 1);
  assert.equal(files.filter((path) => path.endsWith("/SKILL.md")).length, 2);
  assert.equal(
    files.some((path) => /(?:^|\/)(?:hooks?|mcp|scripts?)(?:\/|\.|$)/i.test(path)),
    false,
    "the example must not ship hook, MCP, or script files",
  );
});

test("declares a portable Agent Plugins 1.0 manifest without legacy components", async () => {
  const manifest = JSON.parse(await readFile(join(pluginRoot, "plugin.json"), "utf8")) as Record<string, unknown>;

  assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(manifest.name, "lean-pdlc-ux");
  assert.equal(manifest.version, "0.1.0");
  for (const legacyComponent of ["agents", "skills", "hooks", "commands", "extensions", "mcpServers"]) {
    assert.equal(
      Object.hasOwn(manifest, legacyComponent),
      false,
      `manifest must not use the legacy ${legacyComponent} component field`,
    );
  }
});

test("keeps the VS Code UX agent read-only and outside PDLC control boundaries", async () => {
  const source = await readFile(join(pluginRoot, "com.github.copilot/agents/lean-pdlc-ux.agent.md"), "utf8");
  const { frontmatter, body } = splitFrontmatter(source);

  assert.match(frontmatter, /^target: vscode$/m);
  assert.match(frontmatter, /^user-invocable: true$/m);
  assert.match(frontmatter, /^tools: \[read, search\]$/m);
  assert.doesNotMatch(frontmatter, /\bedit\b/i);
  assert.match(body, /(?:must not|do not|cannot) approve requirements/i);
  assert.match(body, /(?:must not|do not|cannot) bypass Build Readiness/i);
  assert.match(body, /(?:must not|do not|cannot) alter (?:the )?workflow/i);
  assert.match(body, /(?:must not|do not|cannot) alter (?:the )?state/i);
  assert.match(body, /(?:must not|do not|cannot) (?:write|modify) workspace files/i);
});

test("keeps UX skills portable, conventionally named, and focused on usable output", async () => {
  const skillSources = await Promise.all(["ux-spec", "ux-review"].map(async (skill) => {
    const source = await readFile(join(pluginRoot, "skills", skill, "SKILL.md"), "utf8");
    return { skill, ...splitFrontmatter(source), source };
  }));

  for (const { skill, frontmatter } of skillSources) {
    assert.match(frontmatter, new RegExp(`^name: ${skill}$`, "m"));
    assert.match(frontmatter, /^description: .+$/m);
  }

  const uxSpec = skillSources.find(({ skill }) => skill === "ux-spec")?.source ?? "";
  for (const requiredState of [
    "normal",
    "loading",
    "empty",
    "error",
    "validation",
    "destructive",
    "responsive",
    "accessibility",
  ]) {
    assert.match(uxSpec, new RegExp(`\\b${requiredState}\\b`, "i"), `ux-spec must cover ${requiredState} state`);
  }

  const uxReview = skillSources.find(({ skill }) => skill === "ux-review")?.source ?? "";
  for (const requiredOutput of ["evidence-backed", "severity", "evidence", "recommendation", "link", "acceptance criteria"]) {
    assert.match(uxReview, new RegExp(requiredOutput, "i"), `ux-review must require ${requiredOutput}`);
  }
});
