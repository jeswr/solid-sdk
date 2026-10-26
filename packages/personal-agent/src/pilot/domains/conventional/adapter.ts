/**
 * The fixed, reviewed adapter for `synthetic-slots/1`.
 *
 * Request targets are built ONLY from the API base in local operator configuration plus
 * identifiers that match a strict pattern; nothing from an email is ever a URL here.
 * Redirects are refused. Responses are read as a byte stream that is cancelled as soon as it
 * exceeds `MAX_BODY_BYTES` (never fully buffered first), must be `application/json`, strict
 * UTF-8 and depth/size-bounded JSON, and one deadline covers headers AND body consumption.
 * Booking is an effect with an idempotency key. Both `execute` and `reconcile` accept a
 * provider record only if it matches the exact request (key, user, event, start, invitee)
 * and the one supported status, `confirmed`; anything missing, contradictory or unknown is
 * `uncertain` — never success, and never "definitely absent" (which would allow a retry).
 */
import { BoundsError, DEFAULT_LIMITS, parseBoundedJson } from "../../core/limits.js";
import type { JsonObject } from "../../core/types.js";
import type { EffectAdapter, EffectResult } from "../../runtime/operations.js";

const IDENT = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Cap on one provider response body, in bytes (the reference service answers far below it). */
export const MAX_BODY_BYTES = 64 * 1024;
const JSON_LIMITS = { ...DEFAULT_LIMITS, maxEnvelopeBytes: MAX_BODY_BYTES };
const BOOKING_ID = /^[A-Za-z0-9_-]{1,64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** A provider response that is not the supported shape (the call's outcome is unknown). */
export class ProviderResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderResponseError";
  }
}

/** Read a response body as bounded bytes; cancel the stream at the first byte over the cap. */
async function readBounded(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    throw new ProviderResponseError(`response too large (declared ${declared} bytes)`);
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new ProviderResponseError(`response too large (over ${max} bytes)`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** The provider booking record, accepted only if it is exactly the one requested. */
function checkBooking(
  b: unknown,
  expected: { idem: string; params: JsonObject },
): { ok: true; record: JsonObject } | { ok: false; problem: string } {
  if (!b || typeof b !== "object" || Array.isArray(b))
    return { ok: false, problem: "booking record is not an object" };
  const r = b as JsonObject;
  const invitee = r.invitee as JsonObject | undefined;
  const p = expected.params;
  if (typeof r.bookingId !== "string" || !BOOKING_ID.test(r.bookingId))
    return { ok: false, problem: "missing or invalid bookingId" };
  if (r.idempotencyKey !== expected.idem) return { ok: false, problem: "idempotency key mismatch" };
  if (r.status !== "confirmed")
    return { ok: false, problem: `unsupported booking status ${JSON.stringify(r.status)}` };
  if (r.user !== p.user || r.event !== p.event)
    return { ok: false, problem: "booking is for a different event type" };
  if (typeof r.start !== "string" || r.start !== p.start)
    return { ok: false, problem: "booking start differs from the request" };
  if (typeof r.end !== "string" || !INSTANT.test(r.end) || Date.parse(r.end) <= Date.parse(r.start))
    return { ok: false, problem: "missing or invalid booking end" };
  if (!invitee || typeof invitee !== "object" || invitee.email !== p.inviteeEmail)
    return { ok: false, problem: "booking invitee differs from the request" };
  return { ok: true, record: r };
}

/** Accept only a loopback http base or an https origin, with no path, query or credentials. */
export function validateApiBase(base: string): string {
  const u = new URL(base);
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) {
    throw new Error("API base must be a bare origin");
  }
  const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (!(u.protocol === "https:" || (u.protocol === "http:" && loopback))) {
    throw new Error("API base must be https, or http on loopback for the local reference service");
  }
  return u.origin;
}

export class ProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class SlotsClient {
  readonly base: string;
  constructor(
    base: string,
    private readonly timeoutMs = 2_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = validateApiBase(base);
  }

  private path(user: string, event: string, suffix = ""): string {
    if (!IDENT.test(user) || !IDENT.test(event)) throw new Error("invalid identifiers");
    return `/v1/users/${user}/event-types/${event}${suffix}`;
  }

  /**
   * One request. A single deadline covers connection, headers and body; the body is read as
   * a bounded byte stream. Throws `ProviderError` for a well-formed error response and
   * `ProviderResponseError` (or an abort/transport error) when the outcome is unknown.
   */
  private async call(
    path: string,
    init: { method: string; body?: JsonObject; headers?: Record<string, string> },
  ): Promise<JsonObject> {
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new ProviderResponseError(`no complete response within ${this.timeoutMs} ms`),
        ),
      this.timeoutMs,
    );
    try {
      const res = await this.fetchImpl(`${this.base}${path}`, {
        method: init.method,
        redirect: "error",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      });
      const type = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
      if (type !== "application/json") {
        await res.body?.cancel().catch(() => undefined);
        throw new ProviderResponseError(`response is not JSON (HTTP ${res.status})`);
      }
      const bytes = await readBounded(res, MAX_BODY_BYTES);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new ProviderResponseError("response is not valid UTF-8");
      }
      let json: unknown;
      try {
        json = parseBoundedJson(text, JSON_LIMITS);
      } catch (error) {
        throw new ProviderResponseError(
          error instanceof BoundsError ? `response JSON ${error.code}` : "response is not JSON",
        );
      }
      if (!json || typeof json !== "object" || Array.isArray(json))
        throw new ProviderResponseError("response JSON is not an object");
      const obj = json as JsonObject;
      if (!res.ok)
        throw new ProviderError(
          res.status,
          String(obj.error ?? `HTTP ${res.status}`).slice(0, 200),
        );
      return obj;
    } finally {
      clearTimeout(timer);
    }
  }

  eventType(user: string, event: string): Promise<JsonObject> {
    return this.call(this.path(user, event), { method: "GET" });
  }

  async availability(user: string, event: string, from: string, to: string): Promise<JsonObject> {
    const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const r = await this.call(this.path(user, event, "/availability") + q, { method: "GET" });
    const slots = r.slots;
    if (
      !Array.isArray(slots) ||
      slots.length > 1000 ||
      !slots.every(
        (s) =>
          !!s &&
          typeof s === "object" &&
          !Array.isArray(s) &&
          typeof (s as JsonObject).start === "string" &&
          INSTANT.test((s as JsonObject).start as string) &&
          typeof (s as JsonObject).end === "string" &&
          INSTANT.test((s as JsonObject).end as string),
      )
    )
      throw new ProviderResponseError("availability response lacks a valid slots list");
    return r;
  }

  book(
    user: string,
    event: string,
    key: string,
    start: string,
    invitee: { name: string; email: string },
  ): Promise<JsonObject> {
    return this.call(this.path(user, event, "/bookings"), {
      method: "POST",
      body: { start, invitee },
      headers: { "idempotency-key": key },
    });
  }

  findBooking(key: string): Promise<JsonObject> {
    return this.call(`/v1/bookings?idempotencyKey=${encodeURIComponent(key)}`, { method: "GET" });
  }
}

