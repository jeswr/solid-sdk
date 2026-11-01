// AUTHORED-BY Codex GPT-6.1-Sol
import { fromRdf, recordFromTurtle } from "@jeswr/agent-model";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { readFileSync } from "fs";
import { expect, it } from "vitest";
import {
  AGENT_FOOTER,
  asBridgeMessage,
  type BuiltReply,
  CARRIAGE_PROFILES,
  capabilityToTurtle,
  DIRECT,
  type EmailMessage,
  InMemoryChannelAdapter,
  isBridgeMessage,
  toBridgeMessage,
  toRdf,
} from "../src/index.js";
import { createInMemoryDirectBinding } from "../src/testing.js";
import { options } from "./fixtures/signed.js";

it("preserves every legacy BridgeMessage field, including first-header-wins and prototype safety", () => {
  const email: EmailMessage = {
    from: { address: "sender@example.com", displayName: "Example" },
    to: [],
    cc: [],
    replyTo: [],
    textBody: "hello",
    subject: "Subject",
    date: "2026-10-26T00:00:00Z",
    messageId: "test@example.com",
    inReplyTo: "thread@example.com",
    dkimDomain: "example.com",
    jsonLdBlocks: ["{}"],
    calendarParts: ["test calendar"],
    headers: [
      ["x-test", "first"],
      ["x-test", "second"],
      ["__proto__", "safe"],
      ["constructor", "safe"],
    ],
    rawSha256: "a".repeat(64),
    rawByteLength: 12,
    warnings: ["untrusted"],
  };
  const bridge = toBridgeMessage(email);
  expect(bridge).toMatchObject({
    channel: "email",
    sender: { handle: "sender@example.com", displayName: "Example" },
    textBody: "hello",
    subject: "Subject",
    date: email.date,
    messageId: email.messageId,
    threadId: email.inReplyTo,
    dkimDomainClaim: "example.com",
    jsonLdBlocks: ["{}"],
    calendarParts: ["test calendar"],
    rawSha256: email.rawSha256,
    rawByteLength: 12,
    rawMediaType: "message/rfc822",
    warnings: email.warnings,
  });
  expect(Object.getPrototypeOf(bridge.signals)).toBeNull();
  expect(bridge.signals["x-test"]).toBe("first");
  expect(Object.getOwnPropertyDescriptor(bridge.signals, "__proto__")?.value).toBe("safe");
  expect(bridge.signals.constructor).toBe("safe");
  expect(Object.isFrozen(bridge.signals)).toBe(true);
  expect(isBridgeMessage(bridge)).toBe(true);
  expect(asBridgeMessage(bridge)).toBe(bridge);
  expect(asBridgeMessage(email)).toEqual(bridge);
  expect(isBridgeMessage({ ...bridge, rawMediaType: undefined } as never)).toBe(false);
  const empty: EmailMessage = {
    to: [],
    cc: [],
    replyTo: [],
    headers: [],
    textBody: "",
    rawSha256: "b".repeat(64),
    rawByteLength: 0,
    warnings: [],
  };
  expect(toBridgeMessage(empty)).not.toHaveProperty("sender");
  expect(toBridgeMessage({ ...empty, from: { address: "sender@example.com" } }).sender).toEqual({
    handle: "sender@example.com",
  });
});

it("runs the extracted adapter with an explicit parser and records replies", async () => {
  const bridge = {
    channel: "test",
    textBody: "text",
    signals: {},
    rawSha256: "a".repeat(64),
    rawByteLength: 4,
    rawMediaType: "text/plain",
    warnings: [],
  };
  const items = [{ id: "1", raw: "text" }];
  const adapter = new InMemoryChannelAdapter("test", items, () => bridge);
  expect(adapter.channel).toBe("test");
  expect(await adapter.pullInbound()).toBe(items);
  expect(adapter.parse({ id: "1", raw: "text" })).toBe(bridge);
  const reply: BuiltReply = {
    credential: {},
    signed: false,
    inlineHtml: "",
    mimePart: { contentType: "application/ld+json", body: "{}" },
    headers: {},
  };
  await adapter.sendReply({ to: "recipient@example.com" }, reply);
  expect(adapter.sent).toEqual([{ target: { to: "recipient@example.com" }, reply }]);
});

it("defines a frozen profile for every carriage row, with read-only proxies and no structured bridge claims", () => {
  expect(Object.keys(CARRIAGE_PROFILES)).toEqual([
    "email",
    "slack",
    "matrix",
    "teams",
    "a2a",
    "mcp",
    "discord",
    "bluesky",
    "mastodon",
    "telegram",
    "imessage",
    "sms",
    "signal",
    "whatsapp",
    "linkedin",
    "x",
    "direct",
  ]);
  for (const profile of Object.values(CARRIAGE_PROFILES))
    expect(Object.isFrozen(profile)).toBe(true);
  expect(CARRIAGE_PROFILES.email).toMatchObject({
    structured: "mime-part",
    footer: "required",
    maxBytes: 25000000,
  });
  for (const channel of [
    "discord",
    "bluesky",
    "mastodon",
    "telegram",
    "imessage",
    "sms",
    "signal",
    "whatsapp",
  ] as const)
    expect(CARRIAGE_PROFILES[channel]).toMatchObject({
      structured: "footer-url-only",
      footer: "required",
    });
  expect(CARRIAGE_PROFILES.linkedin.maxBytes).toBe(0);
  expect(CARRIAGE_PROFILES.x.maxBytes).toBe(0);
  expect(DIRECT).toMatchObject({ structured: "native", footer: "none" });
  expect(AGENT_FOOTER).toBe(
    "— Sent by Jesse Wright's software agent · how to talk to it: https://jeswr.org/agent · spec: https://jeswr.org/agentic-web",
  );
});

it("serializes the direct descriptor to a golden Turtle fixture through the model's typed mapping", async () => {
  const binding = createInMemoryDirectBinding(options());
  const capability = binding.describe("connected");
  const text = await capabilityToTurtle(capability);
  expect(`# AUTHORED-BY Codex GPT-6.1-Sol\n${text}`).toBe(
    readFileSync(new URL("./fixtures/direct-capability.ttl", import.meta.url), "utf8"),
  );
  expect(await recordFromTurtle(text, capability.id)).toEqual(capability);
  expect(fromRdf(toRdf(capability), capability.id)).toEqual(capability);
  expect(binding.describe("disabled").credentialState).toBe("disabled");
  expect(() => toRdf({ ...capability, credentialState: "invalid" } as never)).toThrow();
  await expect(capabilityToTurtle({ ...capability, maxMessageBytes: -1 })).rejects.toThrow();
});
