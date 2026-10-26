import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AVAILABILITY_FILE, readAvailabilityOverlay } from "../pilot/availability.js";
import { openAgent, main as pilot } from "../pilot/cli.js";
import { SyntheticCalendar } from "../pilot/domains/scheduling.js";
import { summariseAgent } from "./agents.js";
import {
  appliedMatches,
  applyToAgent,
  availabilityFileFor,
  evaluateCalendars,
  previewScheduling,
} from "./calendars.js";
import { type CalendarSource, emptySettings, type Settings } from "./model.js";

// Synthetic only: a Monday in October; working hours 09:00–17:00 UTC.
const NOW = "2026-10-19T08:00:00Z";
const TUESDAY = { start: "2026-10-20T09:00:00Z", end: "2026-10-20T17:00:00Z" };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "awp-cal-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const EMPTY_CALENDAR = {
  timeZone: "UTC",
  workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
  busy: [],
  holds: {},
};

/** An agent directory with identity and (unless told otherwise) an initialised calendar. */
function fakeAgent(name: string, calendar: unknown = EMPTY_CALENDAR /* null: none */) {
  const d = join(dir, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(
    join(d, "identity.json"),
    JSON.stringify({ name, role: "personal", timeZone: "UTC" }),
  );
  if (calendar !== null)
    writeFileSync(
      join(d, "calendar.json"),
      typeof calendar === "string" ? calendar : JSON.stringify(calendar),
    );
  return d;
}

/** `count` disjoint 15-minute busy periods starting at `from`, one every 30 minutes. */
function disjointBusy(from: string, count: number, offset = 0) {
  const base = Date.parse(from);
  return Array.from({ length: count }, (_, i) => {
    const start = base + (offset + i) * 30 * 60_000;
    return {
      start: new Date(start).toISOString(),
      end: new Date(start + 15 * 60_000).toISOString(),
    };
  });
}

/** 11 synthetic calendars of 200 periods each (the per-calendar maximum), all counting. */
function manyCalendars(overlapping: boolean): Settings {
  const extra: CalendarSource[] = Array.from({ length: 11 }, (_, k) => ({
    ...rota,
    id: `rota-${k}`,
    label: `Rota ${k}`,
    busy: disjointBusy("2026-11-02T00:00:00Z", 200, overlapping ? 0 : k * 200),
  }));
  const s = settings(["own", ...extra.map((c) => c.id)]);
  s.calendars = [own, ...extra];
  return s;
}

const own: CalendarSource = {
  id: "own",
  label: "Agent calendar",
  kind: "agent-synthetic",
  agent: "owner",
  busy: [],
  enabled: true,
  permissions: { readAvailability: true, createBookings: true },
};
const rota: CalendarSource = {
  id: "rota",
  label: "Team rota",
  kind: "local-synthetic",
  busy: [{ start: "2026-10-20T09:00:00Z", end: "2026-10-20T12:00:00Z" }],
  enabled: true,
  permissions: { readAvailability: true, createBookings: false },
};
const provider: CalendarSource = {
  id: "provider",
  label: "Provider calendar",
  kind: "external",
  provider: "caldav",
  busy: [],
  enabled: true,
  permissions: { readAvailability: true, createBookings: false },
};

function settings(authoritative: string[], extra: Partial<Settings> = {}): Settings {
  const s = emptySettings(NOW);
  return {
    ...s,
    revision: 3,
    managedAgents: ["owner"],
    calendars: [own, rota, provider],
    availability: {
      ...s.availability,
      authoritative,
      bookingTarget: "own",
      workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
    },
    ...extra,
  };
}

describe("calendar evaluation fails closed", () => {
  beforeEach(() => {
    fakeAgent("owner");
  });

  it("is ready with the agent calendar and a synthetic rota", () => {
    expect(evaluateCalendars(settings(["own", "rota"]), dir)).toMatchObject({
      status: "ready",
      reasons: [],
    });
  });

  it("blocks when an authoritative calendar is a provider calendar (unavailable)", () => {
    const ev = evaluateCalendars(settings(["own", "provider"]), dir);
    expect(ev.status).toBe("blocked");
    expect(ev.reasons.join(" ")).toMatch(/Provider calendar/);
  });

  it("blocks when an authoritative calendar is disabled, unreadable or missing", () => {
    const disabled = settings(["own", "rota"]);
    disabled.calendars = [own, { ...rota, enabled: false }, provider];
    expect(evaluateCalendars(disabled, dir).status).toBe("blocked");
    const unreadable = settings(["own", "rota"]);
    unreadable.calendars = [
      own,
      { ...rota, permissions: { readAvailability: false, createBookings: false } },
    ];
    expect(evaluateCalendars(unreadable, dir).status).toBe("blocked");
    const missing = settings(["own", "gone"]);
    expect(evaluateCalendars(missing, dir).status).toBe("blocked");
    expect(evaluateCalendars(settings([]), dir).status).toBe("blocked");
  });

  it("separates reading availability from receiving bookings", () => {
    const noBooking = settings(["own"]);
    noBooking.calendars = [
      { ...own, permissions: { readAvailability: true, createBookings: false } },
    ];
    expect(evaluateCalendars(noBooking, dir).status).toBe("blocked");
    const rotaTarget = settings(["own", "rota"]);
    rotaTarget.availability.bookingTarget = "rota";
    expect(evaluateCalendars(rotaTarget, dir).reasons.join(" ")).toMatch(/only the agent's own/);
    const notAuthoritative = settings(["rota"]);
    expect(evaluateCalendars(notAuthoritative, dir).reasons.join(" ")).toMatch(/must also count/);
  });

  it("blocks when the linked agent is missing", () => {
    rmSync(join(dir, "owner"), { recursive: true });
    expect(evaluateCalendars(settings(["own"]), dir).status).toBe("blocked");
  });
});

describe("missing or unreadable calendar data is unavailable, never free", () => {
  const preview = (s: Settings) =>
    previewScheduling(s, dir, { window: TUESDAY, durationMinutes: 60, now: NOW });

  it("a missing calendar.json (not initialised, or lost) blocks preview and apply", () => {
    fakeAgent("owner", null);
    const ev = evaluateCalendars(settings(["own"]), dir);
    expect(ev.status).toBe("blocked");
    expect(ev.reasons.join(" ")).toMatch(/no calendar data/);
    const p = preview(settings(["own"]));
    expect([p.status, p.freeSlots, p.peerOffer.decision]).toEqual(["blocked", [], "refuse"]);
    const { file } = applyToAgent(settings(["own"]), dir, "owner", NOW);
    expect(file.blocked?.reason).toMatch(/no calendar data/);
    expect(file.bookingTarget).toBe("none");
  });

  it.each([
    ["not JSON", "{broken"],
    [
      "a reversed busy period",
      { ...EMPTY_CALENDAR, busy: [{ start: "2026-10-20T12:00:00Z", end: "2026-10-20T11:00:00Z" }] },
    ],
    ["a wrong shape", { busy: "all day" }],
  ])("unreadable calendar data (%s) is an intelligible blocked source", (_n, content) => {
    fakeAgent("owner", content);
    const ev = evaluateCalendars(settings(["own", "rota"]), dir);
    expect(ev.status).toBe("blocked");
    expect(ev.sources.find((s) => s.id === "own")?.explanation).toMatch(/could not be read/);
    expect(preview(settings(["own", "rota"])).freeSlots).toEqual([]);
    // The agent summary reports it instead of failing the page.
    expect(summariseAgent(dir, "owner").calendarProblem).toMatch(/could not be read/);
  });

  it("another agent's calendar that counts but is missing blocks too", () => {
    fakeAgent("owner");
    fakeAgent("colleague", null);
    const s = settings(["own", "colleague-cal"]);
    s.managedAgents = ["owner", "colleague"];
    s.calendars = [own, { ...own, id: "colleague-cal", label: "Colleague", agent: "colleague" }];
    expect(evaluateCalendars(s, dir).status).toBe("blocked");
    expect(availabilityFileFor(s, dir, "owner", NOW).blocked).toBeDefined();
  });
});

describe("busy periods are never truncated", () => {
  beforeEach(() => {
    fakeAgent("owner");
  });

  it("more than 2000 separate busy periods block preview and apply instead of dropping any", () => {
    const s = manyCalendars(false); // 2200 disjoint periods, all in November
    const ev = evaluateCalendars(s, dir);
    expect(ev.status).toBe("blocked");
    expect(ev.reasons.join(" ")).toMatch(/2200 separate busy periods/);
    // Tuesday 20 October has no busy period at all, yet nothing is offered.
    const p = previewScheduling(s, dir, { window: TUESDAY, durationMinutes: 60, now: NOW });
    expect([p.status, p.freeSlots]).toEqual(["blocked", []]);
    const { file } = applyToAgent(s, dir, "owner", NOW);
    expect(file.blocked?.reason).toMatch(/rather than dropping any/);
    expect(file.busy).toEqual([]);
  });

  it("overlapping periods are merged losslessly, so the same coverage stays usable", () => {
    const s = manyCalendars(true); // 11 × the same 200 periods
    expect(evaluateCalendars(s, dir).status).toBe("ready");
    const file = availabilityFileFor(s, dir, "owner", NOW);
    expect(file.blocked).toBeUndefined();
    expect(file.busy).toHaveLength(200);
    expect(file.busy[0]).toEqual(disjointBusy("2026-11-02T00:00:00Z", 1)[0]);
    // Touching periods coalesce into one.
    const touching = settings(["own", "rota"]);
    touching.calendars = [
      own,
      {
        ...rota,
        busy: [
          { start: "2026-10-20T09:00:00Z", end: "2026-10-20T10:00:00Z" },
          { start: "2026-10-20T10:00:00Z", end: "2026-10-20T11:00:00Z" },
        ],
      },
    ];
    expect(availabilityFileFor(touching, dir, "owner", NOW).busy).toEqual([
      { start: "2026-10-20T09:00:00.000Z", end: "2026-10-20T11:00:00.000Z" },
    ]);
  });
});

describe("chosen calendars change scheduling (same domain code as the agent)", () => {
  beforeEach(() => {
    fakeAgent("owner");
  });
  const preview = (s: Settings) =>
    previewScheduling(s, dir, { window: TUESDAY, durationMinutes: 60, now: NOW });

  it("the rota's busy morning is excluded only while it counts for availability", () => {
    const withRota = preview(settings(["own", "rota"]));
    const without = preview(settings(["own"]));
    expect(withRota.freeSlots[0]?.start).toBe("2026-10-20T12:00:00.000Z");
    expect(without.freeSlots[0]?.start).toBe("2026-10-20T09:00:00.000Z");
    // A peer offering 09:00 is countered only when the rota counts.
    expect(without.peerOffer.decision).toBe("accept");
    expect(withRota.peerOffer.decision).toBe("counter");
  });

  it("time zone and working hours change the result", () => {
    const s = settings(["own"]);
    s.availability.timeZone = "America/New_York";
    const r = preview(s);
    expect(r.timeZone).toBe("America/New_York");
    // 09:00 New York is 13:00 UTC in October.
    expect(r.freeSlots[0]?.start).toBe("2026-10-20T13:00:00.000Z");
  });

  it("an unavailable authoritative calendar offers nothing and refuses offers", () => {
    const r = preview(settings(["own", "provider"]));
    expect(r.status).toBe("blocked");
    expect(r.freeSlots).toEqual([]);
    expect(r.peerOffer.decision).toBe("refuse");
  });
});

describe("the agent consumes applied availability", () => {
  it("apply writes a validated 0600 file for a managed personal agent only", () => {
    const d = fakeAgent("owner");
    fakeAgent("peer");
    const s = settings(["own", "rota"]);
    const { file } = applyToAgent(s, dir, "owner", NOW);
    expect(file.blocked).toBeUndefined();
    expect(file.busy).toEqual([
      { start: "2026-10-20T09:00:00.000Z", end: "2026-10-20T12:00:00.000Z" },
    ]);
    expect(statSync(join(d, AVAILABILITY_FILE)).mode & 0o777).toBe(0o600);
    expect(appliedMatches(s, dir, "owner")).toBe(true);
    expect(appliedMatches(settings(["own"]), dir, "owner")).toBe(false);
    expect(() => applyToAgent(s, dir, "peer", NOW)).toThrow(/not managed/);
    const blocked = applyToAgent(settings(["own", "provider"]), dir, "owner", NOW);
    expect(blocked.file.bookingTarget).toBe("none");
  });

  it("a blocked or malformed file makes every slot unavailable", () => {
    const d = fakeAgent("owner");
    const cal = () =>
      Object.assign(
        new SyntheticCalendar({
          timeZone: "UTC",
          workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
          busy: [],
          holds: {},
        }),
        { overlay: readAvailabilityOverlay(d) },
      );
    expect(cal().overlay).toBeUndefined();
    expect(cal().freeSlots(TUESDAY, 30, Date.parse(NOW), 5).length).toBeGreaterThan(0);
    const valid = availabilityFileFor(settings(["own", "rota"]), dir, "owner", NOW);
    for (const bad of [
      "{not json",
      JSON.stringify({
        ...valid,
        busy: [{ start: "2026-10-20T12:00:00Z", end: "2026-10-20T11:00:00Z" }],
      }),
      JSON.stringify({ ...valid, source: "someone-else" }),
    ]) {
      writeFileSync(join(d, AVAILABILITY_FILE), bad);
      expect(cal().overlay?.blocked).toBeDefined();
      expect(cal().freeSlots(TUESDAY, 30, Date.parse(NOW), 5)).toEqual([]);
    }
  });

  describe("a real provisioned agent (openAgent reads the file at start)", () => {
    let root: string;
    const init = async (name: string) => {
      const code = await pilot(
        [
          "init",
          "--name",
          name,
          "--party",
          `https://${name}.example/#me`,
          "--actor",
          `https://agents.${name}.example/personal#agent`,
          "--policy-engine=solid-odrl",
          "--dir",
          root,
          "--now",
          NOW,
        ],
        { stdout: () => undefined },
      );
      expect(code).toBe(0);
    };
    /** Open, report the first free slots on Tuesday, close. */
    const freeAtStart = async (name: string) => {
      const opened = await openAgent(root, name, () => new Date(NOW));
      try {
        return {
          blocked: opened.calendar.overlay?.blocked?.reason,
          free: opened.calendar
            .freeSlots(TUESDAY, 60, Date.parse(NOW), 2)
            .map((s) => s.start.slice(11, 16)),
        };
      } finally {
        opened.rt.close();
      }
    };
    beforeEach(async () => {
      root = join(dir, "agents");
      await init("owner");
      // As demo-setup does: initialise the calendar explicitly before offering it.
      SyntheticCalendar.open(join(root, "owner", "calendar.json"), EMPTY_CALENDAR);
    });

    it("ready settings apply; unavailable and oversized ones block every slot", async () => {
      applyToAgent(settings(["own", "rota"]), root, "owner", NOW);
      expect(await freeAtStart("owner")).toEqual({ blocked: undefined, free: ["12:00", "12:30"] });
      applyToAgent(settings(["own", "provider"]), root, "owner", NOW);
      expect((await freeAtStart("owner")).free).toEqual([]);
      applyToAgent(manyCalendars(false), root, "owner", NOW);
      const overflow = await freeAtStart("owner");
      expect(overflow.blocked).toMatch(/rather than dropping any/);
      expect(overflow.free).toEqual([]);
    });

    it("a calendar lost after apply blocks at start and stays blocked (not recreated empty)", async () => {
      applyToAgent(settings(["own", "rota"]), root, "owner", NOW);
      rmSync(join(root, "owner", "calendar.json"));
      for (let start = 0; start < 2; start++) {
        const r = await freeAtStart("owner");
        expect(r.blocked).toMatch(/calendar data is missing/);
        expect(r.free).toEqual([]);
        expect(existsSync(join(root, "owner", "calendar.json"))).toBe(false);
      }
    });

    it("an agent without owner settings keeps the original behaviour", async () => {
      await init("legacy");
      expect(existsSync(join(root, "legacy", "calendar.json"))).toBe(false);
      expect(await freeAtStart("legacy")).toEqual({ blocked: undefined, free: ["09:00", "09:30"] });
      expect(existsSync(join(root, "legacy", "calendar.json"))).toBe(true);
    });
  });
});
