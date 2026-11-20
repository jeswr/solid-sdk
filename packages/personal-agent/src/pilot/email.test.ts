// AUTHORED-BY Codex GPT-6
import { createHash } from "node:crypto";
import { FOOTER_LINK, footerText } from "@jeswr/agent-reference/bindings/email-footer";
import { MessageNode } from "@jeswr/agent-reference/model/message-nodes";
import { testKey } from "@jeswr/agent-reference/reference/keys";
import { writeMessagePacket } from "@jeswr/agent-reference/wire/message-packet";
import { describe, expect, it } from "vitest";
import { DirectBus } from "./bindings/direct.js";
import {
  buildEmail,
  carrierFor,
  parseInboundEmail,
  renderHuman,
  validateOutboundEmail,
  verifyProviderCopy,
} from "./bindings/email.js";
import { leaves, parseMime } from "./bindings/mime.js";
import { buildMeetingTerms, MEETING_MODEL, SCHEDULE_OP } from "./domains/scheduling.js";
import { CONFIG_ED25519 } from "./profile/configurations.js";
import { PILOT_PROFILE } from "./profile/vocabulary.js";
import type { AgentRuntime, OutboundMessage } from "./runtime/agent.js";
import { ALICE, BOB, fixedClock, personalPair } from "./scenarios/personal.js";
import { type ProcessedOutbound, prepareOutbound, processInput, ThreadStore } from "./service.js";

