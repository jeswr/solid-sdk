// AUTHORED-BY Codex GPT-6
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../../node_modules/vitest/vitest.mjs", import.meta.url));
const config = fileURLToPath(new URL("./vitest.config.ts", import.meta.url));
const child = spawn(
  process.execPath,
  [runner, "run", "--config", config, ...process.argv.slice(2)],
  {
    stdio: "inherit",
  },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});
