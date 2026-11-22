// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { copyOf, envelopeBytes } from "../src/bindings/bytes.js";
import { BoundsError } from "../src/core/limits.js";
import { MessageNode } from "../src/model/message-nodes.js";
import { CONFIG_PUBLIC } from "../src/profile/configurations.js";
import { PILOT_PROFILE } from "../src/profile/vocabulary.js";
import { carriageBytes, DOCUMENT_MEDIA_TYPE } from "../src/wire/carriage.js";
import { readCarrierEnvelope } from "../src/wire/carrier-envelope.js";
import { writeMessagePacket } from "../src/wire/message-packet.js";

it.each([
  { mediaType: DOCUMENT_MEDIA_TYPE },
  { mediaType: DOCUMENT_MEDIA_TYPE, bytes: Buffer.from("not a packet").toString("base64") },
])("keeps control bounds when a native-copy marker does not carry a document", (marker) => {
  expect(() => readCarrierEnvelope(envelopeBytes({ marker, text: "x".repeat(20_000) }))).toThrow(
    BoundsError,
  );
});

it("admits the separately bounded carrier only for an actual native document copy", async () => {
  const packet = await writeMessagePacket(
    MessageNode.toNode({
      profile: PILOT_PROFILE,
      configuration: CONFIG_PUBLIC,
      id: "urn:test:carrier-message",
      conversation: "urn:test:carrier-conversation",
      kind: "invoke",
      from: {},
      createdAt: "2026-11-13T09:00:00Z",
      expiresAt: "2026-11-13T10:00:00Z",
      body: {
        operation: { id: "urn:test:operation", version: "1" },
        input: { request: "x".repeat(12_000) },
        basis: { kind: "public" },
      },
    }),
    { unsigned: true },
  );
  expect(packet.attachments.length).toBeGreaterThan(0);
  const envelope = { message: copyOf(carriageBytes(packet)) };
  expect(envelope.message.bytes.length).toBeGreaterThan(16_384);
  expect(readCarrierEnvelope(envelopeBytes(envelope))).toEqual(envelope);
});
