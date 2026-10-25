/**
 * Phase-2 review items 1 and 2: provider transmission is an effect boundary.
 *  1. Authorisation and expiry are re-decided when the message is actually transmitted
 *     (revocation while queued, after restart; expiry; approvals), not taken from the
 *     signature on an old artefact.
 *  2. Provider sends have durable per-message records: a repeat transmits nothing, an
 *     uncertain send is never retried blindly, and a crash after provider acceptance is
 *     reconciled by the stable Message-ID.
 * All transports are local injected fakes; nothing is sent anywhere.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DirectBus } from "./bindings/direct.js";
import { emailMessageIdFor } from "./bindings/email.js";
import {
  createGmailRestTransport,
  GmailProviderAdapter,
  type GmailSearchResult,
  type GmailTransport,
  ProviderRejectedError,
} from "./bindings/gmail.js";
import { buildMeetingTerms, MEETING_MODEL, SCHEDULE_OP } from "./domains/scheduling.js";
import { CONFIG_ED25519 } from "./profile/configurations.js";
import type { OutboundMessage } from "./runtime/agent.js";
import type { TransmissionIo } from "./runtime/transmission.js";
import {
  ALICE,
  BOB,
  fixedClock,
  londonCalendar,
  newYorkCalendar,
  type PersonalAgent,
  provisionPair,
  startAgent,
} from "./scenarios/personal.js";
import { type ProcessedOutbound, prepareOutbound, ThreadStore } from "./service.js";
import { FileStateStore, type RuntimeState, type StateStore } from "./store/state.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fake mailbox: records accepted messages; configurable failure modes. */
function mailbox() {
  const accepted: Array<{ id: string; messageId: string; raw: string }> = [];
  let mode: "ok" | "lose-response" | "fail-before" | "reject" = "ok";
  let lookupMode: "real" | "unknown" | "absent" = "real";
  let sends = 0;
  let onAccept: (() => void) | undefined;
  const transport: GmailTransport = {
    send: async ({ raw }) => {
      sends++;
      if (mode === "fail-before") throw new Error("connection refused");
      if (mode === "reject") throw new ProviderRejectedError("HTTP 400");
      const text = Buffer.from(raw, "base64url").toString("utf8");
      const messageId = /^Message-ID: (.+)\r$/m.exec(text)?.[1] ?? "";
      const id = `g${accepted.length + 1}`;
      accepted.push({ id, messageId, raw: text });
      onAccept?.();
      if (mode === "lose-response") throw new Error("socket closed before response");
      return { id };
    },
    getRaw: async (id) => {
      const m = accepted.find((a) => a.id === id);
      if (!m) throw new Error("HTTP 404");
      return { id, raw: Buffer.from(m.raw, "utf8").toString("base64url") };
    },
    findByMessageId: async (rfc822): Promise<GmailSearchResult> => {
      if (lookupMode === "unknown") return { outcome: "unknown", detail: "search unavailable" };
      if (lookupMode === "absent") return { outcome: "candidates", ids: [] };
      return {
        outcome: "candidates",
        ids: accepted.filter((m) => m.messageId === rfc822).map((m) => m.id),
      };
    },
  };
  return {
    transport,
    accepted,
    sends: () => sends,
    set: (m: typeof mode) => {
      mode = m;
    },
    lookup: (m: typeof lookupMode) => {
      lookupMode = m;
    },
    onAccept: (f: () => void) => {
      onAccept = f;
    },
  };
}

/** A file store whose writes can be made to fail, simulating process death mid-effect. */
class DyingStore implements StateStore {
  dead = false;
  constructor(readonly inner: FileStateStore) {}
  load(): RuntimeState {
    return this.inner.load();
  }
  save(state: RuntimeState): void {
    if (this.dead) throw new Error("process died");
    this.inner.save(state);
  }
  close(): void {
    this.inner.close();
  }
}

