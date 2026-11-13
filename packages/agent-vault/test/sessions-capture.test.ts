// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { inspect } from "util";
import { describe, expect, it, vi } from "vitest";
import {
  acceptCapture,
  EncryptedRecords,
  Secret,
  type SessionState,
  SessionStore,
  sessionCapture,
  stateSchema,
} from "../src/index.js";
import { ACCESS, COOKIE, capture, cookie, deferred, NOW, REFRESH, SITE, setup } from "./helpers.js";

function delayedSessions() {
  const base = setup();
  const entered = deferred<void>();
  const release = deferred<void>();
  let blocked = false;
  const keys = {
    key: async () => {
      if (blocked) {
        blocked = false;
        entered.resolve();
        await release.promise;
      }
      return new Secret(Buffer.alloc(32, 7));
    },
  };
  const records = new EncryptedRecords(base.store, keys);
  const sessions = new SessionStore(records, { now: () => NOW });
  const writer = new SessionStore(new EncryptedRecords(base.store, keys), { now: () => NOW });
  return {
    ...base,
    records,
    sessions,
    writer,
    entered,
    release,
    block: () => {
      blocked = true;
    },
  };
}
const initialState = (): SessionState => ({
  site: SITE,
  account: "alex",
  bundle: { cookies: [cookie()] },
  capturedAt: NOW,
  stale: false,
});

