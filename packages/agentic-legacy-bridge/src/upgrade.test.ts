// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Fable 5
import { Parser, Writer } from "n3";
import { describe, expect, it, vi } from "vitest";
import type { UpgradeOffer } from "./negotiate.js";
import { base64Url } from "./safe-iri.js";
import {
  createGuardedUpgradeTransport,
  createPodRelationshipStore,
  decodeUpgradeResponse,
  discoverCard,
  encodeUpgradeOffer,
  InMemoryRelationshipStore,
  offerAndNegotiate,
  RelationshipConflictError,
  recordBridgeDetected,
  recordIdentityVerified,
  type UpgradeTransport,
} from "./upgrade.js";
import { serializeRelationship, transition } from "./upgrade-state.js";
import { AGENTIC_OFFER_IRI_VERSION, AGENTIC_PERSON_IRI_VERSION } from "./vocab.js";

const PERSON = "urn:agentic:person:c2xhY2s6VDpV";
const WEBID = "https://bob.example/profile/card#me";
const CARD = "https://bob.example/agent-card.json";
const CONTAINER = "https://alice.example/rel/";
const AT = new Date("2026-07-05T00:00:00.000Z");
const rdfOffer: UpgradeOffer = { targetChannel: "rdf", required: false, protocolHash: "h" };

function must<T>(x: T | undefined | null): T {
  if (x === undefined || x === null) throw new Error("expected a defined value");
  return x;
}

async function driveToCard(store: InMemoryRelationshipStore): Promise<void> {
  await recordBridgeDetected(store, PERSON, AT);
  await recordIdentityVerified(store, PERSON, WEBID, AT);
  await discoverCard(store, PERSON, async () => ({ agentCardUrl: CARD }), AT);
}

/** Reproduce an unversioned document written before lexical relationship keys. */
async function legacyDocument(state: Parameters<typeof serializeRelationship>[0], url: string) {
  const quads = new Parser().parse(await serializeRelationship(state, url));
  return new Writer({ format: "text/turtle" }).quadsToString(
    quads.filter(
      (quad) =>
        ![AGENTIC_PERSON_IRI_VERSION, AGENTIC_OFFER_IRI_VERSION].includes(quad.predicate.value),
    ),
  );
}

describe("InMemoryRelationshipStore — optimistic concurrency (CAS)", () => {
  it("bumps a version on each save and refuses a stale write", async () => {
    const store = new InMemoryRelationshipStore();
    await recordBridgeDetected(store, PERSON, AT); // creates version 1
    const loaded = await store.load(PERSON);
    expect(loaded?.version).toBe("1");

    // A stale save (wrong expectedVersion) conflicts.
    await expect(
      store.save({ ...must(loaded).state, state: "legacy-only" }, "0"),
    ).rejects.toBeInstanceOf(RelationshipConflictError);
  });
});

describe("orchestration — the ratchet is persisted", () => {
  it("drives legacy → verified → card → upgraded through the store", async () => {
    const store = new InMemoryRelationshipStore();
    await driveToCard(store);
    const transport: UpgradeTransport = async () => ({ accept: true, protocolHash: "h" });
    const r = await offerAndNegotiate(store, PERSON, rdfOffer, transport, AT);
    expect(r.ok).toBe(true);
    const loaded = await store.load(PERSON);
    expect(loaded?.state.state).toBe("upgraded");
    expect(loaded?.state.currentChannel).toBe("rdf");
  });

  it("persists offer-pending before invoking transport", async () => {
    const store = new InMemoryRelationshipStore();
    await driveToCard(store);
    const transport: UpgradeTransport = async () => {
      expect((await store.load(PERSON))?.state.state).toBe("offer-pending");
      return { accept: false };
    };

    await offerAndNegotiate(store, PERSON, rdfOffer, transport, AT);
    expect((await store.load(PERSON))?.state.state).toBe("card-discovered");
  });

  it("retains offer-pending on transport failure and resumes an identical retry", async () => {
    const store = new InMemoryRelationshipStore();
    await driveToCard(store);
    await expect(
      offerAndNegotiate(store, PERSON, rdfOffer, async () => {
        throw new Error("peer unavailable");
      }),
    ).rejects.toThrow(/peer unavailable/);
    expect((await store.load(PERSON))?.state.state).toBe("offer-pending");

    const retried = await offerAndNegotiate(
      store,
      PERSON,
      rdfOffer,
      async () => ({ accept: true, protocolHash: "h" }),
      AT,
    );
    expect(retried).toMatchObject({ ok: true, state: { state: "upgraded" } });
  });

  it("refuses to replace a durable pending offer with a different offer", async () => {
    const store = new InMemoryRelationshipStore();
    await driveToCard(store);
    await expect(
      offerAndNegotiate(store, PERSON, rdfOffer, async () => {
        throw new Error("peer unavailable");
      }),
    ).rejects.toThrow();
    const transport = vi.fn(async () => ({ accept: true }));

    const result = await offerAndNegotiate(
      store,
      PERSON,
      { ...rdfOffer, targetChannel: "a2a" },
      transport,
      AT,
    );
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/different/) });
    expect(transport).not.toHaveBeenCalled();
    expect((await store.load(PERSON))?.state.pendingOffer).toEqual(rdfOffer);
  });
});

