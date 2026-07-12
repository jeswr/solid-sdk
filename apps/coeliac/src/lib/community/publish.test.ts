// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareCard } from "./share-card";
import { DIET_SAFE_FOOD_SHARE } from "./share-card";
import {
  ensureCommunityReady,
  publishShareCard,
  resetCommunityReadyMemo,
  serializeProvenanceSidecar,
  writeShareProvenanceSidecar,
} from "./publish";

const ROOT = "https://alice.example/";
const OWNER = "https://alice.example/profile/card#me";
const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const DIARY_IRI = "https://alice.example/health/diary/meals/2026/07/01BX5ZZKBKACTAV9WEVGEMMVRZ.ttl#it";

/** A recording fetch: HEAD → 404 (create), PUT → 201. */
function recordingFetch() {
  const calls: { method: string; url: string; body?: string }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });
    if (method === "HEAD") return new Response(null, { status: 404 });
    return new Response("", { status: 201 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function safeFoodCard(audience: ShareCard["audience"] = "owner-only", author?: string): ShareCard {
  const message: ShareCard["message"] = {
    content: "Safe foods that work for me: rice, Schär bread.",
    mediaType: "text/plain",
    published: "2026-07-03T12:00:00.000Z",
  };
  if (author) message.author = author;
  return { kind: "safe-food", shareClass: DIET_SAFE_FOOD_SHARE, message, audience };
}

beforeEach(() => resetCommunityReadyMemo());

describe("ensureCommunityReady", () => {
  it("writes an OWNER-ONLY ACL on the /community/ root BEFORE any share container", async () => {
    const { fetch, calls } = recordingFetch();
    await ensureCommunityReady(fetch, ROOT, OWNER);

    const aclPut = calls.find((c) => c.method === "PUT" && c.url.endsWith("/community/.acl"));
    expect(aclPut).toBeTruthy();
    expect(aclPut?.body ?? "").not.toMatch(/agentClass|foaf:Agent|Public/i);
    expect(aclPut?.body ?? "").toContain(OWNER);

    const aclIndex = calls.findIndex((c) => c.url.endsWith("/community/.acl") && c.method === "PUT");
    const sharesIndex = calls.findIndex((c) => c.url.endsWith("/community/shares/") && c.method === "PUT");
    expect(aclIndex).toBeGreaterThanOrEqual(0);
    expect(sharesIndex).toBeGreaterThan(aclIndex);
  });

  it("NEVER issues a write to a diary URL", async () => {
    const { fetch, calls } = recordingFetch();
    await ensureCommunityReady(fetch, ROOT, OWNER);
    expect(calls.every((c) => !c.url.includes("/health/diary/"))).toBe(true);
  });

  it("is memoised — a second call issues no further requests", async () => {
    const { fetch } = recordingFetch();
    await ensureCommunityReady(fetch, ROOT, OWNER);
    const n = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await ensureCommunityReady(fetch, ROOT, OWNER);
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(n);
  });
});

describe("publishShareCard", () => {
  it("provisions the owner-only ACL first, then PUTs the card under community/shares/", async () => {
    const { fetch, calls } = recordingFetch();
    const url = await publishShareCard(fetch, ROOT, OWNER, ULID, safeFoodCard());
    expect(url).toBe(`https://alice.example/community/shares/${ULID}.ttl`);

    const aclIndex = calls.findIndex((c) => c.url.endsWith("/community/.acl") && c.method === "PUT");
    const cardIndex = calls.findIndex((c) => c.url === url && c.method === "PUT");
    expect(aclIndex).toBeGreaterThanOrEqual(0);
    expect(cardIndex).toBeGreaterThan(aclIndex);
  });

  it("NEVER writes to a diary URL and the card body carries no diary IRI", async () => {
    const { fetch, calls } = recordingFetch();
    await publishShareCard(fetch, ROOT, OWNER, ULID, safeFoodCard());
    expect(calls.every((c) => !c.url.includes("/health/diary/"))).toBe(true);
    const cardPut = calls.find((c) => c.url.endsWith(`/shares/${ULID}.ttl`) && c.method === "PUT");
    expect(cardPut?.body ?? "").not.toContain("/health/diary/");
    // The card resource carries no public/agentClass grant of its own (owner-only default).
    expect(calls.every((c) => !(c.body ?? "").match(/foaf:Agent/))).toBe(true);
  });

  it("REFUSES to publish a card carrying provenance.derivedFrom (no writes happen)", async () => {
    const { fetch, calls } = recordingFetch();
    const bad = safeFoodCard();
    bad.message.provenance = { derivedFrom: DIARY_IRI };
    await expect(publishShareCard(fetch, ROOT, OWNER, ULID, bad)).rejects.toThrow();
    expect(calls.some((c) => c.method === "PUT" && c.url.includes("/shares/"))).toBe(false);
  });

  it("REFUSES to publish ANY public card to the user's own (origin-linkable) pod", async () => {
    const { fetch, calls } = recordingFetch();
    // Even with an unlinkable author, the resource IRI on the owner's pod is
    // linkable — same-pod publishing is owner-only/group only (public = 4B-2).
    const pub = safeFoodCard("public", "https://pseudo.example/profile#me");
    await expect(publishShareCard(fetch, ROOT, OWNER, ULID, pub)).rejects.toThrow(/public/);
    expect(calls.some((c) => c.method === "PUT" && c.url.includes("/shares/"))).toBe(false);
  });

  it("rejects an invalid ULID (path-injection guard)", async () => {
    const { fetch } = recordingFetch();
    await expect(publishShareCard(fetch, ROOT, OWNER, "../evil", safeFoodCard())).rejects.toThrow();
  });
});

describe("provenance sidecar — separate, owner-only, diary-IRIs-only", () => {
  it("serialises ONLY absolute http(s) diary IRIs and refuses anything else", async () => {
    const ttl = await serializeProvenanceSidecar("https://alice.example/community/shares/x.provenance.ttl#it", [DIARY_IRI]);
    expect(ttl).toContain(DIARY_IRI);
    expect(ttl).toContain("wasDerivedFrom");
    // Non-diary host → refused.
    await expect(serializeProvenanceSidecar("https://x/#it", ["https://evil.example/not-a-diary"])).rejects.toThrow();
    // Relative / malformed / non-http(s) diary-ish strings → refused (roborev Medium).
    await expect(serializeProvenanceSidecar("https://x/#it", ["/health/diary/meals/a.ttl"])).rejects.toThrow();
    await expect(serializeProvenanceSidecar("https://x/#it", ["not a url /health/diary/"])).rejects.toThrow();
    await expect(serializeProvenanceSidecar("https://x/#it", ["file:///health/diary/x"])).rejects.toThrow();
  });

  it("writes the sidecar to a DISTINCT .provenance.ttl resource, not the card", async () => {
    const { fetch, calls } = recordingFetch();
    const url = await writeShareProvenanceSidecar(fetch, ROOT, OWNER, ULID, [DIARY_IRI]);
    expect(url).toBe(`https://alice.example/community/shares/${ULID}.provenance.ttl`);
    // It is NOT the card resource.
    expect(url).not.toBe(`https://alice.example/community/shares/${ULID}.ttl`);
    // It is under the owner-only community scope (never a diary URL).
    expect(calls.every((c) => !c.url.includes("/health/diary/"))).toBe(true);
  });
});
