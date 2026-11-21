// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.2 Sol
import {
  type BridgeMessage,
  encodeEnvelope,
  encodeEnvelopeObject,
  encodeEventContent,
  type InboundRawMessage,
} from "@jeswr/agent-channels";
import { createDirectReader } from "@jeswr/agent-channels/direct";
import { createDiscordReader } from "@jeswr/agent-channels/discord";
import { inspectEmail } from "@jeswr/agent-channels/email-mime";
import { createGithubReader } from "@jeswr/agent-channels/github";
import { createGmailReader } from "@jeswr/agent-channels/gmail";
import { createGraphMailReader } from "@jeswr/agent-channels/graph-mail";
import { createMastodonReader } from "@jeswr/agent-channels/mastodon";
import { RecordingTokenProvider } from "@jeswr/agent-channels/testing";
import { createXReader, createXSpendCounter } from "@jeswr/agent-channels/x";
import type { Message } from "@jeswr/agent-model";
import { CONFIG_ED25519, PILOT_PROFILE } from "@jeswr/agent-reference";
import { parseEmail } from "@jeswr/agentic-legacy-bridge";
import { readFileSync } from "fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { renderBodies } from "../../../packages/agent-channels/src/email/bodies.js";
import {
  fixtureTransport,
  raw as goldenMail,
  mime,
  recipient,
} from "../../../packages/agent-channels/test/fixtures/graph.js";
import * as matrix from "../../../packages/agent-channels/test/fixtures/matrix.js";
import { account as deviceAccount } from "../../../packages/agent-channels/test/fixtures/signed.js";
import * as teams from "../../../packages/agent-channels/test/fixtures/teams.js";
import { createTestGate } from "../src/testing.js";

const account = { id: "fixture" };
const limits = { maxItems: 10, maxBytes: 1024 * 1024 };
const footer = "Sent by a fictional software agent for its fictional owner.";
const mailConfig = { parseEmail, footer, recipient, ownAccounts: new Set([recipient]) };
const readFixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(
      new URL(`../../../packages/agent-channels/test/fixtures/${name}.json`, import.meta.url),
      "utf8",
    ),
  );

let fixture: Awaited<ReturnType<typeof createTestGate>>;
let message: Message<"describe">;
let validJws: string;
let alteredJws: string;
beforeAll(async () => {
  fixture = await createTestGate();
  message = {
    profile: PILOT_PROFILE,
    configuration: CONFIG_ED25519,
    id: "urn:uuid:00000000-0000-4000-8000-000000000020",
    conversation: "urn:uuid:00000000-0000-4000-8000-100000000020",
    kind: "describe",
    from: { actor: fixture.peer.identity.actor },
    to: { actor: fixture.receiver.identity.actor },
    createdAt: fixture.now().toISOString(),
    expiresAt: "2026-10-19T09:00:00.000Z",
    body: {},
  };
  validJws = await fixture.sign(message);
  const [header, payload, signature] = validJws.split(".") as [string, string, string];
  const bytes = Buffer.from(signature, "base64url");
  bytes[0] = (bytes[0] as number) ^ 1;
  alteredJws = `${header}.${payload}.${bytes.toString("base64url")}`;
});
afterAll(async () => fixture?.gate.close());

function email(jws: string, changes: { humanSuffix?: string; attachmentJws?: string } = {}) {
  const { human, html, carrier } = renderBodies(message, jws, footer);
  const parts = [
    human + (changes.humanSuffix ?? ""),
    html,
    changes.attachmentJws ? encodeEnvelope(changes.attachmentJws) : carrier,
  ].map((text) =>
    Buffer.from(text)
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n"),
  );
  const mail = goldenMail.replace(
    /(Content-Transfer-Encoding: base64\r\n\r\n)[A-Za-z0-9+/=\r\n]+(?=--agent-)/g,
    (_encoded, headers: string) => `${headers}${parts.shift()}\r\n`,
  );
  expect(parts).toHaveLength(0);
  return mail;
}
function first(items: readonly InboundRawMessage[]): InboundRawMessage {
  const firstItem = items[0];
  if (!firstItem) throw new Error("Reader fixture yielded no item");
  return firstItem;
}