async function world(opts: { dir?: boolean } = {}) {
  const clock = fixedClock();
  const dir = opts.dir ? mkdtempSync(join(tmpdir(), "awp-tx-")) : undefined;
  if (dir) dirs.push(dir);
  const { alice: pa, bob: pb } = await provisionPair({ now: clock.now, ...(dir ? { dir } : {}) });
  const open = async (store?: StateStore) =>
    startAgent(pa, londonCalendar(), {
      now: clock.now,
      accepted: [CONFIG_ED25519],
      ...(dir ? { dir } : {}),
      ...(store ? { store } : {}),
      runtime: { effectTimeoutMs: 200 },
    });
  const alice = await open();
  const bob = await startAgent(pb, newYorkCalendar(), {
    now: clock.now,
    accepted: [CONFIG_ED25519],
    ...(dir ? { dir } : {}),
  });
  return { clock, dir, alice, bob, open, pa };
}

/** Drive normal discovery until Alice emits her `propose`; stop it in transit. */
async function alicePropose(alice: PersonalAgent, bob: PersonalAgent, now: Date) {
  const start = await alice.runtime.startNegotiation({
    peer: { actor: BOB.actor, party: BOB.party },
    operation: SCHEDULE_OP,
    terms: buildMeetingTerms({
      calendar: alice.calendar,
      title: "Synthetic catch-up",
      durationMinutes: 30,
      window: { start: "2026-10-20T13:00:00Z", end: "2026-10-20T17:00:00Z" },
      now: now.toISOString(),
    }) as never,
    models: [MEETING_MODEL],
  });
  let propose: OutboundMessage | undefined;
  await new DirectBus()
    .register(alice.runtime, bob.runtime)
    .send(alice.runtime, start)
    .run(({ from, out }) => {
      if (from === alice.runtime && out.kind === "propose") {
        propose = out;
        return "drop";
      }
      return undefined;
    });
  if (!propose) throw new Error("no propose emitted");
  return { propose, describe: start.outbound[0] as OutboundMessage };
}

async function item(alice: PersonalAgent, out: OutboundMessage, now: Date) {
  const [i] = await prepareOutbound(
    alice.runtime,
    [out],
    { selfAddress: ALICE.email },
    new ThreadStore(),
    now,
  );
  return i as ProcessedOutbound;
}

function adapter(alice: PersonalAgent, transport: GmailTransport) {
  return new GmailProviderAdapter(transport, {
    allowedRecipients: [BOB.email as string],
    sourceAccount: ALICE.email as string,
    verifier: alice.runtime.outboundVerifier(),
    dryRun: false,
  });
}

