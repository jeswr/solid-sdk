// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { execFile } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { fileURLToPath } from "url";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { promisify } from "util";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalArgv = process.argv;
afterEach(() => {
  process.argv = originalArgv;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("./capture.js");
  vi.doUnmock("./export-import.js");
});

describe("export process contract", () => {
  it.each([
    "chatgpt-export",
    "claude-export",
  ])("reports %s failure without input or remote details", async (command) => {
    const result = await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
      command,
      "/missing/secret-export.json",
    ]).catch((error: { code: number; stdout: string; stderr: string }) => error);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Export import failed. Check the file and writable MCP configuration.\n",
    );
    expect(result).toHaveProperty("code", 1);
  });
  it.each([0, 1])("propagates import status %i without the hook watchdog", async (status) => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const run = vi.fn().mockResolvedValue(status);
    vi.doMock("./export-import.js", () => ({ runExportImport: run }));
    process.argv = ["node", "solid-capture", "chatgpt-export", "fixture.json"];
    await import("./cli.js");
    expect(run).toHaveBeenCalledWith(["chatgpt-export", "fixture.json"]);
    expect(exit).toHaveBeenCalledWith(status);
    expect(stderr).toHaveBeenCalledTimes(status);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("sanitizes export startup failures", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.doMock("./export-import.js", () => {
      throw new Error("secret import error");
    });
    process.argv = ["node", "solid-capture", "claude-export", "fixture.json"];
    await import("./cli.js");
    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr).toHaveBeenCalledWith(
      "Export import failed. Check the file and writable MCP configuration.\n",
    );
  });
});
describe("hook process contract", () => {
  it.each([
    [],
    ["unknown"],
    ["claude", "--bad"],
    ["codex", "--since", "invalid"],
  ])("exits zero without output: %j", async (...args) => {
    const result = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL("../dist/cli.js", import.meta.url)), ...args],
      { timeout: 12000 },
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
  it("exits zero after work and its watchdog also exits zero", async () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const capture = vi.fn().mockResolvedValue(0);
    vi.doMock("./capture.js", () => ({ runCapture: capture }));
    await import("./cli.js");
    expect(capture).toHaveBeenCalledWith(process.argv.slice(2));
    expect(exit).toHaveBeenCalledWith(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(exit).toHaveBeenCalledTimes(2);
  });
  it("also exits zero when SDK import fails", async () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.doMock("./capture.js", () => {
      throw new Error("fixture import failure");
    });
    await import("./cli.js");
    expect(exit).toHaveBeenCalledWith(0);
  });
});
