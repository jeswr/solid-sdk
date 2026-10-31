// AUTHORED-BY Codex GPT-6.1-Sol
import { type AnyMessage, canonicalJson, digestBytes, digestOf } from "@jeswr/agent-model";
import { describe, expect, it, vi } from "vitest";
import { parseEmail } from "../../agentic-legacy-bridge/dist/email/index.js";
import { envelope } from "../src/direct/shared.js";
import { renderBodies, renderHuman, summaryLines } from "../src/email/bodies.js";
import { createEmailRenderer } from "../src/email-mime/send.js";
import {
  assertEmailAddress,
  assertFooter,
  decodeEmailProposal,
  emailMessageIdFor,
  inspectEmail,
  MAX_EMAIL_BYTES,
  verifyProviderCopy,
} from "../src/email-mime.js";
import { AGENT_FOOTER, EMAIL_MIME } from "../src/profiles.js";
import { at, message, signed, verifyMessage } from "./fixtures/signed.js";

const from = "sender@example.test";
const recipient = "receiver@example.test";
const config = { parseEmail, recipient, ownAccounts: new Set([recipient]), footer: AGENT_FOOTER };
const renderOptions = {
  from,
  footer: AGENT_FOOTER,
  recipients: new Map([[message.to!.actor, recipient]]),
  verify: verifyMessage,
  now: () => at,
};
const wireFor = async (value: unknown = message) =>
  createEmailRenderer(renderOptions).render(signed(value), EMAIL_MIME);
const rewrite = (raw: string, oldText: string, text: string) =>
  raw.replace(
    Buffer.from(oldText)
      .toString("base64")
      .match(/.{1,76}/g)!
      .join("\r\n"),
    Buffer.from(text)
      .toString("base64")
      .match(/.{1,76}/g)!
      .join("\r\n"),
  );

it("renders exact deterministic MIME with three copies, approved footer and legacy BridgeMessage observations", async () => {
  const renderer = createEmailRenderer(renderOptions);
  const proposal = signed();
  const wire = await renderer.render(proposal, EMAIL_MIME);
  expect(wire).toEqual(await renderer.render(proposal, { ...EMAIL_MIME }));
  expect(wire.bytes).toContain("X-Agentic-Reply: 1\r\n");
  expect(wire.bytes).not.toContain("List-Unsubscribe:");
  expect(wire.digest).toBe(digestBytes(wire.bytes));
  const parsed = inspectEmail(wire.bytes, config);
  expect(parsed).toMatchObject({
    parity: "match",
    proposal,
    message: {
      channel: "email",
      sender: { handle: from },
      rawSha256: wire.digest.slice(8),
      warnings: ["signature-unverified"],
    },
  });
  expect(parsed.message.textBody).toContain(AGENT_FOOTER);
  expect(parsed.message.jsonLdBlocks).toHaveLength(2);
  expect(parsed.message.signals["x-agentic-reply"]).toBe("1");
  expect(await renderer.validate(wire, proposal)).toEqual({ ok: true });
  expect(emailMessageIdFor(message.id)).toMatch(/^<agent-[a-f0-9]{40}@agent.invalid>$/);
  expect(inspectEmail(Buffer.from(wire.bytes), config).parity).toBe("match");
});

