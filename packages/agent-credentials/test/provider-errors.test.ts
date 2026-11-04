// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import type { JWTPayload } from "jose";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, expect, it, vi } from "vitest";
import type { ProviderEnvironment } from "../src/providers/common.js";
import {
  fetchJson,
  ProviderCallError,
  parseRfc3339,
  parseWallClock,
  tokenFor,
  zonedToUtcChecked,
} from "../src/providers/common.js";
import { CredentialError, HelperTokenProvider } from "../src/providers/credentials.js";
import { googleFreeBusy } from "../src/providers/google.js";
import { microsoftCalendarView } from "../src/providers/microsoft.js";
import { providerEnvironment } from "../src/providers/setup.js";
import { localParts } from "../src/providers/time.js";
import {
  authorizationUrl,
  call,
  GOOGLE,
  idTokenClaimProblem,
  listCalendars,
  MICROSOFT,
  noTransport,
  refresh,
  revokeGoogle,
  tenantMatches,
  verifyIdentity,
} from "../src/providers.js";
import type { Profile } from "../src/store.js";
import { fixtureFetch, fixtureProviders, fixtureTokens } from "../src/testing.js";

const instant = new Date("2026-10-26T00:00:00Z");
const p: Profile = {
  version: 1,
  name: "fixture",
  provider: "google",
  purpose: "read",
  resource: "calendar",
  account: "owner@example.org",
  connectionId: "owner",
  inventory: true,
  createdAt: instant.toISOString(),
};
const client = { clientId: "fixture.apps.googleusercontent.com" };
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const timeWindow = { start: "2026-10-19T00:00:00Z", end: "2026-10-30T00:00:00Z" };
afterEach(() => vi.restoreAllMocks());
it("refuses unavailable transports, malformed URLs, unexpected origins and broken response bodies", async () => {
  await expect(noTransport(GOOGLE.token, {})).rejects.toThrow(/no provider transport/);
  const transport = vi.fn(async () => json({}));
  for (const url of [
    "invalid",
    "https://user:password@oauth2.googleapis.com/token",
    `${GOOGLE.token}#fragment`,
  ])
    await expect(call(transport, url, {}, "test")).rejects.toThrow(/not a URL/);
  await expect(call(transport, "https://evil.example/token", {}, "test")).rejects.toThrow(
    /not an allowed/,
  );
  expect(transport).not.toHaveBeenCalled();
  await expect(
    call(
      async () => {
        throw new Error("test-secret");
      },
      GOOGLE.token,
      {},
      "test",
    ),
  ).rejects.toThrow(/could not be reached/);
  await expect(
    call(async () => new Response("x".repeat(256 * 1024 + 1)), GOOGLE.token, {}, "test"),
  ).rejects.toThrow(/too large/);
  await expect(
    call(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("test-secret"));
            },
          }),
        ),
      GOOGLE.token,
      {},
      "test",
    ),
  ).rejects.toThrow(/could not be read/);
  await expect(
    call(async () => new Response("not JSON", { status: 401 }), GOOGLE.token, {}, "test"),
  ).rejects.toThrow(/unreadable/);
});
it("refuses malformed OAuth profiles and token endpoint failures", async () => {
  expect(tenantMatches("organizations", MICROSOFT.CONSUMERS_TID)).toBe(false);
  expect(tenantMatches("organizations", "not-a-uuid")).toBe(false);
  expect(tenantMatches("organizations", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBe(true);
  const ms = { ...p, provider: "microsoft" as const };
  expect(() =>
    authorizationUrl(ms, client, {
      state: "x",
      nonce: "x",
      redirectUri: "http://127.0.0.1",
      challenge: "x",
    }),
  ).toThrow(/no account type/);
  for (const [status, answer, problem] of [
    [400, {}, /HTTP 400/],
    [429, { error: "rate_limit" }, /unavailable/],
    [503, {}, /unavailable/],
  ] as const)
    await expect(
      refresh(async () => json(answer, status), p, client, "test-refresh-0123456789"),
    ).rejects.toThrow(problem);
});
it("rejects every invalid mandatory ID-token claim before it can become an account binding", () => {
  const t = instant.getTime() / 1000;
  const good = { exp: t + 3600, iat: t, sub: "fixture-sub", aud: client.clientId };
  expect(idTokenClaimProblem(good, client.clientId, instant)).toBeUndefined();
  for (const [claims, message] of [
    [{ ...good, exp: undefined }, "exp"],
    [{ ...good, iat: undefined }, "iat"],
    [{ ...good, exp: t }, "after"],
    [{ ...good, exp: t + 86401 }, "long"],
    [{ ...good, iat: t + 61 }, "future"],
    [{ ...good, exp: t - 61, iat: t - 100 }, "expired"],
    [{ ...good, sub: "" }, "sub"],
    [{ ...good, aud: undefined }, "client"],
    [{ ...good, aud: [client.clientId, "other"] }, "azp"],
    [{ ...good, azp: "other" }, "party"],
  ] as const)
    expect(idTokenClaimProblem(claims as JWTPayload, client.clientId, instant)).toContain(message);
});
it.each([
  null,
  7,
  ["openid"],
  "x".repeat(4001),
])("refuses malformed scope fields instead of applying omitted-scope defaults: %j", async (scope) => {
  await expect(
    refresh(
      async () =>
        json({
          access_token: "test-token-0123456789",
          expires_in: 3600,
          token_type: "Bearer",
          scope,
        }),
      p,
      client,
      "test-refresh-0123456789",
    ),
  ).rejects.toThrow(/unexpected token answer shape/);
});
it("refuses missing or malformed ID tokens and missing signing keys", async () => {
  for (const jwt of [undefined, "not-a-jwt"])
    await expect(
      verifyIdentity(noTransport, p, client, jwt, "nonce", undefined, instant),
    ).rejects.toThrow(/ID token/);
  const jwt = [
    Buffer.from("{}").toString("base64url"),
    Buffer.from("{}").toString("base64url"),
    "signature",
  ].join(".");
  await expect(
    verifyIdentity(async () => json({}, 503), p, client, jwt, "nonce", undefined, instant),
  ).rejects.toThrow(/signing keys/);
  await expect(
    verifyIdentity(
      noTransport,
      { ...p, provider: "microsoft" },
      client,
      jwt,
      "nonce",
      undefined,
      instant,
    ),
  ).rejects.toThrow(/no tenant/);
});
it("bounds inventory paging and maps revocation failures without exposing response bodies", async () => {
  for (const [status, expected] of [
    [401, /refused/],
    [403, /scope/],
    [500, /unexpected/],
  ] as const)
    await expect(
      listCalendars(async () => json({}, status), p, "test-token-0123456789"),
    ).rejects.toThrow(expected);
  expect(await listCalendars(async () => json({}), p, "test-token-0123456789")).toEqual([]);
  expect(
    await listCalendars(
      async () => json({ items: [{ id: "fixture" }] }),
      p,
      "test-token-0123456789",
    ),
  ).toEqual([{ id: "fixture", name: "", accessRole: "unknown", primary: false }]);
  await expect(
    listCalendars(async () => json({ nextPageToken: "more" }), p, "test-token-0123456789"),
  ).rejects.toThrow(/too many pages/);
  const ms = { ...p, provider: "microsoft" as const };
  for (const [status, expected] of [
    [401, /refused/],
    [500, /unexpected/],
  ] as const)
    await expect(
      listCalendars(async () => json({}, status), ms, "test-token-0123456789"),
    ).rejects.toThrow(expected);
  expect(
    await listCalendars(
      async () => json({ value: [{ id: "fixture", canEdit: false }] }),
      ms,
      "test-token-0123456789",
    ),
  ).toEqual([{ id: "fixture", name: "", accessRole: "read", primary: false }]);
  await expect(
    listCalendars(
      async () => json({ value: [], "@odata.nextLink": "https://evil.example/page" }),
      ms,
      "test-token-0123456789",
    ),
  ).rejects.toThrow(/paging/);
  await expect(
    listCalendars(
      async () => json({ value: [], "@odata.nextLink": `${MICROSOFT.graph}/v1.0/me/calendars` }),
      ms,
      "test-token-0123456789",
    ),
  ).rejects.toThrow(/too many pages/);
  await expect(
    revokeGoogle(async () => new Response(""), "test-token-0123456789"),
  ).resolves.toBeUndefined();
  await expect(
    revokeGoogle(async () => json({}), "test-token-0123456789"),
  ).resolves.toBeUndefined();
  await expect(revokeGoogle(async () => json({}, 400), "test-token-0123456789")).rejects.toThrow(
    /revocation failed/,
  );
  await expect(revokeGoogle(noTransport, "test-token-0123456789")).rejects.toThrow(/reached/);
});
it("configures synthetic providers and defaults to no access without a transport", async () => {
  const none = providerEnvironment({});
  expect(none.configuredConnections).toEqual([]);
  await expect(none.providers.transport("https://evil.example", {})).rejects.toThrow(
    /not configured/,
  );
  expect(() => providerEnvironment({ fixtures: true, configPath: "fixture" })).toThrow(/either/);
  const fixtures = providerEnvironment({ fixtures: true });
  expect(fixtures.providers.mode).toBe("fixture");
  const base = mkdtempSync(join(tmpdir(), "credentials-setup-"));
  try {
    const path = join(base, "config.json");
    writeFileSync(path, JSON.stringify({ version: 1, accounts: [] }), { mode: 0o600 });
    const configured = providerEnvironment({ configPath: path });
    expect(configured.providers.mode).toBe("live");
    await expect(configured.providers.transport(GOOGLE.token, {})).rejects.toThrow(
      /no provider transport/,
    );
    expect(
      providerEnvironment({ configPath: path, transport: fixtureFetch }).providers.transport,
    ).toBe(fixtureFetch);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
it("testing fixtures exercise calendar paging and unknown calendars entirely in process", async () => {
  const env = fixtureProviders();
  const g = await googleFreeBusy(
    env,
    {
      connectionId: "owner",
      calendarIds: ["primary", "family-fixture@example.org", "absent"],
      window: timeWindow,
    },
    () => instant.toISOString(),
  );
  expect(g.get("primary")).toMatchObject({ ok: true });
  expect(g.get("absent")).toMatchObject({ ok: false });
  for (const calendarId of ["primary", "AAMkFixtureSecondary"])
    expect(
      await microsoftCalendarView(
        env,
        { connectionId: "owner", calendarId, window: timeWindow, ownerTimeZone: "Europe/London" },
        () => instant.toISOString(),
      ),
    ).toMatchObject({ ok: true });
  expect(
    await microsoftCalendarView(
      env,
      { connectionId: "owner", calendarId: "absent", window: timeWindow, ownerTimeZone: "UTC" },
      () => instant.toISOString(),
    ),
  ).toMatchObject({ ok: false });
  expect((await fixtureFetch("https://evil.example/", {})).status).toBe(404);
  expect((await fixtureFetch("https://graph.microsoft.com/other/calendarView", {})).status).toBe(
    200,
  );
  expect(
    (await fixtureFetch("https://www.googleapis.com/calendar/v3/freeBusy", { method: "GET" }))
      .status,
  ).toBe(404);
  expect(
    (await fixtureTokens.getAccessToken({ provider: "google", connectionId: "owner", scopes: [] }))
      .grantedScopes,
  ).toBeDefined();
});
it("rejects malformed token providers, expiries, stream failures and time values", async () => {
  const env = (token: unknown): ProviderEnvironment => ({
    mode: "fixture",
    transport: noTransport,
    tokens: {
      getAccessToken: async () =>
        token as {
          token: string;
        },
    },
  });
  await expect(tokenFor(env({ token: "bad" }), "google", "owner", [], [])).rejects.toThrow(
    /unusable/,
  );
  await expect(
    tokenFor(
      env({ token: "test-token-0123456789", expiresAt: "invalid" }),
      "google",
      "owner",
      [],
      [],
    ),
  ).rejects.toThrow(/invalid expiry/);
  const thrown: ProviderEnvironment = {
    mode: "fixture",
    transport: noTransport,
    tokens: {
      getAccessToken: async () => {
        throw new Error("test-secret");
      },
    },
  };
  await expect(tokenFor(thrown, "google", "owner", [], [])).rejects.toThrow(/provider failed/);
  const unavailable: ProviderEnvironment = {
    mode: "fixture",
    transport: noTransport,
    tokens: {
      getAccessToken: async () => {
        throw new CredentialError("unavailable", "unavailable");
      },
    },
  };
  await expect(tokenFor(unavailable, "google", "owner", [], [])).rejects.toMatchObject({
    status: "blocked",
  });
  const readError = new Response(
    new ReadableStream({
      start(c) {
        c.error(new Error("test-secret"));
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
  await expect(
    fetchJson(
      { mode: "fixture", transport: async () => readError },
      "https://fixture.example",
      {},
      "test",
    ),
  ).rejects.toThrow(/could not be read/);
  const bodyless = new Response(null, { status: 401 });
  await expect(
    fetchJson(
      { mode: "fixture", transport: async () => bodyless },
      "https://fixture.example",
      {},
      "test",
    ),
  ).rejects.toThrow(/rejected/);
  const noType = new Response(null);
  await expect(
    fetchJson(
      { mode: "fixture", transport: async () => noType },
      "https://fixture.example",
      {},
      "test",
    ),
  ).rejects.toThrow(/not JSON/);
  const noBody = new Response(null, { headers: { "content-type": "application/json" } });
  await expect(
    fetchJson(
      { mode: "fixture", transport: async () => noBody },
      "https://fixture.example",
      {},
      "test",
    ),
  ).rejects.toThrow(/could not be read/);
  for (const t of [
    "2026-01-01T12:00:00Z",
    "2026-01-01T12:00:00.1+01:00",
    "2026-02-30T12:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T12:60:00Z",
    "2026-01-01T12:00:60Z",
    "2026-01-01T12:00:00+24:00",
    "2026-01-01T12:00:00+01:60",
    "2026-01-01T12:00:00z",
  ])
    expect(parseRfc3339(t) === undefined).toBe(
      !["2026-01-01T12:00:00Z", "2026-01-01T12:00:00.1+01:00", "2026-01-01T12:00:00z"].includes(t),
    );
  expect(parseWallClock("invalid")).toBeUndefined();
  expect(parseWallClock("2026-01-01T12:30")).toEqual({ date: "2026-01-01", minutes: 750, ms: 0 });
  expect(parseWallClock("2026-01-01T12:30:30.5")?.ms).toBe(30500);
  expect(zonedToUtcChecked("2026-03-29", 90, "Europe/London", "earliest")).toBeUndefined();
  expect(localParts(instant, "UTC")).toMatchObject({ date: "2026-10-26", minutes: 0 });
});
it("calendar adapters fail closed for unknown token errors, budgets, unbounded or malformed events", async () => {
  const broken: ProviderEnvironment = {
    mode: "fixture",
    transport: noTransport,
    tokens: {
      getAccessToken: async () => {
        throw new Error("test-secret");
      },
    },
  };
  // Exercise the outer adapter boundary by making the injected contract itself malformed.
  const bad: ProviderEnvironment = {
    ...broken,
    tokens: {
      getAccessToken: async () => {
        throw new ProviderCallError("blocked", "bad");
      },
    },
  };
  expect(
    await googleFreeBusy(
      bad,
      { connectionId: "owner", calendarIds: ["primary"], window: timeWindow },
      () => instant.toISOString(),
    ),
  ).toBeInstanceOf(Map);
  const goodEnv = (value: unknown): ProviderEnvironment => ({
    ...fixtureProviders(),
    transport: async () => json(value),
  });
  expect(
    await microsoftCalendarView(
      goodEnv({ value: [] }),
      {
        connectionId: "owner",
        calendarId: "primary",
        window: timeWindow,
        ownerTimeZone: "UTC",
        deadline: 0,
      },
      () => instant.toISOString(),
    ),
  ).toMatchObject({ ok: false, reason: expect.stringContaining("budget") });
  expect(
    await microsoftCalendarView(
      goodEnv({ value: Array(1000).fill({}) }),
      { connectionId: "owner", calendarId: "primary", window: timeWindow, ownerTimeZone: "UTC" },
      () => instant.toISOString(),
    ),
  ).toMatchObject({ ok: false, reason: expect.stringContaining("unreadable event") });
  const event = {
    showAs: "busy",
    start: { dateTime: "2026-10-20T08:00:00", timeZone: "UTC" },
    end: { dateTime: "2026-10-20T09:00:00", timeZone: "UTC" },
  };
  const pages: ProviderEnvironment = {
    ...fixtureProviders(),
    transport: async (url) => {
      const u = new URL(url);
      u.searchParams.set("page", String(Number(u.searchParams.get("page") ?? 0) + 1));
      return json({ value: Array(1000).fill(event), "@odata.nextLink": u.toString() });
    },
  };
  expect(
    await microsoftCalendarView(
      pages,
      { connectionId: "owner", calendarId: "primary", window: timeWindow, ownerTimeZone: "UTC" },
      () => instant.toISOString(),
    ),
  ).toMatchObject({ ok: false, reason: expect.stringContaining("5000") });
  const midnightGap = {
    ...event,
    isAllDay: true,
    start: { dateTime: "2026-03-08T00:00:00", timeZone: "UTC" },
    end: { dateTime: "2026-03-09T00:00:00", timeZone: "UTC" },
  };
  expect(
    await microsoftCalendarView(
      goodEnv({ value: [midnightGap] }),
      {
        connectionId: "owner",
        calendarId: "primary",
        window: timeWindow,
        ownerTimeZone: "America/Havana",
      },
      () => instant.toISOString(),
    ),
  ).toMatchObject({ ok: false });
});
it("fails closed when provider contracts throw outside their methods or the clock parser fails", async () => {
  const broken: ProviderEnvironment = {
    mode: "fixture",
    transport: noTransport,
    get tokens(): import("../src/providers/credentials.js").AccessTokenProvider {
      throw new Error("test-secret");
    },
  };
  expect(
    (
      await googleFreeBusy(
        broken,
        { connectionId: "owner", calendarIds: ["primary"], window: timeWindow },
        () => instant.toISOString(),
      )
    ).get("primary"),
  ).toMatchObject({ ok: false, reason: "Google freeBusy failed" });
  expect(
    await microsoftCalendarView(
      broken,
      { connectionId: "owner", calendarId: "primary", window: timeWindow, ownerTimeZone: "UTC" },
      () => instant.toISOString(),
    ),
  ).toMatchObject({ ok: false, reason: "Microsoft token acquisition failed" });
  const absent: ProviderEnvironment = { mode: "fixture", transport: noTransport };
  await expect(tokenFor(absent, "google", "owner", [], [])).rejects.toThrow(/no credential/);
  const valid: ProviderEnvironment = {
    ...absent,
    tokens: {
      getAccessToken: async () => ({
        token: "test-token-0123456789",
        expiresAt: "2099-01-01T00:00:00Z",
      }),
    },
  };
  expect(await tokenFor(valid, "google", "owner", [], [])).toBe("test-token-0123456789");
  for (const name of ["TimeoutError", "AbortError"])
    await expect(
      fetchJson(
        {
          ...absent,
          transport: async () => {
            throw Object.assign(new Error("test-secret"), { name });
          },
        },
        "https://fixture.example",
        {},
        "test",
      ),
    ).rejects.toThrow(/no answer/);
  const event = {
    showAs: "busy",
    start: { dateTime: "2026-10-20T08:00:00", timeZone: "UTC" },
    end: { dateTime: "2026-10-20T09:00:00", timeZone: "UTC" },
  };
  expect(
    await microsoftCalendarView(
      { ...fixtureProviders(), transport: async () => json({ value: [event] }) },
      {
        connectionId: "owner",
        calendarId: "primary",
        window: timeWindow,
        ownerTimeZone: "UTC",
        get deadline(): number {
          throw new Error("test-secret");
        },
      },
      () => instant.toISOString(),
    ),
  ).toMatchObject({ ok: false, reason: "Microsoft calendarView failed" });
  const parse = vi.spyOn(Date, "parse").mockReturnValueOnce(Number.NaN);
  expect(parseRfc3339("2026-10-26T00:00:00Z")).toBeUndefined();
  parse.mockRestore();
  // An unavailable Intl implementation must not turn an all-day event into free time.
  vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue([]);
  expect(
    await microsoftCalendarView(
      {
        ...fixtureProviders(),
        transport: async () =>
          json({
            value: [
              {
                ...event,
                isAllDay: true,
                start: { dateTime: "2026-10-20T00:00:00", timeZone: "UTC" },
                end: { dateTime: "2026-10-21T00:00:00", timeZone: "UTC" },
              },
            ],
          }),
      },
      {
        connectionId: "owner",
        calendarId: "primary",
        window: timeWindow,
        ownerTimeZone: "Europe/London",
      },
      () => instant.toISOString(),
    ),
  ).toMatchObject({ ok: false });
});
it("handles incomplete helper answers and signal exits without echoing output", async () => {
  const config = {
    version: 1 as const,
    accounts: [
      {
        connectionId: "owner",
        provider: "google" as const,
        credential: {
          type: "helper" as const,
          command: process.execPath,
          args: [
            "-e",
            'process.stdout.write(JSON.stringify({access_token:"test-token-0123456789",expires_at:"2099-01-01T00:00:00Z"}))',
          ],
        },
      },
    ],
  };
  expect(
    await new HelperTokenProvider(config).getAccessToken({
      provider: "google",
      connectionId: "owner",
      scopes: [],
      purpose: "read",
    }),
  ).toMatchObject({ token: "test-token-0123456789", expiresAt: "2099-01-01T00:00:00Z" });
  fixtureValue(config.accounts[0]).credential.args = [
    "-e",
    'process.stdout.write(JSON.stringify({access_token:"test-token-0123456789",expires_at:"2020-01-01T00:00:00Z",scope:""}))',
  ];
  await expect(
    new HelperTokenProvider(config).getAccessToken({
      provider: "google",
      connectionId: "owner",
      scopes: [],
    }),
  ).rejects.toThrow(/expired/);
  fixtureValue(config.accounts[0]).credential.args = [
    "-e",
    'process.stdout.write(JSON.stringify({access_token:"test-token-0123456789",expires_at:"invalid"}))',
  ];
  await expect(
    new HelperTokenProvider(config).getAccessToken({
      provider: "google",
      connectionId: "owner",
      scopes: [],
    }),
  ).rejects.toThrow(/invalid expiry/);
  fixtureValue(config.accounts[0]).credential.args = [
    "-e",
    'process.stdout.write(JSON.stringify({access_token:"test-token-0123456789",scope:""}))',
  ];
  expect(
    await new HelperTokenProvider(config).getAccessToken({
      provider: "google",
      connectionId: "owner",
      scopes: [],
    }),
  ).toEqual({ token: "test-token-0123456789" });
  const { runHelper } = await import("../src/providers/credentials.js");
  await expect(
    runHelper(process.execPath, ["-e", 'process.kill(process.pid,"SIGTERM")'], {}),
  ).rejects.toThrow(/signal SIGTERM/);
});
it("refuses malformed calendar pages, intervals, encoded paging paths and absent setup accounts", async () => {
  const make = (body: unknown): ProviderEnvironment => ({
    ...fixtureProviders(),
    transport: async () => json(body),
  });
  const input = {
    connectionId: "owner",
    calendarId: "primary",
    window: timeWindow,
    ownerTimeZone: "UTC",
  };
  const broken = {
    isAllDay: true,
    start: { dateTime: "invalid", timeZone: "UTC" },
    end: { dateTime: "invalid", timeZone: "UTC" },
  };
  expect(
    await microsoftCalendarView(make({ value: [broken] }), input, () => instant.toISOString()),
  ).toMatchObject({ ok: false, reason: expect.stringContaining("unreadable date") });
  expect(await microsoftCalendarView(make({}), input, () => instant.toISOString())).toMatchObject({
    ok: false,
    reason: expect.stringContaining("unexpected answer"),
  });
  expect(
    await microsoftCalendarView(
      make({
        value: [],
        "@odata.nextLink": `https://graph.microsoft.com/%zz?startDateTime=${timeWindow.start}&endDateTime=${timeWindow.end}`,
      }),
      input,
      () => instant.toISOString(),
    ),
  ).toMatchObject({ ok: false, reason: expect.stringContaining("paging link") });
  const env: ProviderEnvironment = {
    ...fixtureProviders(),
    transport: async () =>
      json({
        timeMin: timeWindow.start,
        timeMax: timeWindow.end,
        calendars: {
          primary: { busy: [{ start: "2026-10-01T00:00:00Z", end: "2026-10-02T00:00:00Z" }] },
        },
      }),
  };
  expect(
    (
      await googleFreeBusy(
        env,
        { connectionId: "owner", calendarIds: ["primary"], window: timeWindow },
        () => instant.toISOString(),
      )
    ).get("primary"),
  ).toMatchObject({ ok: true, busy: [] });
  const base = mkdtempSync(join(tmpdir(), "credentials-config-"));
  try {
    const path = join(base, "config.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        accounts: [
          {
            connectionId: "owner",
            provider: "google",
            credential: { type: "helper", command: process.execPath, args: [] },
          },
        ],
      }),
      { mode: 0o600 },
    );
    expect(providerEnvironment({ configPath: path }).configuredConnections).toEqual(["owner"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

import { fixtureValue } from "./fixture.js";

it("bounds streamed OAuth answers before EOF and cancels as soon as the limit is exceeded", async () => {
  const max = 256 * 1024;
  let pulls = 0;
  const cancel = vi.fn();
  const response = new Response(
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array(pulls === 1 ? max : 1));
        },
        cancel,
      },
      { highWaterMark: 0 },
    ),
  );
  await expect(call(async () => response, GOOGLE.token, {}, "test")).rejects.toThrow(/too large/);
  expect(pulls).toBe(2);
  expect(cancel).toHaveBeenCalledOnce();
  expect(response.body?.locked).toBe(false);
});
it("accepts the exact OAuth body limit and decodes UTF-8 across chunk boundaries", async () => {
  const payload = JSON.stringify({ message: "é", padding: "x".repeat(256 * 1024 - 29) });
  const bytes = new TextEncoder().encode(payload);
  expect(bytes.byteLength).toBe(256 * 1024);
  const split = bytes.indexOf(0xc3) + 1;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, split));
        controller.enqueue(bytes.subarray(split));
        controller.close();
      },
    }),
  );
  expect(await call(async () => response, GOOGLE.token, {}, "test")).toEqual({
    status: 200,
    body: JSON.parse(payload),
  });
  expect(response.body?.locked).toBe(false);
  await expect(call(async () => new Response(null), GOOGLE.token, {}, "test")).rejects.toThrow(
    /could not be read/,
  );
});
it("sanitizes a failed cancellation of an oversized OAuth answer", async () => {
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(256 * 1024 + 1));
      },
      cancel() {
        throw new Error("test-secret");
      },
    }),
  );
  await expect(call(async () => response, GOOGLE.token, {}, "test")).rejects.toThrow(
    "test: the answer could not be read",
  );
  expect(response.body?.locked).toBe(false);
});
it("resolves thirty-minute DST overlaps from actual Lord Howe offsets and rejects gaps", () => {
  for (const [prefer, expected] of [
    ["earliest", "2026-04-04T14:45:00Z"],
    ["latest", "2026-04-04T15:15:00Z"],
  ] as const) {
    expect(zonedToUtcChecked("2026-04-05", 105, "Australia/Lord_Howe", prefer)).toBe(
      Date.parse(expected),
    );
    expect(zonedToUtcChecked("2026-10-04", 135, "Australia/Lord_Howe", prefer)).toBeUndefined();
    expect(zonedToUtcChecked("2026-04-05", 180, "Australia/Lord_Howe", prefer)).toBe(
      Date.parse("2026-04-04T16:30:00Z"),
    );
  }
});
it("widens Microsoft busy intervals across Lord Howe's thirty-minute DST overlap", async () => {
  const result = await microsoftCalendarView(
    {
      ...fixtureProviders(),
      transport: async () =>
        json({
          value: [
            {
              showAs: "busy",
              start: { dateTime: "2026-04-05T01:40:00", timeZone: "Australia/Lord_Howe" },
              end: { dateTime: "2026-04-05T01:50:00", timeZone: "Australia/Lord_Howe" },
            },
          ],
        }),
    },
    {
      connectionId: "owner",
      calendarId: "primary",
      ownerTimeZone: "Australia/Lord_Howe",
      window: { start: "2026-04-04T00:00:00Z", end: "2026-04-06T00:00:00Z" },
    },
    () => instant.toISOString(),
  );
  expect(result).toMatchObject({
    ok: true,
    busy: [
      {
        start: "2026-04-04T14:40:00.000Z",
        end: "2026-04-04T15:20:00.000Z",
      },
    ],
  });
});
