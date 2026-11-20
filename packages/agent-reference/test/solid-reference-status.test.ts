// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
import { expect, it } from "vitest";
import type { TraceFile } from "../src/trace/types.js";

const manifest = JSON.parse(
  readFileSync(new URL("../scenario-runs.json", import.meta.url), "utf8"),
) as {
  paths: Array<{
    scenario: string;
    configuration?: string;
    path: string;
    status: string;
    trace?: string;
    reason?: string;
  }>;
};
const trace = (file: string) =>
  JSON.parse(readFileSync(new URL(`../traces/${file}`, import.meta.url), "utf8")) as TraceFile;

it("keeps the local holder distinct from Solid reference access", () => {
  for (const id of ["health-referral", "records-to-new-practice"]) {
    const rows = manifest.paths.filter((path) => path.scenario === id && path.trace);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows)
      expect(trace(row.trace!).configuration.layers["data-access"]).not.toBe("by-reference-solid");
  }
});

it("publishes a trace for each of the five Solid access paths", () => {
  for (const [configuration, names] of [
    ["data-access-by-reference-solid", ["main", "grant-wider-than-terms", "read-after-withdrawal"]],
    ["usage-control-solid-access-control", ["main", "translation-grants-more"]],
  ] as const) {
    const paths = manifest.paths.filter((p) => p.configuration === configuration);
    expect(paths.map((path) => path.path)).toEqual(names);
    for (const path of paths) {
      // Ordered comparison reports the authorized withdrawal before the later read refusal.
      expect(path.status).toBe(path.path === "read-after-withdrawal" ? "disagrees" : "runs");
      expect(path.reason).toBeUndefined();
      expect(path.trace).toBeDefined();
      expect(trace(path.trace!).configuration.id).toBe(configuration);
    }
  }
});
