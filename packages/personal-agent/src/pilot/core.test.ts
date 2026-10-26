import { describe, expect, it } from "vitest";
import { digestOf } from "./core/canonical.js";
import { openConversation, transition } from "./core/conversation.js";
import { BoundsError, DEFAULT_LIMITS, parseBoundedJson, resolveLimits } from "./core/limits.js";
import { validateMessage } from "./core/schema.js";
import type { AnyMessage } from "./core/types.js";
import { ENERGY_PLANS_OP, RetailerPlansHandler } from "./domains/energy.js";
import {
  buildMeetingTerms,
  MEETING_MODEL,
  SCHEDULE_OP,
  SyntheticCalendar,
} from "./domains/scheduling.js";
import { schedulingMandate } from "./mandates.js";
import { generateSigningKey } from "./mechanisms/jws.js";
import { TrustStore } from "./mechanisms/trust.js";
import { CONFIG_PUBLIC } from "./profile/configurations.js";
import { PILOT_PROFILE } from "./profile/vocabulary.js";
import { AgentRuntime } from "./runtime/agent.js";
import { craftSigned } from "./scenarios/common.js";
import { BOB, fixedClock, personalPair } from "./scenarios/personal.js";
import { provisionAgent } from "./setup.js";
import { MemoryLedger, verifyLedger } from "./store/ledger.js";
import { MemoryStateStore } from "./store/state.js";

const msg = (kind: string, body: object, extra: object = {}) =>
  ({
    profile: "p:x",
    configuration: "c:x",
    id: `urn:m:${kind}${Math.random()}`,
    conversation: "urn:c",
    kind,
    from: {},
    createdAt: "2026-10-19T08:00:00Z",
    expiresAt: "2026-10-19T09:00:00Z",
    body,
    ...extra,
  }) as unknown as AnyMessage;

