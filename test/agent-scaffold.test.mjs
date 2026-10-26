// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const packages = [
  "model",
  "channels",
  "mandate",
  "executor",
  "audit",
  "model-gateway",
  "credentials",
  "memory",
  "registry",
];
const securityCritical = new Set([
  "channels",
  "mandate",
  "executor",
  "audit",
  "model-gateway",
  "credentials",
]);
const bindings = [
  "email-mime",
  "gmail",
  "graph-mail",
  "graph-teams",
  "matrix",
  "slack",
  "discord",
  "bluesky",
  "mastodon",
  "github",
  "telegram",
  "imessage",
  "a2a",
  "mcp",
  "public-http",
  "direct",
  "testing",
];
const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

it("registers the nine private package scaffolds and private daemon under their required names", () => {
  const suite = read("suite.json");
  for (const name of packages) {
    const manifest = read(`packages/agent-${name}/package.json`);
    expect(manifest.name).toBe(`@jeswr/agent-${name}`);
    expect(manifest.private).toBe(true);
    expect(manifest.securityCritical).toBe(securityCritical.has(name));
    expect(suite.packages.filter((entry) => entry === manifest.name)).toHaveLength(1);
    if (securityCritical.has(name)) expect(manifest.scripts.test).toContain("--coverage");
  }
  const daemon = read("apps/agent-daemon/package.json");
  expect(daemon.name).toBe("@jeswr/app-agent-daemon");
  expect(daemon.private).toBe(true);
  expect(suite.applications.filter((entry) => entry.slug === "agent-daemon")).toEqual([
    { slug: "agent-daemon", name: daemon.name, kind: "application" },
  ]);
});

it("exports every channel ingest and send placeholder while keeping GitHub read-only", () => {
  const { exports } = read("packages/agent-channels/package.json");
  expect(Object.keys(exports).sort()).toEqual(
    [
      ".",
      ...bindings.map((binding) => `./${binding}`),
      ...bindings.filter((binding) => binding !== "github").map((binding) => `./${binding}/send`),
    ].sort(),
  );
  for (const [subpath, target] of Object.entries(exports)) {
    const entry = subpath === "." ? "index" : subpath.slice(2);
    expect(target).toEqual({ types: `./dist/${entry}.d.ts`, default: `./dist/${entry}.js` });
  }
});
