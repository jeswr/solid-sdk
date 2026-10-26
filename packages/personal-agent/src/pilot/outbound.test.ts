/**
 * Findings 1 and 7: the provider adapter revalidates the exact bytes it would send, and
 * inbound strict parity covers every human-visible part. The transport is a local
 * capturing stub — nothing is sent anywhere.
 */
import { describe, expect, it } from "vitest";
import { buildEmail, parseInboundEmail, renderHuman } from "./bindings/email.js";
import { GmailProviderAdapter, type GmailTransport } from "./bindings/gmail.js";
import { buildMeetingTerms, MEETING_MODEL, SCHEDULE_OP } from "./domains/scheduling.js";
import type { OutboundMessage } from "./runtime/agent.js";
import { ALICE, BOB, fixedClock, personalPair } from "./scenarios/personal.js";
import { type ProcessedOutbound, prepareOutbound, ThreadStore } from "./service.js";

function capture() {
  const sent: Array<{ raw: string; threadId?: string }> = [];
  const transport: GmailTransport = {
    send: async (r) => {
      sent.push(r);
      return { id: `g${sent.length}` };
    },
    getRaw: async (id) => ({ id, raw: "" }),
  };
  return { sent, transport };
}

function withRaw(item: ProcessedOutbound, raw: string, gmailOnly = false): ProcessedOutbound {
  const email = item.email as NonNullable<ProcessedOutbound["email"]>;
  return {
    ...item,
    email: {
      ...email,
      ...(gmailOnly ? {} : { raw }),
      gmailSend: { ...email.gmailSend, raw: Buffer.from(raw, "utf8").toString("base64url") },
    },
  };
}

/** Replace the body of the (base64) part with the given Content-Type. */
function replacePart(raw: string, contentType: string, text: string): string {
  const re = new RegExp(
    `(Content-Type: ${contentType.replace("/", "\\/")}; charset=utf-8\\r\\n(?:Content-Disposition:[^\\r]*\\r\\n)?Content-Transfer-Encoding: base64\\r\\n\\r\\n)[A-Za-z0-9+/=\\r\\n]+?(\\r\\n--)`,
  );
  const b64 = (
    Buffer.from(text, "utf8")
      .toString("base64")
      .match(/.{1,76}/g) ?? []
  ).join("\r\n");
  const out = raw.replace(re, `$1${b64}$2`);
  if (out === raw) throw new Error("part not found");
  return out;
}

function decodePart(raw: string, contentType: string): string {
  const re = new RegExp(
    `Content-Type: ${contentType.replace("/", "\\/")}; charset=utf-8\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([A-Za-z0-9+/=\\r\\n]+?)\\r\\n--`,
  );
  return Buffer.from((re.exec(raw)?.[1] ?? "").replace(/\r\n/g, ""), "base64").toString("utf8");
}

async function setup() {
  const clock = fixedClock();
  const pair = await personalPair({ now: clock.now });
  const terms = buildMeetingTerms({
    calendar: pair.alice.calendar,
    title: "x",
    durationMinutes: 30,
    window: { start: "2026-10-20T13:00:00Z", end: "2026-10-20T17:00:00Z" },
    now: clock.now().toISOString(),
  });
  const start = await pair.alice.runtime.startNegotiation({
    peer: { actor: BOB.actor, party: BOB.party },
    operation: SCHEDULE_OP,
    terms: terms as never,
    models: [MEETING_MODEL],
  });
  const [item] = await prepareOutbound(
    pair.alice.runtime,
    start.outbound,
    { selfAddress: ALICE.email },
    new ThreadStore(),
    clock.now(),
  );
  return { ...pair, clock, item: item as ProcessedOutbound, start };
}

