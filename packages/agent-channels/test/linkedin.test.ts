// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { parseEmail } from "../../agentic-legacy-bridge/src/email/parse.js";
import { createGmailReader, triageLinkedInNotification } from "../src/gmail.js";
import { toBridgeMessage } from "../src/message.js";
import { AGENT_FOOTER } from "../src/profiles.js";
import { RecordingTokenProvider } from "../src/testing.js";

const raw = (from: string) =>
  `From: ${from}\r\nTo: owner@example.test\r\nSubject: You have a new message\r\nMessage-ID: <notification@example.test>\r\nIn-Reply-To: <thread@example.test>\r\n\r\nA preview, not a complete LinkedIn conversation.`;

it.each([
  "messages-noreply@linkedin.com",
  "notifications-noreply@linkedin.com",
  "updates-noreply@linkedin.com",
  "invitations@linkedin.com",
  "MESSAGES-NOREPLY@LINKEDIN.COM",
])("tags Gmail notifications from %s without changing evidence", (sender) => {
  const tokens = new RecordingTokenProvider();
  const reader = createGmailReader({
    tokens,
    parseEmail,
    recipient: "owner@example.test",
    ownAccounts: new Set(),
    footer: AGENT_FOOTER,
  });
  const bytes = raw(sender);
  const email = toBridgeMessage(parseEmail(bytes));
  expect(reader.ingest.parse({ id: "abc", raw: bytes })).toEqual({
    ...email,
    channel: "linkedin-proxy",
    warnings: [...email.warnings, "linkedin-proxy-unverified"],
  });
  expect(tokens.calls).toEqual([]);
  expect(email.channel).toBe("email");
});

it.each([
  "LinkedIn <attacker@example.test>",
  "messages-noreply@linkedin.com.attacker.test",
  "messages-noreply@notlinkedin.com",
  "messages-noreply@sub.linkedin.com",
  "person@linkedin.com",
])("does not tag lookalikes or unrecognised senders: %s", (sender) => {
  const email = toBridgeMessage(parseEmail(raw(sender)));
  expect(triageLinkedInNotification(email)).toBe(email);
});

it("leaves other channels and absent senders alone; the tag grants no identity", () => {
  const email = toBridgeMessage(parseEmail(raw("messages-noreply@linkedin.com")));
  const other = { ...email, channel: "matrix" };
  const { sender: _sender, ...absent } = email;
  expect(triageLinkedInNotification(other)).toBe(other);
  expect(triageLinkedInNotification(absent)).toBe(absent);
  const tagged = triageLinkedInNotification(email);
  expect(triageLinkedInNotification(tagged)).toBe(tagged);
  expect(tagged.sender).toBe(email.sender);
  expect(tagged.warnings).toContain("linkedin-proxy-unverified");
});