it("rejects changed visible parts under STRICT and preserves unverified human mail under LENIENT", async () => {
  const wire = await wireFor();
  const proposal = signed();
  const { human, html, carrier } = renderBodies(message, proposal.compactJws, config.footer);
  for (const altered of [
    rewrite(wire.bytes, human, "different terms"),
    rewrite(wire.bytes, html, `${html}<p>pay me</p>`),
    wire.bytes.replace("Content-Type: text/plain", "X-Untrusted: yes\r\nContent-Type: text/plain"),
    wire.bytes.replace("multipart/alternative", "multipart/mixed"),
    wire.bytes.replace(/--agent-mixed-[a-f0-9]+--\r\n$/, ""),
  ]) {
    expect(() => inspectEmail(altered, config)).toThrow("human-parity-mismatch");
    expect(inspectEmail(altered, { ...config, ownAccounts: new Set() })).toMatchObject({
      parity: "unverified",
      message: { warnings: ["signature-unverified", "human-parity-unverified"] },
    });
  }
  // The trusted receiving account chooses parity; forged To cannot downgrade it.
  expect(() =>
    inspectEmail(
      rewrite(wire.bytes.replace(recipient, "human@example.test"), human, "changed"),
      config,
    ),
  ).toThrow("human-parity-mismatch");
  const changedCarrier = ` ${carrier}`;
  expect(() => inspectEmail(rewrite(wire.bytes, carrier, changedCarrier), config)).toThrow(
    "human-parity-mismatch",
  );
  expect(inspectEmail(wire.bytes, { ...config, recipient: recipient.toUpperCase() }).parity).toBe(
    "match",
  );
  const plain = inspectEmail("Subject: Human\r\n\r\nHello", config);
  expect(plain.parity).toBe("none");
  expect(plain.message.textBody).toBe("Hello");
});

it("fails closed on conflicting/malformed carriers and leaves unrelated JSON-LD untrusted", async () => {
  const raw = (await wireFor()).bytes;
  const withBlocks = (blocks?: readonly string[]) => ({
    ...config,
    parseEmail: () => ({ ...parseEmail(raw), jsonLdBlocks: blocks }),
  });
  for (const block of [
    '{"@type":"agent:SignedMessage",',
    canonicalJson({ "@type": "agent:SignedMessage", "agent:compactJws": 1 }),
    canonicalJson({ "@type": "agent:SignedMessage", "agent:compactJws": "a.b.c" }),
  ])
    expect(() => inspectEmail(raw, withBlocks([block]))).toThrow();
  expect(() =>
    inspectEmail(
      raw,
      withBlocks([
        envelope(signed().compactJws),
        envelope(signed({ ...message, id: "urn:other" }).compactJws),
      ]),
    ),
  ).toThrow("conflicting");
  for (const blocks of [undefined, [], ["not json", "null", "1", '"string"', '{"@type":"Person"}']])
    expect(inspectEmail(raw, withBlocks(blocks)).parity).toBe("none");
  expect(() => inspectEmail("x".repeat(MAX_EMAIL_BYTES + 1), config)).toThrow("byte cap");
  expect(() =>
    inspectEmail(raw, {
      ...config,
      parseEmail: () => {
        throw new Error("parser refused");
      },
    }),
  ).toThrow();
});

it("requires the same signed payload, recipient, every header, bytes and digest at validation", async () => {
  const renderer = createEmailRenderer(renderOptions);
  const proposal = signed();
  const wire = await renderer.render(proposal, EMAIL_MIME);
  const bytes = wire.bytes.replace("To: receiver", "To: stranger");
  expect(await renderer.validate({ ...wire, bytes, digest: digestBytes(bytes) }, proposal)).toEqual(
    { ok: false, reason: "terms-digest-mismatch" },
  );
  for (const bad of [
    { ...wire, digest: "changed" },
    { ...wire, mediaType: "text/plain" },
    { ...wire, bytes: 1 },
    { ...wire, bytes: "x".repeat(MAX_EMAIL_BYTES + 1) },
    { ...wire, extra: "Bcc" },
  ])
    expect(await renderer.validate(bad as never, proposal)).toEqual({
      ok: false,
      reason: "malformed",
    });
  await expect(renderer.render(proposal, { ...EMAIL_MIME, footer: "none" })).rejects.toThrow(
    "carriage",
  );
  await expect(
    renderer.render({ ...proposal, message: { ...message, id: "urn:tampered" } }, EMAIL_MIME),
  ).rejects.toThrow("differs");
  await expect(
    createEmailRenderer({ ...renderOptions, verify: async () => ({}) }).render(
      proposal,
      EMAIL_MIME,
    ),
  ).rejects.toThrow("differs");
  await expect(
    createEmailRenderer({
      ...renderOptions,
      verify: async () => ({ ...message, id: "urn:other" }),
    }).render(proposal, EMAIL_MIME),
  ).rejects.toThrow("differs");
  await expect(
    createEmailRenderer({ ...renderOptions, recipients: new Map() }).render(proposal, EMAIL_MIME),
  ).rejects.toThrow("pinned");
  await expect(
    createEmailRenderer(renderOptions).render(signed({ ...message, to: null }), EMAIL_MIME),
  ).rejects.toThrow();
  for (const now of [() => at + 24 * 3600000, () => at - 24 * 3600000, () => NaN])
    expect(await createEmailRenderer({ ...renderOptions, now }).validate(wire, proposal)).toEqual({
      ok: false,
      reason: "malformed",
    });
  expect(
    await createEmailRenderer({ ...renderOptions, now: undefined }).validate(wire, proposal),
  ).toEqual({ ok: false, reason: "malformed" });
  const cyclic = { ...message, body: {} as Record<string, unknown> };
  cyclic.body.self = cyclic;
  await expect(
    renderer.render({ ...proposal, message: cyclic as never }, EMAIL_MIME),
  ).rejects.toThrow();
  const spy = vi.fn(verifyMessage);
  await expect(
    createEmailRenderer({ ...renderOptions, verify: spy }).render(
      { ...proposal, compactJws: "bad" },
      EMAIL_MIME,
    ),
  ).rejects.toThrow();
  expect(spy).not.toHaveBeenCalled();
});

