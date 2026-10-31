#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
// Start the watchdog before loading the SDK graph; even import/startup failures exit zero.
setTimeout(() => process.exit(0), 10000);
try {
  const { runCapture } = await import("./capture.js");
  await runCapture(process.argv.slice(2));
} catch {
  // Hooks must not interrupt the agent session or print secret-bearing errors.
}
process.exit(0);