describe("bounded input", () => {
  it("rejects oversize, deep, wide and non-JSON input before use", () => {
    expect(() => parseBoundedJson("[".repeat(10_000))).toThrow(BoundsError);
    expect(() => parseBoundedJson(`"${"x".repeat(70_000)}"`)).toThrow(/exceeds/);
    expect(() => parseBoundedJson(JSON.stringify(Array.from({ length: 600 }, () => 1)))).toThrow(
      /array/,
    );
    expect(() => parseBoundedJson("{not json")).toThrow(/not valid JSON/);
    expect(() => resolveLimits({ maxJsonDepth: 0 })).toThrow(RangeError);
    expect(parseBoundedJson('{"a":[1,{"b":"\\"["}]}', DEFAULT_LIMITS)).toEqual({
      a: [1, { b: '"[' }],
    });
  });

  it("refuses unknown fields in the envelope as unsupported-term, not silently ignored", () => {
    const r = validateMessage({ ...msg("describe", {}), extraConsequentialField: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported-term");
  });
});

describe("conversation state machine", () => {
  const limits = { maxMessagesPerConversation: 8, maxProposalRounds: 2 };
  const open = () =>
    openConversation({
      id: "urn:c",
      role: "initiator",
      peer: { actor: "urn:peer" },
      at: "2026-10-19T08:00:00Z",
    });
  const at = "2026-10-19T08:00:00Z";

  it("forbids accepting one's own offer, accepting a non-open offer, and changed digests", () => {
    const p = msg("propose", {
      operation: { id: "urn:op", version: "1" },
      terms: {},
      termsDigest: "d1",
      round: 1,
    });
    const s1 = transition(open(), { type: "message", direction: "out", message: p, at }, limits);
    expect(s1.ok).toBe(true);
    if (!s1.ok) return;
    const own = transition(
      s1.state,
      {
        type: "message",
        direction: "out",
        message: msg("accept", { proposal: p.id, termsDigest: "d1", agreement: "urn:a" }),
        at,
      },
      limits,
    );
    expect(own.ok).toBe(false);
    const other = transition(
      s1.state,
      {
        type: "message",
        direction: "in",
        message: msg("accept", { proposal: "urn:other", termsDigest: "d1", agreement: "urn:a" }),
        at,
      },
      limits,
    );
    expect(other.ok).toBe(false);
    const changed = transition(
      s1.state,
      {
        type: "message",
        direction: "in",
        message: msg("accept", { proposal: p.id, termsDigest: "d2", agreement: "urn:a" }),
        at,
      },
      limits,
    );
    expect(changed.ok ? "ok" : changed.reason).toBe("terms-digest-mismatch");
  });

  it("bounds counter-proposal rounds and closes terminal conversations", () => {
    const p1 = msg("propose", {
      operation: { id: "urn:op", version: "1" },
      terms: {},
      termsDigest: "d1",
      round: 1,
    });
    let s = transition(open(), { type: "message", direction: "out", message: p1, at }, limits);
    if (!s.ok) throw new Error("x");
    const p2 = msg("propose", {
      operation: { id: "urn:op", version: "1" },
      terms: {},
      termsDigest: "d2",
      round: 2,
      counters: p1.id,
    });
    s = transition(s.state, { type: "message", direction: "in", message: p2, at }, limits);
    if (!s.ok) throw new Error("x");
    const p3 = msg("propose", {
      operation: { id: "urn:op", version: "1" },
      terms: {},
      termsDigest: "d3",
      round: 3,
      counters: p2.id,
    });
    const over = transition(
      s.state,
      { type: "message", direction: "out", message: p3, at },
      limits,
    );
    expect(over.ok ? "ok" : over.reason).toBe("round-limit");
    const refused = transition(
      s.state,
      {
        type: "message",
        direction: "out",
        message: msg("refuse", { ref: p2.id, reason: "no-acceptable-slot" }),
        at,
      },
      limits,
    );
    if (!refused.ok) throw new Error("x");
    const after = transition(
      refused.state,
      {
        type: "message",
        direction: "in",
        message: msg("receipt", {
          ref: "urn:a",
          activity: "urn:x",
          outcome: "completed",
          final: true,
        }),
        at,
      },
      limits,
    );
    expect(after.ok ? "ok" : after.reason).toBe("conversation-closed");
  });

  it("never upgrades an uncertain outcome to completion", () => {
    const base = {
      ...open(),
      phase: "agreed" as const,
      agreement: "urn:a",
      requiredOutcomes: ["self", "peer"] as const,
    };
    const u = transition(
      base,
      {
        type: "message",
        direction: "out",
        message: msg("receipt", { ref: "urn:a", activity: "urn:x", outcome: "uncertain" }),
        at,
      },
      limits,
    );
    if (!u.ok) throw new Error("x");
    expect(u.state.phase).toBe("uncertain");
    const peer = transition(
      u.state,
      {
        type: "message",
        direction: "in",
        message: msg("receipt", {
          ref: "urn:a",
          activity: "urn:y",
          outcome: "completed",
          final: true,
        }),
        at,
      },
      limits,
    );
    if (!peer.ok) throw new Error("x");
    expect(peer.state.phase).toBe("uncertain");
  });
});

describe("trust store and ledger", () => {
  it("refuses corrupt pins, private keys and one subject pinned in two roles", async () => {
    const { key, privateJwk } = await generateSigningKey("EdDSA");
    const pin = {
      role: "actor" as const,
      subject: "urn:a",
      kid: key.kid,
      alg: key.alg,
      publicJwk: key.publicJwk,
    };
    await expect(
      TrustStore.load({
        version: 1,
        owner: "urn:o",
        keys: [{ ...pin, kid: "x".repeat(43) }],
        sourceAuthority: [],
      }),
    ).rejects.toThrow(/does not match/);
    await expect(
      TrustStore.load({
        version: 1,
        owner: "urn:o",
        keys: [{ ...pin, publicJwk: privateJwk }],
        sourceAuthority: [],
      }),
    ).rejects.toThrow();
    const other = (await generateSigningKey("EdDSA")).key;
    await expect(
      TrustStore.load({
        version: 1,
        owner: "urn:o",
        keys: [pin, { ...pin, role: "party", kid: other.kid, publicJwk: other.publicJwk }],
        sourceAuthority: [],
      }),
    ).rejects.toThrow(/two roles/);
  });

  it("detects a modified ledger entry", () => {
    const l = new MemoryLedger();
    l.append({ type: "a", v: 1 }, "t1");
    l.append({ type: "b", v: 2 }, "t2");
    const entries = l.entries().map((e) => ({ ...e }));
    expect(verifyLedger(entries).ok).toBe(true);
    (entries[0] as { record: unknown }).record = { type: "a", v: 999 };
    expect(verifyLedger(entries)).toMatchObject({
      ok: false,
      firstBadSeq: 1,
      problem: "hash mismatch",
    });
  });

  it("digests are canonical (key order independent)", () => {
    expect(digestOf({ b: 1, a: [1, 2] })).toBe(digestOf({ a: [1, 2], b: 1 }));
  });
});

describe("replay conflict with a genuine key", () => {
  it("rejects a second, different message reusing an already-seen id", async () => {
    const clock = fixedClock();
    const { alice, bob } = await personalPair({ now: clock.now });
    const cal = new SyntheticCalendar(structuredClone(alice.calendar.data));
    const terms = buildMeetingTerms({
      calendar: cal,
      title: "x",
      durationMinutes: 30,
      window: { start: "2026-10-20T13:00:00Z", end: "2026-10-20T17:00:00Z" },
      now: clock.now().toISOString(),
    });
    const start = await alice.runtime.startNegotiation({
      peer: { actor: BOB.actor, party: BOB.party },
      operation: SCHEDULE_OP,
      terms: terms as never,
      models: [MEETING_MODEL],
    });
    const describe = start.outbound[0];
    if (!describe) throw new Error("no describe");
    expect((await bob.runtime.receive(describe.wire)).disposition).toBe("accepted");
    const sameId = await craftSigned(alice.provisioned, {
      ...describe.message,
      body: { want: ["something-else"] },
    });
    expect((await bob.runtime.receive(sameId)).reason).toBe("replay-conflict");
  });
});

describe("unauthenticated traffic cannot pin the conversation budget", () => {
  it("refuses at the cap, then accepts again once idle anonymous conversations expire", async () => {
    const clock = fixedClock();
    const service = await provisionAgent({
      identity: {
        name: "retailer",
        party: "https://r.example/#org",
        actor: "https://r.example/agents/plans#service",
      },
      now: clock.now(),
      mandate: schedulingMandate([]),
      representationOperations: [ENERGY_PLANS_OP.id],
    });
    const rt = await AgentRuntime.create({
      identity: { actor: service.identity.actor, party: service.identity.party },
      actorKeys: [service.actorKey],
      trust: await TrustStore.load(service.trust),
      accepted: [CONFIG_PUBLIC],
      handlers: [new RetailerPlansHandler(service.identity.party, [])],
      store: new MemoryStateStore(),
      ledger: new MemoryLedger(),
      now: clock.now,
      limits: { maxOpenConversations: 2 },
    });
    const describe = (n: number) => ({
      format: "awp-unsigned-json/0.1",
      payload: JSON.stringify({
        profile: PILOT_PROFILE,
        configuration: CONFIG_PUBLIC,
        id: `urn:uuid:00000000-0000-4000-8000-00000000000${n}`,
        conversation: `urn:uuid:00000000-0000-4000-8000-10000000000${n}`,
        kind: "describe",
        from: {},
        to: { actor: service.identity.actor },
        createdAt: clock.now().toISOString(),
        expiresAt: new Date(clock.now().getTime() + 3_600_000).toISOString(),
        body: {},
      }),
    });
    expect((await rt.receive(describe(1))).disposition).toBe("accepted");
    expect((await rt.receive(describe(2))).disposition).toBe("accepted");
    expect((await rt.receive(describe(3))).reason).toBe("capacity");
    clock.advance(16 * 60_000);
    expect((await rt.receive(describe(4))).disposition).toBe("accepted");
  });
});
