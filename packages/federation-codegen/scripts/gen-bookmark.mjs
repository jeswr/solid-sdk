// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8
// The package owns the config, generated artifacts, and regeneration command.
import { spawn } from "node:child_process";

const child = spawn("pnpm", ["run", "codegen", ...process.argv.slice(2)], {
  cwd: new URL("../../solid-bookmark/", import.meta.url),
  stdio: "inherit",
});
child.on("error", (error) => {
  throw error;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
