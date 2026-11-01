// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { digestBytes } from "@jeswr/agent-model";
import { expect, it, vi } from "vitest";
import { parseEmail } from "../../agentic-legacy-bridge/src/email/parse.js";
import { leaves, parseMime } from "../src/email/mime.js";
import { emailMessageIdFor, inspectEmail } from "../src/email-mime.js";
import { createGraphMailSend } from "../src/graph-mail/send.js";
import { AGENT_FOOTER, EMAIL_MIME } from "../src/profiles.js";
import { RecordingTokenProvider } from "../src/testing.js";
import { fixtureTransport, mime, recipient } from "./fixtures/graph.js";
import { account, at, message, signed, verifyMessage } from "./fixtures/signed.js";

function sender(replies: unknown[], extra: Record<string, unknown> = {}) {
  const fake = fixtureTransport(replies);
  const tokens = new RecordingTokenProvider();
  const verifyApproval = vi.fn(async () => true);
  const config = {
    from: "sender@example.test",
    recipients: new Map([[message.to?.actor as string, recipient]]),
    verify: verifyMessage,
    now: () => at,
    account,
    tokens,
    parseEmail,
    verifyApproval,
    transport: fake.options,
    ...extra,
  };
  return { ...fake, config, tokens, verifyApproval, send: createGraphMailSend(config) };
}
const accepted = () => new Response(null, { status: 202 });
const search = (ids: string[]) => ({
  value: ids.map((id) => ({ id, internetMessageId: emailMessageIdFor(message.id) })),
});

it("requires explicit send, exact approved MIME and a separate send grant; projects the reviewed carrier to Graph JSON", async () => {
  const s = sender([accepted()]);
  const proposal = signed();
  const wire = await s.send.render(proposal, EMAIL_MIME);
  const io = { assertAuthority: vi.fn(), account, tokens: s.tokens };
  expect(await s.send.validate(wire, proposal)).toEqual({ ok: true });
  for (const dryRun of [undefined, true])
    expect(await s.send.transmit(wire, { ...io, dryRun })).toEqual({
      outcome: "rejected",
      detail: "dry-run",
    });
  expect(s.tokens.calls).toEqual([]);
  expect(s.verifyApproval).not.toHaveBeenCalled();
  expect(s.requests).toEqual([]);
  await expect(
    s.send.transmit(wire, { ...io, dryRun: false, account: { id: "other" } }),
  ).rejects.toThrow("account differs");
  expect(await s.send.transmit(wire, { ...io, dryRun: false })).toEqual({
    outcome: "accepted",
    providerRef: emailMessageIdFor(message.id),
  });
  expect(s.tokens.calls.map((c) => c.access)).toEqual(["send"]);
  expect(s.verifyApproval).toHaveBeenCalledWith(wire, account);
  const request = s.requests[0] as (typeof s.requests)[number];
  expect(request.url.href).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
  expect(request.method).toBe("POST");
  expect(request.headers.get("content-type")).toBe("application/json");
  const tree = parseMime(wire.bytes);
  if (!tree.ok) throw new Error(tree.detail);
  const parts = leaves(tree.root);
  expect(JSON.parse(request.body)).toEqual({
    message: {
      from: { emailAddress: { address: "sender@example.test" } },
      toRecipients: [{ emailAddress: { address: recipient } }],
      subject: "[Agent] describe",
      internetMessageId: emailMessageIdFor(message.id),
      body: { contentType: "HTML", content: parts[1]?.text },
      internetMessageHeaders: [{ name: "X-Agentic-Reply", value: "1" }],
      attachments: [
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: "agent-message.jsonld",
          contentType: "application/ld+json",
          contentBytes: Buffer.from(parts[2]?.text as string).toString("base64"),
        },
      ],
    },
    saveToSentItems: true,
  });
  expect(request.body).toContain(AGENT_FOOTER);
  expect(request.body).not.toContain("List-Unsubscribe");
});

it("refuses absent approvals, tampered MIME, invalid signatures and wrong-purpose grants without transmission", async () => {
  const s = sender([]);
  const wire = await s.send.render(signed(), EMAIL_MIME);
  const io = { assertAuthority: vi.fn(), account, tokens: s.tokens, dryRun: false };
  for (const verifyApproval of [undefined, async () => false, async () => "yes"]) {
    const refused = sender([], { verifyApproval });
    await expect(refused.send.transmit(wire, io)).rejects.toThrow("approval required");
    expect(refused.requests).toEqual([]);
  }
  for (const bytes of [
    wire.bytes.replace("To: receiver", "To: stranger"),
    "Subject: Plain\r\n\r\nHuman",
  ]) {
    await expect(
      s.send.transmit({ ...wire, bytes, digest: digestBytes(bytes) }, io),
    ).rejects.toThrow("wire differs");
  }
  await expect(s.send.transmit({ ...wire, digest: "changed" }, io)).rejects.toThrow(
    "invalid email wire",
  );
  const badVerifier = sender([], {
    verify: async () => {
      throw new Error("signature refused");
    },
  });
  await expect(badVerifier.send.transmit(wire, io)).rejects.toThrow("signature refused");
  const readGrant = {
    read: vi.fn(),
    send: vi.fn(async () => ({ access: "read", accessToken: "fake-read" })),
  };
  await expect(s.send.transmit(wire, { ...io, tokens: readGrant as never })).rejects.toThrow(
    "wrong-scope",
  );
  expect(readGrant.read).not.toHaveBeenCalled();
  expect(s.requests).toEqual([]);
});

