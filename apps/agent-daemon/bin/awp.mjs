#!/usr/bin/env node
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
import { createInterface } from "readline/promises";
import { runConfiguredCli } from "../dist/cli.js";

const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  process.exitCode = await runConfiguredCli(process.argv.slice(2), {
    print: (line) => process.stdout.write(`${line}\n`),
    signal: controller.signal,
    async confirm(prompt) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return /^(y|yes)$/i.test((await terminal.question(`${prompt} [y/N] `)).trim());
      } finally {
        terminal.close();
      }
    },
  });
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
