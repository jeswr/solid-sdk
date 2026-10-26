/**
 * Domain adapter: deterministic personal-to-personal appointment negotiation (UC-02
 * personal variant). Synthetic availability only — no real calendar, booking or payment.
 *
 * Negotiation: the initiator offers candidate slots inside a window; the responder accepts
 * the earliest slot free in its own calendar AND inside its own working hours (evaluated
 * in its own IANA time zone, so DST transitions are handled by the platform time-zone
 * database, not by offset arithmetic); otherwise it counters with its own free slots in
 * the same window, up to the round limit; otherwise it refuses `no-acceptable-slot`.
 * A fee payable by the acceptor turns acceptance into a `compensate` action, which a
 * scheduling mandate does not grant.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import { iso } from "../core/schema.js";
import type { ActionIntent, Agreement, JsonObject, ProposeBody } from "../core/types.js";
import type { OperationDescription } from "../profile/description.js";
import { AWP, PURPOSE } from "../profile/vocabulary.js";
import type {
  AgreementPlan,
  EffectAdapter,
  EffectResult,
  HandlerContext,
  HandlerReply,
  OperationHandler,
} from "../runtime/operations.js";

export const SCHEDULE_OP = { id: `${AWP}op/schedule-meeting`, version: "0.1" } as const;
export const MEETING_MODEL = { id: `${AWP}model/meeting-terms`, version: "0.1" } as const;
export const PAYMENT_OP = `${AWP}op/payment`;
export const CALENDAR_ADAPTER = "calendar.hold";

const MINUTE = 60_000;

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const slot = z.strictObject({ start: iso, end: iso });
export type Slot = z.infer<typeof slot>;

export const meetingTermsSchema = z.strictObject({
  model: z.literal(MEETING_MODEL.id),
  modelVersion: z.literal(MEETING_MODEL.version),
  title: z.string().min(1).max(120),
  durationMinutes: z.number().int().min(15).max(240),
  timeZone: z.string().max(64).refine(isTimeZone, "unknown IANA time zone"),
  window: slot,
  candidates: z.array(slot).min(1).max(16),
  fee: z.strictObject({
    amount: z.number().min(0).max(1_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/),
    payableBy: z.enum(["acceptor", "none"]),
  }),
  disclosure: z.array(z.enum(["name", "email"])).max(2),
  location: z.strictObject({ kind: z.enum(["video", "phone", "in-person"]) }),
  synthetic: z.literal(true),
});
export type MeetingTerms = z.infer<typeof meetingTermsSchema>;

// ------------------------------------------------------------------ synthetic calendar

export interface CalendarData {
  timeZone: string;
  workingHours: { start: string; end: string; days: number[] };
  busy: Slot[];
  holds: Record<string, Slot & { title: string; conversation: string }>;
}

export type FailureMode = "none" | "timeout-after-commit" | "timeout-before-commit";

/**
 * Owner availability settings applied ON TOP of the agent's own synthetic calendar (written by
 * the dashboard as `availability.json`, read when the agent opens; see `pilot/availability.ts`).
 * Never persisted with the calendar's holds. `blocked` means an authoritative source is not
 * available: NO slot is free (fail closed — never treat an unknown calendar as free time).
 */
export interface AvailabilityOverlay {
  readonly revision: number;
  readonly timeZone?: string;
  readonly workingHours?: { start: string; end: string; days: number[] };
  /** Busy periods from the other authoritative (synthetic) sources. */
  readonly busy: readonly Slot[];
  readonly blocked?: { readonly reason: string };
}

/** A synthetic calendar. Optional JSON-file persistence so restarts are realistic. */
export class SyntheticCalendar {
  failNext: FailureMode = "none";
  /** Owner availability settings (not persisted here); see {@link AvailabilityOverlay}. */
  overlay: AvailabilityOverlay | undefined;

  constructor(
    public data: CalendarData,
    private readonly path?: string,
  ) {}

  /** The zone availability is evaluated in (owner setting over the calendar's own). */
  get timeZone(): string {
    return this.overlay?.timeZone ?? this.data.timeZone;
  }

