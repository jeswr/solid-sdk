// AUTHORED-BY Codex GPT-6.1-Sol
import { spawnSync } from "node:child_process";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("runs the built executable with help and usage process exit codes", () => {
  const bin = fileURLToPath(new URL("../../dist/node/bin.js", import.meta.url));
  const help = spawnSync(execPath, [bin, "--help"], { encoding: "utf8" });
  expect(help.status).toBe(0);
  expect(help.stdout).toContain("Usage: pod-connectors import <id>");
  expect(help.stderr).toBe("");
  const usage = spawnSync(execPath, [bin, "unknown"], { encoding: "utf8" });
  expect(usage.status).toBe(2);
  expect(usage.stdout).toBe("");
  expect(usage.stderr).toContain("Usage: pod-connectors import <id>");
});
