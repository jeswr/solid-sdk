#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
const args = process.argv.slice(2);
if (args[0] === "chatgpt-export" || args[0] === "claude-export") {
  let status = 1;
  try {
    const { runExportImport } = await import("./export-import.js");
    status = await runExportImport(args);
  } catch {
    // Never print secret-bearing startup errors.
  }
  if (status !== 0)
    process.stderr.write("Export import failed. Check the file and writable MCP configuration.\n");
  process.exit(status);
} else if (args[0] === "redact-archive") {
  let status = 1;
  try {
    const { runRedactionMigration } = await import("./redaction-migration.js");
    status = await runRedactionMigration(args);
  } catch {
    // Never print secret-bearing startup errors.
  }
  if (status !== 0)
    process.stderr.write("Redaction failed. Check the owner MCP configuration and run it again.\n");
  process.exit(status);
} else {
  // Start the watchdog before loading the SDK graph; even import/startup failures exit zero.
  setTimeout(() => process.exit(0), 10000);
  try {
    const { runCapture } = await import("./capture.js");
    await runCapture(args);
  } catch {
    // Hooks must not interrupt the agent session or print secret-bearing errors.
  }
  process.exit(0);
}