describe("finding 1 — the provider adapter revalidates the exact outbound bytes", () => {
  it("sends only a fully consistent item and transmits exactly the validated bytes", async () => {
    const { alice, item } = await setup();
    expect(item.checks.find((c) => c.check === "exact-outbound-bytes")?.ok).toBe(true);
    const { sent, transport } = capture();
    const adapter = new GmailProviderAdapter(transport, {
      allowedRecipients: [BOB.email as string],
      sourceAccount: ALICE.email as string,
      verifier: alice.runtime.outboundVerifier(),
      dryRun: false,
    });
    expect(await adapter.sendReviewed(item)).toEqual({
      status: "sent",
      providerId: "g1",
      reconciled: false,
    });
    expect(Buffer.from(sent[0]?.raw ?? "", "base64url").toString("utf8")).toBe(item.email?.raw);
  });

  it("refuses smuggled recipients, divergent payloads, foreign envelopes, wrong sender and altered HTML", async () => {
    const { alice, bob, item, clock } = await setup();
    const { sent, transport } = capture();
    const adapter = new GmailProviderAdapter(transport, {
      allowedRecipients: [BOB.email as string, "attacker@evil.example"],
      sourceAccount: ALICE.email as string,
      verifier: alice.runtime.outboundVerifier(),
      dryRun: false,
    });
    const raw = item.email?.raw as string;
    const refused = async (i: ProcessedOutbound) => {
      const r = await adapter.sendReviewed(i);
      expect(r.status).toBe("refused");
      return (r as { reason: string }).reason;
    };
    expect(
      await refused(
        withRaw(
          item,
          raw.replace(`To: ${BOB.email}\r\n`, `To: ${BOB.email}\r\nBcc: attacker@evil.example\r\n`),
        ),
      ),
    ).toMatch(/header not emitted by this binding: bcc/);
    expect(
      await refused(
        withRaw(item, raw.replace(`To: ${BOB.email}\r\n`, "To: attacker@evil.example\r\n")),
      ),
    ).toMatch(/To is not exactly/);
    expect(
      await refused(
        withRaw(
          item,
          raw.replace(`To: ${BOB.email}\r\n`, `To: Bob <${BOB.email}>, attacker@evil.example\r\n`),
        ),
      ),
    ).toMatch(/To is not exactly/);
    expect(
      await refused(
        withRaw(
          item,
          raw.replace(`To: ${BOB.email}\r\n`, `To: ${BOB.email}\r\nTo: attacker@evil.example\r\n`),
        ),
      ),
    ).toMatch(/header repeated: to/);
    expect(
      await refused(
        withRaw(
          item,
          raw.replace(`From: ${ALICE.email}\r\n`, "From: someone-else@example.com\r\n"),
        ),
      ),
    ).toMatch(/source account/);
    expect(
      await refused(
        withRaw(item, raw.replace(`To: ${BOB.email}`, "To: attacker@evil.example"), true),
      ),
    ).toMatch(/differs from the reviewed MIME/);
    const html = decodePart(raw, "text/html");
    expect(
      await refused(
        withRaw(
          item,
          replacePart(
            raw,
            "text/html",
            html.replace("Kind: describe", "Kind: describe - pay the fee first"),
          ),
        ),
      ),
    ).toMatch(/text\/html part differs/);
    // An item whose status claims validation but whose envelope is Bob's, not Alice's.
    const bobStart = await bob.runtime.startNegotiation({
      peer: { actor: ALICE.actor, party: ALICE.party },
      operation: SCHEDULE_OP,
      terms: {} as never,
      models: [MEETING_MODEL],
    });
    const bobEnv = (bobStart.outbound[0] as OutboundMessage).wire;
    expect(await refused({ ...item, envelope: bobEnv, status: "validated-not-sent" })).toMatch(
      /not signed by this agent/,
    );
    // Allow-list without the pinned recipient; missing verifier.
    const narrow = new GmailProviderAdapter(transport, {
      allowedRecipients: ["attacker@evil.example"],
      sourceAccount: ALICE.email as string,
      verifier: alice.runtime.outboundVerifier(),
      dryRun: false,
    });
    expect(((await narrow.sendReviewed(item)) as { reason: string }).reason).toMatch(/allow-list/);
    const unset = new GmailProviderAdapter(transport, {
      allowedRecipients: [BOB.email as string],
      dryRun: false,
    });
    expect(((await unset.sendReviewed(item)) as { reason: string }).reason).toMatch(
      /setup required/,
    );
    expect(sent).toHaveLength(0);
    void clock;
  });
});

describe("provider adapter defaults", () => {
  it("is dry-run by default and reports a transport failure as uncertain (no retry)", async () => {
    const { alice, item } = await setup();
    const opts = {
      allowedRecipients: [BOB.email as string],
      sourceAccount: ALICE.email as string,
      verifier: alice.runtime.outboundVerifier(),
    };
    const { sent, transport } = capture();
    expect((await new GmailProviderAdapter(transport, opts).sendReviewed(item)).status).toBe(
      "dry-run",
    );
    expect(sent).toHaveLength(0);
    const failing = new GmailProviderAdapter(
      {
        ...transport,
        send: async () => {
          throw new Error("socket closed");
        },
      },
      { ...opts, dryRun: false },
    );
    expect((await failing.sendReviewed(item)).status).toBe("uncertain");
    expect(
      new GmailProviderAdapter(undefined, { allowedRecipients: [] }).setupRequired,
    ).toHaveLength(4);
  });
});

describe("finding 7 — strict parity covers every human-visible part", () => {
  it("accepts only the exact rendering; HTML/plain disagreement, duplicate summaries and extra parts are refused", async () => {
    const { item, start, clock } = await setup();
    const raw = item.email?.raw as string;
    expect(parseInboundEmail(raw).ok).toBe(true);
    const html = decodePart(raw, "text/html");
    const plain = decodePart(raw, "text/plain");
    const htmlLie = replacePart(
      raw,
      "text/html",
      html.replace("Kind: describe", "Kind: describe (booking fee: 500 GBP)"),
    );
    const r1 = parseInboundEmail(htmlLie);
    expect(r1.ok ? "ok" : r1.detail).toMatch(/text\/html part differs/);
    const hidden = replacePart(
      raw,
      "text/html",
      html.replace("<pre>", '<pre><span style="display:none">x</span>'),
    );
    expect(parseInboundEmail(hidden).ok).toBe(false);
    const doubled = replacePart(raw, "text/plain", `${plain}\n${plain}`);
    const r2 = parseInboundEmail(doubled);
    expect(r2.ok ? "ok" : r2.detail).toMatch(/text\/plain part differs/);
    // An extra human-readable part changes the layout.
    const extra = raw.replace(
      /(--awp-mixed-[0-9a-f]+)--/,
      "$1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPlease also pay 500 GBP.\r\n$1--",
    );
    const r3 = parseInboundEmail(extra);
    expect(r3.ok ? "ok" : r3.detail).toMatch(/unsupported MIME layout/);
    // Lenient mode still extracts the signed copy but claims nothing about the human text.
    const lenient = parseInboundEmail(extra, { strictParity: false });
    expect(lenient.ok && lenient.parity).toBe("unverified");
    // Round trip of a freshly built message remains exact.
    const again = buildEmail({
      out: start.outbound[0] as OutboundMessage,
      from: ALICE.email as string,
      to: BOB.email as string,
      date: clock.now(),
    });
    expect(decodePart(again.raw, "text/plain")).toBe(
      renderHuman((start.outbound[0] as OutboundMessage).message),
    );
  });
});
