// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.2 Sol
console.error(
  "Cannot import standalone runtime traces. The explorer requires a scenario run manifest. " +
    "Use python3 scripts/import-engine-runs.py <traces-dir> <scenario-runs.json>.",
);
process.exitCode = 1;
