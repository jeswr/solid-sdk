// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { canonicalJson, digestBytes } from "@jeswr/agent-model";
import { expect, it, vi } from "vitest";
import { capabilityToTurtle } from "../src/capability.js";
import { encodeEventContent } from "../src/envelope.js";
import { createMatrixSend, type MatrixSendOptions } from "../src/matrix/send.js";
import {
  describeMatrixBridge,
  detectMatrixBridge,
  type MatrixBridgeChannel,
  parseMatrixMessage,
} from "../src/matrix.js";
import { AGENT_FOOTER, CARRIAGE_PROFILES, MATRIX_CONTENT } from "../src/profiles.js";
import { RecordingTokenProvider } from "../src/testing.js";
import {
  cursor,
  direct,
  event,
  fixtureTransport,
  homeserver,
  reader,
  required,
  roomId,
  userId,
} from "./fixtures/matrix.js";
import { bridgedSync, bridgeGhosts, bridgeState } from "./fixtures/matrix-bridges.js";
import { account, at, limits, message, signed, verifyMessage } from "./fixtures/signed.js";

const channels = ["signal", "whatsapp"] as const;

it("drops permanently redacted bridge ciphertext and its cursor hint without decryption", async () => {
  const redacted = { ...event(), type: "m.room.encrypted", unsigned: { redacted_because: {} } };
  const r = reader([direct, bridgedSync([redacted], [bridgeState("signal")])]);
  const page = await r.binding.ingest.list(account, undefined, limits);
  expect(page.items).toEqual([]);
  expect(JSON.parse(page.next).bridges).toEqual({});
  expect(r.crypto.decrypt).not.toHaveBeenCalled();
});

it.each(
  channels,
)("detects %s ghosts and state, without mistaking bot names or substrings for ghosts", (channel) => {
  expect(detectMatrixBridge(bridgeGhosts[channel])).toBe(channel);
  expect(detectMatrixBridge(bridgeGhosts[channel].replace("@", "@_"))).toBe(channel);
  for (const type of ["m.bridge", "uk.half-shot.bridge"])
    expect(detectMatrixBridge(userId, [bridgeState(channel, type), { type: "unrelated" }])).toBe(
      channel,
    );
  for (const sender of [
    undefined,
    null,
    "@signalbot:example.org",
    "@whatsappbot:example.org",
    "@notsignal_123:example.org",
    "@signal_:example.org",
    "@signal_123:",
  ])
    expect(detectMatrixBridge(sender)).toBeUndefined();
});

it("refuses unsupported, malformed or conflicting bridge state without using state URLs", () => {
  for (const state of [
    [bridgeState("telegram")],
    [null],
    [{ type: "m.bridge", state_key: 1 }],
    [{ ...bridgeState("signal"), content: {} }],
    [bridgeState("signal"), bridgeState("whatsapp")],
  ])
    expect(() => detectMatrixBridge(undefined, state)).toThrow();
  expect(() => detectMatrixBridge(bridgeGhosts.signal, [bridgeState("whatsapp")])).toThrow(
    "conflicting",
  );
  expect(
    detectMatrixBridge(bridgeGhosts.signal, [
      bridgeState("signal"),
      bridgeState("signal", "uk.half-shot.bridge"),
    ]),
  ).toBe("signal");
});

it.each(
  channels,
)("projects %s as plain observation with immutable raw provenance, ignoring forged carriers", (channel) => {
  const value = {
    ...event(),
    sender: bridgeGhosts[channel],
    content: {
      msgtype: "m.text",
      body: "Remote text",
      "org.jeswr.agent.envelope": { malformed: true },
    },
  };
  const raw = JSON.stringify(value);
  const parsed = parseMatrixMessage({ id: "$one", raw });
  expect(parsed).toMatchObject({
    channel,
    sender: { handle: bridgeGhosts[channel] },
    threadId: roomId,
    textBody: "Remote text",
    rawSha256: digestBytes(raw).slice(8),
    rawByteLength: Buffer.byteLength(raw),
  });
  expect(parsed.jsonLdBlocks).toBeUndefined();
});

it.each(
  channels,
)("retains %s state through cursor paging and a reader restart, including decrypted events", async (channel) => {
  const cipher = { ...event("$two"), type: "m.room.encrypted" };
  const r = reader([direct, bridgedSync([event(), cipher], [bridgeState(channel)])]);
  const first = await r.binding.ingest.list(account, undefined, { ...limits, maxItems: 1 });
  const one = required(first.items[0]);
  expect(one.raw).toBe(JSON.stringify(event()));
  expect(r.binding.ingest.parse(one).channel).toBe(channel);
  const restarted = reader([]);
  const second = await restarted.binding.ingest.list(account, first.next, limits);
  const two = required(second.items[0]);
  expect(two.raw).toBe(JSON.stringify(cipher));
  expect(restarted.binding.ingest.parse(two)).toMatchObject({
    channel,
    textBody: "decrypted fixture",
  });
  expect(restarted.requests).toEqual([]);
  expect(JSON.parse(second.next).bridges).toEqual({});
  expect(r.tokens.calls.every((call) => call.access === "read")).toBe(true);
});

