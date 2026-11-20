// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import {
  type AuthorizationGrant,
  authorizationGrantSchema,
  FictionalAuthorizationServer,
} from "../src/mechanisms/authorization-server.js";
import { signStatement } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { mandateOf } from "../src/scenarios/common.js";
import { decodeCompactPayload } from "../src/wire/inspect.js";

async function setup() {
  const owner = await testKey("grant-test-owner"),
    actor = await testKey("grant-test-actor"),
    issuer = await testKey("grant-test-issuer");
  let at = "2026-11-13T09:00:00.000Z";
  const mandate = mandateOf("grant-test", [
    { type: "permission", action: "use", target: "urn:operation:test" },
  ])({
    owner: "urn:person:sam",
    actor: "urn:actor:sam",
    validFrom: at,
    validUntil: "2026-11-14T09:00:00.000Z",
  });
  const trust = await TrustStore.load({
    version: 1,
    owner: mandate.issuer,
    sourceAuthority: [],
    keys: [
      {
        kid: owner.kid,
        alg: owner.alg,
        publicJwk: owner.publicJwk,
        role: "party",
        subject: mandate.issuer,
      },
      {
        kid: issuer.kid,
        alg: issuer.alg,
        publicJwk: issuer.publicJwk,
        role: "issuer",
        subject: "urn:server:bank",
      },
    ],
  });
  const server = new FictionalAuthorizationServer("urn:server:bank", issuer, () => at);
  const consent = await signStatement(owner, "awp-grant-consent+jws", {
    issuer: mandate.issuer,
    actor: mandate.subject,
    kid: actor.kid,
    mandateDigest: digestOf(mandate),
    validUntil: mandate.validUntil,
  });
  const grant = await server.issue(mandate, actor.kid, ["urn:lender"], consent, trust);
  const input = {
    trust,
    actor: mandate.subject,
    party: mandate.issuer,
    kid: actor.kid,
    audience: "urn:lender",
    accepted: true,
  };
  return {
    server,
    issuer,
    grant,
    input,
    advance: () => {
      at = "2027-01-01T00:00:00.000Z";
    },
  };
}
it("requires accepted issuer, principal, actor, key, audience, exact detail scopes and time", async () => {
  const f = await setup();
  const valid = await f.server.verify(f.grant, f.input);
  expect(valid.ok).toBe(true);
  if (valid.ok)
    expect(valid.loaded.mandate.autonomous.permissions?.[0]?.target).toBe("urn:operation:test");
  for (const field of [
    { accepted: false },
    { actor: "urn:actor:thief" },
    { party: "urn:person:other" },
    { kid: "copied-key" },
    { audience: "urn:other-lender" },
  ])
    expect((await f.server.verify(f.grant, { ...f.input, ...field })).ok).toBe(false);
  for (const mutate of [
    (p: AuthorizationGrant) => {
      delete p.act;
    },
    (p: AuthorizationGrant) => {
      p.exp = 1;
    },
    (p: AuthorizationGrant) => {
      p.authorization_details[0]!.actions.push("distribute");
    },
    (p: AuthorizationGrant) => {
      p.authorization_details[0]!.policy.assigner = "urn:person:other";
    },
  ]) {
    const p = authorizationGrantSchema.parse(decodeCompactPayload(f.grant));
    mutate(p);
    expect((await f.server.verify(await signStatement(f.issuer, "at+jwt", p), f.input)).ok).toBe(
      false,
    );
  }
  f.advance();
  expect((await f.server.verify(f.grant, f.input)).ok).toBe(false);
});
it("fails closed on unavailable or stale status and on withdrawal", async () => {
  const f = await setup();
  f.server.available = false;
  expect(await f.server.verify(f.grant, f.input)).toMatchObject({
    ok: false,
    reason: "lookup-failed",
  });
  f.server.available = true;
  f.server.revoke();
  expect(await f.server.verify(f.grant, f.input)).toMatchObject({
    ok: false,
    reason: "mandate-withdrawn",
  });
  f.advance();
  expect(f.server.current()).toBe("lookup-failed");
});
