// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import type { ToleranceConclusionData } from "@jeswr/solid-health-diary";
import { describe, expect, it } from "vitest";
import { ShareIdentityError, type CommunityIdentity } from "./identity";
import type { CanonicalMessage, ShareCard } from "./share-card";
import { DIET_SAFE_FOOD_SHARE } from "./share-card";
import { serializeShareCard } from "./share-rdf";
import {
  assertShareable,
  deriveSafeFoodCandidates,
  generateExperienceShare,
  generateSafeFoodShare,
  generateSafeVenueShare,
  sanitizeLine,
  sanitizeText,
  ShareSanitizationError,
} from "./share";

const REAL_WEBID = "https://alice.example/profile/card#me";

// A diary IRI + the sensitive fields that MUST NEVER reach a card.
const DIARY_EXPOSURE = "https://alice.example/health/diary/meals/2026/07/01ARZ3NDEKTSV4RRFFQ69G5FAV.ttl#it";
const DIARY_SYMPTOM = "https://alice.example/health/diary/symptoms/2026/07/01BX5ZZKBKACTAV9WEVGEMMVRZ.ttl#it";
const SECRET_NOTE = "SECRETNOTE-a pattern in your data not a diagnosis";

/** A realistic concluded tolerance carrying the sensitive context that must be STRIPPED. */
const toleratedConclusion: ToleranceConclusionData = {
  id: "https://alice.example/health/diary/conclusions/01CKF1P2M3N4Q5R6S7T8U9V0WX.ttl#it",
  aboutTrigger: "lactose",
  verdict: "tolerated",
  confidence: "likely",
  note: SECRET_NOTE,
  reviewAfter: new Date("2026-12-01T00:00:00Z"),
  derivedFrom: [DIARY_EXPOSURE, DIARY_SYMPTOM],
  patient: REAL_WEBID,
  created: new Date("2026-07-01T09:30:00Z"),
};
const reactsConclusion: ToleranceConclusionData = {
  aboutTrigger: "gluten",
  verdict: "reacts",
  derivedFrom: [DIARY_SYMPTOM],
  patient: REAL_WEBID,
};

const samePod: CommunityIdentity = {
  handle: "gw",
  webId: "https://alice.example/community/profile/card#me",
  linkability: "linkable-same-pod",
};
const unlinkable: CommunityIdentity = {
  handle: "gw",
  webId: "https://pseudo.example/profile#me",
  linkability: "unlinkable",
};
const anonymous: CommunityIdentity = { handle: "gw", linkability: "unlinkable" };

/** Assert a serialised card leaks NONE of the sensitive tokens (the headline invariant). */
async function assertNoLeak(card: ShareCard): Promise<string> {
  const ttl = await serializeShareCard(card, "https://alice.example/community/shares/01ARZ3NDEKTSV4RRFFQ69G5FAV.ttl#it");
  expect(ttl).not.toContain("/health/diary/");
  expect(ttl).not.toContain(DIARY_EXPOSURE);
  expect(ttl).not.toContain(DIARY_SYMPTOM);
  expect(ttl).not.toContain(SECRET_NOTE);
  expect(ttl).not.toContain("2026-07-01"); // the conclusion's created date
  expect(ttl).not.toContain("symptom");
  expect(ttl).not.toContain("reacts");
  return ttl;
}

describe("deriveSafeFoodCandidates (sanitising extractor)", () => {
  it("keeps ONLY tolerated trigger slugs and drops derivedFrom/patient/note/dates", () => {
    const { tolerated } = deriveSafeFoodCandidates([toleratedConclusion, reactsConclusion]);
    expect(tolerated).toEqual(["lactose"]);
    // The extractor output must carry none of the sensitive context.
    const serialised = JSON.stringify({ tolerated });
    expect(serialised).not.toContain("/health/diary/");
    expect(serialised).not.toContain(REAL_WEBID);
    expect(serialised).not.toContain(SECRET_NOTE);
    expect(serialised).not.toContain("2026");
  });

  it("dedupes and excludes non-tolerated verdicts", () => {
    const dup: ToleranceConclusionData = { aboutTrigger: "lactose", verdict: "tolerated" };
    expect(deriveSafeFoodCandidates([toleratedConclusion, dup]).tolerated).toEqual(["lactose"]);
    expect(deriveSafeFoodCandidates([reactsConclusion]).tolerated).toEqual([]);
  });
});