const structured: Record<string, (jws: string) => BridgeMessage | Promise<BridgeMessage>> = {
  direct(jws) {
    const reader = createDirectReader(
      { inboxes: new Map(), accepted: new Map() },
      new RecordingTokenProvider(),
    );
    return reader.ingest.parse({ id: "sample", raw: encodeEnvelope(jws) });
  },
  "email-mime": (jws) => inspectEmail(email(jws), mailConfig).message,
  async gmail(jws) {
    const { profile } = readFixture<{ profile: object }>("gmail");
    const fake = fixtureTransport([
      profile,
      { messages: [{ id: "a1", threadId: "ab" }] },
      {
        id: "a1",
        threadId: "ab",
        historyId: "110",
        raw: Buffer.from(email(jws)).toString("base64url"),
      },
    ]);
    const reader = createGmailReader({
      ...mailConfig,
      tokens: new RecordingTokenProvider(),
      transport: fake.options,
    });
    const batch = await reader.ingest.list(account, undefined, limits);
    return reader.ingest.parse(first(batch.items));
  },
  async "graph-mail"(jws) {
    const { first: firstPage } = readFixture<{ first: object }>("graph-mail");
    const fake = fixtureTransport([{ id: "AQMk+inbox/==" }, firstPage, mime(email(jws))]);
    const reader = createGraphMailReader({
      ...mailConfig,
      tokens: new RecordingTokenProvider(),
      transport: fake.options,
    });
    const batch = await reader.ingest.list(account, undefined, limits);
    return reader.ingest.parse(first(batch.items));
  },
  "graph-teams"(jws) {
    const reader = teams.reader([]).binding;
    return reader.ingest.parse(
      teams.item({
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: JSON.stringify({
              type: "AdaptiveCard",
              version: "1.4",
              body: [],
              data: { envelope: encodeEnvelopeObject(jws) },
            }),
          },
        ],
      }),
    );
  },
  async matrix(jws) {
    const event = matrix.event("$signed", {
      msgtype: "m.text",
      body: "Fixture",
      ...encodeEventContent(jws),
    });
    const reader = matrix.reader([matrix.direct, matrix.sync([event])]).binding;
    const batch = await reader.ingest.list(deviceAccount, undefined, limits);
    return reader.ingest.parse(first(batch.items));
  },
};

it.each(
  Object.entries(structured),
)("%s carries a valid and a damaged reference JWS", async (binding, read) => {
  const { gate } = await fixture.open();
  try {
    const admittedMessage = await read(validJws);
    expect(admittedMessage.warnings).not.toContain("human-parity-unverified");
    expect(
      await gate.check({ binding, account: account.id, message: admittedMessage }),
    ).toMatchObject({
      outcome: "admitted",
      messageId: message.id,
    });
    const tamperedMessage = await read(alteredJws);
    expect(
      await gate.check({ binding, account: account.id, message: tamperedMessage }),
    ).toMatchObject({
      outcome: "refused",
      reason: "bad-signature",
    });
  } finally {
    await gate.close();
  }
});

it("refuses conflicting MIME copies and sends a readable-copy mismatch through the gate", async () => {
  expect(() => inspectEmail(email(validJws, { attachmentJws: alteredJws }), mailConfig)).toThrow(
    "conflicting structured copies",
  );
  const observation = inspectEmail(email(validJws, { humanSuffix: "\nAltered text" }), {
    ...mailConfig,
    ownAccounts: new Set(),
  }).message;
  expect(observation.warnings).toContain("human-parity-unverified");
  const { gate } = await fixture.open();
  try {
    expect(
      await gate.check({ binding: "email-mime", account: account.id, message: observation }),
    ).toMatchObject({ outcome: "refused", reason: "human-parity-mismatch" });
  } finally {
    await gate.close();
  }
});

const unstructured: Record<string, () => BridgeMessage | Promise<BridgeMessage>> = {
  discord() {
    const { guild } = readFixture<{ guild: { d: { id: string } } }>("discord");
    const reader = createDiscordReader({
      tokens: new RecordingTokenProvider(),
      gateway: {
        read: async () => {
          throw new Error("No Discord access");
        },
      },
    });
    return reader.ingest.parse({ id: guild.d.id, raw: JSON.stringify(guild) });
  },
  async mastodon() {
    const { notification } = readFixture<{ notification: object }>("mastodon");
    const fake = fixtureTransport([[notification], []]);
    const reader = createMastodonReader({
      tokens: new RecordingTokenProvider(),
      transport: fake.options,
    });
    const batch = await reader.ingest.list(account, undefined, limits);
    return reader.ingest.parse(first(batch.items));
  },
  async x() {
    const fake = fixtureTransport([readFixture("x")]);
    const reader = createXReader({
      enabled: true,
      tokens: new RecordingTokenProvider(),
      spend: createXSpendCounter({ cap: 6, costPerCall: 2, periodMs: 1000 }),
      transport: fake.options,
    });
    const batch = await reader.ingest.list(account, undefined, limits);
    return reader.ingest.parse(first(batch.items));
  },
  github() {
    const [notification] =
      readFixture<{ id: string; updated_at: string }[]>("github-notifications");
    if (!notification) throw new Error("Missing GitHub fixture");
    return createGithubReader({ account }).ingest.parse({
      id: `github:${notification.id}:${notification.updated_at}`,
      raw: JSON.stringify(notification),
    });
  },
};
it.each(
  Object.entries(unstructured),
)("%s carries unstructured observations", async (binding, read) => {
  const result = await fixture.gate.check({ binding, account: account.id, message: await read() });
  expect(result).toMatchObject({ outcome: "unstructured" });
});
