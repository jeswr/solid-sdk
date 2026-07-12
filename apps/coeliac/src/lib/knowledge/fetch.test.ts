// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The misinformation-guard chokepoint (§3.4): only the four curated hosts are
 * reachable, https is mandatory, an off-allowlist host is rejected BEFORE the
 * network is touched, and a cross-host redirect is rejected AFTER.
 */
import { describe, expect, it, vi } from "vitest";
import {
  isAllowlistedKnowledgeHost,
  KNOWLEDGE_HOSTS,
  KnowledgeFetchError,
  knowledgeFetch,
  knowledgeJson,
} from "./fetch";

const okJson = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

describe("isAllowlistedKnowledgeHost", () => {
  it("accepts each of the four curated https hosts", () => {
    for (const host of KNOWLEDGE_HOSTS) {
      expect(isAllowlistedKnowledgeHost(`https://${host}/path?q=1`)).toBe(true);
    }
  });

  it("rejects a non-allowlisted host", () => {
    expect(isAllowlistedKnowledgeHost("https://evil.example/x")).toBe(false);
    expect(isAllowlistedKnowledgeHost("https://google.com/search?q=coeliac")).toBe(false);
  });

  it("rejects non-https (no downgrade) and a lookalike subdomain", () => {
    expect(isAllowlistedKnowledgeHost("http://www.ebi.ac.uk/x")).toBe(false);
    expect(isAllowlistedKnowledgeHost("https://www.ebi.ac.uk.evil.example/x")).toBe(false);
    expect(isAllowlistedKnowledgeHost("https://evil.www.ebi.ac.uk.attacker/x")).toBe(false);
  });

  it("fail-closed on a malformed URL", () => {
    expect(isAllowlistedKnowledgeHost("not a url")).toBe(false);
    expect(isAllowlistedKnowledgeHost("")).toBe(false);
  });
});

describe("knowledgeFetch (allowlist enforced)", () => {
  it("THROWS before touching the network for a non-allowlisted host", async () => {
    const spy = vi.fn(okJson);
    const kf = knowledgeFetch(spy as unknown as typeof globalThis.fetch);
    await expect(kf("https://evil.example/data")).rejects.toBeInstanceOf(KnowledgeFetchError);
    // the underlying fetch was never called — no arbitrary URL can be fetched
    expect(spy).not.toHaveBeenCalled();
  });

  it("allows an allowlisted host and returns the response", async () => {
    const spy = vi.fn(okJson);
    const kf = knowledgeFetch(spy as unknown as typeof globalThis.fetch);
    const res = await kf("https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=x&format=json");
    expect(res.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rejects a response that redirected off the allowlist", async () => {
    const redirected = new Response(JSON.stringify({}), { status: 200 });
    Object.defineProperty(redirected, "url", { value: "https://evil.example/landed" });
    const spy = vi.fn(async () => redirected);
    const kf = knowledgeFetch(spy as unknown as typeof globalThis.fetch);
    await expect(
      kf("https://clinicaltrials.gov/api/v2/studies?query.cond=celiac"),
    ).rejects.toBeInstanceOf(KnowledgeFetchError);
  });
});

describe("knowledgeJson", () => {
  it("simple mode sends NO custom headers (CT.gov preflight-403 constraint)", async () => {
    const seen: RequestInit[] = [];
    const fetchFn = vi.fn(async (_u: unknown, init?: RequestInit) => {
      seen.push(init ?? {});
      return okJson();
    });
    await knowledgeJson(fetchFn as unknown as typeof globalThis.fetch, "https://clinicaltrials.gov/x", {
      simple: true,
    });
    // no init at all in simple mode → no Accept/Authorization/custom header ⇒ no preflight
    expect(seen[0]).toEqual({});
  });

  it("default mode sets Accept: application/json", async () => {
    let init: RequestInit | undefined;
    const fetchFn = vi.fn(async (_u: unknown, i?: RequestInit) => {
      init = i;
      return okJson();
    });
    await knowledgeJson(fetchFn as unknown as typeof globalThis.fetch, "https://www.ebi.ac.uk/x");
    expect((init?.headers as Record<string, string>).accept).toBe("application/json");
  });

  it("throws KnowledgeFetchError on a non-2xx and on a non-JSON body", async () => {
    const bad = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(
      knowledgeJson(bad as unknown as typeof globalThis.fetch, "https://api.fda.gov/x"),
    ).rejects.toBeInstanceOf(KnowledgeFetchError);
    const notJson = vi.fn(async () => new Response("<html/>", { status: 200 }));
    await expect(
      knowledgeJson(notJson as unknown as typeof globalThis.fetch, "https://api.fda.gov/x"),
    ).rejects.toBeInstanceOf(KnowledgeFetchError);
  });
});