describe("sanitizeLine / sanitizeText", () => {
  it("strips control characters and collapses whitespace to a single line", () => {
    expect(sanitizeLine("  Schär\tbread\n\n ")).toBe("Schär bread");
    expect(sanitizeLine("a\u0000b\u007Fc")).toBe("a b c");
  });
  it("caps length", () => {
    expect(sanitizeLine("x".repeat(500)).length).toBe(200);
    expect(sanitizeText("y".repeat(5000)).length).toBe(2000);
  });
  it("keeps paragraph newlines in free text but strips other control chars", () => {
    expect(sanitizeText("line1\n\nline2\u0000")).toBe("line1\n\nline2");
  });
});

describe("generateSafeFoodShare — sanitisation invariant (NO diary/genetics/symptom leak)", () => {
  it("produces a card carrying none of the sensitive conclusion context", async () => {
    const { tolerated } = deriveSafeFoodCandidates([toleratedConclusion, reactsConclusion]);
    const card = generateSafeFoodShare({
      foods: ["Schär sourdough", "Nairn's oatcakes"],
      toleratedTriggers: tolerated,
      identity: samePod,
      audience: "owner-only",
      realWebId: REAL_WEBID,
      published: new Date("2026-07-03T12:00:00Z"),
    });
    expect(card.kind).toBe("safe-food");
    expect(card.shareClass).toBe(DIET_SAFE_FOOD_SHARE);
    expect(card.message.mediaType).toBe("text/plain");
    expect(card.message.content).toContain("Schär sourdough");
    expect(card.message.content).toContain("lactose");
    expect(card.message.provenance).toBeUndefined();
    await assertNoLeak(card);
  });

  it("requires at least one food or tolerated trigger", () => {
    expect(() =>
      generateSafeFoodShare({ foods: ["   ", ""], identity: samePod, audience: "owner-only", realWebId: REAL_WEBID }),
    ).toThrow(ShareSanitizationError);
  });
});

describe("generateSafeVenueShare / generateExperienceShare — no linkage leaked", () => {
  it("safe-venue carries only the venue + optional note", async () => {
    const card = generateSafeVenueShare({
      venue: "The Gluten-Free Kitchen",
      note: "Ordered the GF pizza, no reaction.",
      identity: samePod,
      audience: "owner-only",
      realWebId: REAL_WEBID,
    });
    expect(card.kind).toBe("safe-venue");
    expect(card.message.content).toContain("The Gluten-Free Kitchen");
    await assertNoLeak(card);
  });

  it("experience carries only the user's text", async () => {
    const card = generateExperienceShare({
      text: "Eating out got much easier once I learned to call ahead.",
      identity: anonymous,
      audience: "owner-only",
      realWebId: REAL_WEBID,
    });
    expect(card.kind).toBe("experience");
    expect(card.message.content).toContain("call ahead");
    await assertNoLeak(card);
  });
});

describe("pseudonymous identity — origin-unlinkable public enforcement", () => {
  it("REFUSES a public card generated with a linkable same-pod identity", () => {
    expect(() =>
      generateSafeFoodShare({
        foods: ["Schär bread"],
        identity: samePod,
        audience: "public",
        realWebId: REAL_WEBID,
      }),
    ).toThrow(ShareIdentityError);
  });

  it("ALLOWS a public card with an origin-unlinkable identity (author = pseudonym)", async () => {
    const card = generateSafeFoodShare({
      foods: ["Schär bread"],
      identity: unlinkable,
      audience: "public",
      realWebId: REAL_WEBID,
    });
    expect(card.message.author).toBe(unlinkable.webId);
    // The public card must not carry the real WebID nor its origin.
    const ttl = await serializeShareCard(card, "https://pseudo.example/shares/01ARZ3NDEKTSV4RRFFQ69G5FAV.ttl#it");
    expect(ttl).not.toContain(REAL_WEBID);
    expect(ttl).not.toContain("alice.example");
  });

  it("ALLOWS a public card with a fully-anonymous identity (author omitted)", () => {
    const card = generateSafeFoodShare({
      foods: ["Schär bread"],
      identity: anonymous,
      audience: "public",
      realWebId: REAL_WEBID,
    });
    expect(card.message.author).toBeUndefined();
  });

  it("ALLOWS a same-pod (linkable) identity for an owner-only card", () => {
    const card = generateSafeFoodShare({
      foods: ["Schär bread"],
      identity: samePod,
      audience: "owner-only",
      realWebId: REAL_WEBID,
    });
    expect(card.message.author).toBe(samePod.webId);
  });
});

