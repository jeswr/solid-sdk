// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import { COMMUNITY_HOSTS, isAllowlistedCommunityHost } from "./allowlist.js";

describe("community allowlist", () => {
  it("accepts https URLs on the closed host allowlist", () => {
    expect(isAllowlistedCommunityHost("https://www.coeliac.org.uk/gluten-free-accredited-venues/")).toBe(true);
    expect(isAllowlistedCommunityHost("https://celiac.org/")).toBe(true);
    expect(isAllowlistedCommunityHost("https://www.reddit.com/r/Celiac/")).toBe(true);
  });

  it("fail-closes on non-https, off-list host, credentials, or malformed URLs", () => {
    expect(isAllowlistedCommunityHost("http://www.coeliac.org.uk/")).toBe(false); // not https
    expect(isAllowlistedCommunityHost("https://evil.example/")).toBe(false); // off-list
    expect(isAllowlistedCommunityHost("https://www.coeliac.org.uk.evil.example/")).toBe(false); // suffix trick
    expect(isAllowlistedCommunityHost("https://user:pass@celiac.org/")).toBe(false); // embedded creds
    expect(isAllowlistedCommunityHost("not a url")).toBe(false);
    expect(isAllowlistedCommunityHost("javascript:alert(1)")).toBe(false);
  });

  it("keeps the host list frozen", () => {
    expect(Object.isFrozen(COMMUNITY_HOSTS)).toBe(true);
    expect(() => {
      // @ts-expect-error — mutating a readonly frozen array must throw in strict mode
      COMMUNITY_HOSTS.push("evil.example");
    }).toThrow();
  });
});