it("rechecks validity after credential and approval awaits and snapshots mutable configuration and wire", async () => {
  let now = at;
  const s = sender([accepted()], { now: () => now, footer: "Fixture agent footer" });
  const wire = { ...(await s.send.render(signed(), EMAIL_MIME)) };
  const io = { assertAuthority: vi.fn(), account, tokens: s.tokens, dryRun: false };
  now = at + 24 * 3600000;
  await expect(s.send.transmit(wire, io)).rejects.toThrow("expired");
  now = at;
  const lateTokens = {
    read: vi.fn(),
    send: async () => {
      now = at + 24 * 3600000;
      return { access: "send" as const, accessToken: "fake-send" };
    },
  };
  await expect(s.send.transmit(wire, { ...io, tokens: lateTokens })).rejects.toThrow("expired");
  now = at;
  s.verifyApproval.mockImplementationOnce(async () => {
    now = at + 24 * 3600000;
    return true;
  });
  await expect(s.send.transmit(wire, io)).rejects.toThrow("expired");
  expect(s.requests).toEqual([]);
  now = at;
  s.config.recipients.set(message.to?.actor as string, "stranger@example.test");
  s.config.from = "stranger@example.test";
  s.config.account = { id: "other" };
  const original = { ...wire };
  s.verifyApproval.mockImplementationOnce(async () => {
    wire.bytes = "tampered";
    wire.digest = digestBytes(wire.bytes);
    return true;
  });
  expect(await s.send.transmit(wire, io)).toMatchObject({ outcome: "accepted" });
  expect(s.verifyApproval).toHaveBeenLastCalledWith(original, account);
  const payload = JSON.parse(s.requests[0]?.body as string);
  expect(payload.message.from.emailAddress.address).toBe("sender@example.test");
  expect(payload.message.toRecipients[0].emailAddress.address).toBe(recipient);
  expect(payload.message.body.content).toContain("Fixture agent footer");
  expect(payload.message.body.content).not.toContain("tampered");
});

it.each([
  400, 401, 403, 429, 500, 503, 200, 204,
])("requires exactly HTTP 202 and distinguishes rejection from uncertainty (%s)", async (status) => {
  const s = sender([new Response(null, { status })]);
  const wire = await s.send.render(signed(), EMAIL_MIME);
  await expect(
    s.send.transmit(wire, { assertAuthority: vi.fn(), account, tokens: s.tokens, dryRun: false }),
  ).rejects.toThrow(status === 400 ? "refused" : "uncertain");
  expect(s.requests).toHaveLength(1);
});

it("refuses redirects and reports sanitized transport uncertainty without retries", async () => {
  for (const response of [
    new Response(null, { status: 302, headers: { location: "https://evil.test/private" } }),
    new Error("sensitive provider detail"),
  ]) {
    const s = sender([response]);
    const wire = await s.send.render(signed(), EMAIL_MIME);
    await expect(
      s.send.transmit(wire, { assertAuthority: vi.fn(), account, tokens: s.tokens, dryRun: false }),
    ).rejects.toThrow("binding transport failed");
    expect(s.requests).toHaveLength(1);
  }
});

it("looks up by internetMessageId with read grants and verifies MIME copies even after expiry", async () => {
  let now = at;
  const s = sender([], { now: () => now });
  const wire = await s.send.render(signed(), EMAIL_MIME);
  s.queue.push(
    search(["deleted", "changed", "match"]),
    new Response(null, { status: 404 }),
    mime(wire.bytes.replace("Subject: [Agent] describe", "Subject: changed")),
    mime(`Received: graph.example.test\r\n${wire.bytes}`),
  );
  now = at + 24 * 3600000;
  expect(await s.send.lookup?.(wire)).toEqual({ outcome: "found", providerRef: "match" });
  expect(s.requests[0]?.url.pathname).toBe("/v1.0/me/messages");
  expect(s.requests[0]?.url.searchParams.get("$filter")).toBe(
    `internetMessageId eq '${emailMessageIdFor(message.id)}'`,
  );
  expect(s.requests[0]?.url.searchParams.get("$top")).toBe("10");
  expect(s.tokens.calls.every((c) => c.access === "read")).toBe(true);
  expect(s.verifyApproval).not.toHaveBeenCalled();
  expect(s.send.finalAbsence).toBeUndefined();
});