describe("review item 1 — authorisation and expiry are re-decided at transmission", () => {
  it("reproduction: a propose prepared before revocation is not transmitted after it", async () => {
    const { alice, bob, clock } = await world();
    const { propose } = await alicePropose(alice, bob, clock.now());
    const i = await item(alice, propose, clock.now());
    const mb = mailbox();
    // Dry run before revocation: would be allowed.
    const dry = new GmailProviderAdapter(mb.transport, {
      allowedRecipients: [BOB.email as string],
      sourceAccount: ALICE.email as string,
      verifier: alice.runtime.outboundVerifier(),
    });
    expect((await dry.sendReviewed(i)).status).toBe("dry-run");
    await alice.runtime.revokeMandate();
    const r = await adapter(alice, mb.transport).sendReviewed(i);
    expect(r.status).toBe("refused");
    expect((r as { reason: string }).reason).toMatch(/^not-authorised: .*revoked/);
    // Two days later: still refused (now also expired) — and nothing ever reached the provider.
    clock.advance(2 * 86_400_000);
    const later = await adapter(alice, mb.transport).sendReviewed(i);
    expect(later.status).toBe("refused");
    expect(mb.sends()).toBe(0);
    const types = alice.ledger.entries().map((e) => e.record.type);
    expect(types).toContain("transmission-refused");
  });

  it("an unrevoked message expires in the queue", async () => {
    const { alice, bob, clock } = await world();
    const { propose } = await alicePropose(alice, bob, clock.now());
    const i = await item(alice, propose, clock.now());
    const mb = mailbox();
    clock.advance(2 * 86_400_000);
    const r = await adapter(alice, mb.transport).sendReviewed(i);
    expect(r).toMatchObject({ status: "refused" });
    expect((r as { reason: string }).reason).toMatch(/^expired: /);
    expect(mb.sends()).toBe(0);
  });

  it("revocation while queued survives a restart; the gate reads the persisted state", async () => {
    const { alice, bob, clock, open } = await world({ dir: true });
    const { propose } = await alicePropose(alice, bob, clock.now());
    const i = await item(alice, propose, clock.now());
    await alice.runtime.revokeMandate();
    alice.runtime.close();
    const reopened = await open();
    const mb = mailbox();
    const r = await adapter(reopened, mb.transport).sendReviewed(i);
    expect((r as { reason: string }).reason).toMatch(/^not-authorised: /);
    expect(mb.sends()).toBe(0);
    reopened.runtime.close();
  });

  it("metadata-only messages follow the declared rule: authentic and unexpired, no mandate re-check", async () => {
    const { alice, bob, clock } = await world();
    const { describe: d } = await alicePropose(alice, bob, clock.now());
    const i = await item(alice, d, clock.now());
    await alice.runtime.revokeMandate();
    const mb = mailbox();
    expect((await adapter(alice, mb.transport).sendReviewed(i)).status).toBe("sent");
    // A message not in this runtime's outbox (another state for the same keys) is refused.
    const { alice: other } = await world();
    const r = await adapter(other, mb.transport).sendReviewed(i);
    expect((r as { reason: string }).reason).toMatch(/not signed by this agent|unknown-message/);
  });

  it("a Message-ID not derived from the signed message id is refused", async () => {
    const { alice, bob, clock } = await world();
    const { propose } = await alicePropose(alice, bob, clock.now());
    const i = await item(alice, propose, clock.now());
    const email = i.email as NonNullable<ProcessedOutbound["email"]>;
    const raw = email.raw.replace(
      /^Message-ID: .+\r$/m,
      "Message-ID: <forged@awp-pilot.invalid>\r",
    );
    const forged: ProcessedOutbound = {
      ...i,
      email: {
        ...email,
        raw,
        gmailSend: { ...email.gmailSend, raw: Buffer.from(raw, "utf8").toString("base64url") },
      },
    };
    const mb = mailbox();
    const r = await adapter(alice, mb.transport).sendReviewed(forged);
    expect((r as { reason: string }).reason).toMatch(/Message-ID is not the one derived/);
    expect(i.email?.raw).toContain(`Message-ID: ${emailMessageIdFor(propose.id)}`);
  });
});