  private get workingHours(): CalendarData["workingHours"] {
    return this.overlay?.workingHours ?? this.data.workingHours;
  }

  static open(path: string, initial: CalendarData): SyntheticCalendar {
    if (existsSync(path))
      return new SyntheticCalendar(JSON.parse(readFileSync(path, "utf8")) as CalendarData, path);
    const cal = new SyntheticCalendar(initial, path);
    cal.save();
    return cal;
  }

  save(): void {
    if (this.path) writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  isFree(s: Slot, ignoreKey?: string): boolean {
    if (this.overlay?.blocked) return false; // an authoritative source is unavailable
    const a = Date.parse(s.start);
    const b = Date.parse(s.end);
    for (const [key, hold] of Object.entries(this.data.holds)) {
      if (key === ignoreKey) continue;
      if (Date.parse(hold.start) < b && a < Date.parse(hold.end)) return false;
    }
    const overlaps = (o: Slot) => Date.parse(o.start) < b && a < Date.parse(o.end);
    return !this.data.busy.some(overlaps) && !(this.overlay?.busy ?? []).some(overlaps);
  }

  /** True if the whole slot lies within working hours on a working day, in the calendar's zone. */
  withinWorkingHours(s: Slot): boolean {
    const hours = this.workingHours;
    const start = localParts(new Date(s.start), this.timeZone);
    const end = localParts(new Date(Date.parse(s.end) - MINUTE), this.timeZone);
    if (start.date !== end.date) return false;
    if (!hours.days.includes(start.weekday)) return false;
    const open = toMinutes(hours.start);
    const close = toMinutes(hours.end);
    return start.minutes >= open && end.minutes + 1 <= close;
  }

  acceptable(s: Slot, now: number): boolean {
    return Date.parse(s.start) > now && this.withinWorkingHours(s) && this.isFree(s);
  }

  /** Free, in-hours slots of `duration` in `window`, on a 30-minute grid, max `limit`. */
  freeSlots(window: Slot, durationMinutes: number, now: number, limit = 8): Slot[] {
    const out: Slot[] = [];
    const step = 30 * MINUTE;
    let t = Math.ceil(Math.max(Date.parse(window.start), now + MINUTE) / step) * step;
    const end = Date.parse(window.end);
    for (
      let i = 0;
      t + durationMinutes * MINUTE <= end && out.length < limit && i < 2000;
      i++, t += step
    ) {
      const s = {
        start: new Date(t).toISOString(),
        end: new Date(t + durationMinutes * MINUTE).toISOString(),
      };
      if (this.acceptable(s, now)) out.push(s);
    }
    return out;
  }

  get holdCount(): number {
    return Object.keys(this.data.holds).length;
  }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => Number.parseInt(x, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Local wall-clock parts of an instant in an IANA zone (DST-aware via Intl). */
export function localParts(
  d: Date,
  timeZone: string,
): { date: string; weekday: number; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday ?? ""] ?? 0,
    minutes: Number.parseInt(parts.hour ?? "0", 10) * 60 + Number.parseInt(parts.minute ?? "0", 10),
  };
}

/** The calendar effect adapter: idempotent by key, reconcilable, with failure injection. */
export class CalendarHoldAdapter implements EffectAdapter {
  readonly id = CALENDAR_ADAPTER;
  constructor(readonly calendar: SyntheticCalendar) {}

  async execute(key: string, params: JsonObject): Promise<EffectResult> {
    const existing = this.calendar.data.holds[key];
    if (existing)
      return {
        conclusion: "completed",
        observed: { holdKey: key, start: existing.start, end: existing.end },
      };
    const s = { start: String(params.start), end: String(params.end) };
    const mode = this.calendar.failNext;
    this.calendar.failNext = "none";
    if (mode === "timeout-before-commit") throw new Error("synthetic timeout (nothing committed)");
    if (!this.calendar.isFree(s))
      return { conclusion: "not-executed", reason: "slot no longer free" };
    this.calendar.data.holds[key] = {
      ...s,
      title: String(params.title ?? ""),
      conversation: String(params.conversation ?? ""),
    };
    this.calendar.save();
    if (mode === "timeout-after-commit") throw new Error("synthetic timeout (hold committed)");
    return { conclusion: "completed", observed: { holdKey: key, start: s.start, end: s.end } };
  }

