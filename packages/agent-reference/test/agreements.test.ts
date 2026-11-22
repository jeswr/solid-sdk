// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtempSync, rmSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import {
  type AgreementDefinition,
  LocalAgreementCoordinator,
  verifyAgreementCredential,
} from "../src/mechanisms/agreements.js";
import { signStatement, TYP } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { MemoryLedger } from "../src/store/ledger.js";
import { FileStateStore, MemoryStateStore, type StateStore } from "../src/store/state.js";

async function fixture(store: StateStore = new MemoryStateStore(), conditional = false) {
  const parties = ["urn:a", "urn:b", "urn:coordinator"];
  const keys = await Promise.all(parties.map((p) => testKey(`agreements/${p}`)));
  const actors = await Promise.all(parties.map((p) => testKey(`agreements/${p}/actor`)));
  const source = await testKey("agreements/source");
  const trust = await TrustStore.load({
    version: 1,
    owner: parties[2] as string,
    keys: [
      ...keys.map((k, i) => ({
        kid: k.kid,
        alg: k.alg,
        publicJwk: k.publicJwk,
        role: "party" as const,
        subject: parties[i] as string,
      })),
      ...actors.map((k, i) => ({
        kid: k.kid,
        alg: k.alg,
        publicJwk: k.publicJwk,
        role: "actor" as const,
        subject: `${parties[i]}:actor`,
        party: parties[i],
      })),
      {
        kid: source.kid,
        alg: source.alg,
        publicJwk: source.publicJwk,
        role: "issuer",
        subject: "urn:source",
      },
    ],
    sourceAuthority: [
      {
        id: "urn:source-rule",
        version: "1",
        source: "urn:source",
        claimTypes: ["search.complete"],
        subjects: ["urn:asset"],
      },
      {
        id: "urn:escrow-source-rule",
        version: "1",
        source: "urn:coordinator",
        claimTypes: ["funds.held"],
        subjects: ["urn:asset"],
      },
    ],
  });
  let at = "2026-11-13T09:00:00.000Z";
  const revoked = new Set<string>();
  const definition: AgreementDefinition = {
    id: "urn:plan",
    coordinator: parties[2] as string,
    parties,
    required: parties,
    terms: {
      asset: "urn:asset",
      purpose: "urn:purpose",
      validFrom: "2026-11-13T00:00:00.000Z",
      validUntil: "2026-12-01T00:00:00.000Z",
    },
    conditions: conditional
      ? [
          {
            kind: "search.complete",
            source: "urn:source",
            subject: "urn:asset",
            equals: { value: true },
          },
        ]
      : [],
    reservations: [
      { id: "urn:flight", provider: parties[0] as string, amount: 300, currency: "GBP" },
      { id: "urn:hotel", provider: parties[1] as string, amount: 200, currency: "GBP" },
    ],
    budget: { amount: 600, currency: "GBP" },
  };
  const options = {
    identity: definition.coordinator,
    key: required(keys[2]),
    trust,
    store,
    ledger: new MemoryLedger(),
    definition,
    now: () => at,
    mandateActive: (a: string) => !revoked.has(a),
  };
  const service = new LocalAgreementCoordinator(options);
  async function request(i: number, operation: string, patch: Record<string, unknown> = {}) {
    const representation = await signStatement(required(keys[i]), TYP.representation, {
      type: "RepresentationStatement",
      id: `urn:rep:${i}`,
      party: parties[i],
      actor: `${parties[i]}:actor`,
      actorKid: required(actors[i]).kid,
      operations: ["urn:op:agreement"],
      validFrom: "2026-11-13T00:00:00.000Z",
      validUntil: "2026-12-01T00:00:00.000Z",
      issuedAt: at,
    });
    return signStatement(required(actors[i]), "awp-agreement-request+jws", {
      type: "AgreementRequest",
      id: `urn:request:${i}:${operation}`,
      actor: `${parties[i]}:actor`,
      party: parties[i],
      representation,
      agreement: definition.id,
      termsDigest: digestOf(definition),
      operation,
      at,
      ...patch,
    });
  }
  async function presentation(c: unknown, request: unknown, party = 0) {
    const r = await requestProof(party);
    return signStatement(required(actors[party]), "awp-agreement-presentation+jws", {
      type: "AgreementPresentation",
      actor: `${parties[party]}:actor`,
      party: parties[party],
      at,
      representation: r,
      credentialDigest: digestOf(c),
      audience: options.identity,
      request,
    });
  }
  async function requestProof(i: number) {
    return signStatement(required(keys[i]), TYP.representation, {
      type: "RepresentationStatement",
      id: `urn:rep:${i}`,
      party: parties[i],
      actor: `${parties[i]}:actor`,
      actorKid: required(actors[i]).kid,
      operations: ["urn:op:agreement"],
      validFrom: "2026-11-13T00:00:00.000Z",
      validUntil: "2027-12-01T00:00:00.000Z",
      issuedAt: at,
    });
  }
  async function prepare() {
    await service.request(await request(2, "hold"));
    for (let i = 0; i < 3; i++) await service.request(await request(i, "accept"));
  }
  return {
    service,
    options,
    request,
    prepare,
    revoked,
    definition,
    source,
    advance: (x: string) => {
      at = x;
    },
    verify: async (credential = service.credential(), patch: Record<string, unknown> = {}) =>
      verifyAgreementCredential(credential, {
        ...options,
        presentation: await presentation(
          credential,
          patch.request ?? { asset: "urn:asset", purpose: "urn:purpose", at },
          Math.max(0, parties.indexOf(String(patch.presenter))),
        ),
        presenter: parties[0] as string,
        request: { asset: "urn:asset", purpose: "urn:purpose", at },
        resolve: async () => service.status(),
        ...patch,
      }),
  };
}
it("requires every principal's own signature on one digest and retains partial signatures", async () => {
  const f = await fixture();
  await f.service.request(await f.request(2, "hold"));
  await f.service.request(await f.request(0, "accept"));
  expect(
    await f.service.request(await f.request(1, "accept", { termsDigest: "changed" })),
  ).toMatchObject({ reason: "terms-digest-mismatch" });
  expect(await f.service.request(await f.request(0, "accept", { party: "urn:b" }))).toMatchObject({
    reason: "bad-signature",
  });
  expect(await f.service.request(await f.request(2, "complete"))).toMatchObject({
    reason: "terms-not-acceptable",
  });
  expect(f.service.state()).toMatchObject({
    status: "void",
    holds: { "urn:hotel": "released", "urn:flight": "released" },
    signatures: { "urn:a": expect.any(String) },
  });
});
it("withdrawal and revoked authority before completion void the whole agreement", async () => {
  for (const revoke of [false, true]) {
    const f = await fixture();
    await f.prepare();
    if (revoke) f.revoked.add("urn:b:actor");
    else await f.service.request(await f.request(1, "withdraw"));
    await f.service.request(await f.request(2, "complete"));
    expect(f.service.state()).toMatchObject({
      status: "void",
      holds: { "urn:flight": "released", "urn:hotel": "released" },
    });
  }
});
it("verifies every credential signature, presenter, fresh status, asset, period and purpose", async () => {
  const f = await fixture();
  await f.prepare();
  expect(await f.service.request(await f.request(2, "complete"))).toMatchObject({
    status: "complete",
  });
  const c = f.service.credential();
  expect(await f.verify(c)).toMatchObject({ ok: true });
  expect(await f.verify(c, { presenter: "urn:outsider" })).toMatchObject({
    reason: "not-authorised",
  });
  expect(await f.verify({ ...c, signatures: c.signatures.slice(1) })).toMatchObject({
    reason: "terms-not-acceptable",
  });
  expect(await f.verify({ ...c, signatures: ["invalid", ...c.signatures.slice(1)] })).toMatchObject(
    { reason: "bad-signature" },
  );
  expect(
    await f.verify(c, {
      request: { asset: "urn:wrong", purpose: "urn:purpose", at: f.options.now() },
    }),
  ).toMatchObject({ reason: "terms-not-acceptable" });
  expect(
    await f.verify(c, {
      request: { asset: "urn:asset", purpose: "urn:other", at: f.options.now() },
    }),
  ).toMatchObject({ reason: "terms-not-acceptable" });
  expect(await f.verify(c, { resolve: async () => undefined })).toMatchObject({
    reason: "lookup-failed",
  });
  expect(
    await f.verify(c, {
      resolve: async () => {
        throw new Error("offline status");
      },
    }),
  ).toMatchObject({ reason: "lookup-failed" });
  expect(
    await f.verify(c, {
      request: {
        asset: "urn:asset",
        purpose: "urn:purpose",
        at: f.options.now(),
        period: { start: f.options.now(), end: "2027-01-01T00:00:00.000Z" },
      },
    }),
  ).toMatchObject({ reason: "expired" });
  f.advance("2026-11-14T09:00:00.000Z");
  expect(await f.verify(c)).toMatchObject({ ok: true });
  await f.service.request(await f.request(1, "end"));
  expect(await f.verify(c)).toMatchObject({ reason: "terms-not-acceptable" });
  f.advance("2026-12-01T00:00:00.000Z");
  expect(await f.verify(c)).toMatchObject({ reason: "expired" });
});
it("releases every hold on a failed condition and reserves the cumulative budget", async () => {
  const f = await fixture(undefined, true);
  await f.prepare();
  expect(await f.service.request(await f.request(2, "complete"))).toMatchObject({
    reason: "evidence-missing",
  });
  expect(Object.values(f.service.state().holds)).toEqual(["released", "released"]);
  const g = await fixture();
  required(g.options.definition.budget).amount = 400;
  const service = new LocalAgreementCoordinator(g.options);
  expect(await service.request(await g.request(2, "hold"))).toMatchObject({
    reason: "limit-exceeded",
  });
  const good = await fixture(undefined, true);
  await good.prepare();
  const evidence = await signStatement(good.source, TYP.statement, {
    id: "urn:condition",
    issuer: "urn:source",
    subject: "urn:asset",
    claimType: "search.complete",
    value: true,
    method: "recorded-by-authority",
    asOf: good.options.now(),
    terms: {
      policy: {
        id: "urn:terms",
        permissions: [{ type: "permission", action: "use", target: "urn:condition" }],
      },
    },
  });
  expect(
    await good.service.request(await good.request(2, "complete", { evidence: [evidence] })),
  ).toMatchObject({ status: "complete" });
});
it("recovers partial acceptances and holds after a file-store restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agreement-"));
  try {
    const file = join(dir, "state.json"),
      s = new FileStateStore(file),
      f = await fixture(s);
    await f.service.request(await f.request(2, "hold"));
    await f.service.request(await f.request(0, "accept"));
    s.close();
    const next = new FileStateStore(file),
      g = await fixture(next);
    await g.service.request(await g.request(1, "accept"));
    await g.service.request(await g.request(2, "accept"));
    expect(await g.service.request(await g.request(2, "complete"))).toMatchObject({
      status: "complete",
    });
    expect(Object.values(g.service.state().holds)).toEqual(["confirmed", "confirmed"]);
    next.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("completes all five data cases and discloses the passport only to the airline at ticketing", async () => {
  for (const id of [
    "joint-mortgage",
    "home-purchase",
    "energy-switch",
    "content-licence",
    "trip-booking",
  ]) {
    const { profile, scenario } = loadCase(join(import.meta.dirname, ".."), id);
    const paths = await runScenario(profile, scenario, { compare: false });
    expect(
      paths.every((p) => !!p.trace),
      id,
    ).toBe(true);
    if (id === "trip-booking") {
      const events = required(required(paths[0]).trace).events;
      const releases = events.filter((e) => e.kind === "message-out");
      expect(releases).toHaveLength(1);
      expect(releases[0]?.packet?.layers.evidence.raw).toContainEqual(
        expect.objectContaining({ claimType: "identity.passport", number: 123456789 }),
      );
      expect(
        events.filter((e) => e.kind === "message-out").every((e) => e.agent === "receiver-agent"),
      ).toBe(true);
      expect(events.some((e) => e.agent === "airline-agent" && e.outcome === "admit")).toBe(true);
    }
  }
});

it("distinguishes required acceptors from later optional co-signatures for credential issuance", async () => {
  const f = await fixture();
  f.definition.required = ["urn:a"];
  const service = new LocalAgreementCoordinator(f.options);
  await service.request(await f.request(2, "hold"));
  await service.request(await f.request(0, "accept"));
  expect(await service.request(await f.request(2, "complete"))).toMatchObject({
    status: "complete",
    credential: null,
  });
  expect(() => service.credential()).toThrow("every party signature");
  await service.request(await f.request(1, "accept"));
  expect(await service.request(await f.request(2, "accept"))).toMatchObject({
    status: "complete",
    credential: { signatures: expect.any(Array) },
  });
  expect(await f.verify(service.credential())).toMatchObject({ ok: true });
});

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error("required capability value is missing");
  return value;
}

