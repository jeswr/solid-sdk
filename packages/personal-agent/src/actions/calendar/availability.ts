/**
 * Availability over ALL owner-selected authoritative calendars (agent synthetic, dashboard
 * synthetic, Google, Microsoft), computed deterministically:
 *   busy = union of every source's busy intervals (each widened by the buffer),
 *   free = working-hours slots that avoid all of it (= intersection of every source's free time),
 * using the agent's own scheduling code (`SyntheticCalendar`: IANA time zone, DST, working days,
 * 30-minute grid). Any source that cannot be read — missing setup, revoked access, provider error,
 * a calendar the provider does not return, data not covering the window — makes the whole
 * answer blocked: no proposal is ever made from partial data. The result carries its coverage
 * (window, per-source fetch time) and a short validity; nothing is cached or reused.
 * Computing availability needs READ permission only; booking is a separate matter.
 */
import { z } from "zod";
import { readAgentCalendar } from "../../dashboard/calendars.js";
import type { CalendarSource } from "../../dashboard/model.js";
import { workingHoursSchema } from "../../pilot/availability.js";
import { iso } from "../../pilot/core/schema.js";
import { isTimeZone, type Slot, SyntheticCalendar } from "../../pilot/domains/scheduling.js";
import type { Ctx } from "../env.js";
import { failure, type SourceResult } from "../providers/common.js";
import { googleFreeBusy } from "../providers/google.js";
import { microsoftCalendarView } from "../providers/microsoft.js";
import type { ActionOutcome, PermissionCheck } from "../types.js";

export const AVAILABILITY_TTL_MS = 5 * 60_000;
/** Remote observations older than this when the answer is finalised are not used. */
export const MAX_OBSERVATION_AGE_MS = 60_000;
/** Wall-clock budget for all provider reads of one computation. */
export const READ_BUDGET_MS = 30_000;
const MAX_WINDOW_DAYS = 31;
const MAX_BUSY = 5000;

const window = z
  .strictObject({ start: iso, end: iso })
  .refine((w) => Date.parse(w.end) > Date.parse(w.start), "the window must end after it starts")
  .refine(
    (w) => Date.parse(w.end) - Date.parse(w.start) <= MAX_WINDOW_DAYS * 86_400_000,
    `at most ${MAX_WINDOW_DAYS} days`,
  );

export const availabilityInput = z.strictObject({
  window,
  durationMinutes: z.number().int().min(15).max(480),
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  maxProposals: z.number().int().min(1).max(20).default(5),
  /** earliest: first free times; spread: at most one per day first, then earliest. */
  ranking: z.enum(["earliest", "spread"]).default("earliest"),
  /** Overrides of the owner's settings for this computation only. */
  timeZone: z.string().max(64).refine(isTimeZone, "unknown IANA time zone").optional(),
  workingHours: workingHoursSchema.optional(),
});
export type AvailabilityInput = z.infer<typeof availabilityInput>;

const slotOut = z.strictObject({ start: z.string(), end: z.string() });
const sourceOut = z.strictObject({
  id: z.string(),
  label: z.string(),
  kind: z.string(),
  provider: z.string().optional(),
  /** remote: read from a provider now (ages); local: the owner's own data read at computation. */
  observation: z.enum(["remote", "local"]),
  state: z.enum(["ok", "blocked", "needs-setup"]),
  reason: z.string().optional(),
  detail: z.string().optional(),
  fetchedAt: z.string().optional(),
  covered: slotOut.optional(),
  busyIntervals: z.number().int(),
});
export const availabilityResult = z.strictObject({
  status: z.enum(["complete", "blocked"]),
  mode: z.enum(["live", "fixture", "none"]),
  timeZone: z.string(),
  workingHours: workingHoursSchema,
  window: slotOut,
  durationMinutes: z.number(),
  bufferMinutes: z.number(),
  proposals: z.array(
    z.strictObject({
      rank: z.number().int(),
      start: z.string(),
      end: z.string(),
      local: z.string(),
    }),
  ),
  /** The merged busy time used (no titles, attendees or other event details). */
  busy: z.array(slotOut),
  sources: z.array(sourceOut),
  computedAt: z.string(),
  validUntil: z.string(),
  schedulingNow: z.string(),
});
export type AvailabilityResult = z.infer<typeof availabilityResult>;

