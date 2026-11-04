// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ProviderEnvironment, zonedToUtc } from "../src/providers/common.js";
import {
  type AccessTokenProvider,
  CredentialError,
  HelperTokenProvider,
  loadProviderConfig,
  providerConfigSchema,
  runHelper,
} from "../src/providers/credentials.js";
import { GOOGLE_FREEBUSY_URL, googleFreeBusy } from "../src/providers/google.js";
import { microsoftCalendarView } from "../src/providers/microsoft.js";
import type { Transport } from "../src/providers.js";

// Synthetic data only; every test injects fetch — no network.
const WINDOW = { start: "2026-10-20T00:00:00Z", end: "2026-10-21T00:00:00Z" };
const at = () => "2026-10-19T08:00:00.000Z";
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
const tokens = (grantedScopes?: string[]): AccessTokenProvider => ({
  getAccessToken: vi.fn(async () => ({
    token: "test-token-123456",
    ...(grantedScopes ? { grantedScopes } : {}),
  })),
});
const env = (fetchImpl: Transport, t: AccessTokenProvider = tokens()): ProviderEnvironment => ({
  mode: "live",
  transport: fetchImpl,
  tokens: t,
});

describe("Google freeBusy adapter", () => {
  const ok = (calendars: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    vi.fn(async () => json({ timeMin: WINDOW.start, timeMax: WINDOW.end, calendars, ...over }));

  it("asks for busy time of every calendar at the fixed endpoint and keeps only busy intervals", async () => {
    const f = ok({
      primary: { busy: [{ start: "2026-10-19T23:00:00Z", end: "2026-10-20T01:00:00Z" }] },
      "team@example.org": { busy: [] },
    });
    const r = await googleFreeBusy(
      env(f),
      {
        connectionId: "g",
        calendarIds: ["primary", "team@example.org"],
        window: WINDOW,
      },
      at,
    );
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(GOOGLE_FREEBUSY_URL);
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-token-123456");
    expect(JSON.parse(String(init.body))).toMatchObject({
      timeMin: WINDOW.start,
      timeMax: WINDOW.end,
      items: [{ id: "primary" }, { id: "team@example.org" }],
    });
    // Clipped to the window.
    expect(r.get("primary")).toMatchObject({
      ok: true,
      busy: [{ start: "2026-10-20T00:00:00.000Z", end: "2026-10-20T01:00:00.000Z" }],
    });
    expect(r.get("team@example.org")).toMatchObject({ ok: true, busy: [] });
  });

  it.each([
    [{ primary: { errors: [{ domain: "global", reason: "notFound" }] } }, "needs-setup"],
    [{ primary: { errors: [{ domain: "global", reason: "internalError" }] } }, "blocked"],
    [{}, "blocked"],
    [
      { primary: { busy: [{ start: "2026-10-20T10:00:00Z", end: "2026-10-20T09:00:00Z" }] } },
      "blocked",
    ],
  ])("a per-calendar problem is never free (%j)", async (calendars, status) => {
    const r = await googleFreeBusy(
      env(ok(calendars)),
      { connectionId: "g", calendarIds: ["primary"], window: WINDOW },
      at,
    );
    expect(r.get("primary")).toMatchObject({ ok: false, status });
  });

  it("an answer for a different window blocks every calendar", async () => {
    const f = ok({ primary: { busy: [] } }, { timeMax: "2026-10-20T12:00:00Z" });
    const r = await googleFreeBusy(
      env(f),
      { connectionId: "g", calendarIds: ["primary"], window: WINDOW },
      at,
    );
    expect(r.get("primary")).toMatchObject({
      ok: false,
      status: "blocked",
      reason: expect.stringMatching(/different time window/),
    });
  });

  it.each([
    [401, "needs-setup", /expired or revoked/],
    [403, "needs-setup", /insufficient scope/],
    [429, "blocked", /rate limited/],
    [503, "blocked", /HTTP 503/],
  ])("HTTP %i fails closed as %s", async (status, expected, reason) => {
    const f = vi.fn(async () =>
      json({ error: { message: "secret detail test-token-123456" } }, { status }),
    );
    const r = await googleFreeBusy(
      env(f),
      { connectionId: "g", calendarIds: ["primary"], window: WINDOW },
      at,
    );
    const x = r.get("primary");
    expect(x).toMatchObject({ ok: false, status: expected, reason: expect.stringMatching(reason) });
    expect(JSON.stringify(x)).not.toContain("test-token-123456");
  });

  it("refuses to call Google when the granted scopes are insufficient", async () => {
    const f = ok({ primary: { busy: [] } });
    const r = await googleFreeBusy(
      env(f, tokens(["https://www.googleapis.com/auth/gmail.readonly"])),
      { connectionId: "g", calendarIds: ["primary"], window: WINDOW },
      at,
    );
    expect(r.get("primary")).toMatchObject({ ok: false, status: "needs-setup" });
    expect(f).not.toHaveBeenCalled();
    const minimal = await googleFreeBusy(
      env(f, tokens(["https://www.googleapis.com/auth/calendar.freebusy"])),
      { connectionId: "g", calendarIds: ["primary"], window: WINDOW },
      at,
    );
    expect(minimal.get("primary")).toMatchObject({ ok: true });
  });

  it("credential problems are needs-setup (revoked) or blocked (unavailable), never free", async () => {
    const failing = (code: "revoked" | "unavailable"): AccessTokenProvider => ({
      getAccessToken: async () => {
        throw new CredentialError(code, `helper says ${code}`);
      },
    });
    const f = ok({ primary: { busy: [] } });
    for (const [code, status] of [
      ["revoked", "needs-setup"],
      ["unavailable", "blocked"],
    ] as const) {
      const r = await googleFreeBusy(
        env(f, failing(code)),
        { connectionId: "g", calendarIds: ["primary"], window: WINDOW },
        at,
      );
      expect(r.get("primary")).toMatchObject({ ok: false, status });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("non-JSON, oversized, network errors and too many calendars block", async () => {
    const html = vi.fn(
      async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    const big = vi.fn(
      async () =>
        new Response(`{"x":"${"a".repeat(1_100_000)}"}`, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const down = vi.fn(async () => {
      throw new TypeError("connect ECONNREFUSED");
    });
    for (const f of [html, big, down]) {
      const r = await googleFreeBusy(
        env(f),
        { connectionId: "g", calendarIds: ["primary"], window: WINDOW },
        at,
      );
      expect(r.get("primary")).toMatchObject({ ok: false, status: "blocked" });
    }
    const many = Array.from({ length: 51 }, (_, i) => `c${i}`);
    const r = await googleFreeBusy(
      env(ok({})),
      { connectionId: "g", calendarIds: many, window: WINDOW },
      at,
    );
    expect(r.get("c0")).toMatchObject({ ok: false, status: "blocked" });
  });
});

describe("Microsoft calendarView adapter", () => {
  const ev = (
    showAs: string | null,
    start: string,
    end: string,
    extra: Record<string, unknown> = {},
  ) => ({
    ...(showAs === null ? {} : { showAs }),
    type: "singleInstance",
    subject: "PRIVATE TITLE",
    attendees: [{ emailAddress: { address: "someone@example.org" } }],
    start: { dateTime: `${start}.0000000`, timeZone: "UTC" },
    end: { dateTime: `${end}.0000000`, timeZone: "UTC" },
    ...extra,
  });

  function paged(pages: unknown[][]): ReturnType<typeof vi.fn> {
    return vi.fn(async (input: string | URL) => {
      const u = new URL(String(input));
      const n = Number(u.searchParams.get("page") ?? "0");
      const next = new URL(u);
      next.searchParams.set("page", String(n + 1));
      return json({
        value: pages[n] ?? [],
        ...(n + 1 < pages.length ? { "@odata.nextLink": next.toString() } : {}),
      });
    });
  }
  const view = (f: Transport, calendarId = "AAMkSecondary", t?: AccessTokenProvider) =>
    microsoftCalendarView(
      env(f, t),
      { connectionId: "m", calendarId, window: WINDOW, ownerTimeZone: "Europe/London" },
      at,
    );

  it("reads a secondary calendar with minimal fields, follows pages and treats only `free` as free", async () => {
    const f = paged([
      [
        ev("busy", "2026-10-20T09:00:00", "2026-10-20T10:00:00", { type: "occurrence" }),
        ev("free", "2026-10-20T10:00:00", "2026-10-20T11:00:00"),
        ev("busy", "2026-10-20T11:00:00", "2026-10-20T12:00:00", { isCancelled: true }),
      ],
      [
        ev("tentative", "2026-10-20T12:00:00", "2026-10-20T12:30:00"),
        ev("oof", "2026-10-20T13:00:00", "2026-10-20T13:30:00"),
        ev("unknown", "2026-10-20T14:00:00", "2026-10-20T14:30:00"),
      ],
      [
        ev("workingElsewhere", "2026-10-20T15:00:00", "2026-10-20T15:30:00"),
        ev(null, "2026-10-20T16:00:00", "2026-10-20T16:30:00"),
      ],
    ]);
    const r = await view(f as unknown as Transport);
    expect(f).toHaveBeenCalledTimes(3);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      "https://graph.microsoft.com/v1.0/me/calendars/AAMkSecondary/calendarView",
    );
    expect(u.searchParams.get("$select")).toBe("showAs,isAllDay,isCancelled,type,start,end");
    expect(u.searchParams.get("startDateTime")).toBe(WINDOW.start);
    expect((init.headers as Record<string, string>).prefer).toBe('outlook.timezone="UTC"');
    expect(r.ok && r.busy.map((b) => b.start.slice(11, 16))).toEqual([
      "09:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00",
    ]);
    // Nothing but intervals leaves the adapter.
    expect(JSON.stringify(r)).not.toMatch(/PRIVATE TITLE|someone@example\.org/);
  });

  it("uses the default calendar path for `primary`", async () => {
    const f = paged([[]]);
    await view(f as unknown as Transport, "primary");
    expect(new URL((f.mock.calls[0] as unknown as [string])[0]).pathname).toBe(
      "/v1.0/me/calendar/calendarView",
    );
  });

  it.each([
    "",
    ".",
    "..",
  ])("refuses an initial calendar identifier that loses its path: %j", async (id) => {
    const f = paged([[]]);
    const r = await view(f as unknown as Transport, id);
    expect(r).toMatchObject({
      ok: false,
      status: "blocked",
      reason: expect.stringMatching(/calendar.*path/),
    });
    expect(f).not.toHaveBeenCalled();
  });

  it.each([
    "AAMk+/=",
    "%2e",
    "%2E%2E",
    "calendar/../other?query#fragment",
  ])("preserves an encoded calendar identifier on the initial and paged requests: %j", async (id) => {
    const f = paged([[], []]);
    const r = await view(f as unknown as Transport, id);
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    for (const [url] of f.mock.calls as unknown as [string][])
      expect(new URL(url).pathname).toBe(
        `/v1.0/me/calendars/${encodeURIComponent(id)}/calendarView`,
      );
  });

  it("an all-day event blocks the owner's whole local day (DST-aware) and its literal interval", async () => {
    const f = paged([
      [ev("oof", "2026-10-20T00:00:00", "2026-10-21T00:00:00", { isAllDay: true })],
    ]);
    const r = await view(f as unknown as Transport);
    expect(r.ok).toBe(true);
    // London is UTC+1 on 20 October: the local day starts 23:00Z the day before (clipped to the window).
    expect(r.ok && r.busy).toContainEqual({
      start: "2026-10-20T00:00:00.000Z",
      end: "2026-10-20T23:00:00.000Z",
    });
    expect(r.ok && r.busy).toContainEqual({
      start: "2026-10-20T00:00:00.000Z",
      end: "2026-10-21T00:00:00.000Z",
    });
  });

  it("converts IANA zones and refuses to guess Windows zone names", async () => {
    const ny = paged([
      [
        {
          ...ev("busy", "2026-10-20T09:00:00", "2026-10-20T10:00:00"),
          start: { dateTime: "2026-10-20T09:00:00", timeZone: "America/New_York" },
          end: { dateTime: "2026-10-20T10:00:00", timeZone: "America/New_York" },
        },
      ],
    ]);
    const r = await view(ny as unknown as Transport);
    expect(r.ok && r.busy).toEqual([
      { start: "2026-10-20T13:00:00.000Z", end: "2026-10-20T14:00:00.000Z" },
    ]);
    const win = paged([
      [
        {
          ...ev("busy", "2026-10-20T09:00:00", "2026-10-20T10:00:00"),
          start: { dateTime: "2026-10-20T09:00:00", timeZone: "Pacific Standard Time" },
        },
      ],
    ]);
    expect(await view(win as unknown as Transport)).toMatchObject({
      ok: false,
      status: "blocked",
    });
  });

  it("refuses paging links elsewhere, too many pages, unreadable events and HTTP errors", async () => {
    const elsewhere = vi.fn(async () =>
      json({ value: [], "@odata.nextLink": "https://evil.example/v1.0/me/x" }),
    );
    expect(await view(elsewhere)).toMatchObject({
      ok: false,
      status: "blocked",
      reason: expect.stringMatching(/does not continue/),
    });
    // A link back to the same page is a loop (refused), not an endless read.
    const loop = vi.fn(async (input: string | URL) =>
      json({ value: [], "@odata.nextLink": String(input) }),
    );
    expect(await view(loop as unknown as Transport)).toMatchObject({ ok: false });
    expect(loop).toHaveBeenCalledTimes(1);
    // Distinct pages beyond the bound.
    const endless = vi.fn(async (input: string | URL) => {
      const u = new URL(String(input));
      u.searchParams.set("page", String(Number(u.searchParams.get("page") ?? "0") + 1));
      return json({ value: [], "@odata.nextLink": u.toString() });
    });
    expect(await view(endless as unknown as Transport)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/pages/),
    });
    const bad = paged([[{ showAs: "busy", start: { dateTime: "yesterday", timeZone: "UTC" } }]]);
    expect(await view(bad as unknown as Transport)).toMatchObject({
      ok: false,
      status: "blocked",
    });
    for (const [status, expected] of [
      [401, "needs-setup"],
      [403, "needs-setup"],
      [404, "blocked"],
      [500, "blocked"],
    ] as const) {
      const f = vi.fn(async () => json({}, { status }));
      expect(await view(f)).toMatchObject({ ok: false, status: expected });
    }
  });

  it("checks the granted Microsoft scopes before calling", async () => {
    const f = paged([[]]);
    expect(await view(f as unknown as Transport, "primary", tokens(["Mail.Read"]))).toMatchObject({
      ok: false,
      status: "needs-setup",
    });
    expect(f).not.toHaveBeenCalled();
    expect(
      await view(
        f as unknown as Transport,
        "primary",
        tokens(["https://graph.microsoft.com/Calendars.ReadBasic"]),
      ),
    ).toMatchObject({ ok: true });
  });
});

describe("time zones", () => {
  it("converts wall-clock time in an IANA zone across the DST change", () => {
    expect(new Date(zonedToUtc("2026-10-24", 9 * 60, "Europe/London")).toISOString()).toBe(
      "2026-10-24T08:00:00.000Z",
    );
    expect(new Date(zonedToUtc("2026-10-26", 9 * 60, "Europe/London")).toISOString()).toBe(
      "2026-10-26T09:00:00.000Z",
    );
    expect(new Date(zonedToUtc("2026-11-02", 9 * 60, "America/New_York")).toISOString()).toBe(
      "2026-11-02T14:00:00.000Z",
    );
  });
});

describe("credential supply (separable, no stored tokens)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "awp-cred-test-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const config = (credential: unknown, mode = 0o600) => {
    const path = join(dir, "providers.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        accounts: [{ connectionId: "acct-g", provider: "google", credential }],
      }),
    );
    chmodSync(path, mode);
    return path;
  };

  it("refuses configuration holding credentials, relative commands or loose permissions", () => {
    expect(
      () =>
        config({ type: "helper", command: process.execPath, args: [], refresh_token: "x" }) &&
        loadProviderConfig(join(dir, "providers.json")),
    ).toThrow(/must not contain credentials/);
    expect(() =>
      loadProviderConfig(config({ type: "helper", command: "helper", args: [] })),
    ).toThrow();
    expect(() =>
      loadProviderConfig(config({ type: "helper", command: process.execPath, args: [] }, 0o666)),
    ).toThrow(/writable/);
    expect(
      loadProviderConfig(config({ type: "helper", command: process.execPath, args: [] })).accounts,
    ).toHaveLength(1);
  });

  it("rejects duplicate mappings on load and refuses ambiguous lookups before invoking a helper", async () => {
    const marker = join(dir, "helper-ran");
    const entry = {
      connectionId: "acct-g",
      provider: "google" as const,
      credential: {
        type: "helper" as const,
        command: process.execPath,
        args: ["-e", `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`],
      },
    };
    const duplicated = { version: 1 as const, accounts: [entry, entry] };
    const path = join(dir, "duplicates.json");
    writeFileSync(path, JSON.stringify(duplicated), { mode: 0o600 });
    expect(() => loadProviderConfig(path)).toThrow(/duplicate/);
    await expect(
      new HelperTokenProvider(duplicated).getAccessToken({
        provider: "google",
        connectionId: "acct-g",
        scopes: [],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(existsSync(marker)).toBe(false);
    // The key includes both provider and connection; neither alone makes a duplicate.
    expect(
      providerConfigSchema.parse({
        version: 1,
        accounts: [entry, { ...entry, connectionId: "other" }, { ...entry, provider: "microsoft" }],
      }).accounts,
    ).toHaveLength(3);
  });

  it("runs the operator's helper without a shell and maps its answers", async () => {
    const helper = (body: string) => {
      const p = join(dir, `helper-${Math.random().toString(36).slice(2)}.mjs`);
      writeFileSync(p, body);
      return new HelperTokenProvider(
        loadProviderConfig(config({ type: "helper", command: process.execPath, args: [p] })),
      );
    };
    const good = helper(
      'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);process.stdout.write(JSON.stringify({access_token:"tok-"+r.connectionId+"-0123456789",scope:r.scopes.join(" ")}))})',
    );
    const t = await good.getAccessToken({
      provider: "google",
      connectionId: "acct-g",
      scopes: ["https://www.googleapis.com/auth/calendar.freebusy"],
    });
    expect(t).toEqual({
      token: "tok-acct-g-0123456789",
      grantedScopes: ["https://www.googleapis.com/auth/calendar.freebusy"],
    });
    await expect(
      helper("process.exit(3)").getAccessToken({
        provider: "google",
        connectionId: "acct-g",
        scopes: [],
      }),
    ).rejects.toMatchObject({ code: "revoked" });
    await expect(
      helper("process.stdout.write('nope')").getAccessToken({
        provider: "google",
        connectionId: "acct-g",
        scopes: [],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      good.getAccessToken({ provider: "microsoft", connectionId: "acct-g", scopes: [] }),
    ).rejects.toMatchObject({ code: "not-configured" });
    for (const expiry of ["tomorrow", "2026", "2026-02-30T10:00:00Z"])
      await expect(
        helper(
          `process.stdout.write(JSON.stringify({access_token:"tok-0123456789",expires_at:${JSON.stringify(expiry)}}))`,
        ).getAccessToken({ provider: "google", connectionId: "acct-g", scopes: [] }),
      ).rejects.toMatchObject({ code: "invalid" });
  });

  it("settles once with a typed error when the helper exits early, hangs or floods", async () => {
    const script = (body: string) => {
      const p = join(dir, `h-${Math.random().toString(36).slice(2)}.mjs`);
      writeFileSync(p, body);
      return p;
    };
    // Closes its stdin before we write (EPIPE on our side), then fails.
    await expect(
      runHelper(
        process.execPath,
        [
          script(
            'import {closeSync} from "fs"; closeSync(0); setTimeout(() => process.exit(1), 100);',
          ),
        ],
        { big: "x".repeat(200_000) },
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
    // Exits 0 without reading or answering: an unusable (empty) answer, not a crash.
    await expect(runHelper(process.execPath, [script("process.exit(0)")], {})).resolves.toBe("");
    const hang = Date.now();
    await expect(
      runHelper(process.execPath, [script("setInterval(() => {}, 1000)")], {}, 300),
    ).rejects.toMatchObject({ code: "unavailable", message: expect.stringMatching(/in time/) });
    expect(Date.now() - hang).toBeLessThan(5000);
    await expect(
      runHelper(process.execPath, [script('process.stdout.write("x".repeat(100000))')], {}),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(runHelper("/nonexistent/helper", [], {})).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});

describe("review counterexamples (independently reproduced) and related boundaries", () => {
  // The reviewer's window.
  const W = { start: "2026-10-19T08:00:00Z", end: "2026-10-20T18:00:00Z" };
  const Graph = "https://graph.microsoft.com";
  const msEvent = (start: string, end: string, extra: Record<string, unknown> = {}) => ({
    showAs: "busy",
    type: "singleInstance",
    start: { dateTime: start, timeZone: "UTC" },
    end: { dateTime: end, timeZone: "UTC" },
    ...extra,
  });
  const google = (calendars: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    googleFreeBusy(
      env(vi.fn(async () => json({ timeMin: W.start, timeMax: W.end, calendars, ...over }))),
      { connectionId: "g", calendarIds: ["primary"], window: W },
      at,
    ).then((r) => r.get("primary"));
  const graph = (f: Transport, calendarId = "primary") =>
    microsoftCalendarView(
      env(f),
      { connectionId: "m", calendarId, window: W, ownerTimeZone: "Europe/London" },
      at,
    );

  it("(a) a Google entry without a busy list is blocked; an explicit empty list is free", async () => {
    expect(await google({ primary: {} })).toMatchObject({
      ok: false,
      status: "blocked",
      reason: expect.stringMatching(/incomplete/),
    });
    expect(await google({ primary: { busy: [] } })).toMatchObject({ ok: true, busy: [] });
  });

  it("Google times must be strict RFC 3339 with real calendar values", async () => {
    for (const bad of [
      "2026",
      "2026-02-30T10:00:00Z",
      "2026-10-20T25:00:00Z",
      "2026-10-20 10:00:00Z",
    ])
      expect(
        await google({ primary: { busy: [{ start: bad, end: "2026-10-20T11:00:00Z" }] } }),
      ).toMatchObject({ ok: false, status: "blocked" });
    expect(await google({ primary: { busy: [] } }, { timeMin: "2026" })).toMatchObject({
      ok: false,
    });
    // Offsets are honoured.
    expect(
      await google({
        primary: {
          busy: [{ start: "2026-10-20T10:00:00+01:00", end: "2026-10-20T11:00:00+01:00" }],
        },
      }),
    ).toMatchObject({
      ok: true,
      busy: [{ start: "2026-10-20T09:00:00.000Z", end: "2026-10-20T10:00:00.000Z" }],
    });
  });

  it("(b) a same-origin nextLink to a different calendar is refused without fetching it", async () => {
    const f = vi.fn(async () =>
      json({
        value: [],
        "@odata.nextLink": `${Graph}/v1.0/me/calendars/UNSELECTED/calendarView?startDateTime=${W.start}&endDateTime=${W.end}`,
      }),
    );
    expect(await graph(f)).toMatchObject({ ok: false, status: "blocked" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["another resource", `${Graph}/v1.0/me/messages?startDateTime=S&endDateTime=E`],
    [
      "credentials in the URL",
      `https://user:pw@graph.microsoft.com/v1.0/me/calendar/calendarView?startDateTime=S&endDateTime=E`,
    ],
    ["a fragment", `${Graph}/v1.0/me/calendar/calendarView?startDateTime=S&endDateTime=E#x`],
    [
      "a different window",
      `${Graph}/v1.0/me/calendar/calendarView?startDateTime=2026-01-01T00:00:00Z&endDateTime=E`,
    ],
    ["no window", `${Graph}/v1.0/me/calendar/calendarView?$skip=200`],
    ["a relative link", "/v1.0/me/calendar/calendarView?startDateTime=S&endDateTime=E"],
  ])("a nextLink with %s is refused", async (_name, link) => {
    const f = vi.fn(async () =>
      json({
        value: [],
        "@odata.nextLink": link.replace("=S", `=${W.start}`).replace("=E", `=${W.end}`),
      }),
    );
    expect(await graph(f)).toMatchObject({ ok: false, status: "blocked" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("(c) a backwards all-day range is blocked, as are other malformed events", async () => {
    const one = (e: unknown) => vi.fn(async () => json({ value: [e] }));
    expect(
      await graph(
        one(
          msEvent("2026-10-20T00:00:00.0000000", "2026-10-19T00:00:00.0000000", { isAllDay: true }),
        ),
      ),
    ).toMatchObject({
      ok: false,
      status: "blocked",
      reason: expect.stringMatching(/does not end after/),
    });
    for (const e of [
      msEvent("2026-02-30T09:00:00", "2026-02-30T10:00:00"),
      msEvent("2026-10-20T24:00:00", "2026-10-20T25:00:00"),
      msEvent("2026-10-20T09:00:00", "2026-10-20T09:00:00"),
      msEvent("2026-10-20T09:00:00", "2026-10-20T10:00:00", { type: "seriesMaster" }),
      msEvent("2026-10-20T00:00:00", "2028-01-01T00:00:00", { isAllDay: true }),
    ])
      expect(await graph(one(e))).toMatchObject({ ok: false, status: "blocked" });
  });

  it("DST-skipped wall times are not guessed; repeated ones are widened to cover both instants", async () => {
    const ny = (start: string, end: string) =>
      vi.fn(async () =>
        json({
          value: [
            {
              showAs: "busy",
              start: { dateTime: start, timeZone: "America/New_York" },
              end: { dateTime: end, timeZone: "America/New_York" },
            },
          ],
        }),
      );
    // 02:30 on 8 March 2026 does not exist in New York.
    const skipped = await microsoftCalendarView(
      env(ny("2026-03-08T02:30:00", "2026-03-08T03:30:00")),
      {
        connectionId: "m",
        calendarId: "primary",
        window: { start: "2026-03-08T00:00:00Z", end: "2026-03-09T00:00:00Z" },
        ownerTimeZone: "UTC",
      },
      at,
    );
    expect(skipped).toMatchObject({ ok: false, status: "blocked" });
    // 01:30 on 1 November 2026 happens twice: start at the earlier, end at the later instant.
    const repeated = await microsoftCalendarView(
      env(ny("2026-11-01T01:30:00", "2026-11-01T01:45:00")),
      {
        connectionId: "m",
        calendarId: "primary",
        window: { start: "2026-11-01T00:00:00Z", end: "2026-11-02T00:00:00Z" },
        ownerTimeZone: "UTC",
      },
      at,
    );
    expect(repeated).toMatchObject({
      ok: true,
      busy: [{ start: "2026-11-01T05:30:00.000Z", end: "2026-11-01T06:45:00.000Z" }],
    });
  });

  it("the adapter boundary refuses malformed or expired token expiry from any credential provider", async () => {
    const withExpiry = (expiresAt: string): AccessTokenProvider => ({
      getAccessToken: async () => ({ token: "test-token-123456", expiresAt }),
    });
    const f = vi.fn(async () =>
      json({ timeMin: W.start, timeMax: W.end, calendars: { primary: { busy: [] } } }),
    );
    for (const [expiresAt, status] of [
      ["not a date", "blocked"],
      ["2026", "blocked"],
      ["2000-01-01T00:00:00Z", "needs-setup"],
    ] as const) {
      const r = await googleFreeBusy(
        env(f, withExpiry(expiresAt)),
        { connectionId: "g", calendarIds: ["primary"], window: W },
        at,
      );
      expect(r.get("primary")).toMatchObject({ ok: false, status });
    }
    expect(f).not.toHaveBeenCalled();
  });
});