  async reconcile(key: string): Promise<EffectResult> {
    const existing = this.calendar.data.holds[key];
    return existing
      ? {
          conclusion: "completed",
          observed: { holdKey: key, start: existing.start, end: existing.end, reconciled: true },
        }
      : {
          conclusion: "not-executed",
          reason: "no hold exists for this key (authoritative local calendar)",
        };
  }
}

// ------------------------------------------------------------------ handler

export interface SchedulingPolicy {
  readonly maxDurationMinutes: number;
  readonly maxRounds: number;
}

export function schedulingDescription(): OperationDescription {
  return {
    id: SCHEDULE_OP.id,
    version: SCHEDULE_OP.version,
    label: "Negotiate a synthetic meeting slot between two represented people",
    pattern: "negotiate",
    access: "represented",
    roles: ["initiator", "responder"],
    models: [MEETING_MODEL],
    purposes: [PURPOSE.scheduling],
    effects: ["calendar hold on each side's synthetic calendar (schema:Event)"],
    outcomes: [
      "agreement + two completed holds",
      "refused: no-acceptable-slot",
      "uncertain → reconciled",
    ],
    limitations: ["synthetic calendars only", "no real booking, invitation or payment"],
  };
}

export class SchedulingHandler implements OperationHandler {
  readonly description = schedulingDescription();
  readonly termsSchema = meetingTermsSchema as unknown as z.ZodType<JsonObject>;
  readonly requiresRepresentation = true;

  constructor(
    readonly calendar: SyntheticCalendar,
    readonly policy: SchedulingPolicy = { maxDurationMinutes: 120, maxRounds: 3 },
  ) {}

  private baseIntent(ctx: HandlerContext, terms: MeetingTerms, termsDigest: string): ActionIntent {
    const payable = terms.fee.payableBy === "acceptor" && terms.fee.amount > 0;
    return {
      operation: SCHEDULE_OP.id,
      action: "use",
      target: SCHEDULE_OP.id,
      purpose: PURPOSE.scheduling,
      ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
      parameters: {
        termsDigest,
        durationMinutes: terms.durationMinutes,
        disclosure: terms.disclosure,
        feePayable: payable,
      },
      conversation: ctx.conversation.id,
    };
  }

  /** Accepting a fee-bearing meeting is a payment commitment: a separate `compensate` action. */
  private acceptIntent(
    ctx: HandlerContext,
    terms: MeetingTerms,
    termsDigest: string,
  ): ActionIntent {
    if (terms.fee.payableBy === "acceptor" && terms.fee.amount > 0) {
      return {
        operation: SCHEDULE_OP.id,
        action: "compensate",
        target: PAYMENT_OP,
        purpose: PURPOSE.scheduling,
        ...(ctx.peer.party ? { recipient: ctx.peer.party } : {}),
        parameters: { termsDigest, amount: terms.fee.amount, currency: terms.fee.currency },
        conversation: ctx.conversation.id,
      };
    }
    return this.baseIntent(ctx, terms, termsDigest);
  }

  intentForProposal(ctx: HandlerContext, terms: JsonObject): ActionIntent {
    const t = meetingTermsSchema.parse(terms);
    return this.baseIntent(ctx, t, digestFor(terms));
  }

  /** Semantic checks beyond the schema. Returns a problem description or undefined. */
  semanticProblem(t: MeetingTerms): string | undefined {
    const ws = Date.parse(t.window.start);
    const we = Date.parse(t.window.end);
    if (we <= ws || we - ws > 14 * 24 * 60 * MINUTE)
      return "window must be positive and at most 14 days";
    if (t.durationMinutes > this.policy.maxDurationMinutes)
      return `duration exceeds ${this.policy.maxDurationMinutes} minutes`;
    const seen = new Set<string>();
    for (const c of t.candidates) {
      const a = Date.parse(c.start);
      const b = Date.parse(c.end);
      if (b - a !== t.durationMinutes * MINUTE)
        return "candidate length differs from durationMinutes";
      if (a < ws || b > we) return "candidate outside window";
      if (seen.has(c.start)) return "duplicate candidate";
      seen.add(c.start);
    }
    if (t.fee.payableBy === "none" && t.fee.amount !== 0) return "fee amount without a payer";
    return undefined;
  }