export function providerFamily(provider: string | undefined): "google" | "microsoft" | undefined {
  const p = (provider ?? "").toLowerCase();
  if (/^(google|gmail|google[-_ ]?(calendar|workspace))$/.test(p)) return "google";
  if (/^(microsoft|microsoft[-_ ]?365|outlook|outlook[-_ ]?com|office[-_ ]?365)$/.test(p))
    return "microsoft";
  return undefined;
}

/**
 * Time zone / working-hours overrides change what counts as free, so they are an OWNER choice:
 * allowed from the owner's dashboard and operator surfaces, refused when the request comes from
 * a message or an extraction (which could otherwise widen the owner's availability).
 */
export function overridePermissions(
  ctx: Ctx,
  input: { timeZone?: string | undefined; workingHours?: unknown },
): PermissionCheck[] {
  if (input.timeZone === undefined && input.workingHours === undefined) return [];
  const owner = ["operator-cli", "mcp", "dashboard"].includes(ctx.origin);
  return [
    {
      subject: "availability preferences",
      capability: "calendar.override-preferences",
      allowed: owner,
      why: owner
        ? "owner/operator override for this computation only"
        : "time zone and working hours come from the owner's settings; a message or extraction cannot change them",
    },
  ];
}

/**
 * Owner permissions for every authoritative calendar: the calendar may be read for availability
 * and its account is included. Deliberately NOT the account's "Read messages" switch — reading
 * busy time is a separate, narrower permission than reading mail.
 */
export function availabilityPermissions(ctx: Ctx): PermissionCheck[] {
  const s = ctx.env.settings;
  const byId = new Map(s.calendars.map((c) => [c.id, c]));
  const checks: PermissionCheck[] = [];
  if (s.availability.authoritative.length === 0)
    checks.push({
      subject: "calendars",
      capability: "calendar.read-availability",
      allowed: false,
      why: "no calendar counts for availability (choose them on the Calendars page)",
    });
  for (const id of s.availability.authoritative) {
    const c = byId.get(id);
    const check = (allowed: boolean, why: string) =>
      checks.push({
        subject: c?.label ?? id,
        capability: "calendar.read-availability",
        allowed,
        why,
      });
    if (!c) check(false, "counts for availability but no longer exists");
    else if (!c.enabled) check(false, "counts for availability but is turned off");
    else if (!c.permissions.readAvailability)
      check(false, "counts for availability but may not be read");
    else if (c.kind === "external") {
      const conn = s.connections.find((x) => x.id === c.connectionId);
      if (!conn) check(false, "is not linked to an account");
      else if (!conn.restrictions.agentEnabled)
        check(false, `its account “${conn.label}” is excluded from the agent`);
      else check(true, `readable (account “${conn.label}” included)`);
    } else check(true, "readable");
  }
  return checks;
}

interface Collected {
  sources: z.infer<typeof sourceOut>[];
  busy: Slot[];
}

