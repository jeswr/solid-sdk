// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { canonicalJson, digestBytes } from "@jeswr/agent-model";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { readFileSync } from "fs";
import { expect, it, vi } from "vitest";
import type { MatrixSendOptions } from "../src/matrix/send.js";
import { createMatrixSend } from "../src/matrix/send.js";
import { AGENT_FOOTER, MATRIX_CONTENT } from "../src/profiles.js";
import { RecordingTokenProvider } from "../src/testing.js";
import type { Wire } from "../src/types.js";
import { event, fixtureTransport, homeserver, roomId, userId } from "./fixtures/matrix.js";
import { account, at, message, signed, verifyMessage } from "./fixtures/signed.js";

const unencrypted = () => [];
function sender(replies: unknown[] = [], patch: Partial<MatrixSendOptions> = {}) {
  const fake = fixtureTransport(replies);
  const tokens = new RecordingTokenProvider();
  const verifyApproval = vi.fn(async () => true);
  const eventIdFor = vi.fn(async () => "$sent");
  const options: MatrixSendOptions = {
    account,
    homeserver,
    userId,
    recipients: new Map([[message.to?.actor as string, roomId]]),
    tokens,
    transport: fake.options,
    verify: verifyMessage,
    verifyApproval,
    eventIdFor,
    now: () => at,
    ...patch,
  };
  return { ...fake, tokens, verifyApproval, eventIdFor, options, send: createMatrixSend(options) };
}
const render = (s: ReturnType<typeof sender>) => s.send.render(signed(), MATRIX_CONTENT);
const live = (s: ReturnType<typeof sender>) => ({
  account,
  tokens: { send: s.tokens.send.bind(s.tokens) },
  dryRun: false,
});
const altered = (wire: Wire, change: Record<string, unknown>): Wire => {
  const bytes = canonicalJson({ ...JSON.parse(wire.bytes), ...change });
  return { ...wire, bytes, digest: digestBytes(bytes) };
};