it("never treats missing, malformed, unavailable or changed provider copies as final absence", async () => {
  for (const replies of [
    [{ value: [] }],
    [{ value: [], "@odata.nextLink": "unfollowed" }],
    [{}],
    [{ value: {} }],
    [new Response(null, { status: 403 })],
    [search(["a"]), mime("Subject: Different\r\n\r\nOther content")],
    [search(["a"]), mime("")],
  ]) {
    const s = sender(replies);
    const wire = await s.send.render(signed(), EMAIL_MIME);
    expect(await s.send.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
    expect(s.send).not.toHaveProperty("finalAbsence");
  }
  const s = sender([]);
  expect(
    await s.send.lookup?.({ bytes: "bad", mediaType: "message/rfc822", digest: "bad" }),
  ).toMatchObject({ outcome: "unknown" });
});

it("continues past malformed and failed candidates but never fetches more than ten", async () => {
  const s = sender([]);
  const wire = await s.send.render(signed(), EMAIL_MIME);
  const internetMessageId = emailMessageIdFor(message.id);
  s.queue.push(
    {
      value: [
        null,
        { id: "bad", internetMessageId: "different" },
        { id: "../bad", internetMessageId },
        ...search(["failed", "match"]).value,
      ],
    },
    new Response(null, { status: 503 }),
    mime(wire.bytes),
  );
  expect(await s.send.lookup?.(wire)).toEqual({ outcome: "found", providerRef: "match" });
  const bounded = sender([
    search(Array.from({ length: 11 }, (_, i) => `a${i}`)),
    ...Array.from({ length: 10 }, () => new Response(null, { status: 404 })),
  ]);
  expect(await bounded.send.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
  expect(bounded.requests).toHaveLength(11);
  expect(bounded.queue).toEqual([]);
});

it("reconciles transport-generated MIME boundaries and dates without relaxing human parity", async () => {
  const s = sender([], { footer: "Fixture agent footer" });
  const wire = await s.send.render(signed(), EMAIL_MIME);
  const provider = wire.bytes
    .replaceAll("agent-mixed-", "exchange-mixed-")
    .replaceAll("agent-alt-", "exchange-alt-")
    .replace(/^Date: .*\r\n/m, "Date: Mon, 26 Oct 2026 12:00:01 GMT\r\n")
    .replace("Auto-Submitted: auto-generated\r\n", "");
  s.queue.push(search(["provider-copy"]), mime(provider));
  expect(await s.send.lookup?.(wire)).toEqual({ outcome: "found", providerRef: "provider-copy" });
});

it.each([
  "agent-message.jsonld",
  "",
  "=?utf-8?B?YWdlbnQtbWVzc2FnZS5qc29ubGQ=?=",
])("reconciles Exchange attachment descriptions (%s) with STRICT body and carrier checks", async (description) => {
  const s = sender([]);
  const proposal = signed();
  const wire = await s.send.render(proposal, EMAIL_MIME);
  const provider = wire.bytes.replace(
    "Content-Type: application/ld+json;",
    `Content-Description: ${description}\r\nContent-Type: application/ld+json;`,
  );
  expect(
    inspectEmail(provider, { parseEmail, recipient, ownAccounts: new Set([recipient]) }),
  ).toMatchObject({ parity: "match", proposal });
  s.queue.push(search(["exchange-copy"]), mime(provider));
  expect(await s.send.lookup?.(wire)).toEqual({ outcome: "found", providerRef: "exchange-copy" });

  const tree = parseMime(provider);
  if (!tree.ok) throw new Error(tree.detail);
  for (const part of leaves(tree.root)) {
    const encoded = Buffer.from(part.text as string).toString("base64");
    const wrapped = encoded.match(/.{1,76}/g)?.join("\r\n") as string;
    const changed = provider.replace(wrapped, Buffer.from("Changed content").toString("base64"));
    expect(changed).not.toBe(provider);
    s.queue.push(search(["changed-copy"]), mime(changed));
    expect(await s.send.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
  }
  for (const [type, header] of [
    ["text/plain", "Content-Description"],
    ["text/html", "Content-Description"],
    ["application/ld+json", "X-Unreviewed-Metadata"],
  ]) {
    const changed = provider.replace(
      `Content-Type: ${type};`,
      `${header}: extra\r\nContent-Type: ${type};`,
    );
    expect(() =>
      inspectEmail(changed, { parseEmail, recipient, ownAccounts: new Set([recipient]) }),
    ).toThrow("human-parity-mismatch");
    s.queue.push(search(["changed-copy"]), mime(changed));
    expect(await s.send.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
  }
});

it.each([
  ["Software Agent", "Graph Recipient"],
  ['"Agent, Software"', '"Recipient, Graph"'],
  ['"Agent \\"Software\\""', '"Graph <display@example.test>"'],
  ["=?utf-8?B?QWdlbnQ=?=", "=?utf-8?B?UmVjaXBpZW50?="],
  ["", ""],
  ["Software\r\n Agent", "Graph\r\n Recipient"],
])("reconciles single pinned mailboxes with display names (%s, %s)", async (from, to) => {
  const s = sender([]);
  const wire = await s.send.render(signed(), EMAIL_MIME);
  const provider = wire.bytes
    .replace("From: sender@example.test", `From: ${from} <sender@example.test>`)
    .replace(`To: ${recipient}`, `To: ${to} <${recipient}>`);
  s.queue.push(search(["provider-copy"]), mime(provider));
  expect(await s.send.lookup?.(wire)).toEqual({ outcome: "found", providerRef: "provider-copy" });
  s.queue.push(
    search(["changed-copy"]),
    mime(provider.replace("Subject: [Agent] describe", "Subject: changed")),
  );
  expect(await s.send.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
  const changedBody = provider.replace(
    /(Content-Type: text\/plain; charset=utf-8\r\n)Content-Transfer-Encoding: base64\r\n\r\n[A-Za-z0-9+/=\r\n]+/,
    "$1Content-Transfer-Encoding: 7bit\r\n\r\nChanged human text\r\n",
  );
  expect(changedBody).not.toBe(provider);
  s.queue.push(search(["changed-human-copy"]), mime(changedBody));
  expect(await s.send.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
});

it("refuses missing, duplicate, multiple and spoofed mailboxes despite matching signed and human bodies", async () => {
  const s = sender([]);
  const wire = await s.send.render(signed(), EMAIL_MIME);
  for (const [name, address] of [
    ["From", "sender@example.test"],
    ["To", recipient],
  ]) {
    const original = `${name}: ${address}\r\n`;
    for (const value of [
      "",
      `${name}: Software Agent <${address}>\r\n${original}`,
      `${name}: Software Agent <${address}>, Other <stranger@example.test>\r\n`,
      `${name}: ${address}, ${address}\r\n`,
      `${name}: "Software Agent <${address}>" <stranger@example.test>\r\n`,
      `${name}: "Software Agent <${address}>"\r\n`,
      `${name}: ${address} <stranger@example.test>\r\n`,
      `${name}: Software Agent <stranger@example.test> <${address}>\r\n`,
      `${name}: Software Agent <${address}> <stranger@example.test>\r\n`,
      `${name}: Software Agent <${address}>, stranger@example.test\r\n`,
      `${name}: Software Agent <${address}>; stranger@example.test\r\n`,
      `${name}: Group: ${address};\r\n`,
      `${name}: "Unclosed display <${address}>\r\n`,
    ]) {
      s.queue.push(search(["candidate"]), mime(wire.bytes.replace(original, value)));
      expect(await s.send.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
    }
  }
});

it("refuses extra destinations, duplicate or changed headers, broken MIME and changed signed or human copies", async () => {
  const s = sender([]);
  const wire = await s.send.render(signed(), EMAIL_MIME);
  const other = await s.send.render(
    signed({ ...message, id: "urn:example:message:other" }),
    EMAIL_MIME,
  );
  const plain = [
    "From: sender@example.test",
    `To: ${recipient}`,
    "Subject: [Agent] describe",
    `Message-ID: ${emailMessageIdFor(message.id)}`,
    "X-Agentic-Reply: 1",
    "",
    "Human text",
  ].join("\r\n");
  const copies = [
    "broken MIME",
    plain,
    wire.bytes.replace("multipart/alternative", "multipart/mixed"),
    other.bytes.replace(
      emailMessageIdFor("urn:example:message:other"),
      emailMessageIdFor(message.id),
    ),
    ...[
      "Cc: stranger@example.test",
      "Bcc: stranger@example.test",
      "Reply-To: stranger@example.test",
      "Sender: stranger@example.test",
      "Resent-From: stranger@example.test",
      "Resent-To: stranger@example.test",
      "To: receiver@example.test",
      "X-Agentic-Reply: 1",
    ].map((header) => `${header}\r\n${wire.bytes}`),
    wire.bytes.replace("From: sender", "From: stranger"),
    wire.bytes.replace("To: receiver", "To: stranger"),
    wire.bytes.replace("X-Agentic-Reply: 1\r\n", ""),
    wire.bytes.replace(emailMessageIdFor(message.id), "<wrong@example.test>"),
  ];
  for (const copy of copies) {
    s.queue.push(search(["candidate"]), mime(copy));
    expect(await s.send.lookup?.(wire)).toMatchObject({ outcome: "unknown" });
  }
});