async function collect(ctx: Ctx, fetchWindow: Slot, ownerTimeZone: string): Promise<Collected> {
  const s = ctx.env.settings;
  const byId = new Map(s.calendars.map((c) => [c.id, c]));
  const at = () => ctx.now().toISOString();
  // One bounded budget for ALL remote reads of this computation (wall clock, not the injected
  // clock). Sources not read within it are blocked rather than waited for.
  const deadline = Date.now() + (ctx.env.readBudgetMs ?? READ_BUDGET_MS);
  const overBudget = () =>
    Date.now() > deadline
      ? failure("blocked", "not read: the time budget for provider reads was used up")
      : undefined;
  const cals = s.availability.authoritative
    .map((id) => byId.get(id))
    .filter((c): c is CalendarSource => c !== undefined);
  const results = new Map<string, SourceResult>();
  // Google: one freeBusy request per account.
  const google = cals.filter(
    (c) => c.kind === "external" && providerFamily(c.provider) === "google",
  );
  const byAccount = new Map<string, CalendarSource[]>();
  for (const c of google)
    byAccount.set(c.connectionId ?? "", [...(byAccount.get(c.connectionId ?? "") ?? []), c]);
  for (const [account, list] of byAccount) {
    const missing = list.filter((c) => !c.providerCalendarId);
    for (const c of missing)
      results.set(c.id, failure("needs-setup", "no Google calendar ID recorded"));
    const withIds = list.filter((c) => c.providerCalendarId);
    if (withIds.length === 0) continue;
    if (ctx.env.providers.mode === "none") {
      for (const c of withIds)
        results.set(
          c.id,
          failure("needs-setup", "provider access is not configured on this server"),
        );
      continue;
    }
    if (!ctx.env.configuredConnections.includes(account) && ctx.env.providers.mode === "live") {
      for (const c of withIds)
        results.set(c.id, failure("needs-setup", "no credential is configured for this account"));
      continue;
    }
    const spent = overBudget();
    if (spent) {
      for (const c of withIds) results.set(c.id, spent);
      continue;
    }
    const fb = await googleFreeBusy(
      ctx.env.providers,
      {
        connectionId: account,
        calendarIds: withIds.map((c) => c.providerCalendarId as string),
        window: fetchWindow,
      },
      at,
    );
    for (const c of withIds)
      results.set(c.id, fb.get(c.providerCalendarId as string) ?? failure("blocked", "no answer"));
  }
  const sources: Collected["sources"] = [];
  const busy: Slot[] = [];
  for (const c of cals) {
    let r: SourceResult | undefined = results.get(c.id);
    const family = c.kind === "external" ? providerFamily(c.provider) : undefined;
    if (!r) {
      if (ctx.env.providers.mode === "none" && family)
        r = failure("needs-setup", "provider access is not configured on this server");
      else if (c.kind === "local-synthetic")
        r = {
          ok: true,
          busy: c.busy,
          covered: fetchWindow,
          fetchedAt: ctx.env.settings.updatedAt,
          detail: "synthetic busy periods kept in the dashboard",
        };
      else if (c.kind === "agent-synthetic") {
        const read = c.agent
          ? readAgentCalendar(ctx.env.agentsDir, c.agent)
          : { problem: "no agent linked" };
        r =
          "data" in read
            ? {
                ok: true,
                busy: [
                  ...read.data.busy,
                  ...Object.values(read.data.holds).map((h) => ({ start: h.start, end: h.end })),
                ],
                covered: fetchWindow,
                fetchedAt: ctx.now().toISOString(),
                detail: "the agent's own synthetic calendar (busy periods and holds)",
              }
            : failure("blocked", read.problem);
      } else if (family === "microsoft") {
        if (!c.providerCalendarId) r = failure("needs-setup", "no Microsoft calendar ID recorded");
        else if (
          !ctx.env.configuredConnections.includes(c.connectionId ?? "") &&
          ctx.env.providers.mode === "live"
        )
          r = failure("needs-setup", "no credential is configured for this account");
        else
          r =
            overBudget() ??
            (await microsoftCalendarView(
              ctx.env.providers,
              {
                connectionId: c.connectionId ?? "",
                calendarId: c.providerCalendarId,
                window: fetchWindow,
                ownerTimeZone,
                deadline,
              },
              at,
            ));
      } else
        r = failure(
          "needs-setup",
          `no availability adapter for provider “${c.provider ?? "unknown"}”`,
        );
    }
    // Defence in depth: data that does not demonstrably cover the whole window is not used.
    if (
      r.ok &&
      (Date.parse(r.covered.start) > Date.parse(fetchWindow.start) ||
        Date.parse(r.covered.end) < Date.parse(fetchWindow.end))
    )
      r = failure("blocked", "the source data does not cover the requested window");
    sources.push({
      id: c.id,
      label: c.label,
      kind: c.kind,
      ...(c.provider ? { provider: c.provider } : {}),
      observation: c.kind === "external" ? "remote" : "local",
      state: r.ok ? "ok" : r.status,
      ...(r.ok
        ? { detail: r.detail, fetchedAt: r.fetchedAt, covered: r.covered }
        : { reason: r.reason }),
      busyIntervals: r.ok ? r.busy.length : 0,
    });
    if (r.ok) busy.push(...r.busy);
  }
  return { sources, busy };
}

/** Merge overlapping/touching intervals (lossless). */
export function mergeBusy(busy: readonly Slot[], widenMinutes = 0): Slot[] {
  const pad = widenMinutes * 60_000;
  const sorted = busy
    .map((b) => ({ a: Date.parse(b.start) - pad, b: Date.parse(b.end) + pad }))
    .sort((x, y) => x.a - y.a);
  const out: { a: number; b: number }[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.a <= last.b) last.b = Math.max(last.b, s.b);
    else out.push({ ...s });
  }
  return out.map((s) => ({ start: new Date(s.a).toISOString(), end: new Date(s.b).toISOString() }));
}

