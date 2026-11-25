// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import type { ChildProcessWithoutNullStreams } from "child_process";
import { EventEmitter } from "events";
import { access, writeFile } from "fs/promises";
import { PassThrough } from "stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeCliPlanner, codexCliPlanner } from "../src/cli.js";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("child_process", () => ({ spawn }));

const input = { goal: "Find sneakers", catalogue: "SearchAction read", history: [] };
afterEach(() => {
  spawn.mockReset();
});

function childProcess(
  result: string,
  args: string[],
  success = true,
): ChildProcessWithoutNullStreams {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  child.stdin.on("finish", async () => {
    const fileIndex = args.indexOf("--output-last-message");
    if (success && fileIndex >= 0) await writeFile(args[fileIndex + 1] ?? "", result);
    else child.stdout.end(result);
    child.emit("close", success ? 0 : 1);
  });
  return child as unknown as ChildProcessWithoutNullStreams;
}

describe("opt-in CLI planners without calling a model", () => {
  it("disables Claude tools/MCP, sends stdin and parses .result", async () => {
    let stdin = "";
    spawn.mockImplementation((_bin: string, args: string[]) => {
      const child = childProcess(JSON.stringify({ result: "ANSWER: Found them." }), args);
      child.stdin.on("data", (data) => {
        stdin += String(data);
      });
      return child;
    });
    expect(
      await claudeCliPlanner({ model: "fictional-model", bin: "claude-fixture" }).next(input),
    ).toEqual({ kind: "answer", text: "Found them." });
    const [bin, args, options] = spawn.mock.calls[0] ?? [];
    expect(bin).toBe("claude-fixture");
    expect(args).toContain("--system-prompt");
    expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual([
      "--tools",
      "",
    ]);
    expect(args).toContain("--disallowedTools");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--safe-mode");
    expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(options.env.OPENAI_API_KEY).toBeUndefined();
    expect(options.shell).toBeUndefined();
    expect(stdin).toContain(input.goal);
    expect(stdin).not.toContain("API_KEY");
    await expect(access(options.cwd)).rejects.toThrow();
  });

  it("uses the requested Codex wrapper, read-only sandbox and final-message file", async () => {
    let stdin = "";
    spawn.mockImplementation((_bin: string, args: string[]) => {
      const child = childProcess("ASK: Which size?", args);
      child.stdin.on("data", (data) => {
        stdin += String(data);
      });
      return child;
    });
    expect(await codexCliPlanner({ model: "gpt-6.1-sol" }).next(input)).toEqual({
      kind: "ask",
      question: "Which size?",
    });
    const [bin, args] = spawn.mock.calls[0] ?? [];
    expect(bin).toBe("bash");
    expect(args[0]).toBe("/mnt/project-files/orchestration/codex/codex-sol.sh");
    expect(args.slice(1, 4)).toEqual(["exec", "-m", "gpt-6.1-sol"]);
    expect(args).toContain("model_reasoning_effort=low");
    expect(args).toContain("read-only");
    expect(args).toContain("--output-last-message");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("features.shell_tool=false");
    expect(args.at(-1)).toBe("-");
    expect(stdin).toContain(input.goal);
  });

  it("retries once on malformed JSON and succeeds on the next attempt", async () => {
    spawn
      .mockImplementationOnce((_bin: string, args: string[]) => childProcess("broken", args))
      .mockImplementationOnce((_bin: string, args: string[]) =>
        childProcess('{"result":"ANSWER: OK"}', args),
      );
    expect(await claudeCliPlanner({ model: "fictional-model" }).next(input)).toEqual({
      kind: "answer",
      text: "OK",
    });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("times out, kills the process, retries once and reports no CLI diagnostics", async () => {
    const kills = vi.fn();
    spawn.mockImplementation(() =>
      Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: kills,
      }),
    );
    await expect(
      claudeCliPlanner({ model: "fictional-model", timeoutMs: 5 }).next(input),
    ).rejects.toThrow("failed after one retry");
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(kills).toHaveBeenCalledTimes(2);
  });

  it("rejects error JSON, nonzero exits and repeated protocol errors", async () => {
    spawn.mockImplementation((_bin: string, args: string[]) =>
      childProcess('{"result":"ANSWER: secret","is_error":true}', args),
    );
    await expect(claudeCliPlanner({ model: "fictional-model" }).next(input)).rejects.toThrow(
      "failed after one retry",
    );
    spawn.mockReset();
    spawn.mockImplementation((_bin: string, args: string[]) =>
      childProcess("secret diagnostics", args, false),
    );
    await expect(claudeCliPlanner({ model: "fictional-model" }).next(input)).rejects.toThrow(
      "failed after one retry",
    );
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