  onProposal(ctx: HandlerContext, body: ProposeBody): HandlerReply {
    const t = meetingTermsSchema.parse(body.terms);
    const problem = this.semanticProblem(t);
    if (problem) return { type: "refuse", reason: "invalid-terms", detail: problem };
    const now = Date.parse(ctx.now);
    const choice = [...t.candidates]
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
      .find((c) => this.calendar.acceptable(c, now));
    if (choice) {
      return {
        type: "accept",
        selection: { slot: choice },
        intent: this.acceptIntent(ctx, t, body.termsDigest),
      };
    }
    if (body.round >= this.policy.maxRounds) {
      return {
        type: "refuse",
        reason: "no-acceptable-slot",
        detail: "no mutually free slot within the round limit",
      };
    }
    const mine = this.calendar.freeSlots(t.window, t.durationMinutes, now);
    if (mine.length === 0)
      return { type: "refuse", reason: "no-acceptable-slot", detail: "no free slot in the window" };
    const counter: MeetingTerms = { ...t, candidates: mine };
    return {
      type: "counter",
      terms: counter as unknown as JsonObject,
      intent: this.baseIntent(ctx, counter, digestFor(counter as unknown as JsonObject)),
    };
  }

  validateSelection(terms: JsonObject, selection: JsonObject | undefined): string | undefined {
    const t = meetingTermsSchema.safeParse(terms);
    const s = slot.safeParse(selection?.slot);
    if (!t.success || !s.success) return "selection is not a slot";
    const offered = t.data.candidates.some((c) => c.start === s.data.start && c.end === s.data.end);
    return offered ? undefined : "selected slot was not offered";
  }

  onAgreement(
    ctx: HandlerContext,
    agreement: Agreement,
    role: "offeror" | "acceptor",
  ): AgreementPlan {
    const t = meetingTermsSchema.parse(agreement.terms);
    const s = slot.parse(agreement.selection?.slot);
    const intent =
      role === "acceptor"
        ? this.acceptIntent(ctx, t, agreement.termsDigest)
        : this.baseIntent(ctx, t, agreement.termsDigest);
    return {
      requiredOutcomes: ["self", "peer"],
      effects: [
        {
          adapter: CALENDAR_ADAPTER,
          key: `${agreement.id}#${ctx.self.actor}`,
          params: {
            start: s.start,
            end: s.end,
            title: t.title,
            conversation: agreement.conversation,
          },
          intent,
          activityType: "https://schema.org/ScheduleAction",
          receipt: { final: true },
        },
      ],
    };
  }
}

function digestFor(terms: JsonObject): string {
  return digestOf(terms);
}

/** Build opening terms from the initiator's own free slots (deterministic). */
export function buildMeetingTerms(input: {
  calendar: SyntheticCalendar;
  title: string;
  durationMinutes: number;
  window: Slot;
  now: string;
  fee?: { amount: number; currency: string };
}): MeetingTerms {
  const candidates = input.calendar.freeSlots(
    input.window,
    input.durationMinutes,
    Date.parse(input.now),
  );
  return {
    model: MEETING_MODEL.id,
    modelVersion: MEETING_MODEL.version,
    title: input.title,
    durationMinutes: input.durationMinutes,
    timeZone: input.calendar.timeZone,
    window: input.window,
    candidates: candidates.length > 0 ? candidates : [],
    fee:
      input.fee && input.fee.amount > 0
        ? { ...input.fee, payableBy: "acceptor" }
        : { amount: 0, currency: "GBP", payableBy: "none" },
    disclosure: ["name", "email"],
    location: { kind: "video" },
    synthetic: true,
  };
}