export function formatLocal(slot: Slot, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(slot.start));
  const t = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${day}, ${t.format(new Date(slot.start))}–${t.format(new Date(slot.end))} (${timeZone})`;
}

function rank(
  slots: Slot[],
  mode: AvailabilityInput["ranking"],
  timeZone: string,
  max: number,
): Slot[] {
  if (mode === "earliest") return slots.slice(0, max);
  const day = (s: Slot) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(s.start));
  const firsts: Slot[] = [];
  const seen = new Set<string>();
  for (const s of slots)
    if (!seen.has(day(s))) {
      seen.add(day(s));
      firsts.push(s);
    }
  const rest = slots.filter((s) => !firsts.includes(s));
  return [...firsts, ...rest].slice(0, max);
}

/** The shared computation (also used by the meeting actions). */
export async function computeAvailability(
  ctx: Ctx,
  input: AvailabilityInput,
): Promise<ActionOutcome<AvailabilityResult> & { calendar: SyntheticCalendar }> {
  const s = ctx.env.settings;
  const timeZone = input.timeZone ?? s.availability.timeZone;
  const workingHours = input.workingHours ?? s.availability.workingHours;
  const pad = input.bufferMinutes * 60_000;
  const fetchWindow = {
    start: new Date(Date.parse(input.window.start) - pad).toISOString(),
    end: new Date(Date.parse(input.window.end) + pad).toISOString(),
  };
  const collected = await collect(ctx, fetchWindow, timeZone);
  const { busy } = collected;
  // Finalisation: reads happen one after another, so an early remote observation can age while
  // later ones run. Anything older than MAX_OBSERVATION_AGE_MS now is not used, and the answer is
  // valid only as long as its OLDEST remote observation (not from the finalisation time).
  const computedAt = ctx.now();
  const sources = collected.sources.map((x) =>
    x.state === "ok" &&
    x.observation === "remote" &&
    !(computedAt.getTime() - Date.parse(x.fetchedAt ?? "") <= MAX_OBSERVATION_AGE_MS)
      ? {
          ...x,
          state: "blocked" as const,
          reason: `read more than ${MAX_OBSERVATION_AGE_MS / 1000} s before the answer was finalised (stale); ask again`,
        }
      : x,
  );
  const oldestRemote = Math.min(
    ...sources
      .filter((x) => x.observation === "remote" && x.fetchedAt)
      .map((x) => Date.parse(x.fetchedAt as string)),
  );
  const validUntil = new Date(
    Math.min(computedAt.getTime(), oldestRemote) + AVAILABILITY_TTL_MS,
  ).toISOString();
  const merged = mergeBusy(busy, input.bufferMinutes);
  const complete =
    sources.length > 0 && sources.every((x) => x.state === "ok") && merged.length <= MAX_BUSY;
  const calendar = new SyntheticCalendar({ timeZone, workingHours, busy: merged, holds: {} });
  if (!complete)
    calendar.overlay = { revision: 0, busy: [], blocked: { reason: "incomplete sources" } };
  const nowMs = ctx.schedulingNow().getTime();
  const candidates = complete
    ? calendar.freeSlots(input.window, input.durationMinutes, nowMs, 400)
    : [];
  const chosen = rank(candidates, input.ranking, timeZone, input.maxProposals);
  const result: AvailabilityResult = {
    status: complete ? "complete" : "blocked",
    mode: ctx.env.providers.mode,
    timeZone,
    workingHours,
    window: { start: input.window.start, end: input.window.end },
    durationMinutes: input.durationMinutes,
    bufferMinutes: input.bufferMinutes,
    proposals: chosen.map((p, i) => ({ rank: i + 1, ...p, local: formatLocal(p, timeZone) })),
    busy: complete ? mergeBusy(busy).slice(0, MAX_BUSY) : [],
    sources,
    computedAt: computedAt.toISOString(),
    validUntil,
    schedulingNow: ctx.schedulingNow().toISOString(),
  };
  const problems = sources.filter((x) => x.state !== "ok");
  const reasons = complete
    ? chosen.length === 0
      ? ["no free time of that length in working hours within the window"]
      : []
    : [
        ...(sources.length === 0 ? ["no calendar counts for availability"] : []),
        ...(merged.length > MAX_BUSY ? [`more than ${MAX_BUSY} busy periods; not computed`] : []),
        ...problems.map((x) => `${x.label}: ${x.reason}`),
        "Availability is withheld: every selected calendar must be read completely.",
      ];
  const status = complete
    ? "ok"
    : problems.some((x) => x.state === "needs-setup") &&
        !problems.some((x) => x.state === "blocked")
      ? "needs-setup"
      : "blocked";
  return { status, reasons, result, calendar };
}
