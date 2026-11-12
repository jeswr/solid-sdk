// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The genetics pod I/O — the write goes through the model's fail-closed consent +
 * NPV-coverage guardrails, and the owner-only ACL is written FIRST. PRIVACY-CRITICAL.
 */
import type { GeneticSummaryInput } from "@jeswr/solid-health-diary";
import { serializeGeneticSummary } from "@jeswr/solid-health-diary";
import { recordingStorage } from "../../../test/storage";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDiaryReadyMemo } from "../pod/pod-fs";
import { readGeneticSummary, writeGeneticSummary } from "./summary";
import { GENETIC_FRAMING, interpretConsumerArray } from "./interpret";

const ROOT = "https://alice.example/";
const WEBID = "https://alice.example/profile/card#me";
const SUMMARY_URL = "https://alice.example/health/diary/genetics/summary.ttl";

const CONSENTED: GeneticSummaryInput = {
  ...interpretConsumerArray([
    { rsid: "rs2187668", genotype: "CT" },
    { rsid: "rs7454108", genotype: "TT" },
  ]),
  consentGiven: true,
};

beforeEach(() => resetDiaryReadyMemo());

describe("writeGeneticSummary", () => {
  it("writes the owner-only ACL FIRST, then the summary — no public grant", async () => {
    const r = recordingStorage();
    await writeGeneticSummary({ storage: r.storage, webId: WEBID, storageRoot: ROOT }, CONSENTED);
    const urls = r.puts().map((p) => p.url);
    const aclIdx = urls.findIndex((u) => u.endsWith("/health/diary/.acl"));
    const summaryIdx = urls.findIndex((u) => u === SUMMARY_URL);
    expect(aclIdx).toBeGreaterThanOrEqual(0);
    expect(summaryIdx).toBeGreaterThan(aclIdx);
    const acl = r.puts().find((p) => p.url.endsWith("/health/diary/.acl"));
    expect(acl?.body ?? "").not.toMatch(/agentClass|foaf:Agent|Public/i);
  });

  it("the written summary carries only interpreted markers + framing (no raw genome field)", async () => {
    const r = recordingStorage();
    await writeGeneticSummary({ storage: r.storage, webId: WEBID, storageRoot: ROOT }, CONSENTED);
    const body = r.puts().find((p) => p.url === SUMMARY_URL)?.body ?? "";
    expect(body).toMatch(/geneticInterpretation/);
    expect(body).toMatch(/rs2187668/);
    // The raw tag-SNP genotype is NOT persisted — no diet:genotype predicate + no
    // genotype literal reaches the pod (only rsid + presence + interpretation).
    expect(body).not.toMatch(/genotype/);
    // No raw-genome surface exists in the model — the body is a small summary, not a genome.
    expect(body.length).toBeLessThan(4000);
  });

  it("REFUSES to write without consent (consentGiven not true) — nothing is PUT", async () => {
    const r = recordingStorage();
    const unconsented = { ...CONSENTED, consentGiven: false } as unknown as GeneticSummaryInput;
    await expect(
      writeGeneticSummary({ storage: r.storage, webId: WEBID, storageRoot: ROOT }, unconsented),
    ).rejects.toThrow(/consent/i);
    expect(r.puts()).toHaveLength(0); // not even the ACL was written for an un-consented summary
  });

  it("serialises concurrent writes per resource — PUTs never interleave (newest lands last)", async () => {
    // A fetch whose PUT to summary.ttl resolves on the NEXT microtask-ish delay, so
    // an unserialised implementation would interleave the two writers' PUTs.
    const events: string[] = [];
    let n = 0;
    const { storage } = recordingStorage(ROOT, async (call) => {
      if (call.method === "PUT" && call.url === SUMMARY_URL) {
        const id = ++n;
        events.push(`start-${id}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push(`end-${id}`);
      }
    });
    const ctx = { storage, webId: WEBID, storageRoot: ROOT };
    await Promise.all([writeGeneticSummary(ctx, CONSENTED), writeGeneticSummary(ctx, CONSENTED)]);
    // Each summary PUT fully completes before the next starts (no interleave).
    expect(events).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });

  it("REFUSES an overstated NPV negative (risk-haplotype-absent w/o complete coverage)", async () => {
    const r = recordingStorage();
    const bad = {
      ...interpretConsumerArray([{ rsid: "rs2187668", genotype: "CC" }]),
      coeliacGeneticRisk: "risk-haplotype-absent",
      coverageComplete: false,
      consentGiven: true,
    } as unknown as GeneticSummaryInput;
    await expect(
      writeGeneticSummary({ storage: r.storage, webId: WEBID, storageRoot: ROOT }, bad),
    ).rejects.toThrow(/coverageComplete|risk-haplotype-absent/i);
    expect(r.puts()).toHaveLength(0);
  });
});

describe("readGeneticSummary", () => {
  it("parses a stored, consented summary", async () => {
    const body = await serializeGeneticSummary(SUMMARY_URL, CONSENTED);
    const r = recordingStorage();
    await r.storage.write(SUMMARY_URL, body, { contentType: "text/turtle", ifMatch: "*" });
    const parsed = await readGeneticSummary({ storage: r.storage, webId: WEBID, storageRoot: ROOT });
    expect(parsed?.interpretation).toBe(GENETIC_FRAMING);
    expect(parsed?.markers.map((m) => m.rsid)).toEqual(["rs2187668", "rs7454108"]);
  });

  it("returns undefined when no summary exists (404)", async () => {
    const r = recordingStorage();
    expect(
      await readGeneticSummary({ storage: r.storage, webId: WEBID, storageRoot: ROOT }),
    ).toBeUndefined();
  });
});