it("applies timeline bridge changes in order and processes legacy bridge state in left rooms", async () => {
  const r = reader([
    direct,
    bridgedSync(
      [
        event(),
        bridgeState("signal"),
        event("$two"),
        bridgeState("whatsapp", "m.bridge", bridgeState("signal").state_key),
        event("$three"),
      ],
      [],
    ),
  ]);
  const page = await r.binding.ingest.list(account, undefined, limits);
  expect(page.items.map((item) => r.binding.ingest.parse(item).channel)).toEqual([
    "matrix",
    "signal",
    "whatsapp",
  ]);
  const data = bridgedSync([event()], [bridgeState("whatsapp", "uk.half-shot.bridge")]);
  const left = reader([direct, { ...data, rooms: { leave: data.rooms.join } }]);
  const leftPage = await left.binding.ingest.list(account, undefined, limits);
  expect(left.binding.ingest.parse(required(leftPage.items[0])).channel).toBe("whatsapp");
});

it.each([
  { state: { events: {} } },
  { state: { events: [bridgeState("telegram")] } },
  { state: { events: [{ type: "m.bridge", content: {} }] } },
  { state: { events: [bridgeState("signal"), bridgeState("whatsapp")] } },
])("retains the previous delivery checkpoint on invalid room bridge state", async (patch) => {
  const data = bridgedSync([event()], []);
  const r = reader([
    direct,
    { ...data, rooms: { join: { [roomId]: { ...data.rooms.join[roomId], ...patch } } } },
  ]);
  await expect(r.binding.ingest.list(account, undefined, limits)).rejects.toMatchObject({ roomId });
});

it("never trusts malformed cursor hints or mismatched decrypted/wrapped identities", async () => {
  for (const bridges of [
    [],
    Object.fromEntries([["$one", "telegram"]]),
    Object.fromEntries([["$orphan", "signal"]]),
    { bad: "signal" },
  ])
    await expect(
      reader([]).binding.ingest.list(account, cursor({ pending: [event()], bridges }), limits),
    ).rejects.toThrow();
  const raw = JSON.stringify(event());
  for (const native of [
    { bridge: "telegram", event: event() },
    { bridge: "signal", event: { ...event(), event_id: "$other" } },
    { bridge: "signal", event: { ...event(), room_id: "!other:example.org" } },
    { bridge: "signal", event: { ...event(), sender: "@other:example.org" } },
    { bridge: "signal" },
  ])
    expect(() => parseMatrixMessage({ id: "$one", raw, native: JSON.stringify(native) })).toThrow();
  expect(() =>
    parseMatrixMessage({
      id: "$one",
      raw: JSON.stringify({ ...event(), sender: bridgeGhosts.signal }),
      native: JSON.stringify({
        bridge: "whatsapp",
        event: { ...event(), sender: bridgeGhosts.signal },
      }),
    }),
  ).toThrow("conflicting");
  const decrypted = { ...event(), content: { msgtype: "m.text", body: "x".repeat(65536) } };
  expect(() =>
    parseMatrixMessage({
      id: "$one",
      raw: JSON.stringify({ ...event(), type: "m.room.encrypted" }),
      native: JSON.stringify(decrypted),
    }),
  ).toThrow("bounded");
});

it("ignores structured envelopes supplied by state-identified double puppets", async () => {
  const content = {
    msgtype: "m.text",
    body: "Human fallback",
    ...encodeEventContent(signed().compactJws),
  };
  const r = reader([direct, bridgedSync([event("$one", content)], [bridgeState("signal")])]);
  const page = await r.binding.ingest.list(account, undefined, limits);
  expect(r.binding.ingest.parse(required(page.items[0])).jsonLdBlocks).toBeUndefined();
});

