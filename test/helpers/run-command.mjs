// AUTHORED-BY Codex GPT-5.6 (Sol)

import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// File descriptors capture child output even in sandboxes that restrict pipes.
export function runCommand(command, args, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "script-output-"));
  const stdoutPath = join(root, "stdout.txt");
  const stderrPath = join(root, "stderr.txt");
  const stdout = openSync(stdoutPath, "w");
  const stderr = openSync(stderrPath, "w");
  try {
    const result = spawnSync(command, args, { ...options, stdio: ["ignore", stdout, stderr] });
    return {
      ...result,
      stdout: readFileSync(stdoutPath, "utf8"),
      stderr: readFileSync(stderrPath, "utf8"),
    };
  } finally {
    closeSync(stdout);
    closeSync(stderr);
    rmSync(root, { recursive: true, force: true });
  }
}
