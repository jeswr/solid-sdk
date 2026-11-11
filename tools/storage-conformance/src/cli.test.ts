// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { main } from "./cli.js";

afterEach(() => vi.unstubAllEnvs());

test("CLI expands memory and persists green reports with a zero exit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "storage-cli-"));
  try {
    expect(await main(["--", "--target", "memory", "--output", directory])).toBe(0);
    for (const target of ["memory-solid", "memory-solid-acp", "memory-lws"]) {
      const rows = JSON.parse(await readFile(join(directory, "reports", `${target}.json`), "utf8"));
      expect(rows.filter((row: { status: string }) => row.status === "fail")).toEqual([]);
    }
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
  // Runs three full memory targets (now 40+ cases each); 5 s is too tight under CI coverage load.
}, 30_000);

test("CLI writes a green LWS report for all supported groups", async () => {
  const directory = await mkdtemp(join(tmpdir(), "storage-cli-lws-"));
  try {
    expect(await main(["--target", "memory-lws", "--output", directory])).toBe(0);
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