describe("review item 2 — durable provider-send records", () => {
  it("a repeated send of a sent message transmits nothing", async () => {
    const { alice, bob, clock } = await world();
    const { propose } = await alicePropose(alice, bob, clock.now());
    const i = await item(alice, propose, clock.now());
    const mb = mailbox();
    const a = adapter(alice, mb.transport);
    expect(await a.sendReviewed(i)).toEqual({
      status: "sent",
      providerId: "g1",
      reconciled: false,
    });
    expect(await a.sendReviewed(i)).toEqual({ status: "duplicate", providerId: "g1" });
    expect(mb.sends()).toBe(1);
    expect(alice.runtime.transmissions()).toMatchObject([
      {
        messageId: propose.id,
        status: "sent",
        attempts: 1,
        externalId: emailMessageIdFor(propose.id),
      },
    ]);
  });

  it("an uncertain send is not retried blindly; a lookup resolves it", async () => {
    const { alice, bob, clock } = await world();
    const { propose } = await alicePropose(alice, bob, clock.now());
    const i = await item(alice, propose, clock.now());
    const mb = mailbox();
    const a = adapter(alice, mb.transport);
    mb.set("lose-response");
    expect((await a.sendReviewed(i)).status).toBe("uncertain");
    // Lookup unavailable: stays uncertain, provider NOT called again.
    mb.set("ok");
    mb.lookup("unknown");
    expect((await a.sendReviewed(i)).status).toBe("uncertain");
    expect(mb.sends()).toBe(1);
    // Lookup finds it by Message-ID: sent, reconciled, still one provider message.
    mb.lookup("real");
    expect(await a.sendReviewed(i)).toEqual({ status: "sent", providerId: "g1", reconciled: true });
    expect(mb.accepted).toHaveLength(1);
    expect(mb.sends()).toBe(1);
  });

  it("process death after provider acceptance is reconciled after restart without a duplicate", async () => {
    const { alice: first, bob, clock, open, dir } = await world({ dir: true });
    const { propose } = await alicePropose(first, bob, clock.now());
    const i = await item(first, propose, clock.now());
    first.runtime.close();
    const dying = new DyingStore(new FileStateStore(join(dir as string, "alice-state.json")));
    const alice = await open(dying);
    const mb = mailbox();
    mb.onAccept(() => {
      dying.dead = true; // the process dies right after the provider accepted
    });
    await expect(adapter(alice, mb.transport).sendReviewed(i)).rejects.toThrow(/process died/);
    dying.inner.close();
    expect(mb.accepted).toHaveLength(1);
    // Restart: the durable record says `attempting`; reconcile by Message-ID, never resend.
    const restarted = await open();
    expect(restarted.runtime.transmissions()[0]).toMatchObject({
      status: "attempting",
      attempts: 1,
    });
    const r = await adapter(restarted, mb.transport).sendReviewed(i);
    expect(r).toEqual({ status: "sent", providerId: "g1", reconciled: true });
    expect(mb.sends()).toBe(1);
    restarted.runtime.close();
  });

  it("a Gmail search miss never permits another send; a definitive 400 is not-sent", async () => {
    const { alice, bob, clock } = await world();
    const { propose } = await alicePropose(alice, bob, clock.now());
    const i = await item(alice, propose, clock.now());
    const mb = mailbox();
    const a = adapter(alice, mb.transport);
    mb.set("fail-before");
    expect((await a.sendReviewed(i)).status).toBe("uncertain");
    mb.lookup("absent");
    mb.set("ok");
    for (let n = 0; n < 3; n++) {
      const r = await a.sendReviewed(i);
      expect(r.status).toBe("uncertain");
      expect((r as { reason: string }).reason).toMatch(/search miss does not show/);
    }
    expect(mb.sends()).toBe(1);
    mb.set("reject");
    const { propose: p2 } = await alicePropose(alice, bob, clock.now());
    const r2 = await a.sendReviewed(await item(alice, p2, clock.now()));
    expect(r2).toEqual({ status: "not-sent", reason: "HTTP 400" });
  });
});

/** A deferred value, resolved by the test. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type FetchInit = { method: string; headers: Record<string, string>; body?: string };
type FetchResult = { ok: boolean; status: number; json(): Promise<unknown> };

/**
 * An injected REST provider behind `createGmailRestTransport`: the send is ACCEPTED (stored)
 * but its HTTP response is held back past the effect timeout; list/get answers are scripted.
 */
