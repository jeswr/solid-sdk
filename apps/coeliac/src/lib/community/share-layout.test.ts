// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import {
  assertCommunityScope,
  communityContainers,
  communityProfileUrl,
  communityRoot,
  communitySharesContainer,
  containsDiaryScope,
  isDiaryIri,
  shareProvenanceSidecarUrl,
  shareUrl,
} from "./share-layout";

const ROOT = "https://alice.example/";
const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("community layout", () => {
  it("puts the community scope under storageRoot/community/, disjoint from health/diary", () => {
    expect(communityRoot(ROOT)).toBe("https://alice.example/community/");
    expect(communitySharesContainer(ROOT)).toBe("https://alice.example/community/shares/");
    expect(communityProfileUrl(ROOT)).toBe("https://alice.example/community/profile/card.ttl");
    // The community root must NOT be under the diary scope.
    expect(communityRoot(ROOT).includes("/health/diary/")).toBe(false);
  });

  it("normalises a storage root missing its trailing slash", () => {
    expect(communityRoot("https://alice.example")).toBe("https://alice.example/community/");
  });

  it("rejects a non-http(s) storage root", () => {
    expect(() => communityRoot("ftp://alice.example/")).toThrow();
    expect(() => communityRoot("not a url")).toThrow();
  });

  it("builds a share URL under shares/ and validates the ULID", () => {
    expect(shareUrl(ROOT, ULID)).toBe(`https://alice.example/community/shares/${ULID}.ttl`);
    expect(() => shareUrl(ROOT, "../../etc/passwd")).toThrow();
    expect(() => shareUrl(ROOT, "not-a-ulid")).toThrow();
  });

  it("builds the provenance sidecar URL as a distinct .provenance.ttl sibling", () => {
    expect(shareProvenanceSidecarUrl(ROOT, ULID)).toBe(
      `https://alice.example/community/shares/${ULID}.provenance.ttl`,
    );
    // Sidecar and card are distinct resources.
    expect(shareProvenanceSidecarUrl(ROOT, ULID)).not.toBe(shareUrl(ROOT, ULID));
  });

  it("lists exactly the community containers (none under the diary scope)", () => {
    const containers = communityContainers(ROOT);
    expect(containers).toContain("https://alice.example/community/");
    expect(containers).toContain("https://alice.example/community/shares/");
    expect(containers).toContain("https://alice.example/community/profile/");
    for (const c of containers) expect(c.includes("/health/diary/")).toBe(false);
  });
});

describe("diary-scope guards", () => {
  it("detects a diary IRI", () => {
    expect(isDiaryIri("https://alice.example/health/diary/meals/2026/07/x.ttl")).toBe(true);
    expect(isDiaryIri("https://alice.example/community/shares/x.ttl")).toBe(false);
    expect(isDiaryIri("https://alice.example/profile/card#me")).toBe(false);
  });

  it("detects a diary scope even when percent-encoded (fail-closed)", () => {
    expect(containsDiaryScope("https://x.example/a%2Fhealth%2Fdiary%2Fb")).toBe(true);
    expect(containsDiaryScope("just some safe foods text")).toBe(false);
  });

  it("detects an encoded diary scope even with a trailing MALFORMED escape (roborev High)", () => {
    // A single bad escape must not defeat the whole decode (the old bug).
    expect(containsDiaryScope("%2Fhealth%2Fdiary%2Fx%ZZ")).toBe(true);
    // Double-encoded still caught.
    expect(containsDiaryScope("%252Fhealth%252Fdiary%252Fx")).toBe(true);
  });

  it("does NOT over-reject legitimate free text containing a stray percent sign", () => {
    expect(containsDiaryScope("this bread is 50% gluten-free tested")).toBe(false);
    expect(containsDiaryScope("100% safe for me")).toBe(false);
  });

  it("detects a diary scope encoded MANY times over (fixed-point decode, roborev High)", () => {
    let v = "/health/diary/meals/a.ttl";
    for (let i = 0; i < 8; i++) v = encodeURIComponent(v); // 8-level nested encoding
    expect(containsDiaryScope(v)).toBe(true);
  });

  it("detects a dot-segment diary IRI that only normalises to /health/diary/ (roborev High)", () => {
    expect(isDiaryIri("https://alice.example/health/x/../diary/meals/a.ttl#it")).toBe(true);
    expect(containsDiaryScope("see https://alice.example/health/x/../diary/meals/a.ttl#it")).toBe(true);
    // A non-diary normalised URL is not falsely flagged.
    expect(isDiaryIri("https://alice.example/community/x/../shares/a.ttl")).toBe(false);
  });
});

describe("assertCommunityScope (disjoint-scope enforcement)", () => {
  it("accepts a URL inside the community scope", () => {
    const url = shareUrl(ROOT, ULID);
    expect(assertCommunityScope(url, ROOT)).toBe(url);
  });

  it("REFUSES a diary URL (the diary is never written by the share pipeline)", () => {
    expect(() =>
      assertCommunityScope("https://alice.example/health/diary/meals/2026/07/x.ttl", ROOT),
    ).toThrow(/diary/);
  });

  it("REFUSES a URL outside the community scope", () => {
    expect(() => assertCommunityScope("https://alice.example/other/x.ttl", ROOT)).toThrow(/community/);
    expect(() => assertCommunityScope("https://evil.example/community/x.ttl", ROOT)).toThrow();
  });

  it("REFUSES a dot-segment traversal out of the community scope (roborev Medium)", () => {
    // Normalises `..` before the check: this really targets /other/ and /health/diary/.
    expect(() => assertCommunityScope("https://alice.example/community/../other/x.ttl", ROOT)).toThrow();
    expect(() =>
      assertCommunityScope("https://alice.example/community/../health/diary/meals/x.ttl", ROOT),
    ).toThrow(/diary/);
  });

  it("REFUSES a non-absolute URL", () => {
    expect(() => assertCommunityScope("/community/shares/x.ttl", ROOT)).toThrow();
  });
});
