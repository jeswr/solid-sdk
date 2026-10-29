/**
 * Calendar sources → the availability a managed personal agent uses.
 *
 * The owner chooses which calendars count for availability (authoritative) and which calendar
 * receives synthetic holds (booking target), plus the time zone and working hours. This module:
 *  - evaluates every source (available / unavailable / disabled / not permitted) and FAILS
 *    CLOSED: if any authoritative calendar cannot be read, or no calendar may take bookings, the
 *    agent is blocked (no slot is free) instead of treating unknown time as free;
 *  - builds the `availability.json` file the agent reads at its next start;
 *  - previews scheduling with the SAME domain code the agent runs (`SyntheticCalendar` with the
 *    same overlay conversion, `SchedulingHandler.onProposal`).
 * Only synthetic calendars exist in this phase: an external (provider) calendar is a record with
 * "setup required" and is never live-ready. Synthetic holds are never real bookings.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  AVAILABILITY_FILE,
  type AvailabilityFile,
  availabilityFileSchema,
  MAX_OVERLAY_BUSY,
  overlayFromFile,
  writeAvailabilityFile,
} from "../pilot/availability.js";
import type { ConversationState } from "../pilot/core/conversation.js";
import { iso } from "../pilot/core/schema.js";
import type { JsonObject } from "../pilot/core/types.js";
import {
  type CalendarData,
  MEETING_MODEL,
  SchedulingHandler,
  type Slot,
  SyntheticCalendar,
} from "../pilot/domains/scheduling.js";
import type { HandlerContext } from "../pilot/runtime/operations.js";
import type { CalendarSource, Settings } from "./model.js";

export type SourceState = "available" | "unavailable" | "disabled";

export interface SourceView {
  id: string;
  label: string;
  kind: CalendarSource["kind"];
  state: SourceState;
  explanation: string;
  authoritative: boolean;
  bookingTarget: boolean;
  readAvailability: boolean;
  createBookings: boolean;
}

export interface CalendarEvaluation {
  status: "ready" | "blocked";
  reasons: string[];
  sources: SourceView[];
  /** The managed agent whose own calendar receives holds (if the booking target is one). */
  agent: string | null;
}

const KIND_LABEL: Record<CalendarSource["kind"], string> = {
  "agent-synthetic": "The agent's own synthetic calendar",
  "local-synthetic": "Synthetic calendar kept in this dashboard",
  external: "Provider calendar",
};

export { KIND_LABEL };

const slotSchema = z
  .object({ start: iso, end: iso })
  .refine((s) => Date.parse(s.end) > Date.parse(s.start));
/** Shape of an agent's `calendar.json` as far as availability depends on it. */
const calendarDataSchema = z.object({
  timeZone: z.string().max(64),
  workingHours: z.object({
    start: z.string(),
    end: z.string(),
    days: z.array(z.number().int().min(1).max(7)),
  }),
  busy: z.array(slotSchema),
  holds: z.record(z.string(), slotSchema.and(z.object({ title: z.string() }).passthrough())),
});

/** Provider calendars an availability adapter exists for (Google, Microsoft). */
function providerCalendarReadable(provider: string | undefined): boolean {
  return /^(google|gmail|microsoft|microsoft[-_ ]?365|outlook|outlook[-_ ]?com|office[-_ ]?365)/i.test(
    provider ?? "",
  );
}

export type AgentCalendarRead = { data: CalendarData } | { problem: string };

/**
 * Read a managed agent's own synthetic calendar (read-only; never written here).
 * A missing `calendar.json` is NOT an empty calendar: the file is created when the agent (or the
 * demo setup) initialises it, so its absence means "not initialised or lost" and the source is
 * unavailable. An unreadable file is reported, never treated as free time.
 */
export function readAgentCalendar(agentsDir: string, agent: string): AgentCalendarRead {
  const dir = join(agentsDir, agent);
  if (!existsSync(join(dir, "identity.json")))
    return { problem: `the agent “${agent}” was not found.` };
  const path = join(dir, "calendar.json");
  if (!existsSync(path))
    return {
      problem: `the agent “${agent}” has no calendar data (not initialised yet, or lost), so its busy time is unknown.`,
    };
  try {
    return {
      data: calendarDataSchema.parse(JSON.parse(readFileSync(path, "utf8"))) as CalendarData,
    };
  } catch {
    return { problem: `the calendar data of the agent “${agent}” could not be read.` };
  }
}

