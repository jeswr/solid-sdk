#!/usr/bin/env node
import nodeProcess from "node:process";
// AUTHORED-BY Codex GPT-6.1-Sol
import { runCli } from "./cli.js";

const controller = new AbortController();
const cancel = () => controller.abort();
nodeProcess.once("SIGINT", cancel);
nodeProcess.once("SIGTERM", cancel);
nodeProcess.exitCode = await runCli(nodeProcess.argv.slice(2), { signal: controller.signal });
nodeProcess.removeListener("SIGINT", cancel);
nodeProcess.removeListener("SIGTERM", cancel);
