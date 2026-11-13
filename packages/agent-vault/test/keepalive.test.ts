// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { KeepAlive, type SessionState, SessionStore, type VaultFetch } from "../src/index.js";
import { ACCESS, COOKIE, cookie, FakeClock, NOW, REFRESH, SITE, setup } from "./helpers.js";

const route = {
  method: "password",
  refresh: {
    urlTemplate: `${SITE}/token`,
    tokenPointer: "/result/access",
    expiresInPointer: "/result/expires",
  },
  probeUrl: `${SITE}/signed-in`,
};
function fixture() {
  const base = setup();
  const clock = new FakeClock();
  const sessions = new SessionStore(base.records, { now: clock.now });
  return { ...base, clock, sessions };
}
async function seed(sessions: SessionStore, tokens = true) {
  const state: SessionState = {
    site: SITE,
    account: "alex",
    bundle: { cookies: [cookie()] },
    capturedAt: NOW,
    stale: false,
  };
  if (tokens)
    state.tokens = {
      access: ACCESS,
      refresh: REFRESH,
      expiresAt: NOW + 120000,
      tokenEndpoint: `${SITE}/token`,
    };
  await sessions.store(state);
}
describe("keep-alive injected scheduler", () => {
  it("refreshes before expiry using POST, form body, manual redirects, and JSON pointers", async () => {
    const { sessions, clock } = fixture();
    await seed(sessions);
    const transport = vi.fn<VaultFetch>(async () => ({
      status: 200,
      text: async () => JSON.stringify({ result: { access: "rotated-access", expires: 600 } }),
    }));
    const k = new KeepAlive({ sessions, clock, transport });
    await k.start(SITE, "alex", route);
    expect(clock.delay()).toBe(60000);
    await clock.tick();
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0] ?? [];
    expect(url).toBe(`${SITE}/token`);
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("manual");
    expect(new URLSearchParams(init?.body).get("refresh_token")).toBe(REFRESH);
    expect((await sessions.get(SITE, "alex"))?.headers?.authorization).toBe(
      "Bearer rotated-access",
    );
    expect(clock.delay()).toBe(540000);
    k.stop(SITE, "alex");
    expect(clock.tasks.size).toBe(0);
  });
  it("probes only frequent sites and stores renewed sliding cookies", async () => {
    const { sessions, clock } = fixture();
    await seed(sessions, false);
    const transport = vi.fn<VaultFetch>(async () => ({
      status: 200,
      text: async () => "",
      setCookies: ["sid=renewed; Path=/; Secure; HttpOnly; Max-Age=600"],
    }));
    const k = new KeepAlive({ sessions, clock, transport });
    await k.start(SITE, "alex", route);
    expect(clock.tasks.size).toBe(0);
    await k.start(SITE, "alex", route, { frequent: true, intervalMs: 1 });
    expect(clock.delay()).toBe(60000);
    await clock.tick();
    expect(transport.mock.calls[0]?.[1].method).toBe("GET");
    expect(transport.mock.calls[0]?.[1].headers.cookie).toBe(`sid=${COOKIE}`);
    expect((await sessions.get(SITE, "alex"))?.cookies[0]?.value).toBe("renewed");
  });
  it.each([
    401, 302, 500,
  ])("handles HTTP %i without following redirects or exposing response bodies", async (status) => {
    const { sessions, clock } = fixture();
    await seed(sessions);
    const text = vi.fn(async () => REFRESH);
    const transport = vi.fn<VaultFetch>(async () => ({ status, text }));
    const k = new KeepAlive({ sessions, clock, transport });
    await k.start(SITE, "alex", route);
    await clock.tick();
    expect(text).not.toHaveBeenCalled();
    if (status === 401) {
      expect(await sessions.get(SITE, "alex")).toBeUndefined();
      expect(clock.tasks.size).toBe(0);
    } else {
      expect(clock.delay()).toBe(120000);
      await clock.tick();
      expect(clock.delay()).toBe(240000);
    }
  });
  it("marks cookie session stale on 401 probe", async () => {
    const { sessions, clock } = fixture();
    await seed(sessions, false);
    const k = new KeepAlive({
      sessions,
      clock,
      transport: async () => ({ status: 401, text: async () => "" }),
    });
    await k.start(SITE, "alex", route, { frequent: true });
    await clock.tick();
    expect(await sessions.get(SITE, "alex")).toBeUndefined();
    expect(clock.tasks.size).toBe(0);
  });
  it.each([
    {},
    { result: { access: ACCESS, expires: 0 } },
    { result: { access: ACCESS, expires: "60" } },
    { result: { access: "bad\r\nheader", expires: 60 } },
  ])("backs off on invalid refresh payload %j", async (body) => {
    const { sessions, clock } = fixture();
    await seed(sessions);
    const k = new KeepAlive({
      sessions,
      clock,
      transport: async () => ({ status: 200, text: async () => JSON.stringify(body) }),
    });
    await k.start(SITE, "alex", route);
    await clock.tick();
    expect(clock.delay()).toBe(120000);
  });
  it("enforces floor, rejects cross-origin routes before sending, and does not overlap timers", async () => {
    const { sessions, clock } = fixture();
    await seed(sessions);
    const transport = vi.fn<VaultFetch>();
    const k = new KeepAlive({ sessions, clock, transport, floorMs: 1 });
    await expect(
      k.start(SITE, "alex", {
        method: "password",
        refresh: { ...route.refresh, urlTemplate: "https://evil.test/token" },
      }),
    ).rejects.toThrow("Vault invalid");
    await expect(
      k.start(SITE, "alex", { method: "passkey", probeUrl: `${SITE}@evil.test/` }),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    await k.start(SITE, "alex", route);
    await k.start(SITE, "alex", route);
    expect(clock.tasks.size).toBe(1);
    k.stop(SITE, "alex");
    expect(clock.tasks.size).toBe(0);
    expect(() => new KeepAlive({ sessions, clock, transport, floorMs: NaN })).toThrow();
  });
  it("stop during a network request prevents late persistence and rescheduling", async () => {
    const { sessions, clock } = fixture();
    await seed(sessions);
    let resolve!: (r: Awaited<ReturnType<VaultFetch>>) => void;
    const transport = vi.fn<VaultFetch>(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const k = new KeepAlive({ sessions, clock, transport });
    await k.start(SITE, "alex", route);
    await clock.tick();
    k.stop(SITE, "alex");
    resolve({ status: 401, text: async () => "" });
    for (let i = 0; i < 100; i++) await Promise.resolve();
    expect(await sessions.get(SITE, "alex")).toBeDefined();
    expect(clock.tasks.size).toBe(0);
  });
});
it("persists standard refresh-token rotation and uses a default expiry pointer", async () => {
  const { sessions, clock } = fixture();
  await seed(sessions);
  const transport = vi.fn<VaultFetch>(async () => ({
    status: 200,
    text: async () =>
      JSON.stringify({
        access: "rotated-access",
        refresh_token: "rotated-refresh",
        expires_in: 120,
      }),
  }));
  const k = new KeepAlive({ sessions, clock, transport });
  await k.start(SITE, "alex", {
    method: "password",
    refresh: { urlTemplate: `${SITE}/token`, tokenPointer: "/access" },
  });
  await clock.tick();
  await clock.tick();
  expect(new URLSearchParams(transport.mock.calls[1]?.[1].body).get("refresh_token")).toBe(
    "rotated-refresh",
  );
});
it("caps long delays to the timer range so large expiries cannot overflow to immediate retries", async () => {
  const { sessions, clock } = fixture();
  await seed(sessions);
  const state = await sessions.state(SITE, "alex");
  await state?.use((s) =>
    sessions.store({ ...s, tokens: { access: ACCESS, refresh: REFRESH, expiresAt: NOW + 1e15 } }),
  );
  const transport = vi.fn<VaultFetch>();
  const k = new KeepAlive({ sessions, clock, transport });
  await k.start(SITE, "alex", route);
  expect(clock.delay()).toBe(2147483647);
  expect(transport).not.toHaveBeenCalled();
  expect(() => new KeepAlive({ sessions, clock, transport, floorMs: 1e15 })).toThrow();
});
