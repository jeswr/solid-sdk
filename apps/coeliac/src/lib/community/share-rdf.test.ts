// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import type { ShareCard } from "./share-card.js";
import { DIET_SAFE_FOOD_SHARE } from "./share-card.js";
import { serializeShareCard } from "./share-rdf.js";
import { ShareSanitizationError } from "./share.js";

const SUBJECT = "https://alice.example/community/shares/01ARZ3NDEKTSV4RRFFQ69G5FAV.ttl#it";
const DIARY_IRI = "https://alice.example/health/diary/meals/2026/07/01ARZ3NDEKTSV4RRFFQ69G5FAV.ttl#it";

function card(over: Partial<ShareCard["message"]>, audience: ShareCard["audience"] = "owner-only"): ShareCard {
  return {
    kind: "safe-food",
    shareClass: DIET_SAFE_FOOD_SHARE,
    message: { content: "Safe foods that work for me: rice.", mediaType: "text/plain", ...over },
    audience,
  };
}

describe("serializeShareCard", () => {
  it("emits an as:Note typed as the diet:*Share class with content + mediaType", async () => {
    const ttl = await serializeShareCard(card({ published: "2026-07-03T12:00:00.000Z" }), SUBJECT);
    expect(ttl).toContain("Note");
    expect(ttl).toContain("SafeFoodShare");
    expect(ttl).toContain("Safe foods that work for me: rice.");
    expect(ttl).toContain("text/plain");
    expect(ttl).toContain("2026-07-03T12:00:00.000Z");
  });

  it("serialises an http(s) author as as:attributedTo", async () => {
    const ttl = await serializeShareCard(card({ author: "https://pseudo.example/profile#me" }), SUBJECT);
    expect(ttl).toContain("https://pseudo.example/profile#me");
  });

  it("DROPS a non-http(s) author (parity with canonicalToAs2)", async () => {
    const ttl = await serializeShareCard(card({ author: "did:key:z6MkExample" }), SUBJECT);
    expect(ttl).not.toContain("did:key");
  });

  it("serialises provenance.attributedTo/generatedBy", async () => {
    const ttl = await serializeShareCard(
      card({ provenance: { attributedTo: "https://pseudo.example/#me", generatedBy: "https://app.example/#it" } }),
      SUBJECT,
    );
    expect(ttl).toContain("https://pseudo.example/#me");
    expect(ttl).toContain("https://app.example/#it");
  });

  it("THROWS fail-closed on a card carrying provenance.derivedFrom (never silently strips it)", async () => {
    // A direct serializer caller bypassing assertShareable must NOT get a clean
    // payload from a provenance-bearing card — the serializer refuses it.
    await expect(serializeShareCard(card({ provenance: { derivedFrom: DIARY_IRI } }), SUBJECT)).rejects.toBeInstanceOf(
      ShareSanitizationError,
    );
    // Even a non-diary derivedFrom is refused — a share carries NO derivation link.
    await expect(
      serializeShareCard(card({ provenance: { derivedFrom: "https://pseudo.example/x#it" } }), SUBJECT),
    ).rejects.toBeInstanceOf(ShareSanitizationError);
  });

  it("THROWS fail-closed if a diary IRI reaches serialisation as an IRI field", async () => {
    await expect(serializeShareCard(card({ author: DIARY_IRI }), SUBJECT)).rejects.toBeInstanceOf(ShareSanitizationError);
  });

  it("THROWS fail-closed if the body carries a diary IRI", async () => {
    await expect(serializeShareCard(card({ content: `see ${DIARY_IRI}` }), SUBJECT)).rejects.toBeInstanceOf(
      ShareSanitizationError,
    );
  });

  it("THROWS on a non-text/plain body (stored-XSS guard, defence in depth)", async () => {
    await expect(serializeShareCard(card({ mediaType: "text/html" }), SUBJECT)).rejects.toBeInstanceOf(
      ShareSanitizationError,
    );
  });

  it("never emits the diary scope segment", async () => {
    const ttl = await serializeShareCard(card({ author: "https://pseudo.example/#me" }), SUBJECT);
    expect(ttl).not.toContain("/health/diary/");
  });
});