async function setup() {
  const clock = fixedClock();
  const pair = await personalPair({ now: clock.now });
  const terms = buildMeetingTerms({
    calendar: pair.alice.calendar,
    title: "catch-up",
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
      expect(item.status, JSON.stringify(item.checks)).toBe("validated-not-sent");
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
  it("checks each footer variant exactly and rejects different plain and HTML variants", async () => {
    const { start, clock } = await setup();
    const out = start.outbound[0] as OutboundMessage;
    const agentDescription = "https://alice.example/agent-description";
    const input = {
      out,
      from: ALICE.email as string,
      to: BOB.email as string,
      date: clock.now(),
      agentDescription,
    };
    const neutral = buildEmail(input);
    const named = buildEmail({ ...input, footer: "named" });
    for (const [built, footer] of [
      [neutral, "neutral"],
      [named, "named"],
    ] as const) {
      const expected = { from: input.from, to: input.to, wire: out.wire, footer, agentDescription };
      const sent = Buffer.from(built.raw);
      const provider = { ...expected, emailMessageId: built.emailMessageId, sent };
      expect(await validateOutboundEmail(built.raw, expected)).toEqual({ ok: true });
      expect(await parseInboundEmail(built.raw)).toMatchObject({
        ok: true,
        parity: "match",
        footer,
      });
      expect(await verifyProviderCopy(sent, provider)).toEqual({ ok: true });
      const other = footer === "neutral" ? "named" : "neutral";
      expect(await validateOutboundEmail(built.raw, { ...expected, footer: other })).toMatchObject({
        ok: false,
      });
      expect(await verifyProviderCopy(sent, { ...provider, footer: other })).toMatchObject({
        ok: false,
      });
      const different = built.raw.replace(agentDescription, "https://other.example/description");
      expect(await validateOutboundEmail(different, expected)).toMatchObject({ ok: false });
      expect(await verifyProviderCopy(Buffer.from(different), provider)).toMatchObject({
        ok: false,
      });
    }
    const htmlPart =
      /Content-Type: text\/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n[A-Za-z0-9+/=\r\n]+(?=--)/;
    const namedHtml = named.raw.match(htmlPart)?.[0];
    if (!namedHtml) throw new Error("Missing named HTML part");
    const mixed = neutral.raw.replace(htmlPart, namedHtml);
    expect(mixed).not.toBe(neutral.raw);
    expect(await parseInboundEmail(mixed)).toMatchObject({
      ok: false,
      reason: "human-parity-mismatch",
    });
    expect(await parseInboundEmail(mixed, { strictParity: false })).toMatchObject({
      ok: true,
      parity: "unverified",
      footer: "unverified",
    });
  });

  it("observes one HTTPS Agent-Description and refuses invalid outbound values", async () => {
    const { start, clock } = await setup();
    const out = start.outbound[0] as OutboundMessage;
    const input = { out, from: ALICE.email as string, to: BOB.email as string, date: clock.now() };
    const agentDescription = "https://alice.example/agent-description";
    const built = buildEmail({ ...input, agentDescription });
    expect(built.raw).toContain(`\r\nAgent-Description: ${agentDescription}\r\n`);
    expect(await parseInboundEmail(built.raw)).toMatchObject({
      ok: true,
      email: { agentDescription, note: expect.stringContaining("unauthenticated") },
    });
    for (const invalid of [
      `${agentDescription}\rInjected: yes`,
      `${agentDescription}\nInjected: yes`,
      "http://alice.example/description",
      `https://alice.example/${"x".repeat(200)}`,
    ])
      expect(() => buildEmail({ ...input, agentDescription: invalid })).toThrow(
        /Agent-Description/,
      );
  });

  it("puts the recipient in To only and uses the fixed link without remote content", async () => {
    const { start, clock } = await setup();
    const out = start.outbound[0] as OutboundMessage;
    const to = BOB.email as string;
    const { raw } = buildEmail({ out, from: ALICE.email as string, to, date: clock.now() });
    expect(raw.split("\r\n").filter((line) => line.includes(to))).toEqual([`To: ${to}`]);
    expect(raw).not.toMatch(/<img|https?:\/\/\S*\?/i);
    const mime = parseMime(raw);
    if (!mime.ok) throw new Error(mime.detail);
    const [plain, html, carrier] = leaves(mime.root);
    expect(plain?.text).toContain(FOOTER_LINK);
    expect(html?.text).toContain(`</pre><p>Sent by ${ALICE.actor}`);
    expect(html?.text).toContain(`<a href="${FOOTER_LINK}">${FOOTER_LINK}</a></p><script`);
    for (const part of [plain, html, carrier]) {
      expect(part?.text).not.toMatch(/<img|https?:\/\/[^\s"<>]*\?/i);
      expect(part?.text).not.toContain(to);
    }
  });

  it("treats a footer pasted into plain mail as no structured content", async () => {
    const footer = footerText({ agent: "Sam's agent", principal: "Sam", variant: "neutral" });
    const raw = `From: sam@fictional.example\r\nTo: lee@fictional.example\r\nAgent-Description: https://sam.example/description\r\n\r\nHello\n\n${footer}`;
    expect(await parseInboundEmail(raw)).toMatchObject({
      ok: false,
      reason: "no-structured-content",
      structuredCopies: 0,
    });
  });

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
  }, 20_000);

  it.each([
    { limit: "expanded packet", expanded: true, data: "x".repeat(400 * 1024) },
    {
      limit: "JSON-LD carrier",
      expanded: false,
      data: createHash("shake256", { outputLength: 46 * 1024 })
        .update("email carrier limit fixture")
        .digest("base64"),
    },
  ])("refuses a signed message above the $limit limit in both directions", async ({
    data,
    expanded,
  }) => {
    const date = fixedClock().now();
    const message = {
      profile: PILOT_PROFILE,
      configuration: CONFIG_ED25519,
      id: "urn:test:email-carrier-bounds",
      conversation: "urn:test:email-conversation",
      kind: "invoke",
      from: { actor: ALICE.actor },
      to: { actor: BOB.actor },
      createdAt: date.toISOString(),
      expiresAt: new Date(date.getTime() + 60_000).toISOString(),
      body: {
        operation: { id: "urn:test:operation", version: "1" },
        input: { data },
        basis: { kind: "public" },
      },
    } as const;
    const key = await testKey("36m/email-carrier-bounds");
    const wire = await writeMessagePacket(MessageNode.toNode(message), {
      suite: "jws",
      key,
      verificationMethod: `urn:awp:key:${key.kid}`,
      created: message.createdAt,
    });
    const out = {
      id: message.id,
      conversation: message.conversation,
      kind: message.kind,
      endpoints: [],
      message,
      wire,
    };
    const from = ALICE.email as string;
    const to = BOB.email as string;
    const { raw } = buildEmail({ out, from, to, date });

    expect(Buffer.byteLength(raw)).toBeLessThan(256 * 1024);
    expect(Buffer.byteLength(JSON.stringify(wire)) > 512 * 1024).toBe(expanded);
    expect(Buffer.byteLength(carrierFor(wire)) > 64 * 1024).toBe(!expanded);
    expect(await parseInboundEmail(raw)).toMatchObject({ ok: false });
    expect(await validateOutboundEmail(raw, { from, to, wire })).toMatchObject({ ok: false });
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
    expect((await parseInboundEmail(built.raw)).ok).toBe(true);

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
    const r2 = await parseInboundEmail(conflicting);
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
