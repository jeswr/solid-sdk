import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CalendarSource,
  type Connection,
  DENY_ALL,
  emptySettings,
  type Settings,
} from "../dashboard/model.js";
import type { ActionsEnv } from "./env.js";
import { createActionRegistry } from "./index.js";
import type { ProviderEnvironment } from "./providers/common.js";
import { fixtureFetch, fixtureProviders, fixtureTokens } from "./providers/fixtures.js";
import type { ActionContext } from "./types.js";

// Synthetic only: fixture Google/Microsoft answers, invented accounts; no network.
const NOW = new Date("2026-10-19T08:00:00Z"); // Monday; London is UTC+1 until 25 October
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "awp-avail-test-"));
  const agent = join(dir, "agents", "owner");
  mkdirSync(agent, { recursive: true });
  writeFileSync(
    join(agent, "identity.json"),
    JSON.stringify({ name: "owner", role: "personal", timeZone: "Europe/London" }),
  );
  writeFileSync(
    join(agent, "calendar.json"),
    JSON.stringify({
      timeZone: "Europe/London",
      workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
      busy: [],
      holds: {
        h1: {
          start: "2026-10-20T15:00:00Z",
          end: "2026-10-20T15:30:00Z",
          title: "synthetic hold",
          conversation: "urn:x",
        },
      },
    }),
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const account = (id: string, provider: string, included = true): Connection => ({
  id,
  label: id,
  channel: "email",
  provider,
  organisation: "",
  identifiers: [],
  origin: "demo",
  evidence: [],
  conflicts: [],
  localConnector: { state: "setup-required" },
  restrictions: { ...DENY_ALL, agentEnabled: included },
  notes: "",
  updatedAt: NOW.toISOString(),
  updatedBy: "demo setup",
});
const cal = (id: string, extra: Partial<CalendarSource>): CalendarSource => ({
  id,
  label: id,
  kind: "external",
  busy: [],
  enabled: true,
  permissions: { readAvailability: true, createBookings: false },
  ...extra,
});

const ALL = ["own", "rota", "g-primary", "g-family", "m-primary", "m-secondary"];
function settings(authoritative = ALL, patch: (s: Settings) => void = () => undefined): Settings {
  const s = emptySettings(NOW.toISOString());
  s.connections = [account("acct-google", "gmail"), account("acct-ms", "microsoft_365")];
  s.managedAgents = ["owner"];
  s.calendars = [
    cal("own", {
      kind: "agent-synthetic",
      agent: "owner",
      permissions: { readAvailability: true, createBookings: true },
    }),
    cal("rota", {
      kind: "local-synthetic",
      busy: [{ start: "2026-10-20T10:00:00Z", end: "2026-10-20T10:30:00Z" }],
    }),
    cal("g-primary", {
      provider: "google",
      connectionId: "acct-google",
      providerCalendarId: "primary",
    }),
    cal("g-family", {
      provider: "google",
      connectionId: "acct-google",
      providerCalendarId: "family-fixture@group.calendar.google.com",
    }),
    cal("m-primary", {
      provider: "microsoft",
      connectionId: "acct-ms",
      providerCalendarId: "primary",
    }),
    cal("m-secondary", {
      provider: "microsoft",
      connectionId: "acct-ms",
      providerCalendarId: "AAMkFixtureSecondary",
    }),
  ];
  s.availability = {
    authoritative,
    bookingTarget: "own",
    timeZone: "Europe/London",
    workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
  };
  patch(s);
  return s;
}

const ctx = (
  s: Settings,
  providers: ProviderEnvironment = fixtureProviders(),
  extra: Partial<ActionsEnv> = {},
): ActionContext<ActionsEnv> => ({
  origin: "operator-cli",
  now: () => NOW,
  schedulingNow: () => NOW,
  env: {
    settings: s,
    agentsDir: join(dir, "agents"),
    stateDir: dir,
    providers,
    configuredConnections: [],
    ...extra,
  },
});
const registry = createActionRegistry();
const TUESDAY = { start: "2026-10-20T00:00:00Z", end: "2026-10-21T00:00:00Z" };
// biome-ignore lint/suspicious/noExplicitAny: results are inspected structurally
type Loose = any;
const availability = async (
  c: ActionContext<ActionsEnv>,
  input: Record<string, unknown>,
): Promise<Loose> =>
  registry.prepare("calendar.availability", { durationMinutes: 30, maxProposals: 20, ...input }, c);
const starts = (r: { result?: { proposals: { start: string }[] } }) =>
  (r.result?.proposals ?? []).map((p) => p.start.slice(0, 16));
const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) =>
  Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);