describe("orchestration — SSRF gating (verified endpoints only)", () => {
  it("calls the card-discovery seam ONLY with the VERIFIED WebID", async () => {
    const store = new InMemoryRelationshipStore();
    await recordBridgeDetected(store, PERSON, AT);
    await recordIdentityVerified(store, PERSON, WEBID, AT);
    const discover = vi.fn(async () => ({ agentCardUrl: CARD }));
    await discoverCard(store, PERSON, discover, AT);
    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith(WEBID);
  });

  it("REFUSES discovery before identity-verified (never fetches on an unverified handle)", async () => {
    const store = new InMemoryRelationshipStore();
    await recordBridgeDetected(store, PERSON, AT); // only bridge-detected
    const discover = vi.fn(async () => ({ agentCardUrl: CARD }));
    const r = await discoverCard(store, PERSON, discover, AT);
    expect(r.ok).toBe(false);
    expect(discover).not.toHaveBeenCalled();
  });

  it("targets the offer transport at the VERIFIED card endpoint only", async () => {
    const store = new InMemoryRelationshipStore();
    await driveToCard(store);
    const seen: string[] = [];
    const transport: UpgradeTransport = async ({ target }) => {
      seen.push(target);
      return { accept: false };
    };
    await offerAndNegotiate(store, PERSON, rdfOffer, transport, AT);
    expect(seen).toEqual([CARD]);
  });
});

describe("orchestration — persistence keys on the escaped lexical personIri", () => {
  it("progresses the ratchet when the caller uses a non-canonical HTTP personIri", async () => {
    const store = new InMemoryRelationshipStore();
    // The shared guard preserves the default port as part of RDF identity. Load + save
    // must resolve to the same lexical key so the state machine can advance.
    const nonCanonical = "https://carol.example:443/card#me";
    const b = await recordBridgeDetected(store, nonCanonical, AT);
    expect(b.ok).toBe(true);
    // A second advance with the SAME non-canonical arg must find the bridge-detected
    // state (not re-create legacy-only, which would make identity-verified illegal).
    const v = await recordIdentityVerified(store, nonCanonical, WEBID, AT);
    expect(v.ok).toBe(true);
    const loaded = await store.load(nonCanonical);
    expect(loaded?.state.state).toBe("identity-verified");
    // Persistence preserves the escaped lexical IRI, including its default port.
    expect(loaded?.state.personIri).toBe(nonCanonical);
  });
});

