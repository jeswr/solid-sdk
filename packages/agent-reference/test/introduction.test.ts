// AUTHORED-BY Codex GPT-6.2 Sol
import { expect, it } from "vitest";
import { TrustStore } from "../src/mechanisms/trust.js";
import { Cast, mandateOf } from "../src/scenarios/common.js";
import { introduce } from "../src/setup.js";

it("binds introduced keys to the reviewed actor and party", async () => {
  const cast = new Cast(() => new Date("2026-10-19T08:00:00Z"));
  const local = await cast.add(
    { name: "local", actor: "urn:test:local-actor", party: "urn:test:local-party" },
    mandateOf("deny-all", []),
    [],
  );
  const peer = await cast.add(
    { name: "peer", actor: "urn:test:peer-actor", party: "urn:test:peer-party" },
    mandateOf("deny-all", []),
    [],
  );
  const card = {
    ...peer.card,
    actorKey: { ...peer.card.actorKey, subject: local.identity.actor, party: local.identity.party },
    partyKey: { ...peer.card.partyKey, subject: local.identity.party },
  };
  const trust = await TrustStore.load(
    introduce(local.trust, card, { party: peer.ownerKey.kid, actor: peer.actorKey.kid }),
  );
  expect(trust.data.keys.find(({ kid }) => kid === peer.actorKey.kid)).toMatchObject({
    role: "actor",
    subject: peer.identity.actor,
    party: peer.identity.party,
  });
  expect(trust.data.keys.find(({ kid }) => kid === peer.ownerKey.kid)).toMatchObject({
    role: "party",
    subject: peer.identity.party,
  });
});