/**
 * All busy periods the authoritative sources contribute (except `agent`'s own calendar, which the
 * agent reads itself), merged losslessly (overlapping or touching periods coalesced). If they
 * still exceed what the agent's file can carry, this is reported as a problem: coverage is never
 * truncated, because a dropped busy period would be promised as free time.
 */
export function collectBusy(
  settings: Settings,
  agentsDir: string,
  agent: string | null,
): { busy: Slot[]; problem?: string } {
  const byId = new Map(settings.calendars.map((c) => [c.id, c]));
  const all: Slot[] = [];
  for (const id of settings.availability.authoritative) {
    const c = byId.get(id);
    if (!c) continue;
    if (c.kind === "local-synthetic") all.push(...c.busy);
    // Another agent's synthetic calendar may also count (its busy periods and holds).
    if (c.kind === "agent-synthetic" && c.agent && c.agent !== agent) {
      const other = readAgentCalendar(agentsDir, c.agent);
      if ("data" in other)
        all.push(
          ...other.data.busy,
          ...Object.values(other.data.holds).map((h) => ({ start: h.start, end: h.end })),
        );
    }
  }
  const sorted = all
    .map((s) => ({ a: Date.parse(s.start), b: Date.parse(s.end) }))
    .sort((x, y) => x.a - y.a);
  const merged: { a: number; b: number }[] = [];
  for (const s of sorted) {
    const last = merged.at(-1);
    if (last && s.a <= last.b) last.b = Math.max(last.b, s.b);
    else merged.push({ ...s });
  }
  if (merged.length > MAX_OVERLAY_BUSY)
    return {
      busy: [],
      problem: `The chosen calendars have ${merged.length} separate busy periods, more than the ${MAX_OVERLAY_BUSY} the agent can take; scheduling is blocked rather than dropping any.`,
    };
  return {
    busy: merged.map((s) => ({
      start: new Date(s.a).toISOString(),
      end: new Date(s.b).toISOString(),
    })),
  };
}

function sourceState(
  c: CalendarSource,
  settings: Settings,
  agentsDir: string,
): { state: SourceState; explanation: string } {
  if (!c.enabled) return { state: "disabled", explanation: "Turned off by you." };
  switch (c.kind) {
    case "agent-synthetic":
      if (!c.agent || !settings.managedAgents.includes(c.agent))
        return {
          state: "unavailable",
          explanation: "No managed agent is linked to this calendar.",
        };
      return ((r) =>
        "data" in r
          ? {
              state: "available" as const,
              explanation: `Synthetic calendar of the agent “${c.agent}”.`,
            }
          : {
              state: "unavailable" as const,
              explanation: `${r.problem.charAt(0).toUpperCase()}${r.problem.slice(1)}`,
            })(readAgentCalendar(agentsDir, c.agent));
    case "local-synthetic":
      return {
        state: "available",
        explanation: `Synthetic busy periods you keep here (${c.busy.length}).`,
      };
    case "external":
      return {
        state: "unavailable",
        explanation: providerCalendarReadable(c.provider)
          ? "The agent runtime cannot read provider calendars, so booking stays blocked while this counts. The availability action reads it through its provider adapter when provider access is configured (see Actions)."
          : "Setup required: this calendar cannot be read yet, so it cannot count as free or busy.",
      };
  }
}

export function evaluateCalendars(settings: Settings, agentsDir: string): CalendarEvaluation {
  const a = settings.availability;
  const reasons: string[] = [];
  const byId = new Map(settings.calendars.map((c) => [c.id, c]));
  const sources: SourceView[] = settings.calendars.map((c) => {
    const st = sourceState(c, settings, agentsDir);
    return {
      id: c.id,
      label: c.label,
      kind: c.kind,
      ...st,
      authoritative: a.authoritative.includes(c.id),
      bookingTarget: a.bookingTarget === c.id,
      readAvailability: c.permissions.readAvailability,
      createBookings: c.permissions.createBookings,
    };
  });
  const view = new Map(sources.map((s) => [s.id, s]));
  if (a.authoritative.length === 0)
    reasons.push("Choose at least one calendar that counts for availability.");
  for (const id of a.authoritative) {
    const c = byId.get(id);
    const v = view.get(id);
    if (!c || !v) reasons.push("A calendar chosen for availability no longer exists.");
    else if (!c.permissions.readAvailability)
      reasons.push(`“${c.label}” counts for availability but may not be read.`);
    else if (v.state !== "available")
      reasons.push(
        `“${c.label}” counts for availability but ${v.explanation.charAt(0).toLowerCase()}${v.explanation.slice(1)}`,
      );
  }
  let agent: string | null = null;
  const target = a.bookingTarget ? byId.get(a.bookingTarget) : undefined;
  if (!a.bookingTarget) reasons.push("No calendar is set to receive bookings.");
  else if (!target) reasons.push("The booking calendar no longer exists.");
  else if (target.kind !== "agent-synthetic")
    reasons.push(
      `“${target.label}” cannot receive bookings: only the agent's own synthetic calendar can in this version.`,
    );
  else if (!target.permissions.createBookings)
    reasons.push(`“${target.label}” is not allowed to receive bookings.`);
  else if (view.get(target.id)?.state !== "available")
    reasons.push(`“${target.label}” cannot receive bookings: ${view.get(target.id)?.explanation}`);
  else if (!a.authoritative.includes(target.id))
    reasons.push(`“${target.label}” receives bookings, so it must also count for availability.`);
  else agent = target.agent ?? null;
  if (target?.kind === "agent-synthetic" && target.agent) agent = agent ?? target.agent;
  const overflow = collectBusy(settings, agentsDir, agent).problem;
  if (overflow) reasons.push(overflow);
  return { status: reasons.length === 0 ? "ready" : "blocked", reasons, sources, agent };
}