it("accepts provider-added headers and rejects recipient smuggling, changed signed bytes and original headers", async () => {
  const raw = (await wireFor()).bytes;
  const expected = { sent: raw, config };
  expect(verifyProviderCopy(Buffer.from(`Received: by google.test\r\n${raw}`), expected)).toBe(
    true,
  );
  for (const name of ["Cc", "Bcc", "Resent-To", "Resent-Cc", "Resent-Bcc", "Reply-To", "Sender"])
    expect(
      verifyProviderCopy(Buffer.from(`${name}: stranger@example.test\r\n${raw}`), expected),
    ).toBe(false);
  for (const altered of [
    raw.replace("From: sender", "From: stranger"),
    raw.replace("Subject: [Agent]", "Subject: changed"),
    `To: extra@example.test\r\n${raw}`,
    "not MIME",
    (await wireFor({ ...message, id: "urn:another" })).bytes,
  ])
    expect(verifyProviderCopy(Buffer.from(altered), expected)).toBe(false);
  expect(verifyProviderCopy(Buffer.from(raw), { ...expected, sent: "plain message" })).toBe(false);
});

it("refuses injectable address/footer values and malformed signed payloads", () => {
  for (const value of ["bad", "a@b\r\nBcc:x@y", "Name <a@b>", "a@b,c@d", "x".repeat(255), 1])
    expect(() => assertEmailAddress(value as string)).toThrow();
  for (const value of ["", " ", "x\nline", "\u2028", "x".repeat(2049), 1])
    expect(() => assertFooter(value as string)).toThrow();
  assertFooter(AGENT_FOOTER);
  assertEmailAddress(from);
  for (const value of ["invalid", "a..b", "x".repeat(65537), 1, "a.e30.c", "a._w.c", "a.eA.c"])
    expect(() => decodeEmailProposal(value as string)).toThrow();
  expect(() => createEmailRenderer({ ...renderOptions, from: "a@b\nBcc:c@d" })).toThrow();
  expect(() =>
    createEmailRenderer({ ...renderOptions, recipients: new Map([["actor", "bad"]]) }),
  ).toThrow();
});

