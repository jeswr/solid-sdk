// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { spawn } from "child_process";
import { mkdtemp, readFile, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { PLANNER_SYSTEM, parsePlannerReply, promptFor } from "./planner.js";
import type { Planner, PlannerInput, PlannerOutput } from "./types.js";

const OUTPUT_LIMIT = 1024 * 1024;

/** No shell interpolation, inherited login only; stdout/stderr are never forwarded to the host. */
async function invoke(
  bin: string,
  args: string[],
  stdin: string,
  cwd: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: { ...process.env, ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined },
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let bytes = 0;
    let settled = false;
    const stop = () => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout);
    };
    const timer = setTimeout(() => {
      stop();
      finish(new Error("Planner CLI timed out."));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > OUTPUT_LIMIT) {
        stop();
        finish(new Error("Planner CLI output exceeded its limit."));
      } else stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > OUTPUT_LIMIT) {
        stop();
        finish(new Error("Planner CLI output exceeded its limit."));
      }
    });
    child.on("error", () => finish(new Error("Planner CLI could not be started.")));
    child.on("close", (code) => finish(code === 0 ? undefined : new Error("Planner CLI failed.")));
    child.stdin.on("error", () => {
      /* close/error reports a safe error, never CLI diagnostics. */
    });
    child.stdin.end(stdin);
  });
}

function cliPlanner(
  timeoutMs: number,
  run: (input: PlannerInput, cwd: string) => Promise<string>,
): Planner {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid CLI timeout.");
  return {
    async next(input): Promise<PlannerOutput> {
      // Empty working directory prevents project pages, instructions and repo files entering context.
      const cwd = await mkdtemp(join(tmpdir(), "agent-browser-planner-"));
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            return parsePlannerReply(await run(input, cwd));
          } catch {
            if (attempt === 1) throw new Error("Planner CLI failed after one retry.");
          }
        }
        throw new Error("Planner CLI failed.");
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    },
  };
}

export function claudeCliPlanner(options: {
  model: string;
  bin?: string;
  timeoutMs?: number;
}): Planner {
  const timeoutMs = options.timeoutMs ?? 60_000;
  return cliPlanner(timeoutMs, async (input, cwd) => {
    // Installed --help: --tools "" is the definitive switch disabling the built-in tool set.
    const output = await invoke(
      options.bin ?? "claude",
      [
        "-p",
        "--model",
        options.model,
        "--output-format",
        "json",
        "--system-prompt",
        PLANNER_SYSTEM,
        "--tools",
        "",
        "--disallowedTools",
        "*",
        "--safe-mode",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--no-session-persistence",
      ],
      promptFor(input).slice(PLANNER_SYSTEM.length).trimStart(),
      cwd,
      timeoutMs,
    );
    const parsed: unknown = JSON.parse(output);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("result" in parsed) ||
      typeof parsed.result !== "string" ||
      ("is_error" in parsed && parsed.is_error)
    ) {
      throw new Error("Planner CLI returned no result.");
    }
    return parsed.result;
  });
}

export function codexCliPlanner(
  options: { model: string; timeoutMs?: number } = { model: "gpt-6.1-sol" },
): Planner {
  const timeoutMs = options.timeoutMs ?? 60_000;
  return cliPlanner(timeoutMs, async (input, cwd) => {
    const finalPath = join(cwd, "final.txt");
    await rm(finalPath, { force: true });
    // The supplied login wrapper owns authentication; this package never reads or copies auth files.
    await invoke(
      "bash",
      [
        "/mnt/project-files/orchestration/codex/codex-sol.sh",
        "exec",
        "-m",
        options.model,
        "-c",
        "model_reasoning_effort=low",
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "-c",
        "features.shell_tool=false",
        "-c",
        "features.unified_exec=false",
        "-c",
        "features.apply_patch_freeform=false",
        "-c",
        "features.multi_agent=false",
        "-c",
        "features.multi_agent_v2=false",
        "-c",
        'web_search="disabled"',
        "-c",
        "project_doc_max_bytes=0",
        "--output-last-message",
        finalPath,
        "-",
      ],
      promptFor(input),
      cwd,
      timeoutMs,
    );
    if ((await stat(finalPath)).size > OUTPUT_LIMIT)
      throw new Error("Planner final message exceeded its limit.");
    return readFile(finalPath, "utf8");
  });
}
