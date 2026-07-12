// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Regression tests for the CREDENTIAL BOUNDARY of the /auth adapter (the fix for
// the roborev High: a session token must NEVER be attached to a foreign origin
// just because it returned 401). The boundary is two exported pure helpers:
// `computeAllowedOrigins` (the per-session allowed set) + `isOriginAllowed` (the
// per-request gate). The PersistingDPoPTokenProvider's matches()/upgrade() are
// built on exactly these, so testing them pins the boundary.
import { describe, expect, it } from "vitest";
import { computeAllowedOrigins, htuOf, isOriginAllowed, validateWebId } from "../src/auth/index.js";

describe("computeAllowedOrigins (the per-session credential boundary)", () => {
  it("includes the WebID's and issuer's origins by default", () => {
    const set = computeAllowedOrigins({
      webId: "https://alice.pod.example/profile/card#me",
      issuer: "https://idp.example/",
    });
    expect(set.has("https://alice.pod.example")).toBe(true);
    expect(set.has("https://idp.example")).toBe(true);
    // A foreign origin is NOT in the set.
    expect(set.has("https://evil.example")).toBe(false);
  });

  it("adds explicit allowedOrigins (e.g. a pod on a different host)", () => {
    const set = computeAllowedOrigins({
      webId: "https://alice.id.example/me",
      issuer: "https://idp.example/",
      allowedOrigins: ["https://storage.example/somepath", "https://media.example"],
    });
    expect(set.has("https://storage.example")).toBe(true); // path stripped → origin
    expect(set.has("https://media.example")).toBe(true);
    expect(set.has("https://alice.id.example")).toBe(true);
  });

  it("can drop the WebID / issuer defaults to rely solely on the explicit list", () => {
    const set = computeAllowedOrigins({
      webId: "https://alice.id.example/me",
      issuer: "https://idp.example/",
      allowedOrigins: ["https://storage.example"],
      includeWebIdOrigin: false,
      includeIssuerOrigin: false,
    });
    expect(set.has("https://storage.example")).toBe(true);
    expect(set.has("https://alice.id.example")).toBe(false);
    expect(set.has("https://idp.example")).toBe(false);
  });

  it("is fail-closed: an unparseable entry is skipped, an empty input → empty set", () => {
    const set = computeAllowedOrigins({
      webId: "not a url",
      issuer: "also not a url",
      allowedOrigins: ["::::"],
    });
    expect(set.size).toBe(0);
    expect(computeAllowedOrigins({}).size).toBe(0);
  });

  it("DROPS a cleartext http origin by default (no token over http)", () => {
    const set = computeAllowedOrigins({
      webId: "https://alice.id.example/me",
      allowedOrigins: ["http://pod.example", "https://media.example"],
    });
    expect(set.has("http://pod.example")).toBe(false); // cleartext dropped
    expect(set.has("https://media.example")).toBe(true);
    expect(set.has("https://alice.id.example")).toBe(true);
  });

  it("allows a LOOPBACK http origin only under allowInsecureLoopback", () => {
    const without = computeAllowedOrigins({ allowedOrigins: ["http://localhost:3000"] });
    expect(without.has("http://localhost:3000")).toBe(false);
    const with_ = computeAllowedOrigins({
      allowedOrigins: ["http://localhost:3000", "http://pod.example"],
      allowInsecureLoopback: true,
    });
    expect(with_.has("http://localhost:3000")).toBe(true); // loopback allowed
    expect(with_.has("http://pod.example")).toBe(false); // non-loopback http still dropped
  });

  it("treats different ports / schemes as DIFFERENT origins", () => {
    const set = computeAllowedOrigins({ webId: "https://pod.example:8443/me" });
    expect(set.has("https://pod.example:8443")).toBe(true);
    expect(set.has("https://pod.example")).toBe(false); // default :443 ≠ :8443
    expect(set.has("http://pod.example:8443")).toBe(false); // scheme differs
  });
});

describe("isOriginAllowed (the per-request credential gate)", () => {
  const allowed = computeAllowedOrigins({
    webId: "https://alice.pod.example/profile/card#me",
    issuer: "https://idp.example/",
  });

  it("allows a request to an allowed origin (own pod)", () => {
    expect(isOriginAllowed(allowed, "https://alice.pod.example/private/note")).toBe(true);
    expect(isOriginAllowed(allowed, "https://idp.example/token")).toBe(true);
  });

  it("DENIES a request to a foreign origin (the credential-leak fix)", () => {
    expect(isOriginAllowed(allowed, "https://evil.example/steal")).toBe(false);
    expect(isOriginAllowed(allowed, "https://alice.pod.example.evil.com/x")).toBe(false);
    expect(isOriginAllowed(allowed, "http://alice.pod.example/x")).toBe(false); // scheme
  });

  it("is fail-closed for an unparseable URL and an empty allowed set", () => {
    expect(isOriginAllowed(allowed, "not a url")).toBe(false);
    expect(isOriginAllowed(new Set(), "https://alice.pod.example/x")).toBe(false);
  });
});

describe("validateWebId (cleartext-token boundary)", () => {
  it("accepts an https WebID", () => {
    expect(validateWebId("https://alice.pod.example/profile/card#me")).toBe(
      "https://alice.pod.example/profile/card#me",
    );
  });
  it("REJECTS a cleartext http WebID by default (the token would ride over http)", () => {
    expect(() => validateWebId("http://alice.pod.example/me")).toThrow(/https/);
    // Even with the flag, a NON-loopback http host is rejected.
    expect(() => validateWebId("http://alice.pod.example/me", true)).toThrow(/https|loopback/);
  });
  it("allows http ONLY for a loopback dev host under the explicit opt-in", () => {
    expect(validateWebId("http://localhost:3000/me", true)).toBe("http://localhost:3000/me");
    expect(validateWebId("http://127.0.0.1:3000/me", true)).toBe("http://127.0.0.1:3000/me");
    // Off by default: loopback http still rejected without the flag.
    expect(() => validateWebId("http://localhost:3000/me")).toThrow();
  });
  it("rejects a non-URL and a non-http(s) scheme", () => {
    expect(() => validateWebId("not a url")).toThrow();
    expect(() => validateWebId("ftp://example.org/me")).toThrow();
  });
});

describe("htuOf (the DPoP htu claim — RFC 9449 §4.2)", () => {
  it("strips the query and fragment, keeping scheme/host/port/path", () => {
    expect(htuOf("https://pod.example/private/note?q=1&r=2#frag")).toBe(
      "https://pod.example/private/note",
    );
    expect(htuOf("https://pod.example:8443/a/b?x=y")).toBe("https://pod.example:8443/a/b");
  });
  it("leaves a query-free URL unchanged", () => {
    expect(htuOf("https://pod.example/private/note")).toBe("https://pod.example/private/note");
  });
  it("returns an unparseable input unchanged", () => {
    expect(htuOf("not a url")).toBe("not a url");
  });
});