describe("createGuardedUpgradeTransport — https-only, no payload-picked target", () => {
  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1024 * 1024 + 1,
  ])("rejects an invalid maxResponseBytes value: %s", (maxResponseBytes) => {
    expect(() => createGuardedUpgradeTransport({ maxResponseBytes })).toThrow(/maxResponseBytes/);
  });

  it("aborts + throws when the peer response exceeds the size cap", async () => {
    const bigBody = "x".repeat(2000);
    const fetchImpl = (async () => new Response(bigBody, { status: 200 })) as typeof fetch;
    const transport = createGuardedUpgradeTransport({ fetch: fetchImpl, maxResponseBytes: 100 });
    await expect(transport({ target: CARD, payload: {} })).rejects.toThrow(/size cap/);
  });

  it("refuses a non-https target before any fetch", async () => {
    const fetchSpy = vi.fn();
    const transport = createGuardedUpgradeTransport({ fetch: fetchSpy as unknown as typeof fetch });
    await expect(transport({ target: "http://bob.example/x", payload: {} })).rejects.toThrow(
      /https/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses an unsafe target before any fetch", async () => {
    const fetchSpy = vi.fn();
    const transport = createGuardedUpgradeTransport({ fetch: fetchSpy as unknown as typeof fetch });
    await expect(transport({ target: "not a url", payload: {} })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs JSON to a valid https target and parses the response", async () => {
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe(CARD);
      expect(init?.method).toBe("POST");
      expect(String(init?.body)).toContain("agentic-upgrade-offer");
      return new Response(JSON.stringify({ accept: true }), { status: 200 });
    }) as typeof fetch;
    const transport = createGuardedUpgradeTransport({ fetch: fetchImpl });
    const out = await transport({ target: CARD, payload: encodeUpgradeOffer(rdfOffer) });
    expect(out).toEqual({ accept: true });
  });

  it("refuses to follow a redirect", async () => {
    const fetchImpl = (async () => new Response(null, { status: 302 })) as typeof fetch;
    const transport = createGuardedUpgradeTransport({ fetch: fetchImpl });
    await expect(transport({ target: CARD, payload: {} })).rejects.toThrow(/redirect/);
  });
});

describe("decodeUpgradeResponse — fail-closed", () => {
  it("accepts only a strict boolean accept:true", () => {
    expect(decodeUpgradeResponse({ accept: true })).toEqual({ accept: true });
    expect(decodeUpgradeResponse({ accept: true, protocolHash: "h" })).toEqual({
      accept: true,
      protocolHash: "h",
    });
  });

  it("treats anything else as a decline", () => {
    expect(decodeUpgradeResponse({ accept: "true" })).toEqual({ accept: false });
    expect(decodeUpgradeResponse({})).toEqual({ accept: false });
    expect(decodeUpgradeResponse(null)).toEqual({ accept: false });
    expect(decodeUpgradeResponse("accept")).toEqual({ accept: false });
    expect(decodeUpgradeResponse({ accept: 1 })).toEqual({ accept: false });
  });

  it("drops a non-string protocolHash", () => {
    expect(decodeUpgradeResponse({ accept: true, protocolHash: 5 })).toEqual({ accept: true });
  });

  it("drops an empty, oversized, or control-bearing protocolHash", () => {
    expect(decodeUpgradeResponse({ accept: true, protocolHash: "" })).toEqual({ accept: true });
    expect(decodeUpgradeResponse({ accept: true, protocolHash: "x".repeat(257) })).toEqual({
      accept: true,
    });
    expect(decodeUpgradeResponse({ accept: true, protocolHash: "ok\nspoof" })).toEqual({
      accept: true,
    });
  });
});