/** The file the agent will read at its next start (fail-closed when blocked). */
export function availabilityFileFor(
  settings: Settings,
  agentsDir: string,
  agent: string,
  now: string,
): AvailabilityFile {
  const ev = evaluateCalendars(settings, agentsDir);
  const byId = new Map(settings.calendars.map((c) => [c.id, c]));
  const labels = settings.availability.authoritative
    .map((id) => byId.get(id)?.label.slice(0, 120))
    .filter((l): l is string => l !== undefined);
  const collected = collectBusy(settings, agentsDir, agent);
  const blocked =
    ev.status === "blocked"
      ? { reason: ev.reasons.join(" ").slice(0, 300) }
      : collected.problem
        ? { reason: collected.problem.slice(0, 300) }
        : ev.agent !== agent
          ? { reason: "this agent's calendar is not the booking calendar" }
          : undefined;
  // A blocked file carries no busy periods: it already makes every slot unavailable.
  const busy = blocked ? [] : collected.busy;
  return availabilityFileSchema.parse({
    version: 1,
    revision: settings.revision,
    appliedAt: now,
    source: "owner-dashboard",
    timeZone: settings.availability.timeZone,
    workingHours: settings.availability.workingHours,
    busy,
    ...(blocked ? { blocked } : {}),
    bookingTarget: blocked ? "none" : "agent-synthetic",
    sources: labels.slice(0, 50),
  });
}

/**
 * Write the file into a MANAGED agent's directory. Returns whether that agent is running.
 * Callers serialise this with the settings revision check (see the dashboard's apply route), so
 * a stale settings revision can never install an overlay.
 */
export function applyToAgent(
  settings: Settings,
  agentsDir: string,
  agent: string,
  now: string,
): { file: AvailabilityFile; running: boolean } {
  if (!settings.managedAgents.includes(agent))
    throw new Error("that agent is not managed by this dashboard");
  const dir = join(agentsDir, agent);
  if (!existsSync(join(dir, "identity.json"))) throw new Error("that agent was not found");
  const identity = JSON.parse(readFileSync(join(dir, "identity.json"), "utf8")) as {
    role?: string;
  };
  if ((identity.role ?? "personal") !== "personal")
    throw new Error("availability applies to personal agents only");
  const file = availabilityFileFor(settings, agentsDir, agent, now);
  writeAvailabilityFile(dir, file);
  return { file, running: agentRunning(dir) };
}

/** True if the agent's single-writer lock is held by a live process (it reads settings at start). */
export function agentRunning(dir: string): boolean {
  return agentStartedAt(dir) !== undefined;
}

/**
 * When the running agent took its lock (ms since epoch, wall clock), null if it is running but
 * the time is unreadable, undefined if it is not running.
 */
