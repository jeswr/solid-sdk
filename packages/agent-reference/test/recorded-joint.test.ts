// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it, vi } from "vitest";
// @ts-expect-error Standalone Node installer is deliberately JavaScript.
import { install } from "../scripts/install-sparq.mjs";
// @ts-expect-error Standalone artifact writer is deliberately JavaScript.
import { jointPaths, recordedJoint } from "../scripts/recorded-joint.mjs";
import { availableAdapters } from "../src/derive/adapters/index.js";

const root = join(import.meta.dirname, "..");
it("keeps all six hash-checked recorded traces and runs rows when the package is absent", async () => {
  const manifest = JSON.parse(readFileSync(join(root, "scenario-runs.json"), "utf8"));
  const before = readFileSync(join(root, "scenario-runs.json"));
  vi.stubEnv("ANSWERABLE_SPARQ_AGGREGATE", join(tmpdir(), "absent-sparq-brief23-package"));
  try {
    expect((await availableAdapters()).jointProtocols.has("sparq-aggregate/1")).toBe(false);
    let retained = 0;
    for (const row of manifest.paths) {
      if (!jointPaths.has(`${row.scenario}/${row.path}`)) continue;
      const bytes = readFileSync(join(root, "traces", row.trace));
      const recorded = recordedJoint(root, manifest.paths, row.scenario, row.path);
      expect(recorded.status).toBe(row.status);
      expect(["runs", "disagrees"]).toContain(recorded.status);
      expect(recorded.recordedWith.commit).toBe("61989f5");
      expect(readFileSync(join(root, "traces", row.trace)).equals(bytes)).toBe(true);
      retained++;
    }
    expect(retained).toBe(6);
    expect(readFileSync(join(root, "scenario-runs.json")).equals(before)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
  }
});
it("fails on modified recorded bytes or missing recorded provenance instead of rewriting them", () => {
  const directory = mkdtempSync(join(tmpdir(), "joint-recorded-"));
  try {
    const manifest = JSON.parse(readFileSync(join(root, "scenario-runs.json"), "utf8"));
    const row = manifest.paths.find(
      (r: { scenario: string; path: string }) => r.scenario === "cohort-count" && r.path === "main",
    );
    mkdirSync(join(directory, "traces"));
    const tampered = Buffer.concat([
      readFileSync(join(root, "traces", row.trace)),
      Buffer.from(" "),
    ]);
    writeFileSync(join(directory, "traces", row.trace), tampered);
    expect(() => recordedJoint(directory, [row], row.scenario, row.path)).toThrow(
      "SHA-256 mismatch",
    );
    expect(readFileSync(join(directory, "traces", row.trace)).equals(tampered)).toBe(true);
    expect(() =>
      recordedJoint(
        directory,
        [{ ...row, recordedWith: { commit: "other" } }],
        row.scenario,
        row.path,
      ),
    ).toThrow("Missing authenticated");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it("rejects an incorrect tarball hash before creating or changing an installation", () => {
  const directory = mkdtempSync(join(tmpdir(), "joint-install-"));
  try {
    const tarball = join(directory, "bad.tgz"),
      destination = join(directory, "installed");
    writeFileSync(tarball, "incorrect tarball");
    mkdirSync(destination);
    writeFileSync(join(destination, "keep"), "unchanged");
    expect(() => install(tarball, destination)).toThrow("SHA-256 mismatch");
    expect(readFileSync(join(destination, "keep"), "utf8")).toBe("unchanged");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
