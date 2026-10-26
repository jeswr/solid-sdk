#!/usr/bin/env node
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6
import { existsSync, realpathSync } from "fs";
import { fileURLToPath } from "url";
import { main } from "./cli.js";
import { createProviderTransport } from "./transport.js";

const isMain =
  process.argv[1] !== undefined &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    stdoutIsTTY: process.stdout.isTTY === true,
    transport: createProviderTransport(),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = 1;
    },
  );
}
