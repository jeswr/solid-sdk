// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { openConversation, transition } from "../src/core/conversation.js";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import { validateMessage } from "../src/core/schema.js";
import type { AnyMessage, Message } from "../src/core/types.js";
import { signStatement, TYP, verifyStatement } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { CONFIG_ED25519 } from "../src/profile/configurations.js";
import { PILOT_PROFILE } from "../src/profile/vocabulary.js";
import { testKey } from "../src/reference/keys.js";

const AT = "2026-11-13T09:00:00Z";
const UNTIL = "2026-11-13T09:05:00Z";
function message(kind: string, body: unknown, id = `urn:test:${kind}`): AnyMessage {
  return {
    id,
    kind,
    profile: PILOT_PROFILE,
    configuration: CONFIG_ED25519,
    conversation: "urn:test:conversation",
    from: { actor: "urn:test:agent", onBehalfOf: "urn:test:person" },
    to: { actor: "urn:test:bank" },
    createdAt: AT,
    expiresAt: "2026-11-13T10:00:00Z",
    body,
  } as AnyMessage;
}
const invoke = message("invoke", {
  operation: { id: "urn:test:balance", version: "0.1" },
  input: {},
  basis: { kind: "represented" },
}) as Message<"invoke">;
const challenge = message("challenge", {
  ref: invoke.id,
  reason: "assurance-insufficient",
  needs: {
    id: "urn:test:challenge",
    nonce: "urn:test:nonce",
    expiresAt: UNTIL,
    approval: "urn:test:face-check",
    label: "face check",
  },
});
function challenged() {
  const initial = openConversation({
    id: invoke.conversation,
    role: "initiator",
    peer: { actor: "urn:test:bank" },
    configuration: CONFIG_ED25519,
    at: AT,
  });
  const requested = transition(
    initial,
    { type: "message", direction: "out", message: invoke, at: AT },
    DEFAULT_LIMITS,
  );
  if (!requested.ok) throw new Error(requested.detail);
  const held = transition(
    requested.state,
    { type: "message", direction: "in", message: challenge, at: AT },
    DEFAULT_LIMITS,
  );
  if (!held.ok) throw new Error(held.detail);
  return held.state;
}
it("keeps a challenge in the conversation and accepts only its unexpired nonce-bound retry", () => {
  const state = challenged();
  expect(state.phase).toBe("challenged");
  expect(state.id).toBe(invoke.conversation);
  expect(validateMessage(challenge).ok).toBe(true);
  const retry = {
    ...invoke,
    id: "urn:test:retry",
    body: { ...invoke.body, challenge: { id: "urn:test:challenge", nonce: "urn:test:nonce" } },
  };
  expect(
    transition(state, { type: "message", direction: "out", message: retry, at: AT }, DEFAULT_LIMITS)
      .ok,
  ).toBe(true);
  const altered = { ...retry, body: { ...retry.body, input: { account: "another-account" } } };
  expect(
    transition(
      state,
      { type: "message", direction: "out", message: altered, at: AT },
      DEFAULT_LIMITS,
    ),
  ).toMatchObject({ ok: false, reason: "protocol-violation" });
  const wrong = {
    ...retry,
    body: { ...retry.body, challenge: { ...retry.body.challenge, nonce: "urn:test:wrong-nonce" } },
  };
  expect(
    transition(
      state,
      { type: "message", direction: "out", message: wrong, at: AT },
      DEFAULT_LIMITS,
    ),
  ).toMatchObject({ ok: false, reason: "protocol-violation" });
  expect(
    transition(
      state,
      { type: "message", direction: "out", message: retry, at: UNTIL },
      DEFAULT_LIMITS,
    ),
  ).toMatchObject({ ok: false, reason: "expired" });
  const other = openConversation({
    id: "urn:test:another-conversation",
    role: "initiator",
    peer: { actor: "urn:test:bank" },
    configuration: CONFIG_ED25519,
    at: AT,
  });
  expect(
    transition(
      other,
      { type: "message", direction: "out", message: retry, at: AT },
      DEFAULT_LIMITS,
    ),
  ).toMatchObject({ ok: false, reason: "protocol-violation" });
});

async function recordFixture(
  options: { signer?: string; delegated?: boolean; claimType?: string; at?: string } = {},
) {
  const identity = await testKey("record/identity");
  const key = await testKey("record/record-key");
  const stranger = await testKey("record/stranger");
  const delegation = await signStatement(
    options.signer ? stranger : identity,
    "awp-record-key+jws",
    {
      type: "RecordKeyDelegation",
      id: "urn:test:delegation",
      issuer: "urn:test:bank",
      recordKid: key.kid,
      claimTypes: ["balance"],
      validFrom: AT,
      validUntil: UNTIL,
    },
  );
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:test:bank",
    keys: [
      {
        ...identity,
        privateJwk: undefined,
        key: undefined,
        role: "party",
        subject: "urn:test:bank",
      },
    ].map(({ role, subject, kid, alg, publicJwk }) => ({ role, subject, kid, alg, publicJwk })),
    sourceAuthority: [],
    ...(options.delegated === false
      ? {}
      : {
          recordKeys: [
            {
              identity: "urn:test:bank",
              key: { kid: key.kid, alg: key.alg, publicJwk: key.publicJwk },
              delegation,
            },
          ],
        }),
  });
  const jws = await signStatement(key, TYP.statement, {
    issuer: "urn:test:bank",
    claimType: options.claimType ?? "balance",
    value: 42,
  });
  return verifyStatement(jws, {
    trust,
    typ: TYP.statement,
    role: "issuer",
    schema: z.object({ issuer: z.string(), claimType: z.string(), value: z.number() }),
    verifier: "urn:test:receiver",
    at: options.at ?? AT,
    limits: DEFAULT_LIMITS,
  });
}
describe("record keys require identity-key delegation", () => {
  it("attributes a scoped record key to its introduced identity", async () => {
    expect((await recordFixture()).verification).toMatchObject({
      outcome: "valid",
      attributedTo: "urn:test:bank",
    });
  });
  it.each([
    { delegated: false },
    { signer: "stranger" },
    { claimType: "income" },
    { at: UNTIL },
  ])("refuses undelegated, forged, out-of-scope or expired record keys: %j", async (options) => {
    expect((await recordFixture(options)).verification.outcome).toBe("unknown-key");
  });
});
