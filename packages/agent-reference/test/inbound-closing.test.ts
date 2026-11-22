// AUTHORED-BY Codex GPT-6.2 Sol
import { expect, it } from "vitest";
import type { Message } from "../src/core/types.js";
import { CONFIG_ED25519 } from "../src/profile/configurations.js";
import { PILOT_PROFILE } from "../src/profile/vocabulary.js";
import { Cast, craftSigned, mandateOf, signClaim } from "../src/scenarios/common.js";

it("refuses a signed closing notice without changing the conversation", async () => {
  const now = () => new Date("2026-10-19T08:00:00Z");
  const cast = new Cast(now, {
    ids(scope) {
      let id = 0;
      return () => `urn:test:${scope}:${++id}`;
    },
  });
  const sender = await cast.add(
    { name: "sender", actor: "urn:test:sender-actor", party: "urn:test:sender-party" },
    mandateOf("deny-all", []),
    [],
  );
  const receiver = await cast.add(
    { name: "receiver", actor: "urn:test:receiver-actor", party: "urn:test:receiver-party" },
    mandateOf("deny-all", []),
    [],
  );
  cast.pin("receiver", "sender");
  const { runtime } = await cast.runtime("receiver", []);
  const { runtime: clean } = await cast.runtime("receiver", []);
  try {
    const opening: Message<"describe"> = {
      profile: PILOT_PROFILE,
      configuration: CONFIG_ED25519,
      id: "urn:test:describe",
      conversation: "urn:test:conversation",
      kind: "describe",
      from: { actor: sender.identity.actor },
      to: { actor: receiver.identity.actor },
      createdAt: now().toISOString(),
      expiresAt: "2026-10-19T09:00:00.000Z",
      body: {},
    };
    const signedOpening = await craftSigned(sender, opening);
    const opened = await runtime.receive(signedOpening);
    await clean.receive(signedOpening);
    expect(opened).toMatchObject({ disposition: "accepted", admitted: true });
    const before = structuredClone(runtime.conversation(opening.conversation));

    const notice: Message<"refuse"> = {
      ...opening,
      id: "urn:test:closing",
      kind: "refuse",
      body: { ref: opening.id, reason: "not-authorised" },
      evidence: [
        {
          role: "credential",
          format: "jws-compact",
          value: await signClaim(sender.ownerKey, {
            id: "urn:test:receipt",
            claimType: "payment-receipt",
            issuer: sender.identity.party,
            subject: receiver.identity.party,
            method: "recorded-by-authority",
            asOf: now().toISOString(),
          }),
        },
      ],
    };
    const result = await runtime.receive(await craftSigned(sender, notice));
    expect(result).toMatchObject({
      disposition: "rejected",
      reason: "source-not-authoritative",
      messageId: notice.id,
      outbound: [],
    });
    expect(result.admitted).toBeUndefined();

    const valid = await craftSigned(sender, {
      ...opening,
      id: "urn:test:valid-closing",
      kind: "refuse",
      body: notice.body,
    });
    const afterRefusal = structuredClone(runtime.conversation(opening.conversation));
    const expected = await clean.receive(valid);
    expect(expected).toMatchObject({ disposition: "accepted", admitted: true, phase: "refused" });
    expect(await runtime.receive(valid)).toMatchObject({
      disposition: expected.disposition,
      admitted: expected.admitted,
      phase: expected.phase,
    });
    expect(afterRefusal).toEqual(before);
    expect(runtime.conversation(opening.conversation)).toEqual(
      clean.conversation(opening.conversation),
    );
  } finally {
    runtime.close();
    clean.close();
  }
});