describe("createPodRelationshipStore — pod round-trip with CAS", () => {
  class FakePod {
    readonly store = new Map<string, { body: string; etag: string }>();
    fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const m = (init?.method ?? "GET").toUpperCase();
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (m === "GET") {
        const e = this.store.get(u);
        if (e === undefined) return new Response(null, { status: 404 });
        return new Response(e.body, { status: 200, headers: { etag: e.etag } });
      }
      if (m === "PUT") {
        const existing = this.store.get(u);
        if (headers["if-none-match"] === "*" && existing !== undefined) {
          return new Response(null, { status: 412 });
        }
        if (
          headers["if-match"] !== undefined &&
          (existing === undefined || existing.etag !== headers["if-match"])
        ) {
          return new Response(null, { status: 412 });
        }
        const nextNum = existing === undefined ? 1 : Number(existing.etag.slice(1)) + 1;
        const etag = `v${nextNum}`;
        this.store.set(u, { body: String(init?.body), etag });
        return new Response(null, { status: 201, headers: { etag } });
      }
      return new Response(null, { status: 405 });
    }) as typeof fetch;
  }

  it.each([
    ["https://protocol.example", "https://protocol.example/"],
    ["https://PROTOCOL.example:443/a/../v1", "https://protocol.example/v1"],
    ["https://bücher.example/日本語", "https://xn--bcher-kva.example/%E6%97%A5%E6%9C%AC%E8%AA%9E"],
    ["https://protocol.example/a\\v1?x=|^`", "https://protocol.example/a/v1?x=%7C%5E%60"],
  ])("retries an unversioned pending offer with its original normalization: %s", async (input, canonical) => {
    const pod = new FakePod();
    const mem = new InMemoryRelationshipStore();
    await driveToCard(mem);
    const original = { ...rdfOffer, protocolSource: canonical };
    const pending = transition(
      must(await mem.load(PERSON)).state,
      { kind: "offer", offer: original },
      AT,
    );
    if (!pending.ok) throw new Error(pending.reason);
    const url = `${CONTAINER}rel-${base64Url(PERSON)}.ttl`;
    pod.store.set(url, { body: await legacyDocument(pending.state, url), etag: "v7" });

    const store = createPodRelationshipStore({ container: CONTAINER, writeFetch: pod.fetch });
    const loaded = must(await store.load(PERSON));
    expect(loaded.state).toMatchObject({ pendingOffer: original, pendingOfferVersion: 1 });
    await store.save(loaded.state, loaded.version);
    const reopened = createPodRelationshipStore({ container: CONTAINER, writeFetch: pod.fetch });
    expect((await reopened.load(PERSON))?.state.pendingOfferVersion).toBe(1);

    const transport = vi.fn(async () => ({ accept: true, protocolHash: "h" }));
    for (const changed of [
      { ...original, protocolSource: "https://other.example/" },
      { ...original, protocolHash: "other" },
      { ...original, required: true },
      { ...original, targetChannel: "a2a" as const },
    ]) {
      expect(await offerAndNegotiate(reopened, PERSON, changed, transport, AT)).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/different/),
      });
    }
    expect(transport).not.toHaveBeenCalled();

    const retry = { ...rdfOffer, protocolSource: input };
    const failing = vi.fn(async () => {
      throw new Error("peer unavailable");
    });
    await expect(offerAndNegotiate(reopened, PERSON, retry, failing, AT)).rejects.toThrow(
      /peer unavailable/,
    );
    expect(failing).toHaveBeenCalledWith({ target: CARD, payload: encodeUpgradeOffer(original) });
    expect((await reopened.load(PERSON))?.state).toMatchObject({
      state: "offer-pending",
      pendingOffer: original,
      pendingOfferVersion: 1,
    });

    const result = await offerAndNegotiate(reopened, PERSON, retry, transport, AT);
    expect(result).toMatchObject({ ok: true, state: { state: "upgraded" } });
    expect(transport).toHaveBeenCalledExactlyOnceWith({
      target: CARD,
      payload: encodeUpgradeOffer(original),
    });
  });

  it("keeps lexical protocol bindings distinct for new pending offers after reopening", async () => {
    const pod = new FakePod();
    const store = createPodRelationshipStore({ container: CONTAINER, writeFetch: pod.fetch });
    const mem = new InMemoryRelationshipStore();
    await driveToCard(mem);
    await store.save(must(await mem.load(PERSON)).state);
    const offer = { ...rdfOffer, protocolSource: "https://PROTOCOL.example:443" };
    await expect(
      offerAndNegotiate(
        store,
        PERSON,
        offer,
        async () => {
          throw new Error("peer unavailable");
        },
        AT,
      ),
    ).rejects.toThrow(/peer unavailable/);

    const reopened = createPodRelationshipStore({ container: CONTAINER, writeFetch: pod.fetch });
    expect((await reopened.load(PERSON))?.state).toMatchObject({
      pendingOfferVersion: 2,
      pendingOffer: offer,
    });
    const transport = vi.fn(async () => ({ accept: true, protocolHash: "h" }));
    expect(
      await offerAndNegotiate(
        reopened,
        PERSON,
        { ...offer, protocolSource: "https://protocol.example/" },
        transport,
        AT,
      ),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/different/) });
    expect(transport).not.toHaveBeenCalled();
    expect(await offerAndNegotiate(reopened, PERSON, offer, transport, AT)).toMatchObject({
      ok: true,
      state: { state: "upgraded" },
    });
    expect(transport).toHaveBeenCalledExactlyOnceWith({
      target: CARD,
      payload: encodeUpgradeOffer(offer),
    });
  });

  it.each([
    ["https://CAROL.example:443/a/../card#me", "https://carol.example/card#me"],
    ["https://carol.example", "https://carol.example/"],
    [
      "https://bücher.example/日本語#me",
      "https://xn--bcher-kva.example/%E6%97%A5%E6%9C%AC%E8%AA%9E#me",
    ],
    ["https://carol.example/a|b^c`d#me", "https://carol.example/a%7Cb%5Ec%60d#me"],
    ["https://carol.example/a\\card#me", "https://carol.example/a/card#me"],
    ["https://carol.example/a\ncard#me", "https://carol.example/acard#me"],
  ])("resumes legacy canonical-key state for %s with CAS", async (personIri, legacyPersonIri) => {
    const pod = new FakePod();
    const legacyUrl = `${CONTAINER}rel-${base64Url(legacyPersonIri)}.ttl`;
    const mem = new InMemoryRelationshipStore();
    await recordBridgeDetected(mem, legacyPersonIri, AT);
    const state = must(await mem.load(legacyPersonIri)).state;
    // Seed the pre-migration resource independently of the current pod-store keying.
    pod.store.set(legacyUrl, {
      body: await legacyDocument(state, legacyUrl),
      etag: "v7",
    });
    const store = createPodRelationshipStore({ container: CONTAINER, writeFetch: pod.fetch });
    const loaded = must(await store.load(personIri));
    expect(loaded).toMatchObject({
      state: { personIri: legacyPersonIri, personIriVersion: 1, state: "bridge-detected" },
      version: "v7",
    });

    expect(await recordIdentityVerified(store, personIri, WEBID, AT)).toMatchObject({ ok: true });
    expect(pod.store.size).toBe(1);
    expect(pod.store.get(legacyUrl)?.etag).toBe("v8");
    // A new store instance must still find the advanced state, and stale saves must fail.
    const reopened = createPodRelationshipStore({ container: CONTAINER, writeFetch: pod.fetch });
    expect(await reopened.load(personIri)).toMatchObject({
      state: { personIriVersion: 1, state: "identity-verified" },
      version: "v8",
    });
    await expect(reopened.save(loaded.state, loaded.version)).rejects.toBeInstanceOf(
      RelationshipConflictError,
    );
  });

  it.each([
    ["https://CAROL.example:443/card#me", "https://carol.example/card#me"],
    ["https://carol.example", "https://carol.example/"],
    ["https://carol.example/a/../card#me", "https://carol.example/card#me"],
    [
      "https://bücher.example/日本語#me",
      "https://xn--bcher-kva.example/%E6%97%A5%E6%9C%AC%E8%AA%9E#me",
    ],
  ])("does not reuse a new relationship for another lexical identity: %s", async (lexical, canonical) => {
    const pod = new FakePod();
    const store = createPodRelationshipStore({ container: CONTAINER, writeFetch: pod.fetch });
    await recordBridgeDetected(store, canonical, AT);
    await recordIdentityVerified(store, canonical, WEBID, AT);
    await discoverCard(store, canonical, async () => ({ agentCardUrl: CARD }), AT);
    await offerAndNegotiate(
      store,
      canonical,
      rdfOffer,
      async () => ({ accept: true, protocolHash: "h" }),
      AT,
    );

    const reopened = createPodRelationshipStore({ container: CONTAINER, writeFetch: pod.fetch });
    expect(await reopened.load(lexical)).toBeUndefined();
    const discover = vi.fn(async () => ({ agentCardUrl: CARD }));
    const transport = vi.fn(async () => ({ accept: true }));
    expect(await discoverCard(reopened, lexical, discover, AT)).toMatchObject({ ok: false });
    expect(await offerAndNegotiate(reopened, lexical, rdfOffer, transport, AT)).toMatchObject({
      ok: false,
    });
    expect(discover).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();

    expect(await recordBridgeDetected(reopened, lexical, AT)).toMatchObject({ ok: true });
    const separate = must(await reopened.load(lexical)).state;
    expect(separate).toMatchObject({
      personIri: lexical,
      personIriVersion: 2,
      state: "bridge-detected",
    });
    expect(separate.verifiedWebId).toBeUndefined();
    expect((await reopened.load(canonical))?.state.state).toBe("upgraded");
    expect(pod.store.size).toBe(2);
  });

  it("prefers lexical-key state when both lexical and legacy resources exist", async () => {
    const pod = new FakePod();
    const store = createPodRelationshipStore({ container: CONTAINER, writeFetch: pod.fetch });
    const lexical = "https://CAROL.example:443/card#me";
    const legacy = "https://carol.example/card#me";
    await recordBridgeDetected(store, legacy, AT);
    await store.save({ ...must(await store.load(legacy)).state, personIri: lexical });
    await recordIdentityVerified(store, lexical, WEBID, AT);

    expect((await store.load(lexical))?.state).toMatchObject({
      personIri: lexical,
      state: "identity-verified",
    });
    expect((await store.load(legacy))?.state.state).toBe("bridge-detected");
    expect(pod.store.size).toBe(2);
  });

  it("stores new HTTP relationships under their lexical key", async () => {
    const pod = new FakePod();
    const store = createPodRelationshipStore({ container: CONTAINER, writeFetch: pod.fetch });
    const personIri = "https://CAROL.example:443/a/../日本語#me";
    await recordBridgeDetected(store, personIri, AT);
    await recordIdentityVerified(store, personIri, WEBID, AT);

    expect([...pod.store.keys()]).toEqual([`${CONTAINER}rel-${base64Url(personIri)}.ttl`]);
    expect((await store.load(personIri))?.state).toMatchObject({
      personIri,
      state: "identity-verified",
    });
  });

  it("saves (create), loads with a version, and re-saves with If-Match", async () => {
    const pod = new FakePod();
    const store = createPodRelationshipStore({ container: CONTAINER, writeFetch: pod.fetch });

    // In-memory drive, then persist to the pod.
    const mem = new InMemoryRelationshipStore();
    await driveToCard(mem);
    const card = must(await mem.load(PERSON)).state;

    await store.save(card); // create (If-None-Match: *)
    const loaded = await store.load(PERSON);
    expect(loaded?.state.state).toBe("card-discovered");
    expect(loaded?.version).toBe("v1");

    // A CAS re-save with the loaded version succeeds.
    await store.save({ ...card, currentChannel: "email" }, loaded?.version);
    expect((await store.load(PERSON))?.version).toBe("v2");
  });

  it("rejects a stale save with a conflict (If-Match mismatch → 412)", async () => {
    const pod = new FakePod();
    const store = createPodRelationshipStore({ container: CONTAINER, writeFetch: pod.fetch });
    const mem = new InMemoryRelationshipStore();
    await driveToCard(mem);
    const card = must(await mem.load(PERSON)).state;
    await store.save(card);
    await expect(store.save(card, "v-stale")).rejects.toBeInstanceOf(RelationshipConflictError);
  });

  it("returns undefined for a missing relationship (404)", async () => {
    const pod = new FakePod();
    const store = createPodRelationshipStore({ container: CONTAINER, writeFetch: pod.fetch });
    expect(await store.load(PERSON)).toBeUndefined();
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1024 * 1024 + 1,
  ])("rejects an invalid maxStateBytes value: %s", (maxStateBytes) => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(() =>
      createPodRelationshipStore({ container: CONTAINER, writeFetch: fetchImpl, maxStateBytes }),
    ).toThrow(/maxStateBytes/);
  });

  it("refuses an existing state without an ETag because safe CAS is impossible", async () => {
    const pod = new FakePod();
    const writer = createPodRelationshipStore({ container: CONTAINER, writeFetch: pod.fetch });
    const mem = new InMemoryRelationshipStore();
    await driveToCard(mem);
    await writer.save(must(await mem.load(PERSON)).state);
    const noEtagFetch = (async (url: string | URL, init?: RequestInit) => {
      const response = await pod.fetch(url, init);
      return new Response(response.body, { status: response.status });
    }) as typeof fetch;
    const reader = createPodRelationshipStore({
      container: CONTAINER,
      writeFetch: pod.fetch,
      readFetch: noEtagFetch,
    });
    await expect(reader.load(PERSON)).rejects.toThrow(/no ETag/);
  });

  it("bounds relationship-state reads before parsing", async () => {
    const pod = new FakePod();
    const writer = createPodRelationshipStore({ container: CONTAINER, writeFetch: pod.fetch });
    const mem = new InMemoryRelationshipStore();
    await driveToCard(mem);
    await writer.save(must(await mem.load(PERSON)).state);
    const reader = createPodRelationshipStore({
      container: CONTAINER,
      writeFetch: pod.fetch,
      maxStateBytes: 16,
    });
    await expect(reader.load(PERSON)).rejects.toThrow(/size cap/);
  });
});
