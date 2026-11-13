// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import type { AnyMessage, JsonObject } from "../src/core/types.js";
import { GateMemory } from "../src/gates/common.js";
import { OutboundGate } from "../src/gates/outbound.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { CONFIG_PUBLIC } from "../src/profile/configurations.js";
import { PILOT_PROFILE } from "../src/profile/vocabulary.js";
import { Cast, mandateOf } from "../src/scenarios/common.js";
import { TraceRecorder } from "../src/trace/recorder.js";
import { TrustResolver } from "../src/trust/resolver.js";

const at = "2026-11-13T09:00:00.000Z";
const op = "urn:test:public-query";
const recipient = "urn:test:service";
const vocabulary = {
  "input.query": { type: "code" as const, values: ["catalogue"] },
  "input.map.*.code": { type: "code" as const, values: ["ok"] },
  "input.publicNumber": { type: "number" as const },
  "input.balance": { type: "number" as const, claimType: "balance" },
  "input.account": { type: "identifier" as const },
};
function message(input: JsonObject = { query: "catalogue" }): AnyMessage {
  return {
    profile: PILOT_PROFILE,
    configuration: CONFIG_PUBLIC,
    id: "urn:test:message",
    conversation: "urn:test:conversation",
    kind: "invoke",
    from: {},
    to: { actor: "urn:test:service-agent", party: recipient },
    createdAt: at,
    expiresAt: "2026-11-13T10:00:00Z",
    body: { operation: { id: op, version: "0.1" }, basis: { kind: "public" }, input },
  } as AnyMessage;
}
it("runs recipient, disclosure and write-ahead evidence on public reads, including continuations", async () => {
  const cast = new Cast(() => new Date(at));
  await cast.add(
    { name: "client", actor: "urn:test:client-agent", party: "urn:test:owner" },
    mandateOf("public", []),
    [op],
  );
  await cast.add(
    { name: "service", actor: "urn:test:service-agent", party: recipient },
    mandateOf("public", []),
    [op],
  );
  cast.introduce("client", "service");
  const recorder = new TraceRecorder();
  const installedVocabulary = structuredClone(vocabulary);
  const handler = {
    description: {
      id: op,
      version: "0.1",
      label: "Public query",
      pattern: "invoke" as const,
      access: "public" as const,
      roles: ["initiator" as const, "responder" as const],
      effects: [],
      outcomes: [],
      models: [],
    },
    contentProfile: { vocabulary },
    requiresRepresentation: false,
  };
  const { runtime } = await cast.runtime("client", [handler], [], [CONFIG_PUBLIC], {
    gates: { sink: recorder.sink("client"), vocabulary: installedVocabulary, identifiers: [op] },
  });
  const start = await runtime.startInvocation({
    peer: { actor: "urn:test:service-agent", party: recipient },
    operation: { id: op, version: "0.1" },
    input: { query: "catalogue" },
    basis: { kind: "public" },
    models: [],
    discover: false,
    configuration: CONFIG_PUBLIC,
  });
  expect(start.outbound).toHaveLength(1);
  expect(start.outbound[0]?.message.from).toEqual({});
  for (const check of ["recipient", "disclosure", "evidence"])
    expect(recorder.events().some((e) => e.check === check)).toBe(true);
  const invented = await runtime.startInvocation({
    peer: { actor: "urn:test:service-agent", party: recipient },
    operation: { id: op, version: "0.1" },
    input: { query: "catalogue" },
    basis: { kind: "public" },
    models: [],
    discover: false,
    configuration: CONFIG_PUBLIC,
    conversation: "urn:x:the-private-balance-is-31400",
  });
  expect(invented.outbound).toEqual([]);
  const knownButChosen = await runtime.startInvocation({
    peer: { actor: "urn:test:service-agent", party: recipient },
    operation: { id: op, version: "0.1" },
    input: { query: "catalogue" },
    basis: { kind: "public" },
    models: [],
    discover: false,
    configuration: CONFIG_PUBLIC,
    conversation: await runtime.mintIdentifier(),
  });
  expect(knownButChosen.outbound).toEqual([]);
  const wrongAddress = await runtime.startInvocation({
    peer: { actor: "https://evil.example/balance/31400", party: recipient },
    operation: { id: op, version: "0.1" },
    input: { query: "catalogue" },
    basis: { kind: "public" },
    models: [],
    discover: false,
    configuration: CONFIG_PUBLIC,
  });
  expect(wrongAddress.outbound).toEqual([]);
  const conversation = start.conversation as string;
  runtime.instruct("Private balance is 31400.");
  installedVocabulary["input.query"].values.push("The private balance is 31400.");
  for (const input of [{ note: "Private balance is 31400." }, { balance: 31400 }] as JsonObject[]) {
    const result = await runtime.sendMessage(conversation, {
      kind: "invoke",
      body: { operation: { id: op, version: "0.1" }, input, basis: { kind: "public" } },
    });
    expect(result.outbound).toEqual([]);
  }
});
it("an anonymous compromised core cannot leak text, structured data, context identifiers or credentials, even with an intent", () => {
  const memory = new GateMemory();
  memory.enter("urn:test:conversation", {
    kind: "memory",
    id: "urn:test:account",
    digest: "digest",
    claimType: "balance",
    source: "urn:test:bank",
    label: "private account",
  });
  const gate = new OutboundGate({
    identity: { actor: "urn:test:client-agent", party: "urn:test:owner" },
    now: () => at,
    mandate: () => undefined,
    gate: { vocabulary, identifiers: [op] },
    memory,
    isReplyTo: () => false,
    offerTerms: () => undefined,
  });
  for (const input of [
    { prose: "Unasked words" },
    { balance: 31400 },
    { publicNumber: 31400 },
    { account: "urn:test:account" },
    { unknown: 31400 },
  ] as JsonObject[]) {
    expect(gate.checkMessage(message(input), { operation: op }).outcome).toBe("stop");
    expect(
      gate.checkMessage(message(input), {
        operation: op,
        intent: {
          action: "read",
          operation: op,
          target: op,
          parameters: {},
          conversation: "urn:test:conversation",
        },
      }).outcome,
    ).toBe("stop");
  }
  expect(
    gate.checkMessage(
      {
        ...message(),
        evidence: [{ role: "credential", format: "jws-compact", value: "anything" }],
      },
      { operation: op },
    ).outcome,
  ).toBe("stop");
  for (const kind of ["propose", "accept"] as const)
    expect(
      gate.checkMessage({ ...message(), kind } as AnyMessage, { operation: op }),
    ).toMatchObject({ outcome: "stop", reason: "representation-missing" });
});
it("public reads cannot evade a mandate prohibition or a profile recipient block", async () => {
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:test:owner",
    keys: [],
    sourceAuthority: [],
  });
  for (const blockedBy of ["mandate", "profile"]) {
    const gate = new OutboundGate({
      identity: { actor: "urn:test:client-agent", party: "urn:test:owner" },
      now: () => at,
      mandate: () =>
        mandateOf(
          "public",
          [],
          [],
          blockedBy === "mandate" ? [{ type: "prohibition", action: "read", target: op }] : [],
        )({
          owner: "urn:test:owner",
          actor: "urn:test:client-agent",
          validFrom: at,
          validUntil: "2027-01-01T00:00:00Z",
        }),
      gate: {
        vocabulary,
        identifiers: [op],
        resolver: new TrustResolver({
          principal: "Owner",
          name: (id) => id ?? "anonymous",
          trust,
          ownList: [{ party: recipient, tasks: [op], block: true }],
        }),
      },
      memory: new GateMemory(),
      isReplyTo: () => false,
      offerTerms: () => undefined,
    });
    expect(gate.checkMessage(message(), { operation: op }).outcome).toBe("stop");
  }
});