it("retains all pilot summary branches and escapes hostile text in HTML", () => {
  const digest = digestBytes("terms");
  const op = { id: "https://example.test/op", version: "1" };
  const bodies = [
    [
      "propose",
      {
        operation: op,
        round: 1,
        termsDigest: digest,
        terms: { candidates: [{ start: "a", end: "b" }], z: "x".repeat(200), bool: true },
      },
    ],
    [
      "accept",
      { proposal: "urn:p", agreement: "urn:a", termsDigest: digest, selection: { x: true } },
    ],
    ["accept", { proposal: "urn:p", agreement: "urn:a", termsDigest: digest }],
    ["refuse", { reason: "malformed", detail: "x".repeat(400) }],
    ["unsupported", { reason: "malformed" }],
    ["indeterminate", { reason: "malformed" }],
    ["invoke", { operation: op, basis: { kind: "public" }, purpose: "urn:purpose" }],
    ["invoke", { operation: op, basis: { kind: "public" } }],
    ["deliver", { operation: op, output: { a: 1 } }],
    ["receipt", { activity: "urn:a", outcome: "success", final: true, observed: { a: 1 } }],
    ["receipt", { activity: "urn:a", outcome: "uncertain" }],
    ["describe", {}],
    ["description", { description: {} }],
  ] as const;
  for (const [kind, body] of bodies) {
    const m = {
      ...message,
      inReplyTo: "urn:previous",
      from: { actor: '<actor>&"\u2028\u2029', operator: "urn:operator", onBehalfOf: "urn:person" },
      kind,
      body,
    } as AnyMessage;
    expect(summaryLines(m).length).toBeGreaterThan(3);
    expect(renderHuman(m, "footer")).toContain("on behalf of");
    expect(renderBodies(m, "<>&\u2028\u2029", "footer").html).toContain(
      "\\u003c\\u003e\\u0026\\u2028\\u2029",
    );
  }
  expect(renderHuman({ ...message, from: {} }, "footer")).toContain("an anonymous client");
});

it("bounds expanded human/HTML MIME bytes even for a bounded signed payload", async () => {
  const terms = Object.fromEntries(
    Array.from({ length: 3 }, (_, i) => ["&".repeat(15500) + i, "value"]),
  );
  const value = {
    ...message,
    kind: "propose",
    body: {
      operation: { id: "urn:op", version: "1" },
      round: 1,
      terms,
      termsDigest: digestOf(terms),
    },
  };
  await expect(wireFor(value)).rejects.toThrow("local byte cap");
});
it("refuses a provider copy whose human rendering is changed", async () => {
  const wire = await wireFor();
  const human = renderHuman(message, config.footer);
  expect(
    verifyProviderCopy(Buffer.from(rewrite(wire.bytes, human, "pay me")), {
      sent: wire.bytes,
      config,
    }),
  ).toBe(false);
});

it("snapshots wire and proposal fields before asynchronous verification", async () => {
  const renderer = createEmailRenderer(renderOptions);
  const proposal = signed();
  const wire = await renderer.render(proposal, EMAIL_MIME);
  let reads = 0;
  const input = {
    mediaType: wire.mediaType,
    digest: wire.digest,
    get bytes() {
      return reads++ === 0 ? wire.bytes : "tampered";
    },
  };
  expect(await renderer.validate(input, proposal)).toEqual({ ok: true });
  expect(reads).toBe(1);
  let messageReads = 0;
  const changingProposal = {
    compactJws: proposal.compactJws,
    get message() {
      messageReads++;
      return message;
    },
  };
  expect(await renderer.render(changingProposal, EMAIL_MIME)).toEqual(wire);
  expect(messageReads).toBe(1);
  let resolve!: () => void;
  const wait = new Promise<void>((done) => {
    resolve = done;
  });
  const delayed = createEmailRenderer({
    ...renderOptions,
    verify: async (jws) => {
      await wait;
      return verifyMessage(jws);
    },
  });
  const pending = delayed.validate(wire, proposal);
  proposal.message = { ...message, createdAt: "2020-01-01T00:00:00Z" };
  resolve();
  // Only the original protected message governs the checked bytes.
  expect(await pending).toEqual({ ok: true });
});

it("cannot extend an expired signed message by editing the proposal during validation", async () => {
  const proposal = signed();
  const renderer = createEmailRenderer(renderOptions);
  const wire = await renderer.render(proposal, EMAIL_MIME);
  let resolve!: () => void;
  const wait = new Promise<void>((done) => {
    resolve = done;
  });
  const delayed = createEmailRenderer({
    ...renderOptions,
    now: () => at + 24 * 3600000,
    verify: async (jws) => {
      await wait;
      return verifyMessage(jws);
    },
  });
  const pending = delayed.validate(wire, proposal);
  proposal.message = { ...message, expiresAt: "2027-01-01T00:00:00Z" };
  resolve();
  expect(await pending).toEqual({ ok: false, reason: "malformed" });
});