it("renders a golden event, validates exact bytes, and keeps the proposal ID as idempotent txnId", async () => {
  const s = sender([unencrypted(), { event_id: "$sent" }, unencrypted(), { event_id: "$sent" }]);
  const wire = await render(s);
  const data = JSON.parse(wire.bytes);
  const envelope = data.content["org.jeswr.agent.envelope"];
  expect({
    ...data,
    content: {
      ...data.content,
      "org.jeswr.agent.envelope": { ...envelope, "agent:compactJws": "<signed-fixture>" },
    },
  }).toEqual(
    JSON.parse(readFileSync(new URL("fixtures/matrix-send.json", import.meta.url), "utf8")),
  );
  expect(data.txnId).toBe(message.id);
  expect(data.content.body).toContain(AGENT_FOOTER);
  expect(wire.digest).toBe(digestBytes(wire.bytes));
  // The same proposal signature is stable input; retransmissions retain routing and txn ID.
  const proposal = signed();
  const repeatWire = await s.send.render(proposal, MATRIX_CONTENT);
  expect(await s.send.render(proposal, MATRIX_CONTENT)).toEqual(repeatWire);
  expect(await s.send.validate(repeatWire, proposal)).toEqual({ ok: true });
  for (let attempt = 0; attempt < 2; attempt++)
    expect(await s.send.transmit(repeatWire, live(s))).toEqual({
      outcome: "accepted",
      providerRef: "$sent",
    });
  const sends = s.requests.filter((req) => req.method === "PUT");
  expect(sends).toHaveLength(2);
  expect(sends[0]?.url.href).toBe(sends[1]?.url.href);
  expect(sends[0]?.url.pathname).toBe(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(message.id)}`,
  );
  expect(sends[0]?.body).toBe(canonicalJson(JSON.parse(repeatWire.bytes).content));
  expect(s.verifyApproval).toHaveBeenCalledWith(repeatWire, account);
  expect(s.tokens.calls.map((c) => c.access)).toEqual(["send", "send", "send", "send"]);
  expect(s.send.finalAbsence).toBeUndefined();
});

it("defaults to dry-run with no credentials, approval or network activity", async () => {
  const s = sender();
  const wire = await render(s);
  expect(await s.send.transmit(wire, { account, tokens: s.tokens })).toEqual({
    outcome: "rejected",
    detail: "dry-run",
  });
  expect(s.tokens.calls).toEqual([]);
  expect(s.verifyApproval).not.toHaveBeenCalled();
  expect(s.requests).toEqual([]);
});

it.each([
  { state: [], accepted: true },
  { state: [{ type: "m.room.encryption", state_key: "", content: {} }], accepted: false },
  { state: new Response(null, { status: 403 }), accepted: false },
  { state: new Response("{"), accepted: false },
])("uses only the executor send grant for room preflight, accepted=$accepted", async ({
  state,
  accepted,
}) => {
  const read = vi.fn(async (): Promise<never> => {
    throw new Error("read grant unavailable");
  });
  const send = vi.fn(async (): Promise<never> => {
    throw new Error("construction grant unavailable");
  });
  const s = sender([state, { event_id: "$approved" }], { tokens: { read, send } });
  const wire = await render(s);
  const sending = s.send.transmit(wire, live(s));
  if (accepted) expect(await sending).toEqual({ outcome: "accepted", providerRef: "$approved" });
  else await expect(sending).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(s.tokens.calls.map((c) => c.access)).toEqual(accepted ? ["send", "send"] : ["send"]);
  expect(s.requests.filter((r) => r.method === "PUT")).toHaveLength(accepted ? 1 : 0);
  for (const request of s.requests)
    expect(request.headers.get("authorization")).toBe("Bearer test-send-token-0123456789");
});

it("rejects wrong sender account, bad signatures and proposal substitutions before network effects", async () => {
  const s = sender();
  const wire = await render(s);
  await expect(s.send.transmit(wire, { ...live(s), account: { id: "wrong" } })).rejects.toThrow(
    "account",
  );
  const proposal = signed();
  await expect(
    s.send.render(
      { ...proposal, compactJws: `${proposal.compactJws.slice(0, -4)}AAAA` },
      MATRIX_CONTENT,
    ),
  ).rejects.toThrow();
  await expect(
    s.send.render({ ...proposal, message: { ...message, id: "urn:other" } }, MATRIX_CONTENT),
  ).rejects.toThrow("differs");
  await expect(
    sender([], { verify: async () => ({}) }).send.render(proposal, MATRIX_CONTENT),
  ).rejects.toThrow("differs");
  await expect(
    sender([], { verify: async () => ({ ...message, id: "urn:other" }) }).send.render(
      proposal,
      MATRIX_CONTENT,
    ),
  ).rejects.toThrow("differs");
  expect(s.requests).toEqual([]);
});

it("refuses unpinned recipients, incompatible carriage, unsafe footer/rooms, oversized transaction/wire", async () => {
  const s = sender();
  await expect(s.send.render(signed(), { ...MATRIX_CONTENT, id: "other" })).rejects.toThrow(
    "carriage",
  );
  await expect(
    sender([], { recipients: new Map() }).send.render(signed(), MATRIX_CONTENT),
  ).rejects.toThrow("pinned");
  const withoutRecipient = { ...message };
  delete withoutRecipient.to;
  const noRecipient = signed(withoutRecipient);
  // JSON-safe unsigned shapes are required before rendering.
  await expect(s.send.render(noRecipient, MATRIX_CONTENT)).rejects.toThrow();
  expect(() => sender([], { footer: "bad\nfooter" })).toThrow();
  expect(() => sender([], { recipients: new Map([["actor", "bad"]]) })).toThrow();
  await expect(
    s.send.render(signed({ ...message, id: `urn:${"x".repeat(2048)}` }), MATRIX_CONTENT),
  ).rejects.toThrow();
  await expect(
    s.send.render(signed({ ...message, id: "urn:bad\n" }), MATRIX_CONTENT),
  ).rejects.toThrow();
  const terms = Object.fromEntries(
    ["x", "y", "z"].map((prefix) => [prefix.repeat(12000), "synthetic"]),
  );
  const big = signed({
    ...message,
    kind: "propose",
    body: {
      operation: { id: "urn:example:operation", version: "1" },
      terms,
      termsDigest: digestBytes("synthetic"),
      round: 1,
    },
  });
  await expect(s.send.render(big, MATRIX_CONTENT)).rejects.toThrow("byte cap");
});

it("snapshots recipients and refuses modified routing, human text, digest, media type or extra wire fields", async () => {
  const recipients = new Map([[message.to?.actor as string, roomId]]);
  const s = sender([], { recipients });
  recipients.set(message.to?.actor as string, "!other:example.org");
  const proposal = signed();
  const wire = await s.send.render(proposal, MATRIX_CONTENT);
  expect(JSON.parse(wire.bytes).roomId).toBe(roomId);
  for (const tamper of [
    { digest: "bad" },
    { mediaType: "text/plain" },
    { extra: "refused" },
    { bytes: "x".repeat(65537) },
  ]) {
    const bad = { ...wire, ...tamper };
    expect(await s.send.validate(bad, proposal)).toEqual({ ok: false, reason: "malformed" });
    await expect(s.send.transmit(bad, live(s))).rejects.toThrow("wire");
  }
  for (const change of [
    { roomId: "!other:example.org" },
    { txnId: "urn:other" },
    { content: { ...JSON.parse(wire.bytes).content, body: "injected" } },
  ]) {
    const bad = altered(wire, change);
    expect(await s.send.validate(bad, proposal)).toEqual({
      ok: false,
      reason: "terms-digest-mismatch",
    });
    await expect(s.send.transmit(bad, live(s))).rejects.toThrow("differs");
  }
  expect(s.requests).toEqual([]);
});

it("requires current mandate/approval and refuses plaintext downgrade of encrypted or unknown rooms", async () => {
  for (const encryption of [
    [{ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }],
    new Response(null, { status: 500 }),
    new Response(null, { status: 403 }),
  ]) {
    const s = sender([encryption]);
    await expect(s.send.transmit(await render(s), live(s))).rejects.toThrow("unencrypted");
    expect(s.tokens.calls.map((c) => c.access)).toEqual(["send"]);
  }
  for (const verifyApproval of [async () => false, undefined]) {
    const s = sender([unencrypted()], {
      verifyApproval: verifyApproval as MatrixSendOptions["verifyApproval"],
    });
    await expect(s.send.transmit(await render(s), live(s))).rejects.toThrow("mandate");
    expect(s.requests).toHaveLength(1);
  }
  const s = sender([unencrypted()]);
  const wire = await render(s);
  await expect(
    s.send.transmit(wire, {
      ...live(s),
      tokens: {
        send: async () => ({ access: "read" as "send", accessToken: "synthetic" }),
      },
    }),
  ).rejects.toThrow("scope");
});

it("checks expiry before I/O and again after credential and approval awaits", async () => {
  for (const now of [() => NaN, () => at - 7200000, () => at + 7200000]) {
    const s = sender([], { now });
    const wire = await render(s);
    expect(await s.send.validate(wire, signed())).toMatchObject({ ok: false });
    await expect(s.send.transmit(wire, live(s))).rejects.toThrow("expired");
    expect(s.requests).toHaveLength(0);
  }
  let time = at;
  const s = sender([unencrypted()], { now: () => time });
  const wire = await render(s);
  const original = s.tokens.send.bind(s.tokens);
  s.tokens.send = async (ref) => {
    const grant = await original(ref);
    time = at + 7200000;
    return grant;
  };
  await expect(s.send.transmit(wire, live(s))).rejects.toThrow("expired");
  expect(s.requests).toHaveLength(1);
  expect(s.requests.filter((r) => r.method === "PUT")).toHaveLength(0);
  time = at;
  const t = sender([unencrypted()], {
    now: () => time,
    verifyApproval: async () => {
      time = at + 7200000;
      return true;
    },
  });
  await expect(t.send.transmit(await render(t), live(t))).rejects.toThrow("expired");
  expect(t.requests).toHaveLength(1);
});

it.each([400, 401, 403, 404, 429, 500])("classifies HTTP %i without retry", async (status) => {
  const s = sender([unencrypted(), new Response(null, { status })]);
  await expect(s.send.transmit(await render(s), live(s))).rejects.toThrow(
    status < 429 ? "refused" : "uncertain",
  );
  expect(s.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
});

it.each([
  {},
  { event_id: "bad" },
  new Response("{"),
])("keeps malformed acknowledgements uncertain", async (ack) => {
  const s = sender([unencrypted(), ack]);
  await expect(s.send.transmit(await render(s), live(s))).rejects.toThrow("uncertain");
});

it("reconciles an exact provider event with read credentials even after expiry", async () => {
  let time = at;
  const s = sender([], { now: () => time });
  const wire = await render(s);
  const content = JSON.parse(wire.bytes).content;
  s.queue.push(event("$sent", content));
  time = at + 7200000;
  expect(await s.send.lookup?.(wire)).toEqual({ outcome: "found", providerRef: "$sent" });
  expect(s.requests[0]?.url.pathname).toBe(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/%24sent`,
  );
  expect(s.tokens.calls.map((c) => c.access)).toEqual(["read"]);
  expect(s.verifyApproval).not.toHaveBeenCalled();
  const noRoom = { ...event("$sent", content), room_id: undefined };
  s.queue.push(noRoom);
  expect(await s.send.lookup?.(wire)).toMatchObject({ outcome: "found" });
});

