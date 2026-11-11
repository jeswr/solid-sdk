// AUTHORED-BY Codex GPT-6
import {
  aggregateTaskStats,
  FileLedger,
  type LedgerEntry,
  MemoryLedger,
  taskStatsCsv,
} from "@jeswr/agent-audit";
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
import { type CliHost, runCli, runConfiguredCli } from "../src/cli.js";

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
  const print = vi.fn<(text: string) => void>();
  const stderr = vi.fn<(text: string) => void>();
  const readLedger = vi.fn((): readonly LedgerEntry[] => ledger.entries());
  const io = { print, stderr, readLedger, signal: new AbortController().signal, confirm: vi.fn() };
  const host: CliHost = {
    run: vi.fn(),
    once: vi.fn(),
    halt: vi.fn(),
    status: vi.fn(),
    accounts: vi.fn(),
    login: vi.fn(),
    stats: vi.fn(async (task) => aggregateTaskStats(ledger.entries(), task)),
    audit: vi.fn(),
    install: vi.fn(),
  };
  return { ledger, host, io };
}

it("prints filtered JSON by default and preserves CSV formatting on request", async () => {
  const { ledger, host, io } = fixture();
  expect(await runCli(["stats", "--task", "paper-1", "--ledger", "fixture"], host, io)).toBe(0);
  expect(io.readLedger).toHaveBeenCalledWith("fixture");
  expect(host.stats).not.toHaveBeenCalled();
  expect(JSON.parse(io.print.mock.calls[0]?.[0] as string).tasks).toMatchObject([
    { taskId: "paper-1", modelCalls: 1, tokens: 50 },
  ]);
  expect(io.stderr).not.toHaveBeenCalled();
  io.print.mockClear();
  expect(await runCli(["stats", "--ledger", "fixture", "--format", "csv"], host, io)).toBe(0);
  expect(`${io.print.mock.calls[0]?.[0]}\n`).toBe(
    taskStatsCsv(aggregateTaskStats(ledger.entries())),
  );
});

it("uses the host ledger by default with task filtering and CSV support", async () => {
  const { ledger, host, io } = fixture();
  expect(await runCli(["stats"], host, io)).toBe(0);
  expect(JSON.parse(io.print.mock.calls[0]?.[0] as string)).toEqual(
    aggregateTaskStats(ledger.entries()),
  );
  io.print.mockClear();
  expect(await runCli(["stats", "--task", "paper-2", "--format", "csv"], host, io)).toBe(0);
  expect(host.stats).toHaveBeenLastCalledWith("paper-2");
  expect(`${io.print.mock.calls[0]?.[0]}\n`).toBe(
    taskStatsCsv(aggregateTaskStats(ledger.entries(), "paper-2")),
  );
  expect(io.readLedger).not.toHaveBeenCalled();
});

it.each(
  [
    ["stats", "--ledger"],
    ["stats", "--ledger", ""],
    ["stats", "--ledger", "--task"],
    ["stats", "--task"],
    ["stats", "--task", ""],
    ["stats", "--format"],
    ["stats", "--unknown", "value"],
    ["stats", "--ledger", "one", "--ledger", "two"],
    ["stats", "--ledger", "one", "--format", "xml"],
    ["stats", "--ledger", "one", "--task", "paper-1", "--task", "paper-2"],
    ["stats", "--format", "json", "--format", "csv"],
    ["stats", "--help", "--ledger", "one"],
  ].map((args) => ({ args })),
)("rejects invalid stats arguments before reading evidence: $args", async ({ args }) => {
  const { host, io } = fixture();
  expect(await runCli(args, host, io)).toBe(2);
  expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining("Usage: awp stats"));
  expect(io.print).not.toHaveBeenCalled();
  expect(io.readLedger).not.toHaveBeenCalled();
  expect(host.stats).not.toHaveBeenCalled();
});

it.each(
  [["--help"], ["stats", "--help"]].map((args) => ({ args })),
)("prints help without a host: $args", async ({ args }) => {
  const { io } = fixture();
  expect(await runConfiguredCli(args, io)).toBe(0);
  expect(io.print).toHaveBeenCalledWith(expect.stringContaining("--format json|csv"));
  expect(io.readLedger).not.toHaveBeenCalled();
});

it("requires a configured host when no explicit ledger is selected", async () => {
  const { io } = fixture();
  expect(await runConfiguredCli(["stats"], io)).toBe(1);
  expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining("trusted composition"));
  expect(io.print).not.toHaveBeenCalled();
  expect(io.readLedger).not.toHaveBeenCalled();
});

it("reports unassigned entries without counting them in task rows", async () => {
  const { ledger, host, io } = fixture();
  const { taskId: _taskId, ...unassigned } = record;
  ledger.append({ ...unassigned, id: "urn:legacy:1" }, AT);
  for (const args of [["stats", "--ledger", "fixture"], ["stats"]]) {
    io.print.mockClear();
    expect(await runCli(args, host, io)).toBe(0);
    expect(io.stderr).toHaveBeenCalledWith(
      "Statistics report 1 entries separately without a task ID.\n",
    );
    const report = JSON.parse(io.print.mock.calls[0]?.[0] as string);
    expect(report.unassignedEntries).toBe(1);
    expect(report.unassigned).toMatchObject({ modelCalls: 1, tokens: 50 });
  }
});

