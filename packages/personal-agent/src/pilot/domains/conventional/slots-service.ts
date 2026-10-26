/**
 * LOCAL REFERENCE SCHEDULING SERVICE — a synthetic stand-in for a Calendly-style provider.
 * It is NOT Calendly, calls nothing external, and binds to 127.0.0.1 only. It exists so the
 * UC-02 adapter can be exercised over a real HTTP boundary (in-process or as a separate
 * process) with deterministic availability, idempotent bookings, reconciliation lookups,
 * and injectable faults (timeouts before/after commit, a changed fee, a removed event type).
 *
 *   GET  /v1/users/:user/event-types/:event                      event-type terms
 *   GET  /v1/users/:user/event-types/:event/availability?from&to  free slots (UTC)
 *   POST /v1/users/:user/event-types/:event/bookings              Idempotency-Key required
 *   GET  /v1/bookings?idempotencyKey=K                            reconciliation lookup
 *   POST /_control  /  GET /_control/log                          synthetic test control
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface EventType {
  readonly durationMinutes: number;
  readonly fee: { readonly amount: number; readonly currency: string };
  readonly requiredFields: readonly string[];
  readonly timeZone: string;
  /** Daily open hours in the host's zone, as UTC hours for determinism. */
  readonly openUtcHours: readonly [number, number];
  readonly days: readonly number[];
}

export interface Booking {
  readonly bookingId: string;
  readonly idempotencyKey: string;
  readonly user: string;
  readonly event: string;
  readonly start: string;
  readonly end: string;
  readonly invitee: { readonly name: string; readonly email: string };
  readonly status: "confirmed";
}

interface ServiceState {
  eventTypes: Record<string, EventType>;
  bookings: Booking[];
  busy: Array<{ user: string; start: string; end: string }>;
  failNext: "none" | "timeout-before-commit" | "timeout-after-commit";
}

export const SYNTHETIC_NOTICE =
  "synthetic local reference service; not Calendly; no real appointment is created";

export function defaultServiceState(): ServiceState {
  return {
    eventTypes: {
      "mateo/30min": {
        durationMinutes: 30,
        fee: { amount: 0, currency: "GBP" },
        requiredFields: ["name", "email"],
        timeZone: "Europe/London",
        openUtcHours: [8, 17],
        days: [1, 2, 3, 4, 5],
      },
      "lin/30min": {
        durationMinutes: 30,
        fee: { amount: 0, currency: "GBP" },
        requiredFields: ["name", "email"],
        timeZone: "Europe/London",
        openUtcHours: [8, 17],
        days: [1, 2, 3, 4, 5],
      },
    },
    bookings: [],
    busy: [{ user: "mateo", start: "2026-10-27T10:00:00Z", end: "2026-10-27T12:00:00Z" }],
    failNext: "none",
  };
}

const MINUTE = 60_000;
const IDENT = /^[a-z0-9][a-z0-9-]{0,39}$/;

export class SlotsService {
  private server: Server | undefined;
  readonly log: Array<{ method: string; path: string; at: string }> = [];
  private state: ServiceState;

  constructor(private readonly statePath?: string) {
    this.state =
      statePath && existsSync(statePath)
        ? (JSON.parse(readFileSync(statePath, "utf8")) as ServiceState)
        : defaultServiceState();
  }

  private save(): void {
    if (!this.statePath) return;
    writeFileSync(`${this.statePath}.tmp`, JSON.stringify(this.state, null, 2));
    renameSync(`${this.statePath}.tmp`, this.statePath);
  }

  control(input: {
    failNext?: ServiceState["failNext"];
    feeAmount?: number;
    removeEvent?: string;
  }): void {
    if (input.failNext) this.state.failNext = input.failNext;
    if (input.feeAmount !== undefined) {
      for (const [k, e] of Object.entries(this.state.eventTypes))
        this.state.eventTypes[k] = { ...e, fee: { ...e.fee, amount: input.feeAmount } };
    }
    if (input.removeEvent) delete this.state.eventTypes[input.removeEvent];
    this.save();
  }

  get bookings(): readonly Booking[] {
    return this.state.bookings;
  }