describe("availability over Google, Microsoft and synthetic calendars", () => {
  it("combines every source (paginated, recurring occurrences, holds) and never offers busy time", async () => {
    const r = await availability(ctx(settings()), { window: TUESDAY });
    expect(r.status).toBe("ok");
    expect(r.deterministic).toBe(true);
    expect(r.result.mode).toBe("fixture");
    expect(r.result.sources.map((s: { id: string; state: string }) => [s.id, s.state])).toEqual(
      ALL.map((id) => [id, "ok"]),
    );
    const ms = r.result.sources.find((s: { id: string }) => s.id === "m-primary");
    expect(ms.detail).toMatch(/page\(s\)/);
    // Working hours 09:00–17:00 London = 08:00–16:00Z on 20 October (BST).
    // Busy: 08:00–08:30 (Microsoft), 08:30–08:45 stand-up occurrence, 10:00–10:30 rota,
    // 13:00–14:00 Google, 15:00–15:30 agent hold.
    expect(starts(r)).toEqual([
      "2026-10-20T09:00",
      "2026-10-20T09:30",
      "2026-10-20T10:30",
      "2026-10-20T11:00",
      "2026-10-20T11:30",
      "2026-10-20T12:00",
      "2026-10-20T12:30",
      "2026-10-20T14:00",
      "2026-10-20T14:30",
      "2026-10-20T15:30",
    ]);
    for (const p of r.result.proposals)
      for (const b of r.result.busy) expect(overlaps(p, b)).toBe(false);
    // Coverage and freshness are explicit; no event details leave the action.
    expect(r.result.sources.every((s: { covered: unknown }) => s.covered)).toBe(true);
    expect(Date.parse(r.result.validUntil) - Date.parse(r.result.computedAt)).toBe(5 * 60_000);
    expect(JSON.stringify(r.result)).not.toMatch(/Private stand-up|subject|attendee/);
  });

  it("free time is exactly the intersection of every source's free time (busy union)", async () => {
    const all = new Set(starts(await availability(ctx(settings()), { window: TUESDAY })));
    const perSource = await Promise.all(
      ALL.map(
        async (id) => new Set(starts(await availability(ctx(settings([id])), { window: TUESDAY }))),
      ),
    );
    const intersection = [...(perSource[0] as Set<string>)].filter((x) =>
      perSource.every((s) => s.has(x)),
    );
    expect([...all]).toEqual(intersection);
  });

  it("follows the owner's time zone across the DST change and ranks one per day first", async () => {
    const r = await availability(ctx(settings()), {
      window: { start: "2026-10-23T00:00:00Z", end: "2026-10-27T00:00:00Z" },
      ranking: "spread",
      maxProposals: 3,
    });
    // Friday 23 (BST): 09:00 London = 08:00Z. Monday 26 (GMT): 09:00 London = 09:00Z. No weekend.
    expect(starts(r)).toEqual(["2026-10-23T08:00", "2026-10-26T09:00", "2026-10-23T09:00"]);
    expect(r.result.proposals[1].local).toMatch(/Mon, 26 Oct 2026, 09:00–09:30 \(Europe\/London\)/);
  });

  it("applies buffers around busy time and all-day out-of-office days", async () => {
    const plain = starts(await availability(ctx(settings(["g-primary"])), { window: TUESDAY }));
    const buffered = starts(
      await availability(ctx(settings(["g-primary"])), { window: TUESDAY, bufferMinutes: 15 }),
    );
    expect(plain).toContain("2026-10-20T12:30");
    expect(plain).toContain("2026-10-20T14:00");
    expect(buffered).not.toContain("2026-10-20T12:30");
    expect(buffered).not.toContain("2026-10-20T14:00");
    const oof = await availability(ctx(settings(["m-primary"])), {
      window: { start: "2026-10-28T00:00:00Z", end: "2026-10-29T00:00:00Z" },
    });
    expect(oof.status).toBe("ok");
    expect(oof.result.proposals).toEqual([]);
    expect(oof.reasons[0]).toMatch(/no free time/);
  });

  it("uses the working hours and time zone given for one computation", async () => {
    const r = await availability(ctx(settings(["rota"])), {
      window: TUESDAY,
      timeZone: "America/New_York",
      workingHours: { start: "09:00", end: "10:00", days: [2] },
    });
    expect(starts(r)).toEqual(["2026-10-20T13:00", "2026-10-20T13:30"]);
  });
});