function slowRestProvider() {
  const stored = new Map<string, string>();
  const response = deferred<FetchResult>();
  let sends = 0;
  let listBody: unknown = {};
  let listStatus = 200;
  let copyEdit: (raw: string) => string = (raw) => raw;
  const json = (status: number, body: unknown): FetchResult => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  const authorizedFetch = async (url: string, init: FetchInit): Promise<FetchResult> => {
    const u = new URL(url);
    if (init.method === "POST" && u.pathname.endsWith("/messages/send")) {
      sends++;
      const { raw } = JSON.parse(init.body as string) as { raw: string };
      stored.set("m1", Buffer.from(raw, "base64url").toString("utf8"));
      return response.promise; // accepted, but the response arrives late (or never)
    }
    if (init.method === "GET" && u.pathname.endsWith("/messages"))
      return json(listStatus, listBody);
    const id = /\/messages\/([A-Za-z0-9]+)$/.exec(u.pathname)?.[1] as string;
    const copy = stored.get(id);
    if (!copy) return json(404, { error: { code: 404 } });
    return json(200, {
      id,
      threadId: "t1",
      raw: Buffer.from(copyEdit(copy), "utf8").toString("base64url"),
    });
  };
  return {
    transport: createGmailRestTransport({ authorizedFetch }),
    sends: () => sends,
    list: (body: unknown, status = 200) => {
      listBody = body;
      listStatus = status;
    },
    editCopy: (f: (raw: string) => string) => {
      copyEdit = f;
    },
    respondLate: () => response.resolve(json(200, { id: "m1", threadId: "t1" })),
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("phase-3 review — recovery never infers absence from a Gmail search", () => {
  /** List bodies that must never be read as "nothing was sent". */
  const inconclusive: Array<[string, unknown, number?]> = [
    ["empty object", {}],
    ["empty messages", { messages: [], resultSizeEstimate: 0 }],
    ["estimate only", { resultSizeEstimate: 0 }],
    ["messages not a list", { messages: "none" }],
    ["entry without id", { messages: [{ threadId: "t1" }] }],
    ["null entry", { messages: [null] }],
    ["unexpected member", { messages: [], error: "partial" }],
    ["malformed page token", { messages: [], nextPageToken: 7 }],
    ["null body", null],
    ["array body", []],
    ["server error", { error: { code: 500 } }, 500],
    ["only an unrelated id", { messages: [{ id: "m9", threadId: "t9" }] }],
  ];

  it("an accepted send whose response times out stays uncertain across retries and a restart; one send", async () => {
    const { alice: first, bob, clock, open } = await world({ dir: true });
    const { propose } = await alicePropose(first, bob, clock.now());
    const i = await item(first, propose, clock.now());
    const p = slowRestProvider();
    expect((await adapter(first, p.transport).sendReviewed(i)).status).toBe("uncertain");
    expect(p.sends()).toBe(1);
    for (const [label, body, status] of inconclusive) {
      p.list(body, status);
      const r = await adapter(first, p.transport).sendReviewed(i);
      expect(r.status, label).toBe("uncertain");
    }
    first.runtime.close();
    // Restart: the persisted record is unresolved; the old request is still pending.
    const restarted = await open();
    expect(restarted.runtime.transmissions()[0]?.status).toBe("uncertain");
    for (const [label, body, status] of inconclusive) {
      p.list(body, status);
      const r = await adapter(restarted, p.transport).sendReviewed(i);
      expect(r.status, `${label} after restart`).toBe("uncertain");
    }
    // The old process's response finally arrives: the closed runtime writes nothing.
    p.respondLate();
    await wait(20);
    expect(restarted.runtime.transmissions()[0]?.status).toBe("uncertain");
    expect(p.sends()).toBe(1);
    restarted.runtime.close();
  });

  it("a candidate is evidence only if its stored copy is the exact signed message to the pinned recipient", async () => {
    const { alice, bob, clock } = await world();
    const { propose } = await alicePropose(alice, bob, clock.now());
    const i = await item(alice, propose, clock.now());
    const p = slowRestProvider();
    const a = adapter(alice, p.transport);
    expect((await a.sendReviewed(i)).status).toBe("uncertain");
    p.list({ messages: [{ id: "m1", threadId: "t1" }], resultSizeEstimate: 1 });
    const tampered: Array<[string, (raw: string) => string]> = [
      ["other recipient", (r) => r.replace(/^To: .+\r$/m, "To: mallory@example.org\r")],
      ["added Cc", (r) => r.replace(/^To: (.+)\r$/m, "To: $1\r\nCc: mallory@example.org\r")],
      ["other sender", (r) => r.replace(/^From: .+\r$/m, "From: mallory@example.org\r")],
      ["other Message-ID", (r) => r.replace(/^Message-ID: .+\r$/m, "Message-ID: <x@y.invalid>\r")],
      ["altered subject", (r) => r.replace(/^Subject: (.+)\r$/m, "Subject: $1!\r")],
      [
        "altered text part",
        (r) =>
          r.replace(
            /(Content-Transfer-Encoding: base64\r\n\r\n)[A-Za-z0-9+/=]+/,
            `$1${Buffer.from("Different text").toString("base64")}`,
          ),
      ],
      ["not MIME", () => "garbage"],
    ];
    for (const [label, edit] of tampered) {
      p.editCopy(edit);
      const r = await a.sendReviewed(i);
      expect(r.status, label).toBe("uncertain");
      expect((r as { reason: string }).reason, label).toMatch(/no verified provider copy/);
    }
    // The verified copy (a provider may add headers) reconciles without another send.
    p.editCopy((r) => `X-Provider-Trace: synthetic\r\n${r}`);
    expect(await a.sendReviewed(i)).toEqual({ status: "sent", providerId: "m1", reconciled: true });
    expect(await a.sendReviewed(i)).toEqual({ status: "duplicate", providerId: "m1" });
    expect(p.sends()).toBe(1);
  });
});

describe("phase-3 review — the generic transmission contract", () => {
  async function gate(opts: { dir?: boolean } = {}) {
    const { alice, bob, clock, open } = await world(opts);
    const { propose } = await alicePropose(alice, bob, clock.now());
    const i = await item(alice, propose, clock.now());
    const checked = await adapter(alice, mailbox().transport).revalidate(i);
    if (!checked.ok) throw new Error(checked.reason);
    let sends = 0;
    const transmit = (io: {
      send?: () => Promise<unknown>;
      lookup?: () => Promise<unknown>;
      finalAbsence?: true;
      idempotentResend?: true;
    }) =>
      alice.runtime.transmit(checked.request, {
        ...io,
        send: async () => {
          sends++;
          return (io.send ?? (async () => ({ outcome: "accepted", providerRef: "p1" })))();
        },
      } as TransmissionIo);
    return { alice, transmit, sends: () => sends, open };
  }
  const fail = async () => {
    throw new Error("connection reset");
  };
  const absent = async () => ({ outcome: "absent" });

  it("phase-7 review: a LATE refusal of an idempotent resend keeps the earlier uncertainty (and across a restart)", async () => {
    const g = await gate({ dir: true });
    // Attempt 1 may have been delivered (error after possible acceptance) → uncertain.
    expect((await g.transmit({ idempotentResend: true, send: fail })).status).toBe("uncertain");
    // Attempt 2, an identical resend, times out; its request is still pending.
    const late = deferred<unknown>();
    const second = await g.transmit({ idempotentResend: true, send: () => late.promise });
    expect(second).toMatchObject({ status: "uncertain" });
    // Its late REFUSAL says nothing about attempt 1: the record must stay uncertain.
    late.resolve({ outcome: "rejected", detail: "HTTP 400" });
    await wait(20);
    const rec = g.alice.runtime.transmissions()[0];
    expect(rec).toMatchObject({ status: "uncertain", attempts: 2 });
    expect(rec?.detail).toMatch(/earlier request remains unresolved/);
    // Restart: still uncertain (never "not-sent").
    g.alice.runtime.close();
    const again = await g.open();
    expect(again.runtime.transmissions()[0]).toMatchObject({ status: "uncertain" });
    again.runtime.close();
  });

  it("phase-7 review: a LATE acceptance of an idempotent resend resolves it as sent", async () => {
    const g = await gate();
    expect((await g.transmit({ idempotentResend: true, send: fail })).status).toBe("uncertain");
    const late = deferred<unknown>();
    await g.transmit({ idempotentResend: true, send: () => late.promise });
    late.resolve({ outcome: "accepted", providerRef: "late-2" });
    await wait(20);
    expect(g.alice.runtime.transmissions()[0]).toMatchObject({
      status: "sent",
      providerRef: "late-2",
    });
  });

  it("unchanged Gmail semantics: a late refusal of a FIRST attempt is not-sent", async () => {
    const g = await gate();
    const late = deferred<unknown>();
    expect((await g.transmit({ send: () => late.promise })).status).toBe("uncertain");
    late.resolve({ outcome: "rejected", detail: "HTTP 400" });
    await wait(20);
    expect(g.alice.runtime.transmissions()[0]).toMatchObject({ status: "not-sent" });
  });

  it("absence without declared finality is unknown: no second send", async () => {
    const g = await gate();
    expect((await g.transmit({ send: fail })).status).toBe("uncertain");
    const r = await g.transmit({ lookup: absent });
    expect(r).toMatchObject({ status: "uncertain" });
    expect((r as { detail: string }).detail).toMatch(/does not declare it final/);
    expect(g.sends()).toBe(1);
  });

  it("declared-final absence permits a bounded re-attempt", async () => {
    const g = await gate();
    expect((await g.transmit({ send: fail })).status).toBe("uncertain");
    for (let n = 0; n < 2; n++)
      expect((await g.transmit({ lookup: absent, finalAbsence: true, send: fail })).status).toBe(
        "uncertain",
      );
    const r = await g.transmit({ lookup: absent, finalAbsence: true, send: fail });
    expect((r as { reason: string }).reason).toBe("attempt-limit");
    expect(g.sends()).toBe(3);
  });

  it("a timed-out request still in flight blocks re-attempts, and its late acceptance is recorded", async () => {
    const g = await gate();
    const late = deferred<unknown>();
    const first = await g.transmit({ send: () => late.promise }); // effect timeout 200 ms
    expect(first).toMatchObject({ status: "uncertain" });
    // Even a provider declaring final absence cannot license a resend while ours is pending.
    const r = await g.transmit({ lookup: absent, finalAbsence: true });
    expect((r as { detail: string }).detail).toMatch(/still in flight/);
    expect(g.sends()).toBe(1);
    late.resolve({ outcome: "accepted", providerRef: "late-1" });
    await wait(20);
    expect(g.alice.runtime.transmissions()[0]).toMatchObject({
      status: "sent",
      providerRef: "late-1",
    });
    expect(await g.transmit({})).toEqual({ status: "duplicate", providerRef: "late-1" });
    expect(g.sends()).toBe(1);
  });

  it("a malformed send result is uncertain, never sent", async () => {
    for (const bad of [
      { outcome: "acepted", providerRef: "p1" },
      { outcome: "accepted" },
      { outcome: "accepted", providerRef: "p 1\n" },
      { outcome: "accepted", providerRef: "p1", extra: true },
      { outcome: "rejected" },
      null,
      "accepted",
    ]) {
      const g = await gate();
      const r = await g.transmit({ send: async () => bad });
      expect(r, JSON.stringify(bad)).toEqual({
        status: "uncertain",
        detail: "malformed provider send result",
      });
      expect(g.alice.runtime.transmissions()[0]?.status).toBe("uncertain");
    }
  });

  it("a malformed lookup result is unknown: no reconciliation and no resend", async () => {
    const g = await gate();
    expect((await g.transmit({ send: fail })).status).toBe("uncertain");
    for (const bad of [
      { outcome: "found" },
      { outcome: "found", providerRef: 7 },
      { outcome: "absent", why: "x" },
      { outcome: "gone" },
      undefined,
    ]) {
      const r = await g.transmit({ lookup: async () => bad, finalAbsence: true });
      expect(r, JSON.stringify(bad)).toEqual({
        status: "uncertain",
        detail: "malformed provider lookup result",
      });
    }
    expect(g.sends()).toBe(1);
  });
});