it("never treats unavailable event IDs, misses, unreadable or mismatched events as final absence", async () => {
  for (const eventIdFor of [undefined, async () => undefined, async () => "bad"]) {
    const s = sender([], { eventIdFor });
    expect(await s.send.lookup?.(await render(s))).toMatchObject({ outcome: "unknown" });
    expect(s.requests).toHaveLength(0);
  }
  for (const patch of [
    { event_id: "$wrong" },
    { type: "other" },
    { sender: "@other:example.org" },
    { room_id: "!other:example.org" },
    { content: {} },
  ]) {
    const s = sender();
    const wire = await render(s);
    s.queue.push({ ...event("$sent", JSON.parse(wire.bytes).content), ...patch });
    expect(await s.send.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
  }
  for (const response of [
    unencrypted(),
    new Response(null, { status: 403 }),
    {},
    new Error("provider secret must not escape"),
  ]) {
    const s = sender([response]);
    expect(await s.send.lookup?.(await render(s))).toMatchObject({ outcome: "unknown" });
  }
  const s = sender();
  expect(await s.send.lookup?.({ ...(await render(s)), digest: "bad" })).toMatchObject({
    outcome: "unknown",
  });
});

it("verifies decrypted lookup content and refuses undecryptable encrypted copies", async () => {
  const crypto = { receiveSync: vi.fn(), decrypt: vi.fn() };
  const s = sender([{ ...event("$sent"), type: "m.room.encrypted" }], { crypto });
  const wire = await render(s);
  crypto.decrypt.mockResolvedValue(event("$sent", JSON.parse(wire.bytes).content));
  expect(await s.send.lookup?.(wire)).toMatchObject({ outcome: "found" });
  expect(crypto.decrypt).toHaveBeenCalledWith(expect.any(Object), roomId);
  const noCrypto = sender([{ ...event("$sent"), type: "m.room.encrypted" }]);
  expect(await noCrypto.send.lookup?.(await render(noCrypto))).toMatchObject({
    outcome: "unknown",
  });
  s.queue.push({ ...event("$sent"), type: "m.room.encrypted" });
  crypto.decrypt.mockRejectedValue(new Error("missing key"));
  expect(await s.send.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
});

it("constructs the default transport and clock without provider I/O", () => {
  expect(
    createMatrixSend({
      ...sender().options,
      transport: undefined,
      now: undefined,
      footer: "Custom agent footer",
    }),
  ).toHaveProperty("transmit");
});
