// AUTHORED-BY Codex GPT-6
import { FileLedger, type LedgerEntry, MemoryLedger } from "@jeswr/agent-audit";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { execFile } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { promisify } from "util";
import { afterEach, expect, it, vi } from "vitest";
import { runAwpCli } from "../src/cli.js";

const AT = "2026-11-01T12:00:00.000Z";
const record = {
  type: "model-call",
  id: "urn:call:1",
  agent: "urn:agent:1",
  owner: "urn:owner:1",
  taskId: "paper-1",
  tokens: 50,
} as const;
const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function path() {
  const directory = mkdtempSync(join(tmpdir(), "awp-stats-"));
  directories.push(directory);
  return join(directory, "events.jsonl");
}
function fixture() {
  const ledger = new MemoryLedger();
  ledger.append(record, AT);
  ledger.append({ ...record, id: "urn:call:2", taskId: "paper-2", tokens: 10 }, AT);
  const stdout = vi.fn<(text: string) => void>();
  const stderr = vi.fn<(text: string) => void>();
  const readLedger = vi.fn((): readonly LedgerEntry[] => ledger.entries());
  return { ledger, io: { stdout, stderr, readLedger } };
}

it("prints filtered JSON by default and CSV on request", () => {
  const { io } = fixture();
  expect(runAwpCli(["stats", "--task", "paper-1", "--ledger", "fixture"], io)).toBe(0);
  expect(io.readLedger).toHaveBeenCalledWith("fixture");
  expect(JSON.parse(io.stdout.mock.calls[0]?.[0] as string).tasks).toMatchObject([
    { taskId: "paper-1", modelCalls: 1, tokens: 50 },
  ]);
  expect(io.stderr).not.toHaveBeenCalled();
  io.stdout.mockClear();
  expect(runAwpCli(["stats", "--ledger", "fixture", "--format", "csv"], io)).toBe(0);
  expect(io.stdout.mock.calls[0]?.[0]).toContain('"paper-1","1"');
  expect(io.stdout.mock.calls[0]?.[0]).toContain('"paper-2","1"');
});

it.each(
  [
    [],
    ["run"],
    ["stats"],
    ["stats", "--task", "paper-1"],
    ["stats", "--ledger"],
    ["stats", "--ledger", ""],
    ["stats", "--ledger", "--task"],
    ["stats", "--unknown", "value"],
    ["stats", "--ledger", "one", "--ledger", "two"],
    ["stats", "--ledger", "one", "--format", "xml"],
    ["stats", "--ledger", "one", "--task", "paper-1", "--task", "paper-2"],
  ].map((args) => ({ args })),
)("rejects invalid command arguments: $args", ({ args }) => {
  const { io } = fixture();
  expect(runAwpCli(args, io)).toBe(1);
  expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining("Usage: awp stats"));
  expect(io.stdout).not.toHaveBeenCalled();
  expect(io.readLedger).not.toHaveBeenCalled();
});

it.each([["--help"], ["stats", "--help"]].map((args) => ({ args })))("prints help: $args", ({
  args,
}) => {
  const { io } = fixture();
  expect(runAwpCli(args, io)).toBe(0);
  expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining("--format json|csv"));
  expect(io.readLedger).not.toHaveBeenCalled();
});

it("reports unassigned entries without counting them in task rows", () => {
  const { ledger, io } = fixture();
  const { taskId: _taskId, ...unassigned } = record;
  ledger.append({ ...unassigned, id: "urn:legacy:1" }, AT);
  expect(runAwpCli(["stats", "--ledger", "fixture"], io)).toBe(0);
  expect(io.stderr).toHaveBeenCalledWith("Statistics exclude 1 entries without a task ID.\n");
  expect(JSON.parse(io.stdout.mock.calls[0]?.[0] as string).unassignedEntries).toBe(1);
});

it("sanitizes read, integrity and task-validation errors without partial output", () => {
  for (const mode of ["read", "integrity", "task"] as const) {
    const { ledger, io } = fixture();
    if (mode === "read")
      io.readLedger.mockImplementation(() => {
        throw new Error("SYNTHETIC_SECRET /private/path https://owner.example/#me");
      });
    if (mode === "integrity") io.readLedger.mockReturnValue(ledger.entries().slice(1));
    expect(
      runAwpCli(
        ["stats", "--ledger", "fixture", "--task", mode === "task" ? "invalid task" : "paper-1"],
        io,
      ),
    ).toBe(1);
    expect(io.stderr.mock.calls).toEqual([["Unable to export task statistics.\n"]]);
    expect(io.stdout).not.toHaveBeenCalled();
  }
});

it("reads rotated and checkpointed storage without changing any evidence", () => {
  const ledgerPath = path();
  const ledger = new FileLedger(ledgerPath, { segmentMaxEntries: 2, maxSegments: 1 });
  for (let i = 0; i < 12; i++) ledger.append({ ...record, id: `urn:call:${i}` }, AT);
  const files = [...ledger.segments(), ledgerPath];
  const before = files.map((file) => readFileSync(file, "utf8"));
  const stdout = vi.fn();
  const stderr = vi.fn();
  expect(runAwpCli(["stats", "--ledger", ledgerPath], { stdout, stderr })).toBe(0);
  const report = JSON.parse(stdout.mock.calls[0]?.[0]);
  expect(report.prunedThroughSeq).toBeGreaterThan(0);
  expect(stderr).toHaveBeenCalledWith(expect.stringContaining("prefix pruned"));
  expect(files.map((file) => readFileSync(file, "utf8"))).toEqual(before);
});

it("reads an archived-only tail and rejects absent or corrupt files", () => {
  const ledgerPath = path();
  new FileLedger(ledgerPath).append(record, AT);
  const content = readFileSync(ledgerPath, "utf8");
  writeFileSync(`${ledgerPath}.seg-000000000001`, content);
  rmSync(ledgerPath);
  const stdout = vi.fn();
  const stderr = vi.fn();
  expect(runAwpCli(["stats", "--ledger", ledgerPath], { stdout, stderr })).toBe(0);
  expect(JSON.parse(stdout.mock.calls[0]?.[0]).tasks[0].tokens).toBe(50);
  for (const corrupt of [false, true]) {
    const input = path();
    stdout.mockClear();
    if (corrupt) writeFileSync(input, "corrupt");
    expect(runAwpCli(["stats", "--ledger", input], { stdout, stderr })).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
  }
});

it("runs the packaged awp binary for help and an offline statistics export", async () => {
  const binary = fileURLToPath(new URL("../bin/awp.mjs", import.meta.url));
  const exec = promisify(execFile);
  expect((await exec(process.execPath, [binary, "--help"])).stdout).toContain("Usage: awp stats");
  const ledgerPath = path();
  new FileLedger(ledgerPath).append(record, AT);
  const result = await exec(process.execPath, [
    binary,
    "stats",
    "--ledger",
    ledgerPath,
    "--task",
    "paper-1",
  ]);
  expect(JSON.parse(result.stdout).tasks[0]).toMatchObject({
    taskId: "paper-1",
    modelCalls: 1,
    tokens: 50,
  });
  expect(result.stderr).toBe("");
});