export function agentStartedAt(dir: string): number | null | undefined {
  const lock = join(dir, "state.json.lock");
  if (!existsSync(lock)) return undefined;
  let record: { pid?: number; createdAt?: string };
  try {
    record = JSON.parse(readFileSync(lock, "utf8")) as typeof record;
  } catch {
    return null; // unreadable lock: assume running (conservative)
  }
  if (record.pid) {
    try {
      process.kill(record.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return undefined;
    }
  }
  const at = Date.parse(record.createdAt ?? "");
  return Number.isNaN(at) ? null : at;
}

/**
 * Whether the availability file in the agent's directory has the content the CURRENT settings
 * would apply (ignoring its revision number and time). null if nothing was applied.
 */
export function appliedMatches(
  settings: Settings,
  agentsDir: string,
  agent: string,
): boolean | null {
  const path = join(agentsDir, agent, AVAILABILITY_FILE);
  if (!existsSync(path)) return null;
  const strip = (f: Partial<AvailabilityFile>) => {
    const { revision: _r, appliedAt: _a, ...rest } = f;
    return JSON.stringify(rest);
  };
  try {
    const onDisk = availabilityFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    return (
      strip(onDisk) === strip(availabilityFileFor(settings, agentsDir, agent, onDisk.appliedAt))
    );
  } catch {
    return false;
  }
}

export interface SchedulingPreview {
  status: "ready" | "blocked";
  reasons: string[];
  timeZone: string;
  freeSlots: Slot[];
  /** What the agent would do if a peer offered these times (same handler the agent runs). */
  peerOffer: {
    offered: Slot[];
    decision: "accept" | "counter" | "refuse";
    slot?: Slot;
    counter?: Slot[];
    detail?: string;
  };
}

/** Preview availability with the settings as they are NOW (not yet applied). */
export function previewScheduling(
  settings: Settings,
  agentsDir: string,
  input: { window: Slot; durationMinutes: number; now: string },
): SchedulingPreview {
  const ev = evaluateCalendars(settings, agentsDir);
  const agent = ev.agent;
  const read = agent ? readAgentCalendar(agentsDir, agent) : undefined;
  // Without readable own data the evaluation is blocked, so this stand-in never offers time.
  const own = read && "data" in read ? read.data : undefined;
  const calendar = new SyntheticCalendar(
    structuredClone(
      own ?? {
        timeZone: settings.availability.timeZone,
        workingHours: settings.availability.workingHours,
        busy: [],
        holds: {},
      },
    ),
  );
  const file = availabilityFileFor(settings, agentsDir, agent ?? "(none)", input.now);
  calendar.overlay = overlayFromFile(file);
  const nowMs = Date.parse(input.now);
  const freeSlots = calendar.freeSlots(input.window, input.durationMinutes, nowMs, 8);
  // A peer offering the first grid times of the window (regardless of this calendar).
  const offered: Slot[] = [];
  const step = 30 * 60_000;
  const len = input.durationMinutes * 60_000;
  for (
    let t = Math.ceil(Date.parse(input.window.start) / step) * step;
    t + len <= Date.parse(input.window.end) && offered.length < 4;
    t += step
  )
    offered.push({ start: new Date(t).toISOString(), end: new Date(t + len).toISOString() });
  const peerOffer: SchedulingPreview["peerOffer"] = { offered, decision: "refuse" };
  if (offered.length > 0) {
    const terms = {
      model: MEETING_MODEL.id,
      modelVersion: MEETING_MODEL.version,
      title: "Preview meeting",
      durationMinutes: input.durationMinutes,
      timeZone: calendar.timeZone,
      window: input.window,
      candidates: offered,
      fee: { amount: 0, currency: "GBP", payableBy: "none" },
      disclosure: [],
      location: { kind: "video" },
      synthetic: true,
    } as unknown as JsonObject;
    const ctx = {
      now: input.now,
      peer: { actor: "urn:awp:preview:peer", party: "urn:awp:preview:party" },
      conversation: { id: "urn:awp:preview:conversation" } as ConversationState,
    } as unknown as HandlerContext;
    const reply = new SchedulingHandler(calendar).onProposal(ctx, {
      operation: { id: "preview", version: "0" },
      terms,
      termsDigest: "preview",
      round: 1,
    });
    if (reply.type === "accept") {
      peerOffer.decision = "accept";
      peerOffer.slot = (reply.selection as { slot: Slot }).slot;
    } else if (reply.type === "counter") {
      peerOffer.decision = "counter";
      peerOffer.counter = (reply.terms as { candidates: Slot[] }).candidates;
    } else if (
      reply.type === "refuse" ||
      reply.type === "unsupported" ||
      reply.type === "indeterminate"
    ) {
      peerOffer.decision = "refuse";
      if (reply.detail) peerOffer.detail = reply.detail;
    }
  }
  const blockedReason = file.blocked?.reason;
  return {
    status: blockedReason ? "blocked" : ev.status,
    reasons:
      ev.reasons.length || !blockedReason
        ? ev.reasons
        : [blockedReason.replace(/^./, (c) => c.toUpperCase())],
    timeZone: calendar.timeZone,
    freeSlots,
    peerOffer,
  };
}
