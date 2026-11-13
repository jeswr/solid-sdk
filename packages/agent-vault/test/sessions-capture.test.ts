// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { inspect } from "util";
import { describe, expect, it } from "vitest";
import { acceptCapture, Secret, SessionStore, sessionCapture } from "../src/index.js";
import { ACCESS, COOKIE, capture, cookie, NOW, REFRESH, SITE, setup } from "./helpers.js";

describe("encrypted sessions and validated capture", () => {
  it("captures sessions per site/account and redacts bundles, arrays, cookies and headers", async () => {
    const { sessions } = setup();
    const bundle = await acceptCapture(
      sessions,
      capture(),
      { site: SITE, account: "alex" },
      () => NOW,
    );
    expect(bundle.cookies[0]?.value).toBe(COOKIE);
    for (const value of [bundle, bundle.cookies, bundle.cookies[0]])
      for (const text of [
        JSON.stringify(value),
        inspect(value, { showHidden: true }),
        String(value),
      ])
        expect(text).not.toContain(COOKIE);
    expect(await sessions.get(SITE, "other")).toBeUndefined();
    expect(await sessions.get("https://other.test", "alex")).toBeUndefined();
    const state = await sessions.state(SITE, "alex");
    expect(inspect(state)).not.toContain(COOKIE);
    await sessions.update(SITE, "alex", { cookies: [{ ...cookie(), value: "updated" }] });
    expect((await sessions.get(SITE, "alex"))?.cookies[0]?.value).toBe("updated");
    await sessions.stale(SITE, "alex");
    expect(await sessions.get(SITE, "alex")).toBeUndefined();
    await expect(sessions.get(SITE)).rejects.toThrow("Vault invalid");
  });
  it("rejects expired cookies and tokens while preserving refresh metadata for scheduler", async () => {
    const { records } = setup();
    let now = NOW;
    const sessions = new SessionStore(records, { now: () => now });
    await sessions.store({
      site: SITE,
      account: "alex",
      bundle: { cookies: [{ ...cookie(), expires: NOW / 1000 + 10 }] },
      tokens: { access: ACCESS, refresh: REFRESH, expiresAt: NOW + 10000 },
      capturedAt: NOW,
      stale: false,
    });
    const bundle = await sessions.get(SITE, "alex");
    expect(bundle?.headers?.authorization).toBe(`Bearer ${ACCESS}`);
    expect(inspect(bundle?.headers)).not.toContain(ACCESS);
    now += 10000;
    expect(await sessions.get(SITE, "alex")).toBeUndefined();
    const state = await sessions.state(SITE, "alex");
    expect(await state?.use((s) => s.tokens?.refresh === REFRESH)).toBe(true);
    await sessions.store({
      site: SITE,
      account: "cookies",
      bundle: { cookies: [{ ...cookie(), expires: 0 }] },
      capturedAt: NOW,
      stale: false,
    });
    expect(await sessions.get(SITE, "cookies")).toBeUndefined();
  });
  it.each([
    "other.test",
    "evilshop.test",
    "shop.test.evil.test",
    "test",
    ".test",
    "shop.test\n",
  ])("rejects unrelated or malformed cookie domain %s", async (domain) => {
    const { sessions } = setup();
    await expect(
      sessions.update(SITE, "alex", { cookies: [{ ...cookie(), domain }] }),
    ).rejects.toThrow("Vault invalid");
  });
  it("permits exact and explicitly approved parent domains, rejects host-only parent and IP suffix", async () => {
    const { records } = setup();
    const sessions = new SessionStore(records, { cookieDomains: ["shop.test", "0.0.1"] });
    expect(
      sessions.validate("https://sub.shop.test", {
        cookies: [{ ...cookie(), domain: ".shop.test", hostOnly: false }],
      }).cookies[0]?.domain,
    ).toBe("shop.test");
    expect(() => sessions.validate("https://sub.shop.test", { cookies: [cookie()] })).toThrow();
    expect(() =>
      sessions.validate("http://127.0.0.1", {
        cookies: [{ ...cookie(), domain: "0.0.1", hostOnly: false }],
      }),
    ).toThrow();
  });
  it.each([
    { name: "__Host-sid", hostOnly: false },
    { name: "__Host-sid", path: "/x" },
    { name: "__Secure-sid", secure: false },
    { sameSite: "None", secure: false },
    { value: "bad; injected" },
  ])("rejects invalid cookie semantics %j", async (patch) => {
    const { sessions } = setup();
    await expect(
      sessions.update(SITE, "alex", { cookies: [{ ...cookie(), ...patch } as never] }),
    ).rejects.toThrow();
  });
  it("refuses arbitrary headers and external token endpoints", async () => {
    const { sessions } = setup();
    await expect(
      sessions.update(SITE, "alex", { cookies: [], headers: { host: "evil.test" } }),
    ).rejects.toThrow();
    await expect(
      sessions.update(SITE, "alex", {
        cookies: [],
        headers: { authorization: "Bearer value\r\ninjected" },
      }),
    ).rejects.toThrow();
    await expect(
      acceptCapture(
        sessions,
        sessionCapture({
          site: SITE,
          cookies: [],
          tokens: {
            access: ACCESS,
            refresh: REFRESH,
            expiresAt: NOW + 1000,
            tokenEndpoint: "https://other.test/token",
          },
          capturedAt: NOW,
        }),
        { site: SITE, account: "alex" },
        () => NOW,
      ),
    ).rejects.toThrow();
  });
  it.each([
    { site: "https://other.test" },
    { account: "other" },
    { capturedAt: NOW + 31000 },
    { capturedAt: NOW - 300001 },
  ])("rejects mismatched/replayed capture %j", async (patch) => {
    const { sessions } = setup();
    await expect(
      acceptCapture(
        sessions,
        new Secret({ site: SITE, account: "alex", cookies: [cookie()], capturedAt: NOW, ...patch }),
        { site: SITE, account: "alex" },
        () => NOW,
      ),
    ).rejects.toThrow("Vault invalid");
    expect(await sessions.get(SITE, "alex")).toBeUndefined();
  });
  it("accepts a missing account only against explicit host binding; validation errors hide input", async () => {
    const { sessions } = setup();
    const input = sessionCapture({ site: SITE, cookies: [cookie()], capturedAt: NOW });
    await acceptCapture(sessions, input, { site: SITE, account: "alex" }, () => NOW);
    expect(await sessions.get(SITE, "alex")).toBeDefined();
    for (const bad of [
      { site: SITE, cookies: [], capturedAt: Infinity },
      { site: SITE, cookies: [], capturedAt: NOW, secret: COOKIE },
    ]) {
      try {
        sessionCapture(bad);
        throw new Error("expected failure");
      } catch (e) {
        expect(inspect(e, { showHidden: true })).not.toContain(COOKIE);
        expect(String(e)).toContain("Vault invalid");
      }
    }
  });
});
