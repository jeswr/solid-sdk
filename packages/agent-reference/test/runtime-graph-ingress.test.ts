// AUTHORED-BY Codex GPT-6
import { DataFactory } from "n3";
import { expect, it } from "vitest";
import { digestBytes } from "../src/core/canonical.js";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import { GateMemory } from "../src/gates/common.js";
import { InboundGate } from "../src/gates/inbound.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { CoreNode } from "../src/model/core-node.js";
import { EvidenceItemNode } from "../src/model/evidence-item.js";
import { MessageNode } from "../src/model/message-nodes.js";
import { StatementQualityNode } from "../src/model/quality.js";
import { CONFIG_ED25519 } from "../src/profile/configurations.js";
import { PILOT_PROFILE } from "../src/profile/vocabulary.js";
import { testKey } from "../src/reference/keys.js";
import { writeAttachmentDocument } from "../src/wire/attachments.js";
import { sign } from "../src/wire/authenticity.js";
import { signCompact } from "../src/wire/jws-compact.js";

const at = "2026-11-13T09:00:00.000Z";
it("admits live wrappers, checks original projections, and explicitly resolves prior credentials", async () => {
  const actor = await testKey("22d/graph-actor"),
    source = await testKey("22d/graph-source");
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:test:receiver",
    sourceAuthority: [],
    keys: [
      { ...actor, role: "actor", subject: "urn:test:sender" },
      { ...source, role: "issuer", subject: "urn:test:source" },
    ].map(({ kid, alg, publicJwk, role, subject }) => ({
      kid,
      alg,
      publicJwk,
      role: role as "actor" | "issuer",
      subject,
    })),
  });
  const gate = new InboundGate({
    identity: { actor: "urn:test:receiver" },
    trust,
    limits: DEFAULT_LIMITS,
    now: () => at,
    record: () => {},
    gate: {},
    memory: new GateMemory(),
    agreementTerms: () => undefined,
  });
  const jws = await signCompact(source, "awp-statement+jws", {
    issuer: "urn:test:source",
    claimType: "count",
    subject: "urn:test:sender",
    count: 1,
  });
  const make = (id: string) =>
    MessageNode.toNode({
      profile: PILOT_PROFILE,
      configuration: CONFIG_ED25519,
      id: "urn:test:" + id,
      conversation: "urn:test:conversation",
      kind: "invoke",
      from: { actor: "urn:test:sender" },
      to: { actor: "urn:test:receiver" },
      createdAt: at,
      expiresAt: "2026-11-13T10:00:00.000Z",
      body: {
        operation: { id: "urn:test:operation", version: "1" },
        input: { count: 1 },
        basis: { kind: "public" },
      },
    });
  const packet = async (node: MessageNode) => {
    const prepared = await writeAttachmentDocument(node);
    return {
      format: "awp-jsonld/0.1" as const,
      jsonld: JSON.stringify(
        await sign(prepared.document, {
          suite: "jws",
          key: actor,
          verificationMethod: "urn:awp:key:" + actor.kid,
          created: at,
        }),
      ),
      attachments: prepared.attachments,
    };
  };
  const first = make("first");
  first.evidence = [{ role: "credential", format: "jws-compact", value: jws }];
  const accepted = await gate.verifyIntegrity(await packet(first), {}, () => false);
  expect(accepted.ok).toBe(true);
  if (!accepted.ok) throw new Error(accepted.detail);
  expect(accepted.message).toBeInstanceOf(MessageNode);
  expect(accepted.message.body).toBeInstanceOf(CoreNode);
  const view = accepted.message as unknown as MessageNode;
  const credential = accepted.message.evidence![0] as unknown as EvidenceItemNode;
  const quality = StatementQualityNode.from(
    credential.credential!.payload as unknown as import("../src/model/quality.js").QualityInput,
  );
  expect(quality.dataset).toBe(view.dataset);
  expect(quality.claimType).toBe("count");
  const claimType = credential.credential!.subjectPayload.entries.find(
    (entry) => entry.name === "claimType",
  )!;
  claimType.domainValue = DataFactory.literal("changed-count");
  expect(quality.claimType).toBe("changed-count");
  claimType.domainValue = DataFactory.literal("count");
  const input = (view.getField("body") as import("../src/model/message-nodes.js").InvokeBodyNode)
    .input;
  input.entries[0]!.domainValue = DataFactory.literal(
    "2",
    DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#integer"),
  );
  expect((accepted.message.body as import("../src/core/types.js").InvokeBody).input.count).toBe(2);
  const second = make("second");
  second.evidence = [
    EvidenceItemNode.byDigest(
      { role: "credential", format: "jws-compact", digest: digestBytes(jws) },
      "urn:test:prior",
      second.dataset,
    ),
  ];
  const prior = await gate.verifyIntegrity(await packet(second), {}, () => false);
  expect(prior.ok).toBe(true);
  if (prior.ok) expect(prior.message.evidence?.[0]?.value).toBe(jws);
  const missing = make("missing");
  missing.evidence = [
    EvidenceItemNode.byDigest(
      { role: "credential", format: "jws-compact", digest: "sha-256:" + "0".repeat(64) },
      "urn:test:missing-prior",
      missing.dataset,
    ),
  ];
  expect(await gate.verifyIntegrity(await packet(missing), {}, () => false)).toMatchObject({
    ok: false,
    reason: "evidence-invalid",
    detail: "prior-credential-missing-or-digest-mismatch",
  });
  const altered = make("altered");
  altered.evidence = [{ role: "credential", format: "jws-compact", value: jws }];
  const claim = altered.evidence![0]!.credential!.subjectPayload.entries.find(
    (entry) => entry.name === "count",
  )!;
  claim.domainValue = DataFactory.literal(
    "99",
    DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#integer"),
  );
  expect(await gate.verifyIntegrity(await packet(altered), {}, () => false)).toMatchObject({
    ok: false,
    reason: "evidence-invalid",
    detail: "original-credential-projection-mismatch",
  });
});
