import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CDMC_KEY_CONTROLS } from "./cdmc.js";
import { main } from "./cli.js";
import {
  auditAgentDirectory,
  governanceManifest,
  missingMetadata,
  RESOURCE_REGISTER,
} from "./governance.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function run(args: string[]): Promise<{ code: number; out: string }> {
  let out = "";
  const code = await main(args, { stdout: (s) => (out += s) });
  return { code, out };
}

describe("resource governance metadata (R16–R18; no CDMC claim)", () => {
  it("every register entry carries the required metadata", () => {
    expect(RESOURCE_REGISTER.filter((r) => missingMetadata(r).length > 0).map((r) => r.id)).toEqual(
      [],
    );
    const [first] = RESOURCE_REGISTER;
    if (!first) throw new Error("empty register");
    expect(missingMetadata({ ...first, retention: "", purposes: [] })).toEqual([
      "purposes",
      "retention",
    ]);
  });

  it("pins the 14 key controls to the v1.1.1 baseline (review corrections) and never scores them", () => {
    expect(CDMC_KEY_CONTROLS.map((c) => c.id)).toEqual(
      Array.from({ length: 14 }, (_, i) => `AW-CDMC-${String(i + 1).padStart(2, "0")}`),
    );
    expect(CDMC_KEY_CONTROLS.map((c) => c.capability)).toEqual([
      "1.1",
      "1.2",
      "1.3",
      "1.4",
      "2.1",
      "2.2",
      "3.1",
      "3.2",
      "4.1",
      "4.2",
      "5.1",
      "5.2",
      "6.1",
      "6.2",
    ]);
    const byId = new Map(CDMC_KEY_CONTROLS.map((c) => [c.id, c]));
    expect(byId.get("AW-CDMC-03")?.name).toBe("Authoritative Data Sources and Provisioning Points");
    expect(byId.get("AW-CDMC-05")?.name).toBe("Cataloging");
    expect(byId.get("AW-CDMC-10")?.name).toBe("Data Protection Impact Assessments");
    expect(byId.get("AW-CDMC-10")?.applicabilityRationale).toMatch(/^Open gap/);
    expect(byId.get("AW-CDMC-11")?.section7Number).toBe(11);
    expect(byId.get("AW-CDMC-11")?.name).toBe("Data Retention, Archiving and Purging");
    for (const c of CDMC_KEY_CONTROLS) {
      expect(c.assessmentStatus).toBe("not-assessed");
      expect(c.implementationGaps.length, c.id).toBeGreaterThan(0);
      expect(Object.keys(c)).not.toContain("status");
    }
    const m = governanceManifest();
    expect(m.cdmcBaseline.framework).toBe("CDMC Framework v1.1.1, September 2021");
    expect(m.assessmentTarget.status).toBe("not-started");
    expect(m.assessmentTarget.scope).toContain("37 sub-capabilities");
    expect(m.notice).toContain("not CDMC compliant, assessed or certified");
    // "compliant"/"certified" may only appear in the negative notice and the conditional ladder.
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") strings.push(v);
      else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
    };
    walk({ ...m, notice: "", assessmentTarget: { ...m.assessmentTarget, claimLadder: [] } });
    expect(strings.filter((s) => /\b(compliant|certified)\b/i.test(s))).toEqual([]);
  });

  it("audits a real agent directory and fails on an unregistered retained file", async () => {
    const root = mkdtempSync(join(tmpdir(), "awp-gov-"));
    dirs.push(root);
    const common = ["--dir", root, "--now", "2026-10-19T08:00:00Z"];
    await run([
      "init",
      "--policy-engine=solid-odrl",
      "--name",
      "alice",
      "--party",
      "https://alice.example/#me",
      "--actor",
      "https://agents.alice.example/personal#agent",
      "--email",
      "alice.awp@example.com",
      ...common,
    ]);
    await run(["status", "--name", "alice", ...common]);
    const clean = auditAgentDirectory(join(root, "alice"));
    expect(clean.unregistered).toEqual([]);
    expect(clean.ok).toBe(true);
    expect(clean.files.map((f) => f.resource)).toEqual(
      expect.arrayContaining([
        "keys",
        "identity-and-grants",
        "trust-store",
        "evidence-ledger",
        "calendar",
      ]),
    );
    expect((await run(["governance", "--name", "alice", ...common])).code).toBe(0);

    // Accountable identifiers come from local configuration, not role labels alone.
    const owned = auditAgentDirectory(join(root, "alice"), { owner: "https://alice.example/#me" });
    expect(owned.ownerless).toEqual([]);
    expect(owned.ownership.find((o) => o.resource === "keys")).toMatchObject({
      accountable: "https://alice.example/#me",
    });
    expect(owned.ownership.find((o) => o.resource === "runtime-state")?.basis).toMatch(
      /no operator configured/,
    );
    const operated = auditAgentDirectory(join(root, "alice"), {
      owner: "https://alice.example/#me",
      operator: "https://hostco.example/#org",
    });
    expect(operated.ownership.find((o) => o.resource === "runtime-state")?.accountable).toBe(
      "https://hostco.example/#org",
    );
    const nobody = auditAgentDirectory(join(root, "alice"), {});
    expect(nobody.ownerless.length).toBeGreaterThan(0);
    expect(nobody.ok).toBe(false);

    writeFileSync(join(root, "alice", "scratch-export.csv"), "synthetic");
    const dirty = auditAgentDirectory(join(root, "alice"));
    expect(dirty.unregistered).toEqual(["scratch-export.csv"]);
    expect(dirty.ok).toBe(false);
    expect((await run(["governance", "--name", "alice", ...common])).code).toBe(2);
  });
});