describe("assertShareable — fail-closed guard (direct)", () => {
  const base = (over: Partial<CanonicalMessage>, audience: ShareCard["audience"] = "owner-only"): ShareCard => ({
    kind: "experience",
    shareClass: DIET_SAFE_FOOD_SHARE,
    message: { content: "hello", mediaType: "text/plain", ...over },
    audience,
  });

  it("REJECTS a card carrying provenance.derivedFrom (source link belongs in the sidecar)", () => {
    expect(() => assertShareable(base({ provenance: { derivedFrom: DIARY_EXPOSURE } }), { realWebId: REAL_WEBID })).toThrow(
      /derivedFrom/,
    );
  });

  it("REJECTS a diary IRI in any message field", () => {
    expect(() => assertShareable(base({ author: DIARY_EXPOSURE }), { realWebId: REAL_WEBID })).toThrow(ShareSanitizationError);
    expect(() => assertShareable(base({ room: DIARY_SYMPTOM }), { realWebId: REAL_WEBID })).toThrow(ShareSanitizationError);
  });

  it("REJECTS a diary IRI embedded in the body", () => {
    expect(() => assertShareable(base({ content: `see ${DIARY_EXPOSURE}` }), { realWebId: REAL_WEBID })).toThrow(
      ShareSanitizationError,
    );
  });

  it("REJECTS a PUBLIC card whose author equals or shares origin with the real WebID", () => {
    expect(() => assertShareable(base({ author: REAL_WEBID }, "public"), { realWebId: REAL_WEBID })).toThrow(
      ShareSanitizationError,
    );
    expect(() =>
      assertShareable(base({ author: "https://alice.example/community/profile/card#me" }, "public"), { realWebId: REAL_WEBID }),
    ).toThrow(ShareSanitizationError);
  });

  it("REJECTS a PUBLIC card whose body contains the real WebID", () => {
    expect(() => assertShareable(base({ content: `I am ${REAL_WEBID}` }, "public"), { realWebId: REAL_WEBID })).toThrow(
      ShareSanitizationError,
    );
  });

  it("REJECTS a PUBLIC card whose NON-author IRI field is on the real pod host (roborev Medium)", () => {
    // room / inReplyTo / provenance on the same host are just as linkable as author.
    expect(() => assertShareable(base({ room: "https://alice.example/community/room#it" }, "public"), { realWebId: REAL_WEBID })).toThrow(
      ShareSanitizationError,
    );
    expect(() =>
      assertShareable(base({ author: "https://pseudo.example/#me", inReplyTo: "https://alice.example/x#it" }, "public"), {
        realWebId: REAL_WEBID,
      }),
    ).toThrow(ShareSanitizationError);
    expect(() =>
      assertShareable(base({ provenance: { attributedTo: "https://alice.example/#me" } }, "public"), { realWebId: REAL_WEBID }),
    ).toThrow(ShareSanitizationError);
  });

  it("ACCEPTS a PUBLIC card whose IRI fields are all on a different host", () => {
    expect(() =>
      assertShareable(
        base({ author: "https://pseudo.example/#me", room: "https://forum.example/room#it" }, "public"),
        { realWebId: REAL_WEBID },
      ),
    ).not.toThrow();
  });

  it("ACCEPTS an owner-only card whose author is the same-pod pseudonym (linkable tier)", () => {
    expect(() =>
      assertShareable(base({ author: "https://alice.example/community/profile/card#me" }), { realWebId: REAL_WEBID }),
    ).not.toThrow();
  });

  it("REJECTS a PUBLIC card whose body names the real pod HOST or a same-host URL (roborev High)", () => {
    expect(() => assertShareable(base({ content: "reach me at alice.example" }, "public"), { realWebId: REAL_WEBID })).toThrow(
      ShareSanitizationError,
    );
    expect(() =>
      assertShareable(base({ content: "see https://alice.example/profile/" }, "public"), { realWebId: REAL_WEBID }),
    ).toThrow(ShareSanitizationError);
    // Encoded host in the body is also caught.
    expect(() =>
      assertShareable(base({ content: "at https%3A%2F%2Falice.example%2Fx" }, "public"), { realWebId: REAL_WEBID }),
    ).toThrow(ShareSanitizationError);
    // Case-variant host / WebID must not bypass (roborev High).
    expect(() => assertShareable(base({ content: "reach me at ALICE.EXAMPLE" }, "public"), { realWebId: REAL_WEBID })).toThrow(
      ShareSanitizationError,
    );
    expect(() =>
      assertShareable(base({ content: "HTTPS://ALICE.EXAMPLE/profile/card#me" }, "public"), { realWebId: REAL_WEBID }),
    ).toThrow(ShareSanitizationError);
  });

  it("REJECTS any card whose mediaType is not text/plain (stored-XSS guard, roborev Medium)", () => {
    const htmlCard: ShareCard = {
      kind: "experience",
      shareClass: DIET_SAFE_FOOD_SHARE,
      message: { content: "<b>hi</b>", mediaType: "text/html" },
      audience: "owner-only",
    };
    expect(() => assertShareable(htmlCard, { realWebId: REAL_WEBID })).toThrow(/text\/plain/);
  });
});
