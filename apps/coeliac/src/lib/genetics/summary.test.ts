// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The genetics pod I/O — the write goes through the model's fail-closed consent +
 * NPV-coverage guardrails, and the owner-only ACL is written FIRST. PRIVACY-CRITICAL.
 */
import type { GeneticSummaryInput } from "@jeswr/solid-health-diary";
import { serializeGeneticSummary } from "@jeswr/solid-health-diary";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDiaryReadyMemo } from "../pod/pod-fs.js";
import { readGeneticSummary, writeGeneticSummary } from "./summary.js";
import { GENETIC_FRAMING, interpretConsumerArray } from "./interpret.js";

const ROOT = "https://alice.example/";
const WEBID = "https://alice.example/profile/card#me";
const SUMMARY_URL = "https://alice.example/health/diary/genetics/summary.ttl";

interface Rec {
  fetch: typeof globalThis.fetch;
  puts: () => { url: string; body?: string }[];
}
function recorder(getBody?: (url: string) => string | undefined): Rec {
  const puts: { url: string; body?: string }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "HEAD") return new Response(null, { status: 200 });
    if (method === "GET") {
      const body = getBody?.(url);
      if (body === undefined) return new Response("Not found", { status: 404 });
      return new Response(body, { status: 200, headers: { "content-type": "text/turtle" } });
    }
    if (method === "PUT") {
      puts.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
      return new Response("", { status: 201 });
    }
    return new Response("", { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, puts: () => puts };
}

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
    const r = recorder();
    await writeGeneticSummary({ authedFetch: r.fetch, webId: WEBID, storageRoot: ROOT }, CONSENTED);
    const urls = r.puts().map((p) => p.url);
    const aclIdx = urls.findIndex((u) => u.endsWith("/health/diary/.acl"));
    const summaryIdx = urls.findIndex((u) => u === SUMMARY_URL);
    expect(aclIdx).toBeGreaterThanOrEqual(0);
    expect(summaryIdx).toBeGreaterThan(aclIdx);
    const acl = r.puts().find((p) => p.url.endsWith("/health/diary/.acl"));
    expect(acl?.body ?? "").not.toMatch(/agentClass|foaf:Agent|Public/i);
  });

  it("the written summary carries only interpreted markers + framing (no raw genome field)", async () => {
    const r = recorder();
    await writeGeneticSummary({ authedFetch: r.fetch, webId: WEBID, storageRoot: ROOT }, CONSENTED);
    const body = r.puts().find((p) => p.url === SUMMARY_URL)?.body ?? "";
    expect(body).toMatch(/geneticInterpretation/);
    expect(body).toMatch(/rs2187668/);
    // No raw-genome surface exists in the model — the body is a small summary, not a genome.
    expect(body.length).toBeLessThan(4000);
  });

  it("REFUSES to write without consent (consentGiven not true) — nothing is PUT", async () => {
    const r = recorder();
    const unconsented = { ...CONSENTED, consentGiven: false } as unknown as GeneticSummaryInput;
    await expect(
      writeGeneticSummary({ authedFetch: r.fetch, webId: WEBID, storageRoot: ROOT }, unconsented),
    ).rejects.toThrow(/consent/i);
    expect(r.puts()).toHaveLength(0); // not even the ACL was written for an un-consented summary
  });

  it("REFUSES an overstated NPV negative (risk-haplotype-absent w/o complete coverage)", async () => {
    const r = recorder();
    const bad = {
      ...interpretConsumerArray([{ rsid: "rs2187668", genotype: "CC" }]),
      coeliacGeneticRisk: "risk-haplotype-absent",
      coverageComplete: false,
      consentGiven: true,
    } as unknown as GeneticSummaryInput;
    await expect(
      writeGeneticSummary({ authedFetch: r.fetch, webId: WEBID, storageRoot: ROOT }, bad),
    ).rejects.toThrow(/coverageComplete|risk-haplotype-absent/i);
    expect(r.puts()).toHaveLength(0);
  });
});

describe("readGeneticSummary", () => {
  it("parses a stored, consented summary", async () => {
    const body = await serializeGeneticSummary(SUMMARY_URL, CONSENTED);
    const r = recorder((url) => (url === SUMMARY_URL ? body : undefined));
    const parsed = await readGeneticSummary({ authedFetch: r.fetch, webId: WEBID, storageRoot: ROOT });
    expect(parsed?.interpretation).toBe(GENETIC_FRAMING);
    expect(parsed?.markers.map((m) => m.rsid)).toEqual(["rs2187668", "rs7454108"]);
  });

  it("returns undefined when no summary exists (404)", async () => {
    const r = recorder();
    expect(
      await readGeneticSummary({ authedFetch: r.fetch, webId: WEBID, storageRoot: ROOT }),
    ).toBeUndefined();
  });
});
