// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { execFile } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { fileURLToPath } from "url";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { promisify } from "util";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("./capture.js");
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