it.each(
  channels,
)("describes the %s logical channel without claiming bridge-wide E2EE, structure or authority", async (channel) => {
  const descriptor = describeMatrixBridge(channel, "connected");
  expect(descriptor).toMatchObject({
    id: `urn:agent:binding:matrix:${channel}`,
    channel,
    binding: "matrix",
    carriage: CARRIAGE_PROFILES[channel].id,
    structuredPayload: false,
    endToEndEncrypted: false,
    sendSupported: true,
    credentialState: "connected",
    rateLimit: { perRecipient: 0, perDay: 0 },
  });
  expect(await capabilityToTurtle(descriptor)).toContain(CARRIAGE_PROFILES[channel].id);
  expect(describeMatrixBridge(channel, "disabled").credentialState).toBe("disabled");
  expect(CARRIAGE_PROFILES[channel].maxBytes).toBe(MATRIX_CONTENT.maxBytes);
});

function sender(
  channel: MatrixBridgeChannel,
  replies: unknown[] = [],
  patch: Partial<MatrixSendOptions> = {},
) {
  const fake = fixtureTransport(replies);
  const tokens = new RecordingTokenProvider();
  const options: MatrixSendOptions = {
    account,
    homeserver,
    userId,
    recipients: new Map([[message.to?.actor as string, roomId]]),
    bridgeRooms: new Map([[roomId, channel]]),
    tokens,
    transport: fake.options,
    verify: verifyMessage,
    verifyApproval: async () => true,
    eventIdFor: async () => "$sent",
    now: () => at,
    ...patch,
  };
  return { ...fake, tokens, options, send: createMatrixSend(options) };
}