  private slots(
    user: string,
    event: string,
    from: number,
    to: number,
  ): Array<{ start: string; end: string }> {
    const et = this.state.eventTypes[`${user}/${event}`];
    if (!et) return [];
    const out: Array<{ start: string; end: string }> = [];
    const step = 30 * MINUTE;
    const len = et.durationMinutes * MINUTE;
    for (let t = Math.ceil(from / step) * step; t + len <= to && out.length < 200; t += step) {
      const d = new Date(t);
      const dow = ((d.getUTCDay() + 6) % 7) + 1;
      const h = d.getUTCHours() + d.getUTCMinutes() / 60;
      const hEnd = h + et.durationMinutes / 60;
      if (!et.days.includes(dow) || h < et.openUtcHours[0] || hEnd > et.openUtcHours[1]) continue;
      const clash = (s: string, e: string) => Date.parse(s) < t + len && t < Date.parse(e);
      if (this.state.busy.some((b) => b.user === user && clash(b.start, b.end))) continue;
      if (this.state.bookings.some((b) => b.user === user && clash(b.start, b.end))) continue;
      out.push({ start: new Date(t).toISOString(), end: new Date(t + len).toISOString() });
    }
    return out;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    this.log.push({ method: req.method ?? "?", path: url.pathname, at: new Date().toISOString() });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "x-synthetic": "true" });
      res.end(JSON.stringify(body));
    };
    const body = async (): Promise<unknown> => {
      let text = "";
      for await (const chunk of req) {
        text += chunk;
        if (text.length > 16 * 1024) throw new Error("body too large");
      }
      return text ? JSON.parse(text) : {};
    };
    if (url.pathname === "/_control" && req.method === "POST") {
      this.control((await body()) as never);
      return send(200, { ok: true });
    }
    if (url.pathname === "/_control/log")
      return send(200, { log: this.log, bookings: this.state.bookings });
    if (url.pathname === "/v1/bookings" && req.method === "GET") {
      const key = url.searchParams.get("idempotencyKey") ?? "";
      return send(200, {
        booking: this.state.bookings.find((b) => b.idempotencyKey === key) ?? null,
        notice: SYNTHETIC_NOTICE,
      });
    }
    const m = /^\/v1\/users\/([^/]+)\/event-types\/([^/]+)(\/availability|\/bookings)?$/.exec(
      url.pathname,
    );
    if (!m || !IDENT.test(m[1] ?? "") || !IDENT.test(m[2] ?? ""))
      return send(404, { error: "not found" });
    const [user, event, sub] = [m[1] as string, m[2] as string, m[3]];
    const et = this.state.eventTypes[`${user}/${event}`];
    if (!et) return send(404, { error: "event type not found" });
    if (!sub && req.method === "GET")
      return send(200, { user, event, ...et, notice: SYNTHETIC_NOTICE });
    if (sub === "/availability" && req.method === "GET") {
      const from = Date.parse(url.searchParams.get("from") ?? "");
      const to = Date.parse(url.searchParams.get("to") ?? "");
      if (
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        to <= from ||
        to - from > 15 * 86_400_000
      )
        return send(400, { error: "bad range" });
      return send(200, { slots: this.slots(user, event, from, to), notice: SYNTHETIC_NOTICE });
    }
    if (sub === "/bookings" && req.method === "POST") {
      const key = req.headers["idempotency-key"];
      if (typeof key !== "string" || !/^[A-Za-z0-9:._-]{8,200}$/.test(key))
        return send(400, { error: "Idempotency-Key required" });
      const existing = this.state.bookings.find((b) => b.idempotencyKey === key);
      if (existing) return send(200, existing);
      const b = (await body()) as { start?: string; invitee?: { name?: string; email?: string } };
      const start = Date.parse(b.start ?? "");
      const slot = this.slots(user, event, start, start + et.durationMinutes * MINUTE)[0];
      if (!slot || slot.start !== new Date(start).toISOString())
        return send(409, { error: "slot not available" });
      if (typeof b.invitee?.name !== "string" || typeof b.invitee?.email !== "string")
        return send(400, { error: "invitee name and email required" });
      const mode = this.state.failNext;
      this.state.failNext = "none";
      if (mode === "timeout-before-commit") {
        this.save();
        return; // never answer: the client times out; nothing was booked
      }
      const booking: Booking = {
        bookingId: `bk-${this.state.bookings.length + 1}`,
        idempotencyKey: key,
        user,
        event,
        start: slot.start,
        end: slot.end,
        invitee: { name: b.invitee.name, email: b.invitee.email },
        status: "confirmed",
      };
      this.state.bookings.push(booking);
      this.save();
      if (mode === "timeout-after-commit") return; // committed, but the client never hears
      return send(201, booking);
    }
    return send(405, { error: "method not allowed" });
  }

  /** Listen on 127.0.0.1 (port 0 = ephemeral). Returns the API base URL. */
  listen(port = 0): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handle(req, res).catch(() => {
          if (!res.headersSent) {
            res.writeHead(400);
            res.end();
          }
        });
      });
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        this.server = server;
        const addr = server.address();
        resolve(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : port}`);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.closeAllConnections();
      this.server.close(() => resolve());
    });
  }
}
