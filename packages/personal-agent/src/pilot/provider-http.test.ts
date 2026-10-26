/**
 * Phase-2 review items 3 and 4 for the UC-02 reference-service client:
 *  3. the response cap is a real memory bound (streamed bytes, cancelled on overflow, one
 *     deadline through body consumption) and malformed responses are rejected;
 *  4. reconciliation never fabricates certainty: only a record matching the exact request is
 *     `completed`, only the explicit `{"booking": null}` is `not-executed`.
 * Synthetic only: injected fetch implementations and one loopback server.
 */
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  bookingKey,
  ConventionalBookingAdapter,
  MAX_BODY_BYTES,
  ProviderResponseError,
  SlotsClient,
} from "./domains/conventional/adapter.js";

const BASE = "http://127.0.0.1:9";
const JSON_HEADERS = { "content-type": "application/json" };

function fakeFetch(respond: () => Response): typeof fetch {
  return (async () => respond()) as unknown as typeof fetch;
}

/** A body that yields 16 KiB chunks forever and counts how many were pulled. */
function endless() {
  let pulls = 0;
  const chunk = new TextEncoder().encode(`[${"1,".repeat(8190)}1`);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(chunk);
    },
  });
  return { stream, pulls: () => pulls };
}

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});

describe("review item 3 — bounded provider responses", () => {
  it("cancels a chunked body at the cap instead of buffering it", async () => {
    const body = endless();
    const client = new SlotsClient(
      BASE,
      2_000,
      fakeFetch(() => new Response(body.stream, { headers: JSON_HEADERS })),
    );
    await expect(client.eventType("mateo", "30min")).rejects.toThrow(/too large \(over 65536/);
    // 16 KiB chunks: the read stops within one chunk of the cap.
    expect(body.pulls()).toBeLessThanOrEqual(Math.ceil(MAX_BODY_BYTES / 16_384) + 2);
  });

  it("rejects a declared oversize body before reading it", async () => {
    const body = endless();
    const client = new SlotsClient(
      BASE,
      2_000,
      fakeFetch(
        () =>
          new Response(body.stream, {
            headers: { ...JSON_HEADERS, "content-length": String(10 * MAX_BODY_BYTES) },
          }),
      ),
    );
    await expect(client.eventType("mateo", "30min")).rejects.toThrow(/declared/);
    expect(body.pulls()).toBeLessThanOrEqual(1);
  });

  it("the deadline covers body consumption (a stalled body times out)", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, JSON_HEADERS);
      res.write('{"slots": ['); // …and never finishes
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    const client = new SlotsClient(`http://127.0.0.1:${port}`, 300);
    const started = Date.now();
    await expect(client.eventType("mateo", "30min")).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("rejects non-JSON, invalid UTF-8, over-deep JSON, non-objects and malformed slot lists", async () => {
    const cases: Array<[Response, RegExp]> = [
      [new Response("<html>", { headers: { "content-type": "text/html" } }), /not JSON/],
      [new Response(new Uint8Array([0x7b, 0xff, 0x7d]), { headers: JSON_HEADERS }), /UTF-8/],
      [new Response(`${"[".repeat(200)}${"]".repeat(200)}`, { headers: JSON_HEADERS }), /too-deep/],
      [new Response("[1,2]", { headers: JSON_HEADERS }), /not an object/],
      [new Response("{not json", { headers: JSON_HEADERS }), /JSON/],
    ];
    for (const [res, pattern] of cases) {
      const client = new SlotsClient(
        BASE,
        2_000,
        fakeFetch(() => res),
      );
      await expect(client.eventType("mateo", "30min")).rejects.toThrow(pattern);
    }
    const noSlots = new SlotsClient(
      BASE,
      2_000,
      fakeFetch(
        () =>
          new Response(JSON.stringify({ slots: [{ start: "soon" }] }), { headers: JSON_HEADERS }),
      ),
    );
    await expect(
      noSlots.availability("mateo", "30min", "2026-10-20T00:00:00Z", "2026-10-21T00:00:00Z"),
    ).rejects.toBeInstanceOf(ProviderResponseError);
  });
});

describe("review item 4 — reconciliation does not fabricate certainty", () => {
  const params = {
    user: "mateo",
    event: "30min",
    start: "2026-10-26T10:30:00.000Z",
    inviteeName: "Priya (synthetic)",
    inviteeEmail: "priya.awp@example.com",
  };
  const idem = "f687536d285c9472eafb26768376378b";
  const booking = {
    bookingId: "bk-3",
    idempotencyKey: idem,
    user: "mateo",
    event: "30min",
    start: params.start,
    end: "2026-10-26T11:00:00.000Z",
    invitee: { name: params.inviteeName, email: params.inviteeEmail },
    status: "confirmed",
  };
  const adapterReturning = (body: unknown, status = 200) =>
    new ConventionalBookingAdapter(
      new Map([
        [
          "synthetic-slots/1",
          new SlotsClient(
            BASE,
            2_000,
            fakeFetch(() => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })),
          ),
        ],
      ]),
    );
  const key = bookingKey("synthetic-slots/1", idem);

  it("completed only for the exact requested record; not-executed only for {booking: null}", async () => {
    expect(
      (await adapterReturning({ booking, notice: "synthetic" }).reconcile(key, params)).conclusion,
    ).toBe("completed");
    expect((await adapterReturning({ booking: null }).reconcile(key, params)).conclusion).toBe(
      "not-executed",
    );
  });

  it("malformed, contradictory or unsupported evidence stays uncertain", async () => {
    const uncertain: unknown[] = [
      {},
      { booking: false },
      { booking: 0 },
      { booking: "yes" },
      { booking: {} },
      { booking: { ...booking, status: "cancelled" } },
      { booking: { ...booking, idempotencyKey: "someone-else" } },
      { booking: { ...booking, start: "2026-10-26T11:00:00.000Z" } },
      { booking: { ...booking, event: "60min" } },
      { booking: { ...booking, invitee: { name: "x", email: "other@example.com" } } },
      { booking: { ...booking, end: undefined } },
      { booking: { ...booking, end: params.start } },
      { booking: { ...booking, bookingId: 42 } },
      { booking: null, extra: "field" },
    ];
    for (const body of uncertain) {
      const r = await adapterReturning(body).reconcile(key, params);
      expect(r.conclusion, JSON.stringify(body)).toBe("uncertain");
    }
    // A provider error response or a missing request is not evidence of absence either.
    expect((await adapterReturning({ error: "boom" }, 500).reconcile(key, params)).conclusion).toBe(
      "uncertain",
    );
    expect((await adapterReturning({ booking: null }).reconcile(key)).conclusion).toBe("uncertain");
  });

  it("execute does not report success for a response that is not the requested booking", async () => {
    for (const body of [
      { ...booking, idempotencyKey: "someone-else" },
      { ...booking, status: "tentative" },
      { status: "confirmed", start: params.start },
    ]) {
      const r = await adapterReturning(body, 201).execute(key, params);
      expect(r.conclusion, JSON.stringify(body)).toBe("uncertain");
    }
    expect((await adapterReturning(booking, 201).execute(key, params)).conclusion).toBe(
      "completed",
    );
  });
});