it.each(
  channels,
)("renders, approves, transmits and looks up %s footer-only content", async (channel) => {
  const s = sender(channel, [[bridgeState(channel)], { event_id: "$sent" }]);
  const proposal = signed({
    ...message,
    kind: "deliver",
    body: {
      ref: "urn:example:invocation",
      basis: { kind: "invocation", invocation: "urn:example:invocation" },
      operation: { id: "urn:example:operation", version: "1" },
      output: { answer: "15:00" },
    },
  });
  const wire = await s.send.render(proposal, CARRIAGE_PROFILES[channel]);
  const data = JSON.parse(wire.bytes);
  expect(Object.keys(data.content).sort()).toEqual(["body", "msgtype"]);
  expect(data.content.body).toContain(AGENT_FOOTER);
  expect(data.compactJws).toBe(proposal.compactJws);
  expect(await s.send.validate(wire, proposal)).toEqual({ ok: true });
  expect(
    await s.send.transmit(wire, { assertAuthority: vi.fn(), account, tokens: s.tokens }),
  ).toMatchObject({
    detail: "dry-run",
  });
  expect(s.requests).toEqual([]);
  expect(
    await s.send.transmit(wire, {
      assertAuthority: vi.fn(),
      account,
      tokens: s.tokens,
      dryRun: false,
    }),
  ).toEqual({
    outcome: "accepted",
    providerRef: "$sent",
  });
  const outbound = required(s.requests[1]).body;
  expect(JSON.parse(outbound)).toEqual(data.content);
  expect(JSON.parse(outbound).body).toContain('"answer":"15:00"');
  expect(outbound).not.toContain(proposal.compactJws);
  expect(outbound).not.toContain("org.jeswr.agent.envelope");
  expect(required(s.requests[0]).url.pathname).toBe(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state`,
  );
  s.queue.push(event("$sent", data.content));
  expect(await s.send.lookup?.(wire)).toMatchObject({ outcome: "found" });
  expect(s.tokens.calls.map((call) => call.access)).toEqual(["send", "send", "read"]);
  expect(s.send.finalAbsence).toBeUndefined();
});

it.each(
  channels,
)("preserves complete %s body values without summary truncation", async (channel) => {
  const s = sender(channel);
  const longText = `${"Full details ".repeat(40)}final value`;
  const operation = { id: "urn:example:operation", version: "1" };
  const terms = { details: longText, nested: { values: [null, false, 0, "15:00"] } };
  for (const value of [
    { kind: "describe", body: { want: ["operations", "bindings"] } },
    { kind: "description", body: { description: terms } },
    {
      kind: "invoke",
      body: {
        operation,
        basis: { kind: "grant", grant: "urn:example:grant" },
        input: terms,
        purpose: "urn:example:purpose",
      },
    },
    {
      kind: "propose",
      body: { operation, terms, termsDigest: digestBytes(canonicalJson(terms)), round: 1 },
    },
    {
      kind: "deliver",
      body: { ref: "urn:example:invocation", basis: { kind: "public" }, operation, output: terms },
    },
  ]) {
    const proposal = signed({ ...message, ...value });
    const wire = await s.send.render(proposal, CARRIAGE_PROFILES[channel]);
    const text: string = JSON.parse(wire.bytes).content.body;
    const bodyLine = required(text.split("\n").find((line) => line.startsWith("Body: ")));
    expect(JSON.parse(bodyLine.slice("Body: ".length))).toEqual(value.body);
    expect(text.endsWith(AGENT_FOOTER)).toBe(true);
    expect(await s.send.render(proposal, CARRIAGE_PROFILES[channel])).toEqual(wire);
    expect(await s.send.validate(wire, proposal)).toEqual({ ok: true });
  }
  expect(s.requests).toEqual([]);
  expect(s.tokens.calls).toEqual([]);
});

it.each(
  channels,
)("rejects oversized %s bodies instead of truncating their values", async (channel) => {
  const s = sender(channel);
  const proposal = signed({
    ...message,
    kind: "description",
    body: { description: { a: "x".repeat(15000), b: "y".repeat(15000) } },
  });
  await expect(s.send.render(proposal, CARRIAGE_PROFILES[channel])).rejects.toThrow("byte cap");
  expect(s.requests).toEqual([]);
  expect(s.tokens.calls).toEqual([]);
});

it("snapshots trusted bridge pins and refuses different carriage, tampered local signatures and content", async () => {
  const bridgeRooms = new Map<string, MatrixBridgeChannel>([[roomId, "signal"]]);
  const s = sender("signal", [], { bridgeRooms });
  bridgeRooms.set(roomId, "whatsapp");
  const proposal = signed();
  const wire = await s.send.render(proposal, CARRIAGE_PROFILES.signal);
  await expect(s.send.render(proposal, MATRIX_CONTENT)).rejects.toThrow("carriage");
  await expect(s.send.render(proposal, CARRIAGE_PROFILES.whatsapp)).rejects.toThrow("carriage");
  const data = JSON.parse(wire.bytes);
  for (const change of [
    { content: { ...data.content, ...encodeEventContent(proposal.compactJws) } },
    { content: { ...data.content, body: "Changed" } },
    { compactJws: `${proposal.compactJws}x` },
  ]) {
    const bytes = canonicalJson({ ...data, ...change });
    const bad = { ...wire, bytes, digest: digestBytes(bytes) };
    expect(await s.send.validate(bad, proposal)).toMatchObject({ ok: false });
    await expect(
      s.send.transmit(bad, { assertAuthority: vi.fn(), account, tokens: s.tokens, dryRun: false }),
    ).rejects.toThrow();
  }
  expect(s.requests).toEqual([]);
  expect(() => sender("signal", [], { bridgeRooms: new Map([["bad", "signal"]]) })).toThrow();
  expect(() =>
    sender("signal", [], { bridgeRooms: new Map([[roomId, "telegram" as MatrixBridgeChannel]]) }),
  ).toThrow();
});

it.each([
  [],
  [bridgeState("whatsapp")],
  [bridgeState("telegram")],
  [bridgeState("signal"), { type: "m.room.encryption" }],
  [bridgeState("signal"), bridgeState("whatsapp")],
  new Response(null, { status: 404 }),
  new Response("{"),
  {},
])("refuses missing, changed, encrypted, unreadable or unknown bridge state before sending", async (state) => {
  const s = sender("signal", [state]);
  const wire = await s.send.render(signed(), CARRIAGE_PROFILES.signal);
  await expect(
    s.send.transmit(wire, { assertAuthority: vi.fn(), account, tokens: s.tokens, dryRun: false }),
  ).rejects.toThrow();
  expect(s.requests).toHaveLength(1);
  expect(s.tokens.calls.map((call) => call.access)).toEqual(["send"]);
});

it("refuses structured Matrix carriage when a previously native room becomes bridged", async () => {
  const s = sender("signal", [[bridgeState("signal")]], { bridgeRooms: undefined });
  const wire = await s.send.render(signed(), MATRIX_CONTENT);
  await expect(
    s.send.transmit(wire, { assertAuthority: vi.fn(), account, tokens: s.tokens, dryRun: false }),
  ).rejects.toThrow("carriage");
  expect(s.requests).toHaveLength(1);
});

it.each([
  [null],
  [{}],
  [{ type: "", state_key: "", content: {} }],
  [{ type: "m.room.name", content: {} }],
  [{ type: "m.room.name", state_key: "", content: null }],
])("refuses incomplete room-state records before native or bridge sends", async (state) => {
  for (const bridge of [false, true]) {
    const s = sender("signal", [state], bridge ? {} : { bridgeRooms: undefined });
    const wire = await s.send.render(signed(), bridge ? CARRIAGE_PROFILES.signal : MATRIX_CONTENT);
    await expect(
      s.send.transmit(wire, { assertAuthority: vi.fn(), account, tokens: s.tokens, dryRun: false }),
    ).rejects.toThrow();
    expect(s.requests).toHaveLength(1);
    expect(s.tokens.calls.map((call) => call.access)).toEqual(["send"]);
  }
});
