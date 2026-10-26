import { describe, expect, it } from "vitest";
import { DirectBus } from "./bindings/direct.js";
import { buildEmail, carrierFor, parseInboundEmail, renderHuman } from "./bindings/email.js";
import { buildMeetingTerms, MEETING_MODEL, SCHEDULE_OP } from "./domains/scheduling.js";
import type { AgentRuntime, OutboundMessage } from "./runtime/agent.js";
import { ALICE, BOB, fixedClock, personalPair } from "./scenarios/personal.js";
import { type ProcessedOutbound, prepareOutbound, processInput, ThreadStore } from "./service.js";

async function setup() {
  const clock = fixedClock();
  const pair = await personalPair({ now: clock.now });
  const terms = buildMeetingTerms({
    calendar: pair.alice.calendar,
    title: "Synthetic catch-up",
    durationMinutes: 30,
    window: { start: "2026-10-20T08:00:00Z", end: "2026-10-23T17:00:00Z" },
    now: clock.now().toISOString(),
  });
  const start = await pair.alice.runtime.startNegotiation({
    peer: { actor: BOB.actor, party: BOB.party },
    operation: SCHEDULE_OP,
    terms: terms as never,
    models: [MEETING_MODEL],
  });
  return { clock, ...pair, start };
}

/** Carry messages between two agents ONLY as provider payloads (Gmail JSON), bounded. */
async function relayByGmail(
  a: AgentRuntime,
  b: AgentRuntime,
  first: readonly ProcessedOutbound[],
  now: () => Date,
) {
  const threads = new Map<AgentRuntime, ThreadStore>([
    [a, new ThreadStore()],
    [b, new ThreadStore()],
  ]);
  const settings = (rt: AgentRuntime) => ({ selfAddress: rt === a ? ALICE.email : BOB.email });
  let queue: Array<{ to: AgentRuntime; item: ProcessedOutbound }> = first.map((item) => ({
    to: b,
    item,
  }));
  const log: string[] = [];
  for (let hop = 0; queue.length > 0 && hop < 30; hop++) {
    const next: typeof queue = [];
    for (const { to, item } of queue) {
      expect(item.status).toBe("validated-not-sent");
      const gmailMessage = {
        id: `m${hop}`,
        threadId: "18c0ffee00000001",
        raw: item.email?.gmailSend.raw,
      };
      const report = await processInput(
        to,
        { format: "gmail-json", data: Buffer.from(JSON.stringify(gmailMessage)) },
        { ...settings(to), strictParity: true },
        threads.get(to) as ThreadStore,
        now(),
      );
      log.push(`${item.kind}->${report.step?.disposition}`);
      const other = to === a ? b : a;
      for (const o of report.outbound) next.push({ to: other, item: o });
    }
    queue = next;
  }
  return log;
}

describe("email binding", () => {
  it("completes the same negotiation when every hop is a Gmail raw payload", async () => {
    const { clock, alice, bob, start } = await setup();
    const first = await prepareOutbound(
      alice.runtime,
      start.outbound,
      { selfAddress: ALICE.email },
      new ThreadStore(),
      clock.now(),
    );
    expect(first[0]?.email?.to).toBe(BOB.email);
    expect(first[0]?.email?.raw).toMatch(
      /AUTOMATED MESSAGE - SYNTHETIC TEST|QVVUT01BVEVEIE1FU1NBR0U/,
    );
    const log = await relayByGmail(alice.runtime, bob.runtime, first, clock.now);
    expect(log.every((l) => l.endsWith("accepted"))).toBe(true);
    const conv = start.conversation as string;
    expect(alice.runtime.conversation(conv)?.phase).toBe("completed");
    expect(bob.runtime.conversation(conv)?.phase).toBe("completed");

    // Semantic parity with the direct binding: same agreement terms digest + same slot.
    const direct = await setup();
    const bus = new DirectBus()
      .register(direct.alice.runtime, direct.bob.runtime)
      .send(direct.alice.runtime, direct.start);
    await bus.run();
    const viaEmail = alice.runtime.agreements()[0];
    const viaDirect = direct.alice.runtime.agreements()[0];
    expect(viaEmail?.termsDigest).toBe(viaDirect?.termsDigest);
    expect(viaEmail?.selection).toEqual(viaDirect?.selection);
  });

  it("labels software representation and synthetic scope in the human fallback", async () => {
    const { start } = await setup();
    const text = renderHuman((start.outbound[0] as OutboundMessage).message);
    expect(text).toContain("AUTOMATED MESSAGE - SYNTHETIC TEST");
    expect(text).toContain(`software agent (${ALICE.actor}) on behalf of ${ALICE.party}`);
    expect(text).toContain("not evidence of authority");
  });

  it("refuses plain email, conflicting structured copies and edited human summaries", async () => {
    const { clock, alice, bob, start } = await setup();
    const out = start.outbound[0] as OutboundMessage;
    const built = buildEmail({
      out,
      from: ALICE.email as string,
      to: BOB.email as string,
      date: clock.now(),
    });
    expect(parseInboundEmail(built.raw).ok).toBe(true);

    const plain =
      "From: alice.awp@example.com\r\nTo: bob.awp@example.com\r\nSubject: hi\r\n\r\nCan we meet Tuesday?\r\n";
    const r1 = await processInput(
      bob.runtime,
      { format: "eml", data: plain },
      { selfAddress: BOB.email },
      new ThreadStore(),
      clock.now(),
    );
    expect(r1.input?.bindingOutcome).toBe("no-structured-content");
    expect(r1.outbound).toHaveLength(0);

    // A second, different signed copy (another valid message from Alice) in the same email.
    const other = await alice.runtime.startNegotiation({
      peer: { actor: BOB.actor, party: BOB.party },
      operation: SCHEDULE_OP,
      terms: {} as never,
      models: [MEETING_MODEL],
    });
    const otherCarrier = carrierFor((other.outbound[0] as OutboundMessage).wire);
    const conflicting = built.raw.replace(
      /--awp-mixed-([0-9a-f]+)--/,
      (m, b) =>
        `--awp-mixed-${b}\r\nContent-Type: application/ld+json\r\n\r\n${otherCarrier}\r\n${m}`,
    );
    const r2 = parseInboundEmail(conflicting);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("conflicting-structured-copies");

    // Human text edited (e.g. a forwarder changes the displayed time): strict parity rejects.
    const original = renderHuman(out.message);
    const human = original.replace(
      "Kind: describe",
      "Kind: describe (URGENT: pay the booking fee first)",
    );
    expect(human).not.toBe(original);
    const edited = buildEmail({
      out,
      from: ALICE.email as string,
      to: BOB.email as string,
      date: clock.now(),
    }).raw.replace(
      /Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n[A-Za-z0-9+/=\r\n]+?\r\n--/,
      `Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(human).toString("base64")}\r\n--`,
    );
    const r3 = await processInput(
      bob.runtime,
      { format: "eml", data: edited },
      { selfAddress: BOB.email },
      new ThreadStore(),
      clock.now(),
    );
    expect(r3.input?.bindingOutcome).toBe("human-parity-mismatch");
    expect(bob.ledger.entries().filter((e) => e.record.type === "binding-rejection").length).toBe(
      2,
    );
  });
});
