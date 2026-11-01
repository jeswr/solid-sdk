// AUTHORED-BY Codex GPT-6.1-Sol
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { execFile } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { promisify } from "util";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const cwd = fileURLToPath(new URL("..", import.meta.url));
const cli = fileURLToPath(new URL("../demos/walkthrough.ts", import.meta.url));

it("runs the D-3 CLI, protects private bodies, and stops CSS", async () => {
  const { stdout, stderr } = await exec(process.execPath, [cli], {
    cwd,
    timeout: 180000,
    maxBuffer: 2 * 1024 * 1024,
  });
  expect(stderr).not.toContain("Error");
  expect(stdout.match(/^SEND /gm)).toHaveLength(2);
  expect(stdout.match(/^EXPECTED approved: audit exit 0$/gm)).toHaveLength(2);
  for (const breach of ["forged-approval", "out-of-scope", "revoked-at-time", "missing-prov"]) {
    expect(stdout).toContain(`BREACH ${breach}`);
    expect(stdout).toContain(`EXPECTED ${breach}: audit exit 1`);
  }
  expect(stdout.match(/^GRANT /gm)).toHaveLength(15);
  expect(stdout).toContain("PRIVATE inbox bodies and proposal previews remain owner-only");
  expect(stdout).toContain("D-3 PASS: two approved audits and four named breaches");
  expect(stdout).not.toMatch(
    /Synthetic private body|synthetic-demo-only|access_token|DPoP |Basic /,
  );
  const base = /^REPLAY BASE (\S+)/m.exec(stdout)?.[1];
  expect(base).toBeDefined();
  const io = createNodeGuardedFetch({ allowLoopback: true, maxRedirects: 0 });
  await expect(io(base as string)).rejects.toThrow();
}, 200000);

it("replays a prepared CSS pod with --base using anonymous reads and exact expected breaches", async () => {
  const fixture = fileURLToPath(new URL("./demo-replay.mjs", import.meta.url));
  const { stdout } = await exec(process.execPath, [fixture], { cwd, timeout: 120000 });
  expect(stdout).toContain("READ-ONLY PASS:");
  expect(stdout).toContain("UNPREPARED PASS:");
  expect(stdout).toContain("MISMATCH PASS:");
}, 310000);

it("prints usage without booting CSS", async () => {
  const { stdout } = await exec(process.execPath, [cli, "--help"], { cwd });
  expect(stdout).toContain("Usage:");
  expect(stdout).not.toContain("OWNER");
});

it.each([
  ["--unknown"],
  ["--base"],
  ["--base", "https://pod.example/", "--unknown"],
  ["--base", "https://user:private-demo-value@pod.example/"],
  ["--base", "https://pod.example/?private-demo-value"],
  ["--base", "https://pod.example/#private-demo-value"],
  ["--base", "file:///private-demo-value/"],
  ["--base", "https://pod.example/no-slash"],
  ["--base", "private-demo-value"],
])("rejects invalid options without exposing their values (%j)", async (...args) => {
  const result = await exec(process.execPath, [cli, ...args], { cwd }).catch((error) => error);
  expect(result.code).toBe(1);
  expect(result.stdout).toMatch(/Usage:|D-3 FAIL:/);
  expect(result.stdout).not.toContain("private-demo-value");
  expect(result.stderr).not.toContain("private-demo-value");
});
