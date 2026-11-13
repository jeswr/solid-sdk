// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { endianness } from "os";
import { Readable, Writable } from "stream";
import { describe, expect, it, vi } from "vitest";
import { KeepAlive } from "../src/keepalive.js";
import { NativeVault, readFrames, runNativeHost, writeFrame } from "../src/native-host.js";
import { SessionStore } from "../src/sessions.js";
import { account, cookie, FakeClock, NOW, SITE, setup } from "./helpers.js";

function packet(value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  const head = Buffer.alloc(4);
  if (endianness() === "LE") head.writeUInt32LE(body.length);
  else head.writeUInt32BE(body.length);
  return Buffer.concat([head, body]);
}
async function messages(chunks: Buffer[]) {
  const out = [];
  for await (const value of readFrames(Readable.from(chunks))) out.push(value);
  return out;
}
describe("native framing", () => {
  it("handles fragmented headers, UTF-8 and coalesced messages", async () => {
    const bytes = Buffer.concat([packet({ label: "é" }), packet({ id: 2 })]);
    expect(await messages([...bytes].map((b) => Buffer.from([b])))).toEqual([
      { label: "é" },
      { id: 2 },
    ]);
  });
  it.each([0, 1024 * 1024 + 1, 0xffffffff])("rejects length %i before reading body", async (n) => {
    const head = Buffer.alloc(4);
    if (endianness() === "LE") head.writeUInt32LE(n);
    else head.writeUInt32BE(n);
    await expect(messages([head])).rejects.toThrow("Vault invalid.");
  });
  it("rejects truncated frames and invalid JSON without retaining contents", async () => {
    for (const bytes of [Buffer.from([1]), packet({ secret: "fixture-secret" }).subarray(0, 10)])
      await expect(messages([bytes])).rejects.toThrow("Vault invalid.");
    const bad = packet("fixture-secret");
    bad[4] = 0xff;
    await expect(messages([bad])).rejects.toThrow("Vault invalid.");
  });
  it("writes only bounded JSON with a byte length header", async () => {
    const chunks: Buffer[] = [];
    const output = new Writable({
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        done();
      },
    });
    await writeFrame(output, { label: "é" });
    expect(Buffer.concat(chunks)).toEqual(packet({ label: "é" }));
    await expect(writeFrame(output, "x".repeat(1024 * 1024))).rejects.toThrow("Vault invalid.");
  });
});
describe("native vault", () => {
  it("stops old probes during review and hands accepted cookies to keep-alive", async () => {
    const state = setup();
    await account(state.profiles);
    await state.sessions.store({
      site: SITE,
      account: "alex",
      capturedAt: NOW,
      stale: false,
      bundle: { cookies: [cookie()] },
    });
    const clock = new FakeClock();
    const transport = vi.fn(async () => ({ status: 401, text: async () => "" }));
    const scheduler = new KeepAlive({ sessions: state.sessions, clock, transport });
    const route = { method: "passkey" as const, probeUrl: `${SITE}/session` };
    await scheduler.start(SITE, "alex", route, { frequent: true });
    const h = new NativeVault({
      ...state,
      now: () => NOW,
      beginning: (site: string, persona: string) => scheduler.stop(site, persona),
      captured: (site, persona) => scheduler.start(site, persona, route, { frequent: true }),
    });
    const begun = await h.handle({
      id: 1,
      type: "beginLogin",
      site: SITE,
      persona: "alex",
      profile: "personal",
    });
    expect(clock.tasks.size).toBe(0);
    if (!begun.ok || begun.result.type !== "beginLogin") throw new Error("Expected token");
    expect(
      await h.handle({
        id: 2,
        type: "capture",
        token: begun.result.token,
        message: { site: SITE, account: "alex", capturedAt: NOW, cookies: [cookie()] },
      }),
    ).toMatchObject({ ok: true });
    expect(clock.tasks.size).toBe(1);
    await clock.tick();
    expect(transport).toHaveBeenCalledWith(
      `${SITE}/session`,
      expect.objectContaining({ headers: { cookie: `sid=${cookie().value}` }, redirect: "manual" }),
    );
    expect(await state.sessions.get(SITE, "alex")).toBeUndefined();
  });
  async function host() {
    const state = setup();
    await account(state.profiles);
    const captured = vi.fn();
    return { ...state, captured, host: new NativeVault({ ...state, now: () => NOW, captured }) };
  }
  it("lists display metadata for this site without backend references", async () => {
    const { host: h } = await host();
    const response = await h.handle({ id: 1, type: "list", site: SITE });
    expect(response).toMatchObject({
      id: 1,
      ok: true,
      result: { type: "list", personas: [{ id: "alex", profile: "personal", label: "alex" }] },
    });
    expect(JSON.stringify(response)).not.toMatch(/backend|item|cookie-secret/);
  });
  it("begins before capture, consumes the token once and returns no session", async () => {
    const { host: h, sessions, captured } = await host();
    const begun = await h.handle({
      id: 1,
      type: "beginLogin",
      site: SITE,
      persona: "alex",
      profile: "personal",
    });
    if (!begun.ok || begun.result.type !== "beginLogin") throw new Error("Expected token");
    const request = {
      id: 2,
      type: "capture",
      token: begun.result.token,
      message: { site: SITE, account: "alex", capturedAt: NOW, cookies: [cookie()] },
    };
    expect(await h.handle(request)).toEqual({ id: 2, ok: true, result: { type: "capture" } });
    expect(captured).toHaveBeenCalledWith(SITE, "alex");
    expect((await sessions.get(SITE, "alex"))?.cookies[0]?.value).toBe(cookie().value);
    expect(await h.handle(request)).toMatchObject({ ok: false, error: "denied" });
  });
  it("atomically marks browser captures and lists every pending new sign-in across restarts and replacements", async () => {
    const { host: h, sessions, records } = await host();
    for (let i = 0; i < 2; i++) {
      const begun = await h.handle({
        id: 1,
        type: "beginLogin",
        site: SITE,
        persona: "alex",
        profile: "personal",
      });
      if (!begun.ok || begun.result.type !== "beginLogin") throw new Error("Expected token");
      const request = {
        id: 2,
        type: "capture",
        token: begun.result.token,
        message: { site: SITE, account: "alex", capturedAt: NOW, cookies: [cookie()] },
      };
      expect(await h.handle(request)).toMatchObject({ ok: true });
      expect(await h.handle(request)).toMatchObject({ ok: false });
      expect(await (await sessions.state(SITE, "alex"))?.use((r) => r.origin)).toBe(
        "browser-capture",
      );
    }
    const restored = new SessionStore(records, { now: () => NOW });
    const entries = await restored.listPendingBrowserSignIns(SITE, "alex");
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((e) => e.id)).size).toBe(2);
    expect(entries[0]).toEqual({
      id: expect.any(String),
      site: SITE,
      account: "alex",
      label: "New sign-in from browser",
      origin: "browser-capture",
      status: "pending",
      capturedAt: NOW,
    });
    expect(JSON.stringify(entries)).not.toContain(cookie().value);
    expect(await restored.listPendingBrowserSignIns(SITE, "other")).toEqual([]);
    await restored.beginLogin(SITE, "alex");
    await restored.stale(SITE, "alex");
    expect(await restored.listPendingBrowserSignIns(SITE, "alex")).toEqual(entries);
  });
  it("refuses a stale generation and cross-account capture", async () => {
    const { host: h, sessions } = await host();
    const begun = await h.handle({
      id: 1,
      type: "beginLogin",
      site: SITE,
      persona: "alex",
      profile: "personal",
    });
    if (!begun.ok || begun.result.type !== "beginLogin") throw new Error("Expected token");
    await sessions.beginLogin(SITE, "alex");
    expect(
      await h.handle({
        id: 2,
        type: "capture",
        token: begun.result.token,
        message: { site: SITE, capturedAt: NOW, cookies: [cookie()] },
      }),
    ).toMatchObject({ ok: false, error: "denied" });
  });
  it("rejects schema additions and unknown profiles without echoing secrets", async () => {
    const { host: h } = await host();
    for (const request of [
      { id: 1, type: "list", site: SITE, password: "fixture-secret" },
      { id: 1, type: "beginLogin", site: SITE, persona: "alex", profile: "work" },
      { id: 1, type: "capture", token: "fixture-secret", message: {} },
    ]) {
      const result = await h.handle(request);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("fixture-secret");
    }
  });
  it("runs the framed protocol sequentially", async () => {
    const { host: h } = await host();
    const chunks: Buffer[] = [];
    const output = new Writable({
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        done();
      },
    });
    await runNativeHost(Readable.from([packet({ id: 1, type: "list", site: SITE })]), output, h);
    expect(await messages(chunks)).toMatchObject([{ id: 1, ok: true }]);
  });
  it("refuses another port's token and an expired transaction", async () => {
    const state = setup();
    await account(state.profiles);
    let time = NOW;
    const h = new NativeVault({ ...state, now: () => time });
    const other = new NativeVault({ ...state, now: () => time });
    const begun = await h.handle({
      id: 1,
      type: "beginLogin",
      site: SITE,
      persona: "alex",
      profile: "personal",
    });
    if (!begun.ok || begun.result.type !== "beginLogin") throw new Error("Expected token");
    const request = {
      id: 2,
      type: "capture",
      token: begun.result.token,
      message: { site: SITE, account: "alex", capturedAt: NOW, cookies: [cookie()] },
    };
    expect(await other.handle(request)).toMatchObject({ ok: false, error: "denied" });
    time += 300001;
    expect(await h.handle(request)).toMatchObject({ ok: false, error: "denied" });
  });
  it.each([
    { site: "https://other.test" },
    { account: "other" },
    { capturedAt: NOW + 30001 },
    { cookies: [{ ...cookie(), domain: "evil.shop.test" }] },
    { cookies: [{ ...cookie(), domain: "test", hostOnly: false }] },
  ])("rejects a mismatched or unsafe capture without a scheduler callback", async (changes) => {
    const { host: h, captured } = await host();
    const begun = await h.handle({
      id: 1,
      type: "beginLogin",
      site: SITE,
      persona: "alex",
      profile: "personal",
    });
    if (!begun.ok || begun.result.type !== "beginLogin") throw new Error("Expected token");
    const response = await h.handle({
      id: 2,
      type: "capture",
      token: begun.result.token,
      message: { site: SITE, account: "alex", capturedAt: NOW, cookies: [cookie()], ...changes },
    });
    expect(response).toMatchObject({ ok: false, error: "invalid" });
    expect(captured).not.toHaveBeenCalled();
    expect(JSON.stringify(response)).not.toContain(cookie().value);
  });
});
