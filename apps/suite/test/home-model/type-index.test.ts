// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { NS } from "@jeswr/suite-vocab";
import { describe, expect, it, vi } from "vitest";
import { discoverDomainItems } from "../../src/apps/home/lib/model/discovery";
import { DiscoveryBudget } from "../../src/apps/home/lib/model/discovery-budget";
import { readTypeIndexes, registrationsFrom } from "../../src/apps/home/lib/model/type-index";
import { fixtureFetch, rdf, STORAGE, WEB_ID } from "./fixtures";

describe("Type Index read model", () => {
  it("ports typed registrations, including legacy classes and both location forms", async () => {
    const dataset = await rdf(
      `
      <#a> a solid:TypeRegistration ; solid:forClass old:Book, "bad" ; solid:instance <book.ttl>, "bad" ; solid:instanceContainer <books/> .
      <#b> a solid:TypeRegistration ; solid:forClass schema:Event .
      <#c> a solid:TypeRegistration ; solid:instance <orphan.ttl> .
      <#notRegistration> solid:forClass schema:Book ; solid:instance <ignore.ttl> .
    `,
      `${STORAGE}index.ttl`,
    );
    expect(registrationsFrom(dataset)).toEqual([
      { forClass: `${NS.SCHEMA}Book`, instance: `${STORAGE}book.ttl` },
      { forClass: `${NS.SCHEMA}Book`, container: `${STORAGE}books/` },
    ]);
  });

  it("merges public and private indexes and reads a shared link just once", async () => {
    const profile = await rdf(
      "<#me> solid:publicTypeIndex <../public.ttl> ; solid:privateTypeIndex <../private.ttl>, <../public.ttl> .",
      WEB_ID,
    );
    const fetch = fixtureFetch({
      [`${STORAGE}public.ttl`]:
        "<#r> a solid:TypeRegistration ; solid:forClass schema:Book ; solid:instance <books/one.ttl> .",
      [`${STORAGE}private.ttl`]:
        "<#r> a solid:TypeRegistration ; solid:forClass <https://custom.example/Unknown> ; solid:instanceContainer <custom/> .",
    });
    const result = await readTypeIndexes(fetch, WEB_ID, profile, STORAGE);
    expect(result.locations).toHaveLength(2);
    expect(result.failures).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await readTypeIndexes(fetch, WEB_ID, await rdf(""), STORAGE)).toEqual({
      locations: [],
      failures: [],
      truncated: false,
    });
  });

  it("caps many index links, retains partial registrations and shares requests with traversal", async () => {
    const profile = await rdf(
      `<#me> solid:publicTypeIndex ${Array.from({ length: 20 }, (_, i) => `<../index-${i}.ttl>`).join(", ")} .`,
      WEB_ID,
    );
    const fetch = fixtureFetch({
      [`${STORAGE}index-0.ttl`]:
        "<#r> a solid:TypeRegistration ; solid:forClass schema:Book ; solid:instance <book.ttl> .",
      [`${STORAGE}book.ttl`]: '<#it> a schema:Book ; schema:name "A book" .',
    });
    const capped = await readTypeIndexes(fetch, WEB_ID, profile, STORAGE, { maxRequests: 1 });
    expect(capped.truncated).toBe(true);
    expect(capped.locations).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);

    fetch.mockClear();
    const budget = new DiscoveryBudget({ maxRequests: 3 });
    const indexes = await readTypeIndexes(
      fetch,
      WEB_ID,
      await rdf("<#me> solid:publicTypeIndex <../index-0.ttl>, <../missing.ttl> .", WEB_ID),
      STORAGE,
      { budget },
    );
    expect(indexes.truncated).toBe(false);
    expect(indexes.failures).toHaveLength(1);
    const result = await discoverDomainItems("media", {
      storage: STORAGE,
      fetch,
      typeIndex: indexes.locations,
      budget,
    });
    expect(result.items.map((item) => item.title)).toEqual(["A book"]);
    expect(result.truncated).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3); // Includes the failed index read.
  });

  it("propagates cancellation before and during index reads through the injected signal", async () => {
    const profile = await rdf("<#me> solid:publicTypeIndex <../index.ttl> .", WEB_ID);
    const before = new AbortController();
    before.abort();
    const fetch = fixtureFetch({});
    await expect(
      readTypeIndexes(fetch, WEB_ID, profile, STORAGE, { signal: before.signal }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();

    const during = new AbortController();
    const pendingFetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      during.abort();
      init?.signal?.throwIfAborted();
      throw new Error("unreachable");
    });
    await expect(
      readTypeIndexes(pendingFetch, WEB_ID, profile, STORAGE, { signal: during.signal }),
    ).rejects.toThrow();
    expect(pendingFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "indexes",
    "items",
  ])("aborts a pending %s read at the deadline and reports incomplete results", async (phase) => {
    const profile = await rdf("<#me> solid:publicTypeIndex <../index.ttl> .", WEB_ID);
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const result =
      phase === "indexes"
        ? await readTypeIndexes(fetch, WEB_ID, profile, STORAGE, { timeoutMs: 10 })
        : await discoverDomainItems("media", { storage: STORAGE, fetch, timeoutMs: 10 });
    expect(result.truncated).toBe(true);
    expect(result.failures).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the original deadline between phases and discards late responses", async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    try {
      const budget = new DiscoveryBudget();
      expect(timeout).toHaveBeenCalledWith(30_000);
      const profile = await rdf("<#me> solid:publicTypeIndex <../index.ttl> .", WEB_ID);
      const fetch = fixtureFetch({ [`${STORAGE}index.ttl`]: "" });
      expect((await readTypeIndexes(fetch, WEB_ID, profile, STORAGE, { budget })).truncated).toBe(
        false,
      );
      deadline.abort();
      expect(
        (await discoverDomainItems("media", { storage: STORAGE, fetch, budget })).truncated,
      ).toBe(true);
      expect((await readTypeIndexes(fetch, WEB_ID, profile, STORAGE, { budget })).truncated).toBe(
        true,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(timeout).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }

    const lateDeadline = new AbortController();
    const lateTimeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(lateDeadline.signal);
    try {
      const fetch: typeof globalThis.fetch = async () => {
        lateDeadline.abort();
        return new Response("", { headers: { "content-type": "text/turtle" } });
      };
      const result = await readTypeIndexes(
        fetch,
        WEB_ID,
        await rdf("<#me> solid:publicTypeIndex <../index.ttl> .", WEB_ID),
        STORAGE,
      );
      expect(result).toEqual({ locations: [], failures: [], truncated: true });
    } finally {
      lateTimeout.mockRestore();
    }
  });

  it("validates index request and deadline limits", async () => {
    const profile = await rdf("");
    for (const maxRequests of [0, -1, 0.1, Number.NaN])
      await expect(
        readTypeIndexes(fixtureFetch({}), WEB_ID, profile, STORAGE, { maxRequests }),
      ).rejects.toThrow("budget");
    for (const timeoutMs of [0, -1, 0.1, Number.NaN, 2_147_483_648])
      await expect(
        readTypeIndexes(fixtureFetch({}), WEB_ID, profile, STORAGE, { timeoutMs }),
      ).rejects.toThrow("timeout");
  });

  it("returns explicit absent, unreadable and out-of-scope failures without leaking credentials", async () => {
    const profile = await rdf(
      "<#me> solid:publicTypeIndex <../missing.ttl>, <https://foreign.example/index.ttl> ; solid:privateTypeIndex <../private.ttl> .",
      WEB_ID,
    );
    const fetch = fixtureFetch({ [`${STORAGE}private.ttl`]: 403 });
    const result = await readTypeIndexes(fetch, WEB_ID, profile, STORAGE);
    expect(result.locations).toEqual([]);
    expect(result.failures).toHaveLength(3);
    expect(result.failures.map((failure) => failure.url)).toContain(
      "https://foreign.example/index.ttl",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
