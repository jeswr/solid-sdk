// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import {
  assertIdentityForAudience,
  authorForIdentity,
  type CommunityIdentity,
  httpHost,
  httpOrigin,
  isOriginUnlinkable,
  ShareIdentityError,
  sharesHost,
  validateIdentity,
} from "./identity";

const REAL_WEBID = "https://alice.example/profile/card#me";

const samePod: CommunityIdentity = {
  handle: "glutenwanderer",
  webId: "https://alice.example/community/profile/card#me",
  linkability: "linkable-same-pod",
};
const unlinkable: CommunityIdentity = {
  handle: "gw",
  webId: "https://pseudo.example/profile#me",
  linkability: "unlinkable",
};
const anonymous: CommunityIdentity = { handle: "gw", linkability: "unlinkable" };
const mislabelled: CommunityIdentity = {
  handle: "x",
  webId: "https://alice.example/community/profile/card#me", // same ORIGIN as real WebID
  linkability: "unlinkable",
};

describe("httpOrigin / isOriginUnlinkable", () => {
  it("returns the origin of an http(s) IRI, null otherwise", () => {
    expect(httpOrigin(REAL_WEBID)).toBe("https://alice.example");
    expect(httpOrigin("ftp://x/y")).toBeNull();
    expect(httpOrigin("not a url")).toBeNull();
  });

  it("treats a same-origin or equal WebID as LINKABLE (not unlinkable)", () => {
    expect(isOriginUnlinkable(REAL_WEBID, REAL_WEBID)).toBe(false);
    expect(isOriginUnlinkable("https://alice.example/community/profile/card#me", REAL_WEBID)).toBe(false);
    expect(isOriginUnlinkable("https://alice.example/anything#me", REAL_WEBID)).toBe(false);
  });

  it("treats a different-origin WebID as unlinkable", () => {
    expect(isOriginUnlinkable("https://pseudo.example/profile#me", REAL_WEBID)).toBe(true);
  });

  it("fail-closed: a non-http(s) or unparseable candidate is NOT unlinkable", () => {
    expect(isOriginUnlinkable("did:key:z6Mk", REAL_WEBID)).toBe(false);
    expect(isOriginUnlinkable("garbage", REAL_WEBID)).toBe(false);
  });

  it("treats a same-HOST different-scheme/port WebID as LINKABLE (roborev High)", () => {
    // Same pod host is trivially linkable regardless of scheme or port.
    expect(isOriginUnlinkable("http://alice.example/profile/card#me", REAL_WEBID)).toBe(false);
    expect(isOriginUnlinkable("https://alice.example:8443/x#me", REAL_WEBID)).toBe(false);
  });

  it("sharesHost compares hostname only (scheme/port-agnostic), false for non-http(s)", () => {
    expect(sharesHost("http://alice.example/a", "https://alice.example/b")).toBe(true);
    expect(sharesHost("https://alice.example/a", "https://pseudo.example/b")).toBe(false);
    expect(sharesHost("did:key:z", REAL_WEBID)).toBe(false);
    expect(httpHost(REAL_WEBID)).toBe("alice.example");
  });
});

describe("validateIdentity (mislabel guard)", () => {
  it("accepts a truthfully-labelled identity", () => {
    expect(() => validateIdentity(samePod, REAL_WEBID)).not.toThrow();
    expect(() => validateIdentity(unlinkable, REAL_WEBID)).not.toThrow();
    expect(() => validateIdentity(anonymous, REAL_WEBID)).not.toThrow();
  });

  it("REJECTS an identity labelled unlinkable whose WebID shares the real origin", () => {
    expect(() => validateIdentity(mislabelled, REAL_WEBID)).toThrow(ShareIdentityError);
  });
});

describe("assertIdentityForAudience (audience contract)", () => {
  it("owner-only and group accept a linkable same-pod identity", () => {
    expect(() => assertIdentityForAudience(samePod, "owner-only", REAL_WEBID)).not.toThrow();
    expect(() => assertIdentityForAudience(samePod, "group", REAL_WEBID)).not.toThrow();
  });

  it("PUBLIC refuses a linkable same-pod identity", () => {
    expect(() => assertIdentityForAudience(samePod, "public", REAL_WEBID)).toThrow(ShareIdentityError);
  });

  it("PUBLIC accepts an origin-unlinkable identity", () => {
    expect(() => assertIdentityForAudience(unlinkable, "public", REAL_WEBID)).not.toThrow();
  });

  it("PUBLIC accepts a fully-anonymous identity (no author)", () => {
    expect(() => assertIdentityForAudience(anonymous, "public", REAL_WEBID)).not.toThrow();
  });

  it("PUBLIC refuses a mislabelled 'unlinkable' identity that is actually same-origin", () => {
    expect(() => assertIdentityForAudience(mislabelled, "public", REAL_WEBID)).toThrow(ShareIdentityError);
  });
});

describe("authorForIdentity", () => {
  it("returns the pseudonym WebID, or undefined when anonymous", () => {
    expect(authorForIdentity(samePod)).toBe(samePod.webId);
    expect(authorForIdentity(unlinkable)).toBe(unlinkable.webId);
    expect(authorForIdentity(anonymous)).toBeUndefined();
  });
});
