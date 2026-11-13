// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  applySetCookies,
  type Cookie,
  cookieHeader,
  cookiesFor,
  domainMatches,
  InMemorySessions,
  parseSetCookie,
  pathMatches,
} from "../src/cookies.js";
import { describeUrl, guardUrl, isLoopbackHost, OriginError, siteOrigin } from "../src/origin.js";

describe("siteOrigin", () => {
  it("accepts https anywhere and http on loopback only", () => {
    expect(siteOrigin("https://shop.test")).toBe("https://shop.test");
    expect(siteOrigin("https://shop.test/some/path")).toBe("https://shop.test");
    expect(siteOrigin("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(siteOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(siteOrigin("http://[::1]:3000")).toBe("http://[::1]:3000");
  });

  it.each([
    "http://shop.test",
    "http://10.0.0.1",
    "http://127.0.0.1.evil.test",
    "ftp://shop.test",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:pw@shop.test",
    "not a url",
    "",
  ])("refuses %s", (site) => {
    expect(() => siteOrigin(site)).toThrow(OriginError);
  });

  it("recognises loopback hosts", () => {
    expect(isLoopbackHost("127.255.0.1")).toBe(true);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
    expect(isLoopbackHost("127.0.0.256")).toBe(false);
    expect(isLoopbackHost("128.0.0.1")).toBe(false);
    expect(isLoopbackHost("localhost.evil.test")).toBe(false);
  });
});

describe("guardUrl", () => {
  const origin = "https://shop.test";

  it("accepts absolute and relative URLs on the origin", () => {
    expect(guardUrl("https://shop.test/a?b=1", origin).href).toBe("https://shop.test/a?b=1");
    expect(guardUrl("/cart", origin).href).toBe("https://shop.test/cart");
    expect(guardUrl("https://SHOP.test:443/x", origin).href).toBe("https://shop.test/x");
  });

  it.each([
    ["absolute foreign host", "https://evil.test/steal"],
    ["protocol-relative", "//evil.test/steal"],
    ["backslash protocol-relative", "\\\\evil.test/steal"],
    ["mixed slashes", "/\\evil.test/steal"],
    ["scheme downgrade", "http://shop.test/x"],
    ["other port", "https://shop.test:8443/x"],
    ["subdomain", "https://api.shop.test/x"],
    ["parent domain suffix trick", "https://shop.test.evil.test/x"],
    ["userinfo host confusion", "https://shop.test@evil.test/x"],
    ["userinfo on origin", "https://alex:pw@shop.test/x"],
    ["javascript scheme", "javascript:fetch('//evil.test')"],
    ["data scheme", "data:text/html,hi"],
    ["file scheme", "file:///etc/passwd"],
    ["leading whitespace host", " https://evil.test/"],
    ["tab inside scheme", "ht\ttps://evil.test/"],
  ])("refuses %s", (_label, candidate) => {
    expect(() => guardUrl(candidate, origin)).toThrow(OriginError);
  });

  it("treats an encoded authority on the origin as a path, not a host", () => {
    expect(() => guardUrl("/%2F%2Fevil.test", origin)).not.toThrow();
    expect(guardUrl("/%2F%2Fevil.test", origin).host).toBe("shop.test");
    // A same-scheme URL without slashes is relative to the base (WHATWG), so it stays on the origin.
    expect(guardUrl("https:%2F%2Fevil.test/", origin).host).toBe("shop.test");
  });

  it("describes URLs without their query", () => {
    expect(describeUrl("https://shop.test/a?token=secret")).toBe("https://shop.test/a");
    expect(describeUrl("::")).toBe("(unparseable URL)");
  });
});

describe("cookies", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  const url = new URL("https://shop.test/account/orders");

  it("matches domains and paths per RFC 6265", () => {
    expect(domainMatches("shop.test", "shop.test")).toBe(true);
    expect(domainMatches("www.shop.test", ".shop.test")).toBe(true);
    expect(domainMatches("evilshop.test", "shop.test")).toBe(false);
    expect(domainMatches("127.0.0.1", "0.0.1")).toBe(false);
    expect(pathMatches("/account/orders", "/account")).toBe(true);
    expect(pathMatches("/accounts", "/account")).toBe(false);
    expect(pathMatches("/account/x", "/account/")).toBe(true);
    expect(pathMatches("/", "/account")).toBe(false);
  });

  it("parses Set-Cookie attributes", () => {
    const c = parseSetCookie(
      "sid=abc123; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=60",
      url,
      now,
    );
    expect(c).toMatchObject({
      name: "sid",
      value: "abc123",
      domain: "shop.test",
      path: "/",
      httpOnly: true,
      secure: true,
    });
    expect(c?.sameSite).toBe("Lax");
    expect(c?.expires).toBe(Math.floor(now.getTime() / 1000) + 60);
    expect(c?.hostOnly).toBe(true);
    expect(parseSetCookie("a=b", url, now)?.path).toBe("/account");
    expect(
      parseSetCookie("a=b; Domain=.shop.test", new URL("https://www.shop.test/"), now),
    ).toMatchObject({
      domain: "shop.test",
      hostOnly: false,
    });
    expect(parseSetCookie("a=b; Expires=Wed, 01 Jan 2020 00:00:00 GMT", url, now)?.expires).toBe(
      1577836800,
    );
    expect(parseSetCookie("a=b; SameSite=Strict", url, now)?.sameSite).toBe("Strict");
    expect(parseSetCookie("a=b; SameSite=None", url, now)?.sameSite).toBe("None");
    expect(parseSetCookie("a=b; Path=relative", url, now)?.path).toBe("/account");
  });

  it("ignores malformed cookies and foreign Domain attributes", () => {
    expect(parseSetCookie("novalue", url, now)).toBeUndefined();
    expect(parseSetCookie("=x", url, now)).toBeUndefined();
    expect(parseSetCookie("a=b; Domain=evil.test", url, now)).toBeUndefined();
    expect(parseSetCookie("a=b; Domain=www.shop.test", url, now)).toBeUndefined();
  });

  it("selects only cookies a browser would send", () => {
    const jar: Cookie[] = [
      { name: "sid", value: "1", domain: "shop.test", path: "/" },
      { name: "other", value: "2", domain: "evil.test", path: "/" },
      { name: "deep", value: "3", domain: "shop.test", path: "/admin" },
      { name: "old", value: "4", domain: "shop.test", path: "/", expires: 100 },
      { name: "sess", value: "5", domain: "shop.test", path: "/", expires: -1 },
      { name: "host", value: "6", domain: "shop.test", path: "/", hostOnly: true },
      { name: "parent", value: "7", domain: "test", path: "/" },
    ];
    expect(cookiesFor(jar, url, now).map((c) => c.name)).toEqual(["sid", "sess", "host", "parent"]);
    expect(cookiesFor(jar, new URL("https://www.shop.test/"), now).map((c) => c.name)).toEqual([
      "sid",
      "sess",
      "parent",
    ]);
  });

  it("sends Secure cookies over https and loopback http only", () => {
    const jar: Cookie[] = [{ name: "s", value: "1", domain: "127.0.0.1", path: "/", secure: true }];
    expect(cookiesFor(jar, new URL("http://127.0.0.1:9/"), now)).toHaveLength(1);
    const jar2: Cookie[] = [
      { name: "s", value: "1", domain: "shop.test", path: "/", secure: true },
    ];
    expect(cookiesFor(jar2, new URL("http://shop.test/"), now)).toHaveLength(0);
  });

  it("orders the Cookie header by path length", () => {
    expect(
      cookieHeader([
        { name: "a", value: "1", domain: "d", path: "/" },
        { name: "b", value: "2", domain: "d", path: "/x/y" },
        { name: "c", value: "3", domain: "d", path: "" },
      ]),
    ).toBe("b=2; a=1; c=3");
  });

  it("merges Set-Cookie updates and deletions", () => {
    const jar: Cookie[] = [
      { name: "sid", value: "old", domain: "shop.test", path: "/" },
      { name: "keep", value: "k", domain: "shop.test", path: "/" },
    ];
    const r = applySetCookies(
      jar,
      ["sid=new; Path=/", "keep=; Max-Age=0; Path=/", "junk"],
      url,
      now,
    );
    expect(r.changed).toBe(true);
    expect(r.jar.map((c) => `${c.name}=${c.value}`)).toEqual(["sid=new"]);
    expect(jar[0]?.value).toBe("old");
    expect(applySetCookies(jar, ["bad"], url, now).changed).toBe(false);
  });

  it("InMemorySessions keeps personas apart and returns copies", async () => {
    const s = new InMemorySessions();
    s.set("https://shop.test", undefined, {
      cookies: [{ name: "a", value: "1", domain: "shop.test", path: "/" }],
    });
    await s.update("https://shop.test", "work", {
      cookies: [],
      headers: { authorization: "Bearer x" },
    });
    const got = await s.get("https://shop.test");
    expect(got?.cookies[0]?.value).toBe("1");
    if (got?.cookies[0]) got.cookies[0].value = "mutated";
    expect((await s.get("https://shop.test"))?.cookies[0]?.value).toBe("1");
    expect((await s.get("https://shop.test", "work"))?.headers).toEqual({
      authorization: "Bearer x",
    });
    expect(await s.get("https://other.test")).toBeUndefined();
  });
});
