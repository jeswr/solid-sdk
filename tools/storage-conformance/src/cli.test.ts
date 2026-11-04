// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { main } from "./cli.js";

afterEach(() => vi.unstubAllEnvs());

test("CLI accepts pnpm's separator, expands memory and writes successful reports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "storage-cli-"));
  try {
    expect(await main(["--", "--target", "memory", "--output", directory])).toBe(0);
    expect(
      JSON.parse(await readFile(join(directory, "reports", "memory-lws.json"), "utf8")),
    ).toContainEqual({
      test: "SC-ERR-move-capability",
      status: "skip",
      feature: "move",
      reason: "target-lacks:move",
    });
    expect(await readFile(join(directory, "MATRIX.md"), "utf8")).toContain("memory-solid");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI honors TARGET and writes a failure report with a nonzero exit code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "storage-cli-"));
  vi.stubEnv("TARGET", "sparq-solid");
  try {
    expect(await main(["--output", directory])).toBe(1);
    expect(
      JSON.parse(await readFile(join(directory, "reports", "sparq-solid.json"), "utf8")),
    ).toContainEqual({
      test: "start",
      status: "fail",
      feature: null,
      reason: "start-failed:no-storage-link",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI rejects invalid targets and arguments", async () => {
  await expect(main(["--target", "typo"])).rejects.toThrow("Unknown conformance target");
  await expect(main(["--unknown"])).rejects.toThrow();
});
