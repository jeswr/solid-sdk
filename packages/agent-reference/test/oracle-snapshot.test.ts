// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { pathToFileURL } from "url";
import { expect, it } from "vitest";
// @ts-expect-error Executable snapshot tool has no declaration file.
import { snapshot } from "../scripts/oracle-snapshot.mjs";

it("snapshots the canonical decisions without transport rows replacing or extending them", () => {
  const directory = mkdtempSync(join(tmpdir(), "canonical-oracle-"));
  try {
    mkdirSync(join(directory, "traces"));
    const canonical = [
      {
        agent: "receiver",
        part: "inbound-gate",
        kind: "decision",
        reason: "canonical",
        outcome: "admit",
      },
    ];
    writeFileSync(join(directory, "traces/main.json"), JSON.stringify({ events: canonical }));
    writeFileSync(
      join(directory, "traces/transport.json"),
      JSON.stringify({ events: [{ ...canonical[0], reason: "transport" }] }),
    );
    writeFileSync(
      join(directory, "scenario-runs.json"),
      JSON.stringify({
        paths: [
          { scenario: "case", path: "main", status: "runs", trace: "main.json" },
          {
            scenario: "case",
            path: "main",
            status: "runs",
            configuration: "transport-mcp",
            trace: "transport.json",
          },
          {
            scenario: "case",
            path: "matrix-attack",
            status: "runs",
            configuration: "transport-mcp",
            trace: "transport.json",
          },
          { scenario: "case", path: "blocked", status: "blocked" },
        ],
      }),
    );
    expect(snapshot(pathToFileURL(`${directory}/`))).toEqual({ "case/main": canonical });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