describe("encrypted sessions and validated capture", () => {
  it("returns and rotates persisted executor revisions; drops missing and reused revisions", async () => {
    const { sessions, store } = setup();
    await sessions.store(initialState());
    const bundle = await sessions.get(SITE, "alex");
    expect(bundle?.revision).toBeTypeOf("string");
    expect(await (await sessions.state(SITE, "alex"))?.use((s) => s.revision)).toBe(
      bundle?.revision,
    );
    const writes = vi.spyOn(store, "putPrivateRecord");
    await sessions.update(SITE, "alex", { cookies: [{ ...cookie(), value: "missing-revision" }] });
    await sessions.update(SITE, "alex", { revision: "wrong", cookies: [cookie()] });
    await sessions.update(SITE, "other", { ...bundle, cookies: [cookie()] });
    await sessions.update("https://other.test", "alex", { ...bundle, cookies: [cookie()] });
    expect(writes).not.toHaveBeenCalled();
    await sessions.update(SITE, "alex", {
      ...bundle,
      cookies: [{ ...cookie(), value: "accepted" }],
    });
    const updated = await sessions.get(SITE, "alex");
    expect(updated?.revision).toBeTypeOf("string");
    expect(updated?.revision).not.toBe(bundle?.revision);
    expect(updated?.cookies[0]?.value).toBe("accepted");
    writes.mockClear();
    await sessions.update(SITE, "alex", { ...bundle, cookies: [cookie()] });
    expect(writes).not.toHaveBeenCalled();
    expect((await sessions.get(SITE, "alex"))?.revision).toBe(updated?.revision);
  });
  it("keeps legacy sessions readable but refuses revisionless executor writes", async () => {
    const { sessions, records } = setup();
    await records.put("sessions", JSON.stringify([SITE, "alex"]), stateSchema, initialState());
    const bundle = await sessions.get(SITE, "alex");
    expect(bundle?.cookies[0]?.value).toBe(COOKIE);
    expect(bundle?.revision).toBeUndefined();
    await sessions.update(SITE, "alex", { ...bundle, cookies: [{ ...cookie(), value: "old" }] });
    expect((await sessions.get(SITE, "alex"))?.cookies[0]?.value).toBe(COOKIE);
    await sessions.stale(SITE, "alex");
    expect(await (await sessions.state(SITE, "alex"))?.use((s) => s.revision)).toBeTypeOf("string");
  });
  it.each([
    "login",
    "revocation",
    "update",
    "refresh",
  ] as const)("rechecks executor revision after key acquisition against %s", async (change) => {
    const { sessions, writer, store, entered, release, block } = delayedSessions();
    await sessions.store(initialState());
    const bundle = await sessions.get(SITE, "alex");
    block();
    const pending = sessions.update(SITE, "alex", {
      ...bundle,
      cookies: [{ ...cookie(), value: "late" }],
    });
    await entered.promise;
    if (change === "login") await writer.beginLogin(SITE, "alex");
    else if (change === "revocation") await writer.stale(SITE, "alex");
    else if (change === "update")
      await writer.update(SITE, "alex", {
        ...bundle,
        cookies: [{ ...cookie(), value: "current" }],
      });
    else
      await (await writer.state(SITE, "alex"))?.use((s) =>
        writer.commit(
          { ...s, bundle: { cookies: [{ ...cookie(), value: "refresh" }] } },
          () => false,
        ),
      );
    const before = await (await writer.state(SITE, "alex"))?.use((s) => s);
    const writes = vi.spyOn(store, "putPrivateRecord");
    release.resolve();
    await pending;
    expect(writes).not.toHaveBeenCalled();
    expect(await (await writer.state(SITE, "alex"))?.use((s) => s)).toEqual(before);
  });
  it.each([
    "revocation",
    "login",
    "store",
  ] as const)("refuses captures invalidated before delivery by %s", async (change) => {
    const { sessions, records, store } = setup();
    const transaction = await sessions.beginLogin(SITE, "alex");
    const writer = new SessionStore(records, { now: () => NOW });
    if (change === "revocation") await writer.stale(SITE, "alex");
    else if (change === "login") await writer.beginLogin(SITE, "alex");
    else await writer.store(initialState());
    const before = await (await sessions.state(SITE, "alex"))?.use((s) => s);
    const writes = vi.spyOn(store, "putPrivateRecord");
    await expect(acceptCapture(sessions, capture(), transaction, () => NOW)).rejects.toThrow(
      "Vault denied",
    );
    expect(writes).not.toHaveBeenCalled();
    expect(await (await sessions.state(SITE, "alex"))?.use((s) => s)).toEqual(before);
  });
  it("accepts capture after executor updates in the same login generation", async () => {
    const { sessions } = setup();
    const transaction = await sessions.beginLogin(SITE, "alex");
    const empty = await sessions.get(SITE, "alex");
    expect(empty?.cookies).toEqual([]);
    expect(empty?.revision).toBeTypeOf("string");
    await sessions.update(SITE, "alex", { ...empty, cookies: [{ ...cookie(), name: "csrf" }] });
    const bundle = await acceptCapture(sessions, capture(), transaction, () => NOW);
    expect(bundle.cookies[0]?.value).toBe(COOKIE);
    expect(bundle.revision).not.toBe(empty?.revision);
    expect(await (await sessions.state(SITE, "alex"))?.use((s) => s.generation)).toBe(
      transaction.generation,
    );
  });
  it("refuses captures without a host login transaction", async () => {
    const { sessions } = setup();
    const transaction = await sessions.beginLogin(SITE, "alex");
    await expect(
      acceptCapture(sessions, capture(), { ...transaction, generation: "" }, () => NOW),
    ).rejects.toThrow("Vault denied");
  });
  it.each([
    "revocation",
    "login",
  ] as const)("rechecks capture generation after key acquisition against %s", async (change) => {
    const { sessions, writer, store, entered, release, block } = delayedSessions();
    const transaction = await sessions.beginLogin(SITE, "alex");
    block();
    const outcome = acceptCapture(sessions, capture(), transaction, () => NOW).then(
      () => "accepted",
      () => "refused",
    );
    await entered.promise;
    if (change === "revocation") await writer.stale(SITE, "alex");
    else await writer.beginLogin(SITE, "alex");
    const before = await (await writer.state(SITE, "alex"))?.use((s) => s);
    const writes = vi.spyOn(store, "putPrivateRecord");
    release.resolve();
    expect(await outcome).toBe("refused");
    expect(writes).not.toHaveBeenCalled();
    expect(await (await sessions.state(SITE, "alex"))?.use((s) => s)).toEqual(before);
  });
  it("rechecks capture generation after waiting for the record lock", async () => {
    const { sessions, store, writer } = delayedSessions();
    const transaction = await sessions.beginLogin(SITE, "alex");
    const entered = deferred<void>();
    const release = deferred<void>();
    const withLock = store.withLock.bind(store);
    vi.spyOn(store, "withLock").mockImplementationOnce(async (name, fn, options) => {
      entered.resolve();
      await release.promise;
      return withLock(name, fn, options);
    });
    const outcome = acceptCapture(sessions, capture(), transaction, () => NOW).then(
      () => "accepted",
      () => "refused",
    );
    await entered.promise;
    // The injected key provider takes no locks, so the delayed lock is the session record lock.
    await writer.stale(SITE, "alex");
    const writes = vi.spyOn(store, "putPrivateRecord");
    release.resolve();
    expect(await outcome).toBe("refused");
    expect(writes).not.toHaveBeenCalled();
  });
  it.each([
    true,
    false,
  ])("refuses host stores superseded during key acquisition (existing=%s)", async (existing) => {
    const { sessions, writer, store, entered, release, block } = delayedSessions();
    if (existing) await sessions.store(initialState());
    block();
    const outcome = sessions.store(initialState()).then(
      () => "accepted",
      () => "refused",
    );
    await entered.promise;
    await writer.stale(SITE, "alex");
    const writes = vi.spyOn(store, "putPrivateRecord");
    release.resolve();
    expect(await outcome).toBe("refused");
    expect(writes).not.toHaveBeenCalled();
    expect(await sessions.get(SITE, "alex")).toBeUndefined();
  });
  it("refuses a login reset superseded during key acquisition", async () => {
    const { sessions, writer, store, entered, release, block } = delayedSessions();
    await sessions.store(initialState());
    block();
    const outcome = sessions.beginLogin(SITE, "alex").then(
      () => "accepted",
      () => "refused",
    );
    await entered.promise;
    await writer.stale(SITE, "alex");
    const writes = vi.spyOn(store, "putPrivateRecord");
    release.resolve();
    expect(await outcome).toBe("refused");
    expect(writes).not.toHaveBeenCalled();
  });
  it("refuses host stores of superseded snapshots", async () => {
    const { sessions } = setup();
    await sessions.store(initialState());
    const snapshot = await sessions.state(SITE, "alex");
    await sessions.stale(SITE, "alex");
    await expect(snapshot?.use((s) => sessions.store({ ...s, stale: false }))).rejects.toThrow(
      "Vault denied",
    );
    expect(await sessions.get(SITE, "alex")).toBeUndefined();
  });
  it("drops delayed executor jars after a newer login", async () => {
    const { sessions } = setup();
    const transaction = await sessions.beginLogin(SITE, "alex");
    await acceptCapture(sessions, capture(), transaction, () => NOW);
    const old = await sessions.get(SITE, "alex");
    await sessions.beginLogin(SITE, "alex");
    await sessions.store({
      site: SITE,
      account: "alex",
      bundle: { cookies: [{ ...cookie(), value: "new-login" }] },
      capturedAt: NOW,
      stale: false,
    });
    await sessions.update(SITE, "alex", {
      ...old,
      cookies: [cookie(), { ...cookie(), name: "tracking", value: "tracking" }],
    });
    expect((await sessions.get(SITE, "alex"))?.cookies.map((c) => c.value)).toEqual(["new-login"]);
  });
  it("refuses a capture revoked during key acquisition", async () => {
    const { store } = setup();
    const entered = deferred<void>();
    const release = deferred<void>();
    let blocked = false;
    const keys = {
      key: async () => {
        if (blocked) {
          blocked = false;
          entered.resolve();
          await release.promise;
        }
        return new Secret(Buffer.alloc(32, 7));
      },
    };
    const sessions = new SessionStore(new EncryptedRecords(store, keys), { now: () => NOW });
    const transaction = await sessions.beginLogin(SITE, "alex");
    blocked = true;
    const pending = acceptCapture(sessions, capture(), transaction, () => NOW);
    const outcome = pending.then(
      () => "accepted",
      () => "refused",
    );
    await entered.promise;
    const writer = new SessionStore(new EncryptedRecords(store, keys), { now: () => NOW });
    await writer.stale(SITE, "alex");
    const writes = vi.spyOn(store, "putPrivateRecord");
    release.resolve();
    expect(await outcome).toBe("refused");
    expect(writes).not.toHaveBeenCalled();
    expect(await sessions.get(SITE, "alex")).toBeUndefined();
  });
  it("captures sessions per site/account and redacts bundles, arrays, cookies and headers", async () => {
    const { sessions } = setup();
    const bundle = await acceptCapture(
      sessions,
      capture(),
      await sessions.beginLogin(SITE, "alex"),
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
    await sessions.update(SITE, "alex", {
      ...bundle,
      cookies: [{ ...cookie(), value: "updated" }],
    });
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
    await sessions.beginLogin(SITE, "alex");
    await expect(
      sessions.update(SITE, "alex", {
        ...(await sessions.get(SITE, "alex")),
        cookies: [{ ...cookie(), domain }],
      }),
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
    await sessions.beginLogin(SITE, "alex");
    await expect(
      sessions.update(SITE, "alex", {
        ...(await sessions.get(SITE, "alex")),
        cookies: [{ ...cookie(), ...patch } as never],
      }),
    ).rejects.toThrow();
  });
  it("refuses arbitrary headers and external token endpoints", async () => {
    const { sessions } = setup();
    await sessions.beginLogin(SITE, "alex");
    await expect(
      sessions.update(SITE, "alex", {
        ...(await sessions.get(SITE, "alex")),
        cookies: [],
        headers: { host: "evil.test" },
      }),
    ).rejects.toThrow();
    await expect(
      sessions.update(SITE, "alex", {
        ...(await sessions.get(SITE, "alex")),
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
        await sessions.beginLogin(SITE, "alex"),
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
        await sessions.beginLogin(SITE, "alex"),
        () => NOW,
      ),
    ).rejects.toThrow("Vault invalid");
    expect((await sessions.get(SITE, "alex"))?.cookies).toEqual([]);
  });
  it("accepts a missing account only against explicit host binding; validation errors hide input", async () => {
    const { sessions } = setup();
    const input = sessionCapture({ site: SITE, cookies: [cookie()], capturedAt: NOW });
    await acceptCapture(sessions, input, await sessions.beginLogin(SITE, "alex"), () => NOW);
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