it("sanitizes read, integrity, counter and task-validation errors without partial output", async () => {
  for (const mode of ["read", "integrity", "counters", "task", "host"] as const) {
    const { ledger, host, io } = fixture();
    const secret = "SYNTHETIC_SECRET /private/path https://owner.example/#me";
    if (mode === "read")
      io.readLedger.mockImplementation(() => {
        throw new Error(secret);
      });
    if (mode === "integrity") io.readLedger.mockReturnValue(ledger.entries().slice(1));
    if (mode === "counters") ledger.append({ ...record, id: "urn:call:3", inputTokens: 1 }, AT);
    if (mode === "host") vi.mocked(host.stats).mockRejectedValue(new Error(secret));
    expect(
      await runCli(
        mode === "host"
          ? ["stats"]
          : [
              "stats",
              "--ledger",
              "fixture",
              "--task",
              mode === "task" ? "invalid task" : "paper-1",
            ],
        host,
        io,
      ),
    ).toBe(1);
    expect(io.stderr.mock.calls).toEqual([["Unable to export task statistics.\n"]]);
    expect(io.print).not.toHaveBeenCalled();
  }
});

it("exports an empty selection successfully", async () => {
  const { io } = fixture();
  expect(await runCli(["stats", "--ledger", "fixture", "--task", "unknown"], undefined, io)).toBe(
    0,
  );
  expect(JSON.parse(io.print.mock.calls[0]?.[0] as string).tasks).toEqual([]);
});

it("reads rotated and checkpointed storage without changing any evidence", async () => {
  const ledgerPath = path();
  const ledger = new FileLedger(ledgerPath, { segmentMaxEntries: 2, maxSegments: 1 });
  for (let i = 0; i < 12; i++) ledger.append({ ...record, id: `urn:call:${i}` }, AT);
  const files = [...ledger.segments(), ledgerPath];
  const before = files.map((file) => readFileSync(file, "utf8"));
  const { io } = fixture();
  const { readLedger: _readLedger, ...fileIo } = io;
  expect(await runConfiguredCli(["stats", "--ledger", ledgerPath], fileIo)).toBe(0);
  const report = JSON.parse(io.print.mock.calls[0]?.[0] as string);
  expect(report.prunedThroughSeq).toBeGreaterThan(0);
  expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining("prefix pruned"));
  expect([...ledger.segments(), ledgerPath]).toEqual(files);
  expect(files.map((file) => readFileSync(file, "utf8"))).toEqual(before);
});

it("reads an archived-only tail and rejects absent or corrupt files", async () => {
  const ledgerPath = path();
  new FileLedger(ledgerPath).append(record, AT);
  const content = readFileSync(ledgerPath, "utf8");
  writeFileSync(`${ledgerPath}.seg-000000000001`, content);
  rmSync(ledgerPath);
  const { io } = fixture();
  const { readLedger: _readLedger, ...fileIo } = io;
  expect(await runConfiguredCli(["stats", "--ledger", ledgerPath], fileIo)).toBe(0);
  expect(JSON.parse(io.print.mock.calls[0]?.[0] as string).tasks[0].tokens).toBe(50);
  for (const corrupt of [false, true]) {
    const input = path();
    io.print.mockClear();
    if (corrupt) writeFileSync(input, "corrupt");
    expect(await runConfiguredCli(["stats", "--ledger", input], fileIo)).toBe(1);
    expect(io.print).not.toHaveBeenCalled();
  }
});

it("runs the unchanged packaged binary for help and offline JSON/CSV exports", async () => {
  const binary = fileURLToPath(new URL("../bin/awp.mjs", import.meta.url));
  const exec = promisify(execFile);
  expect((await exec(process.execPath, [binary, "--help"])).stdout).toContain("Usage: awp run");
  const ledgerPath = path();
  const ledger = new FileLedger(ledgerPath);
  ledger.append(record, AT);
  const args = [binary, "stats", "--ledger", ledgerPath, "--task", "paper-1"];
  const result = await exec(process.execPath, args);
  expect(JSON.parse(result.stdout).tasks[0]).toMatchObject({
    taskId: "paper-1",
    modelCalls: 1,
    tokens: 50,
  });
  expect(result.stderr).toBe("");
  const csv = await exec(process.execPath, [...args, "--format", "csv"]);
  expect(csv.stdout).toBe(taskStatsCsv(aggregateTaskStats(ledger.entries(), "paper-1")));
  expect(csv.stderr).toBe("");
}, 30_000); // Spawns the packaged binary three times: quick alone, but over 5 s in a full-workspace CI gate.
