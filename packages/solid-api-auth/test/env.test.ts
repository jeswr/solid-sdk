// @vitest-environment node
// AUTHORED-BY Claude Opus 4.8
/**
 * env.test.ts — the opt-in env-driven wiring the fan-out apps share: `parseTrustedIssuers`,
 * `optionsFromEnv`, the `getVerifier` / `getScanRateLimiter` singletons (+ their test resets),
 * and `isLoopbackHttp`.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetRateLimiterForTests,
  __resetVerifierForTests,
  getScanRateLimiter,
  getVerifier,
  isLoopbackHttp,
  optionsFromEnv,
  parseTrustedIssuers,
} from "../src/index.js";

afterEach(() => {
  __resetVerifierForTests();
  __resetRateLimiterForTests();
});

describe("parseTrustedIssuers", () => {
  it("splits on commas, spaces, and newlines; trims; drops empties", () => {
    expect(parseTrustedIssuers("https://a.example, https://b.example")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    expect(parseTrustedIssuers("https://a.example\nhttps://b.example")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    expect(parseTrustedIssuers("   ")).toEqual([]);
    expect(parseTrustedIssuers(undefined)).toEqual([]);
  });
});

describe("optionsFromEnv", () => {
  it("reads the documented PSS_* / OWNER_WEBID convention", () => {
    const opts = optionsFromEnv({
      PSS_TRUSTED_ISSUERS: "https://issuer.example",
      OWNER_WEBID: "https://owner.example/card#me",
      PSS_WEBID_CLAIM: "webid",
      PSS_BIDIRECTIONAL_WEBID_MODE: "strict",
      PSS_AUTH_ALLOW_INSECURE_LOOPBACK: "1",
      PSS_CLOCK_TOLERANCE_SEC: "10",
      PSS_TRUST_FORWARDED_HEADERS: "true",
    });
    expect(opts.trustedIssuers).toEqual(["https://issuer.example"]);
    expect(opts.ownerWebId).toBe("https://owner.example/card#me");
    expect(opts.webidClaim).toBe("webid");
    expect(opts.bidirectionalMode).toBe("strict");
    expect(opts.allowInsecureLoopback).toBe(true);
    expect(opts.clockToleranceSec).toBe(10);
    expect(opts.trustForwardedHeaders).toBe(true);
  });

  it("defaults trustForwardedHeaders to false (forwarded headers untrusted unless opted in)", () => {
    const opts = optionsFromEnv({ PSS_TRUSTED_ISSUERS: "https://issuer.example" });
    expect(opts.trustForwardedHeaders).toBe(false);
  });

  it("defaults webidClaim to 'webid' and omits an invalid bidirectional mode", () => {
    const opts = optionsFromEnv({
      PSS_TRUSTED_ISSUERS: "https://issuer.example",
      PSS_BIDIRECTIONAL_WEBID_MODE: "bogus",
    });
    expect(opts.webidClaim).toBe("webid");
    expect(opts.bidirectionalMode).toBeUndefined();
    expect(opts.allowInsecureLoopback).toBe(false);
  });

  it("ignores a negative / non-numeric clock tolerance", () => {
    const neg = optionsFromEnv({
      PSS_TRUSTED_ISSUERS: "https://issuer.example",
      PSS_CLOCK_TOLERANCE_SEC: "-5",
    });
    expect(neg.clockToleranceSec).toBeUndefined();
    const nan = optionsFromEnv({
      PSS_TRUSTED_ISSUERS: "https://issuer.example",
      PSS_CLOCK_TOLERANCE_SEC: "abc",
    });
    expect(nan.clockToleranceSec).toBeUndefined();
  });
});

describe("getVerifier / getScanRateLimiter singletons", () => {
  it("getVerifier returns a stable instance and rereads env after reset", () => {
    process.env.PSS_TRUSTED_ISSUERS = "https://issuer.example";
    process.env.OWNER_WEBID = "https://owner.example/card#me";
    const a = getVerifier();
    const b = getVerifier();
    expect(a).toBe(b);
    __resetVerifierForTests();
    const c = getVerifier();
    expect(c).not.toBe(a);
    delete process.env.PSS_TRUSTED_ISSUERS;
    delete process.env.OWNER_WEBID;
  });

  it("getVerifier throws when no trusted issuers are configured (fail-loud misconfig)", () => {
    delete process.env.PSS_TRUSTED_ISSUERS;
    expect(() => getVerifier()).toThrow(/at least one trusted issuer/i);
  });

  it("getScanRateLimiter honours PSS_SCAN_RATE_PER_MIN and is a stable singleton", () => {
    process.env.PSS_SCAN_RATE_PER_MIN = "2";
    const rl = getScanRateLimiter();
    expect(rl).toBe(getScanRateLimiter());
    // capacity 2 → allows 2 then blocks the 3rd within the window.
    expect(rl.tryRemove("k")).toBe(true);
    expect(rl.tryRemove("k")).toBe(true);
    expect(rl.tryRemove("k")).toBe(false);
    delete process.env.PSS_SCAN_RATE_PER_MIN;
  });
});

describe("isLoopbackHttp", () => {
  it("recognises loopback-HTTP hosts only", () => {
    expect(isLoopbackHttp("http://localhost:3000")).toBe(true);
    expect(isLoopbackHttp("http://127.0.0.1")).toBe(true);
    expect(isLoopbackHttp("http://[::1]:8080")).toBe(true);
    expect(isLoopbackHttp("https://localhost")).toBe(false); // https, not http
    expect(isLoopbackHttp("http://example.com")).toBe(false); // public host
    expect(isLoopbackHttp("not a url")).toBe(false);
  });
});
