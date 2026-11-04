#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
import { runConfiguredCloud } from "../dist/cloud.js";

const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
try {
  await runConfiguredCloud(controller.signal);
} catch {
  // Provider, credential and filesystem exceptions can contain secrets. Never print them.
  process.stderr.write("Cloud daemon failed; no authority granted\n");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGTERM", stop);
  process.removeListener("SIGINT", stop);
}