export const BOOKING_ADAPTER = "conventional-booking";

/** Effect key = `<serviceId>|<idempotency key>` so reconciliation knows where to look. */
export function bookingKey(serviceId: string, idempotencyKey: string): string {
  return `${serviceId}|${idempotencyKey}`;
}

export class ConventionalBookingAdapter implements EffectAdapter {
  readonly id = BOOKING_ADAPTER;
  constructor(private readonly clients: ReadonlyMap<string, SlotsClient>) {}

  private split(key: string): { client: SlotsClient; idem: string } {
    const [serviceId, idem] = key.split("|");
    const client = this.clients.get(serviceId ?? "");
    if (!client || !idem) throw new Error(`no configured endpoint for service ${serviceId}`);
    return { client, idem };
  }

  async execute(key: string, params: JsonObject): Promise<EffectResult> {
    const { client, idem } = this.split(key);
    try {
      const b = await client.book(
        String(params.user),
        String(params.event),
        idem,
        String(params.start),
        {
          name: String(params.inviteeName),
          email: String(params.inviteeEmail),
        },
      );
      const checked = checkBooking(b, { idem, params });
      if (!checked.ok)
        return {
          conclusion: "uncertain",
          reason: `provider response does not confirm the requested booking: ${checked.problem}`,
        };
      return {
        conclusion: "completed",
        observed: {
          bookingId: String(checked.record.bookingId),
          start: String(checked.record.start),
          end: String(checked.record.end),
          status: "confirmed",
          provider: key.split("|")[0] ?? "",
          evidence: "provider booking record (synthetic service)",
        },
      };
    } catch (error) {
      if (error instanceof ProviderError && error.status === 409)
        return { conclusion: "not-executed", reason: "slot no longer available" };
      if (error instanceof ProviderError && error.status >= 400 && error.status < 500)
        return { conclusion: "not-executed", reason: `rejected by provider: ${error.message}` };
      throw error; // timeouts/transport/malformed response: outcome unknown → uncertain
    }
  }

  /**
   * What the provider holds for this effect's idempotency key. `completed` only for a record
   * matching the planned request exactly; `not-executed` only for the explicit, well-formed
   * "no booking" answer (`{"booking": null}`); everything else is `uncertain`.
   */
  async reconcile(key: string, params?: JsonObject): Promise<EffectResult> {
    const { client, idem } = this.split(key);
    if (!params)
      return {
        conclusion: "uncertain",
        reason: "cannot check a provider record without the request",
      };
    let r: JsonObject;
    try {
      r = await client.findBooking(idem);
    } catch (error) {
      return {
        conclusion: "uncertain",
        reason: `lookup failed: ${(error as Error).message.slice(0, 200)}`,
      };
    }
    // Supported shape: `booking` (required) plus the service's optional `notice` label.
    const keys = Object.keys(r);
    if (!("booking" in r) || keys.some((k) => k !== "booking" && k !== "notice"))
      return { conclusion: "uncertain", reason: "lookup response is not the supported shape" };
    if (r.booking === null)
      return {
        conclusion: "not-executed",
        reason: "provider has no booking for this idempotency key",
      };
    const checked = checkBooking(r.booking, { idem, params });
    if (!checked.ok)
      return {
        conclusion: "uncertain",
        reason: `contradictory provider record: ${checked.problem}`,
      };
    return {
      conclusion: "completed",
      observed: {
        bookingId: String(checked.record.bookingId),
        start: String(checked.record.start),
        end: String(checked.record.end),
        status: "confirmed",
        reconciled: true,
      },
    };
  }
}