describe("availability fails closed", () => {
  const graphDown: typeof fetch = async (input, init) =>
    String(input).startsWith("https://graph.microsoft.com")
      ? new Response("{}", { status: 503, headers: { "content-type": "application/json" } })
      : fixtureFetch(input, init);

  it("one unreadable provider blocks the whole answer (no partial availability)", async () => {
    const r = await availability(
      ctx(settings(), { mode: "fixture", fetch: graphDown, tokens: fixtureTokens }),
      { window: TUESDAY },
    );
    expect(r.status).toBe("blocked");
    expect(r.result.proposals).toEqual([]);
    expect(r.result.busy).toEqual([]);
    const states = Object.fromEntries(
      r.result.sources.map((s: { id: string; state: string }) => [s.id, s.state]),
    );
    expect(states).toMatchObject({
      "g-primary": "ok",
      "m-primary": "blocked",
      "m-secondary": "blocked",
    });
    expect(r.reasons.join(" ")).toMatch(/withheld/);
  });

  it("a provider answer for a different (stale) window is not used", async () => {
    const stale: typeof fetch = async (input, init) => {
      const res = await fixtureFetch(input, init);
      if (!String(input).includes("freeBusy")) return res;
      const body = (await res.json()) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          ...body,
          timeMin: "2026-10-01T00:00:00Z",
          timeMax: "2026-10-02T00:00:00Z",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const r = await availability(
      ctx(settings(["g-primary"]), { mode: "fixture", fetch: stale, tokens: fixtureTokens }),
      { window: TUESDAY },
    );
    expect(r.status).toBe("blocked");
    expect(r.result.sources[0].reason).toMatch(/different time window/);
  });

  it("missing setup is reported as such, and nothing is fetched", async () => {
    const f = vi.fn(fixtureFetch);
    const live = ctx(settings(["g-primary", "m-primary"]), {
      mode: "live",
      fetch: f,
      tokens: fixtureTokens,
    });
    const r = await availability(live, { window: TUESDAY });
    expect(r.status).toBe("needs-setup");
    expect(r.reasons.join(" ")).toMatch(/no credential is configured/);
    expect(f).not.toHaveBeenCalled();
    const none = await availability(ctx(settings(["g-primary"]), { mode: "none", fetch: f }), {
      window: TUESDAY,
    });
    expect(none.status).toBe("needs-setup");
    const noId = await availability(
      ctx(
        settings(["g-primary"], (s) => {
          delete (s.calendars[2] as { providerCalendarId?: string }).providerCalendarId;
        }),
      ),
      { window: TUESDAY },
    );
    expect(noId.status).toBe("needs-setup");
    const unknownCal = await availability(
      ctx(
        settings(["g-primary"], (s) => {
          (s.calendars[2] as CalendarSource).providerCalendarId = "gone@example.org";
        }),
      ),
      { window: TUESDAY },
    );
    expect(unknownCal.status).toBe("needs-setup");
    expect(unknownCal.reasons.join(" ")).toMatch(/notFound/);
    const caldav = await availability(
      ctx(
        settings(["g-primary"], (s) => {
          (s.calendars[2] as CalendarSource).provider = "caldav";
        }),
      ),
      { window: TUESDAY },
    );
    expect(caldav.reasons.join(" ")).toMatch(/no availability adapter/);
  });

  it("a configured live account is called with its minimum scope only", async () => {
    const seen: unknown[] = [];
    const tokens = {
      getAccessToken: vi.fn(async (r: unknown) => {
        seen.push(r);
        return { token: "t-0123456789" };
      }),
    };
    const r = await availability(
      ctx(
        settings(["g-primary", "m-secondary"]),
        { mode: "live", fetch: fixtureFetch, tokens },
        { configuredConnections: ["acct-google", "acct-ms"] },
      ),
      { window: TUESDAY },
    );
    expect(r.status).toBe("ok");
    expect(seen).toEqual([
      {
        provider: "google",
        connectionId: "acct-google",
        scopes: ["https://www.googleapis.com/auth/calendar.freebusy"],
      },
      { provider: "microsoft", connectionId: "acct-ms", scopes: ["Calendars.ReadBasic"] },
    ]);
  });

  it("owner restrictions refuse: an excluded account, an unreadable or disabled calendar, no selection", async () => {
    for (const patch of [
      (s: Settings) => {
        (s.connections[0] as Connection).restrictions.agentEnabled = false;
      },
      (s: Settings) => {
        (s.calendars[2] as CalendarSource).permissions.readAvailability = false;
      },
      (s: Settings) => {
        (s.calendars[2] as CalendarSource).enabled = false;
      },
    ]) {
      const f = vi.fn(fixtureFetch);
      const r = await availability(
        ctx(settings(ALL, patch), { mode: "fixture", fetch: f, tokens: fixtureTokens }),
        { window: TUESDAY },
      );
      expect(r.status).toBe("refused");
      expect(f).not.toHaveBeenCalled();
    }
    expect((await availability(ctx(settings([])), { window: TUESDAY })).status).toBe("refused");
    // No booking permission is needed to compute availability.
    expect((await availability(ctx(settings(["g-primary"])), { window: TUESDAY })).status).toBe(
      "ok",
    );
  });

  it("needs calendar 'read availability' only, never the account's 'Read messages'", async () => {
    const s = settings(["g-primary", "m-primary"]);
    expect(s.connections.every((c) => c.restrictions.read === false)).toBe(true);
    const r = await availability(ctx(s), { window: TUESDAY });
    expect(r.status).toBe("ok");
    expect(r.permissions.map((p: { capability: string }) => p.capability)).toEqual([
      "calendar.read-availability",
      "calendar.read-availability",
    ]);
  });

  it("time zone and working-hours overrides are owner choices: refused from a message or an extraction", async () => {
    const widen = {
      window: TUESDAY,
      timeZone: "Pacific/Kiritimati",
      workingHours: { start: "00:00", end: "23:30", days: [1, 2, 3, 4, 5, 6, 7] },
    };
    for (const origin of ["structured-message", "reviewed-extraction"] as const) {
      const f = vi.fn(fixtureFetch);
      const c = {
        ...ctx(settings(), { mode: "fixture", fetch: f, tokens: fixtureTokens }),
        origin,
      };
      const r = await availability(c, widen);
      expect(r.status).toBe("refused");
      expect(r.reasons.join(" ")).toMatch(/owner's settings/);
      expect(f).not.toHaveBeenCalled();
      // biome-ignore lint/suspicious/noExplicitAny: inspected structurally
      const p: any = await registry.prepare(
        "meeting.prepare-proposal",
        { availability: { ...widen, durationMinutes: 30 }, title: "x" },
        c,
      );
      expect(p.status).toBe("refused");
      // Without overrides the same origin gets the owner's own hours.
      const plain = await availability(c, { window: TUESDAY });
      expect(plain.status).toBe("ok");
      expect(plain.result.workingHours.start).toBe("09:00");
    }
    for (const origin of ["dashboard", "operator-cli", "mcp"] as const)
      expect((await availability({ ...ctx(settings()), origin }, widen)).status).toBe("ok");
  });

  it("a provider observation that aged during later reads blocks; validity counts from the oldest read", async () => {
    let clock = NOW.getTime();
    const slowGraph =
      (advanceMs: number): typeof fetch =>
      async (input, init) => {
        if (String(input).startsWith("https://graph.microsoft.com")) clock += advanceMs;
        return fixtureFetch(input, init);
      };
    const clocked = (advanceMs: number) => ({
      ...ctx(settings(), { mode: "fixture", fetch: slowGraph(advanceMs), tokens: fixtureTokens }),
      now: () => new Date(clock),
    });
    // Google is read first; Graph pages then take 2 minutes of (injected) time.
    const stale = await availability(clocked(60_000), { window: TUESDAY });
    expect(stale.status).toBe("blocked");
    expect(stale.result.proposals).toEqual([]);
    const state = (r: Loose, id: string) =>
      r.result.sources.find((x: { id: string }) => x.id === id);
    expect(state(stale, "g-primary")).toMatchObject({ state: "blocked", observation: "remote" });
    expect(state(stale, "g-primary").reason).toMatch(/stale/);
    // Synthetic/local data is the owner's own and does not age this way.
    expect(state(stale, "rota")).toMatchObject({ state: "ok", observation: "local" });
    // Small drift: usable, but valid only until the OLDEST remote read + 5 min.
    clock = NOW.getTime();
    const fresh = await availability(clocked(5_000), { window: TUESDAY });
    expect(fresh.status).toBe("ok");
    expect(Date.parse(fresh.result.computedAt)).toBeGreaterThan(NOW.getTime());
    expect(fresh.result.validUntil).toBe(new Date(NOW.getTime() + 5 * 60_000).toISOString());
  });

  it("all provider reads share one bounded time budget; unread sources block", async () => {
    const slow: typeof fetch = async (input, init) => {
      await new Promise((r) => setTimeout(r, 30));
      return fixtureFetch(input, init);
    };
    const r = await availability(
      ctx(
        settings(["g-primary", "m-primary"]),
        { mode: "fixture", fetch: slow, tokens: fixtureTokens },
        { readBudgetMs: 10 },
      ),
      { window: TUESDAY },
    );
    expect(r.status).toBe("blocked");
    expect(r.result.sources[1]).toMatchObject({ id: "m-primary", state: "blocked" });
    expect(r.result.sources[1].reason).toMatch(/time budget/);
  });

  it("bad input is refused before anything runs", async () => {
    for (const input of [
      { window: { start: "2026-10-20T00:00:00Z", end: "2026-12-20T00:00:00Z" } },
      { window: TUESDAY, durationMinutes: 5 },
      { window: TUESDAY, timeZone: "Mars/Olympus" },
      { window: TUESDAY, sources: ["g-primary"] },
    ])
      expect((await availability(ctx(settings()), input)).status).toBe("refused");
  });
});

describe("meeting proposal and the separate confirmation check", () => {
  it("prepares options and templates without any event details", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: inspected structurally
    const r: any = await registry.prepare(
      "meeting.prepare-proposal",
      {
        availability: { window: TUESDAY, durationMinutes: 30, maxProposals: 3 },
        title: "a project catch-up",
        counterpartName: "Sam",
      },
      ctx(settings()),
    );
    expect(r.status).toBe("ok");
    expect(r.preparation).toBeUndefined();
    expect(r.result.structured).toMatchObject({
      type: "awp-meeting-options/0.1",
      timeZone: "Europe/London",
    });
    expect(r.result.templates.email.text).toContain(
      "1. Tue, 20 Oct 2026, 10:00–10:30 (Europe/London)",
    );
    expect(r.result.templates.email.text).toMatch(/Nothing is booked/);
    expect(JSON.stringify(r)).not.toMatch(/Private stand-up/);
  });

  it("re-checks a chosen slot with fresh data and reports an expired earlier result", async () => {
    const slot = { start: "2026-10-20T09:00:00Z", end: "2026-10-20T09:30:00Z" };
    // biome-ignore lint/suspicious/noExplicitAny: inspected structurally
    const ok: any = await registry.prepare(
      "meeting.check-slot",
      { slot, basedOn: { computedAt: "2026-10-19T07:00:00Z", validUntil: "2026-10-19T07:05:00Z" } },
      ctx(settings()),
    );
    expect(ok.status).toBe("ok");
    expect(ok.result).toMatchObject({ free: true, earlierAvailabilityExpired: true });
    expect(ok.result.booking).toMatch(/Not booked/);
    // biome-ignore lint/suspicious/noExplicitAny: inspected structurally
    const busy: any = await registry.prepare(
      "meeting.check-slot",
      { slot: { start: "2026-10-20T13:00:00Z", end: "2026-10-20T13:30:00Z" } },
      ctx(settings()),
    );
    expect(busy.status).toBe("needs-review");
    expect(busy.result.free).toBe(false);
  });
});

describe("request → availability → prepared response (deterministic, no model)", () => {
  it("runs end to end through the registry with fixture Google and Microsoft calendars", async () => {
    const s = settings(ALL, (x) => {
      x.connections[0] = {
        ...(x.connections[0] as Connection),
        restrictions: { ...DENY_ALL, agentEnabled: true, read: true, triage: true, draft: true },
      };
      x.workflowPolicy = {
        source: "synthetic",
        lastUpdated: "2026-09-01",
        askWhenUncertain: [],
        defaultAllowed: ["classify", "draft"],
        requiresCurrentInstruction: [],
        requiresFreshExplicitInstruction: ["send_after_exact_draft_review"],
        taxonomy: {},
      };
    });
    const network = vi.spyOn(globalThis, "fetch");
    try {
      const c = ctx(s);
      // 1. A structured request (e.g. from an agent message or a reviewed extraction) is queued.
      // biome-ignore lint/suspicious/noExplicitAny: inspected structurally
      const q: any = await registry.prepare(
        "inbox.normalise",
        {
          items: [
            {
              id: "req-1",
              accountId: "acct-google",
              receivedAt: NOW.toISOString(),
              subject: "Can we meet?",
              headers: { "Message-ID": "<req-1@mail.example.org>" },
              structured: { type: "meeting-request", window: TUESDAY, durationMinutes: 30 },
            },
          ],
        },
        { ...c, origin: "structured-message" },
      );
      const next = q.result.queue[0].next;
      expect(next.action).toBe("calendar.availability");
      // 2. The suggested action runs with the suggested input (the input grants no authority).
      // biome-ignore lint/suspicious/noExplicitAny: inspected structurally
      const proposal: any = await registry.prepare(
        "meeting.prepare-proposal",
        {
          availability: { ...next.input, maxProposals: 3, bufferMinutes: 10 },
          title: "our meeting",
        },
        c,
      );
      expect(proposal.status).toBe("ok");
      expect(proposal.result.coverage.map((x: { state: string }) => x.state)).toEqual(
        ALL.map(() => "ok"),
      );
      // 3. The reply is rendered for the account the request came in on, as local content.
      // biome-ignore lint/suspicious/noExplicitAny: inspected structurally
      const reply: any = await registry.prepare(
        "message.prepare",
        {
          accountId: "acct-google",
          content: {
            template: "availability-reply",
            title: "our meeting",
            timeZone: proposal.result.timeZone,
            options: proposal.result.structured.options,
            validUntil: proposal.result.validUntil,
          },
          inReplyTo: { subject: "Can we meet?", messageId: "<req-1@mail.example.org>" },
        },
        c,
      );
      expect(reply.status).toBe("ok");
      expect(reply.result.prepared.subject).toBe("Re: Can we meet?");
      expect(reply.result.prepared.headers["In-Reply-To"]).toBe("<req-1@mail.example.org>");
      expect(reply.result.prepared.text).toContain(
        "1. Tue, 20 Oct 2026, 10:00–10:30 (Europe/London)",
      );
      expect(reply.result.delivery.state).toBe("prepared-locally");
      for (const r of [q, proposal, reply]) expect(r.deterministic).toBe(true);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
});
