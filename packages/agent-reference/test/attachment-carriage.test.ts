// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import * as canonical from "../src/core/canonical.js";
import { ActionIntentNode } from "../src/model/message-nodes.js";
import { testKey } from "../src/reference/keys.js";
import {
  ATTACHMENT_LIMITS,
  readAttachmentDocument,
  writeAttachmentDocument,
} from "../src/wire/attachments.js";
import { digest, sign, verify } from "../src/wire/authenticity.js";
import { verifyMessagePacket } from "../src/wire/message-packet.js";

const intent = {
  operation: "urn:test:operation",
  action: "use",
  target: "urn:test:target",
  conversation: "urn:test:conversation",
  parameters: {
    request: "é".repeat(90_000),
    result: Array.from({ length: 400 }, (_, i) => ({ index: i, result: i * 2 })),
  },
};
describe("bounded content-addressed carriage", () => {
  it("keeps large strings and structured payloads under unchanged document limits", async () => {
    const node = ActionIntentNode.toNode(intent);
    const packet = await writeAttachmentDocument(node);
    expect(Buffer.byteLength(JSON.stringify(packet.document))).toBeLessThan(65_536);
    expect(packet.attachments.length).toBeGreaterThan(0);
    const read = await readAttachmentDocument(JSON.stringify(packet.document), packet.attachments);
    if (!read.ok) throw new Error(read.detail);
    expect(new ActionIntentNode(read.root, read.dataset).toObject()).toEqual(intent);
  });
  it.each([
    "tampered",
    "truncated",
    "missing",
    "extra",
    "duplicate",
    "oversized",
    "unknown-metadata",
  ] as const)("refuses %s attachments with a named reason", async (kind) => {
    const packet = await writeAttachmentDocument(
      ActionIntentNode.toNode({ ...intent, parameters: { request: "x".repeat(20_000) } }),
    );
    const attachments = structuredClone(
      packet.attachments,
    ) as import("../src/wire/attachments.js").DocumentAttachment[];
    const a = attachments[0]!;
    const expected = {
      tampered: "attachment-digest-mismatch",
      truncated: "attachment-length-mismatch",
      missing: "attachment-missing",
      extra: "attachment-unreferenced",
      duplicate: "attachment-duplicate",
      oversized: "attachment-too-large",
      "unknown-metadata": "attachment-malformed",
    }[kind];
    if (kind === "tampered") {
      const bytes = Buffer.from(a.bytes, "base64");
      bytes[10] = bytes[10]! ^ 1;
      attachments[0] = { ...a, bytes: bytes.toString("base64") };
    }
    if (kind === "truncated")
      attachments[0] = {
        ...a,
        bytes: Buffer.from(a.bytes, "base64").subarray(1).toString("base64"),
      };
    if (kind === "missing") attachments.pop();
    if (kind === "extra") attachments.push({ ...a, digest: "sha-256:" + "0".repeat(64) });
    if (kind === "duplicate") attachments.push(a);
    if (kind === "unknown-metadata")
      attachments[0] = { ...a, extra: "not part of the carriage contract" } as typeof a;
    // An invalid digest and invalid bytes cannot mask the cap: rejection is before hashing/parsing.
    if (kind === "oversized")
      attachments[0] = {
        ...a,
        digest: "invalid",
        byteLength: ATTACHMENT_LIMITS.perAttachment + 1,
        bytes: "invalid",
      };
    expect(
      await readAttachmentDocument(JSON.stringify(packet.document), attachments),
    ).toMatchObject({ ok: false, detail: expected });
  });
  it.each([
    "jws",
    "data-integrity",
  ] as const)("binds attachment digests under %s", async (suite) => {
    const key = await testKey("22d-attachment-signature");
    const packet = await writeAttachmentDocument(
      ActionIntentNode.toNode({ ...intent, parameters: { request: "x".repeat(20_000) } }),
    );
    const signed = await sign(packet.document, {
      suite,
      key,
      verificationMethod: "urn:test:attachment-key",
      created: "2026-11-13T09:00:00Z",
    });
    expect(
      await verify(JSON.stringify(signed), "application/ld+json", { suite, resolve: () => key }),
    ).toMatchObject({ ok: true });
    const changed = structuredClone(signed);
    const included = changed["@included"] as Record<string, unknown>[];
    const ref = included.find((n) => n.attachmentDigest)!;
    ref.attachmentDigest = "sha-256:" + "0".repeat(64);
    expect(await digest(changed, suite)).not.toBe(await digest(signed, suite));
    expect(
      await verify(JSON.stringify(changed), "application/ld+json", { suite, resolve: () => key }),
    ).toMatchObject({ ok: false, reason: "bad-signature" });
  });
});

it("rejects attachment and packet caps before starting a hash", async () => {
  const packet = await writeAttachmentDocument(
    ActionIntentNode.toNode({ ...intent, parameters: { request: "x".repeat(20_000) } }),
  );
  const attachment = packet.attachments[0]!;
  const hash = vi.spyOn(canonical, "digestBytes");
  try {
    expect(
      await readAttachmentDocument(JSON.stringify(packet.document), [
        { ...attachment, byteLength: ATTACHMENT_LIMITS.perAttachment + 1 },
      ]),
    ).toMatchObject({ ok: false, detail: "attachment-too-large" });
    expect(hash).not.toHaveBeenCalled();
    expect(
      await verifyMessagePacket(
        {
          format: "awp-jsonld/0.1",
          jsonld: JSON.stringify(packet.document),
          attachments: [{ ...attachment, byteLength: ATTACHMENT_LIMITS.perAttachment + 1 }],
        },
        {
          suite: "jws",
          resolve: () => {
            throw new Error("key resolution must not start");
          },
        },
      ),
    ).toMatchObject({ ok: false, detail: "attachment-too-large" });
    expect(hash).not.toHaveBeenCalled();
    expect(
      await readAttachmentDocument(
        JSON.stringify(packet.document),
        Array.from({ length: 5 }, () => ({
          ...attachment,
          byteLength: ATTACHMENT_LIMITS.perAttachment,
        })),
      ),
    ).toMatchObject({ ok: false, detail: "attachment-packet-too-large" });
    expect(hash).not.toHaveBeenCalled();
  } finally {
    hash.mockRestore();
  }
});