it("admits a register-signed funds-held condition from the actual durable hold balance", async () => {
  for (const amount of [500, 501]) {
    const f = await fixture();
    f.definition.conditions = [
      {
        kind: "funds.held",
        source: "urn:coordinator",
        subject: "urn:asset",
        equals: { value: true, amount, currency: "GBP", plan: "urn:plan" },
      },
    ];
    const service = new LocalAgreementCoordinator(f.options);
    await service.request(await f.request(2, "hold"));
    for (let i = 0; i < 3; i++) await service.request(await f.request(i, "accept"));
    const answer = await service.request(await f.request(2, "complete"));
    expect(answer).toMatchObject(
      amount === 500 ? { status: "complete" } : { reason: "evidence-missing" },
    );
    if (amount !== 500)
      expect(Object.values(service.state().holds)).toEqual(["released", "released"]);
    expect(f.options.ledger.entries().some((e) => e.record.type === "escrow-hold-statement")).toBe(
      true,
    );
  }
});

it("being a party does not grant a use reserved to a named licensee", async () => {
  const f = await fixture();
  f.definition.terms.useBy = ["urn:a"];
  const service = new LocalAgreementCoordinator(f.options);
  await service.request(await f.request(2, "hold"));
  for (let i = 0; i < 3; i++) await service.request(await f.request(i, "accept"));
  await service.request(await f.request(2, "complete"));
  const credential = service.credential();
  expect(await f.verify(credential)).toMatchObject({ ok: true });
  expect(await f.verify(credential, { presenter: "urn:b" })).toMatchObject({
    reason: "terms-not-acceptable",
  });
});
