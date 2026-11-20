// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { signStatement } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { interpretEmployment, registryMeaningSchema } from "../src/suites/meaning-registry.js";

it("pins a signed mapping version and requires a new version for changed published content", async () => {
  const key = await testKey("employment-mapping-version");
  const at = "2026-11-13T09:00:00Z";
  const table = {
    type: "CodeMappingTable",
    id: "urn:employment:mapping",
    issuer: "urn:mapping-publisher",
    version: "1",
    fromList: "urn:payroll:employment:v1",
    toList: "urn:lender:employment:v1",
    validFrom: "2026-11-01T00:00:00Z",
    validUntil: "2026-12-01T00:00:00Z",
    entries: [{ from: "PAYE", to: "employed", relation: "exact" }],
    status: { ref: "urn:employment:mapping-status", id: "active-version" },
  };
  const status = await signStatement(key, "awp-status-list+jws", {
    type: "StatusList",
    id: table.status.ref,
    issuer: table.issuer,
    issuedAt: at,
    validUntil: table.validUntil,
    entries: { "active-version": "active" },
  });
  let published = await signStatement(key, "awp-code-mapping-table+jws", table);
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:sam",
    keys: [
      {
        kid: key.kid,
        alg: key.alg,
        publicJwk: key.publicJwk,
        role: "issuer",
        subject: table.issuer,
      },
    ],
    sourceAuthority: [
      {
        id: "urn:accepted-employment-publisher",
        version: "1",
        source: table.issuer,
        claimTypes: ["code-mapping"],
        subjects: [table.fromList],
      },
    ],
  });
  const settings = registryMeaningSchema.parse({
    requestedList: table.toList,
    acceptedCodes: ["employed"],
    policy: {
      receivers: ["urn:sam-agent"],
      acceptedLists: [table.toList],
      maxStatusAgeSeconds: 60,
      approximate: "ask-more",
      routes: [
        {
          fromList: table.fromList,
          toList: table.toList,
          registry: table.issuer,
          table: table.id,
          version: table.version,
        },
      ],
    },
  });
  const claim = {
    id: "urn:payroll:statement",
    issuer: "urn:payroll-provider",
    subject: "urn:sam",
    claimType: "income.gross.monthly-series",
    method: "recorded-by-authority",
    issuedAt: at,
    employmentStatus: { codeList: table.fromList, code: "PAYE" },
  };
  const seenVersions = new Map<string, string>();
  const options = {
    settings,
    seenVersions,
    resolver: { resolve: async (id: string) => (id === table.id ? published : status) },
    trust,
    at,
    verifier: "urn:sam-agent",
    record: () => {},
  };
  const first = await interpretEmployment(claim, options);
  expect(first).toMatchObject({ ok: true, value: { signedParentDigest: digestOf(claim) } });
  expect(seenVersions.get(`${table.id}\0${table.version}`)).toBe(digestOf(table));
  expect(await interpretEmployment(claim, options)).toMatchObject({ ok: true });

  // Even an unrelated new entry changes the immutable publication at this version.
  const changed = {
    ...table,
    entries: [...table.entries, { from: "OTHER", to: "other", relation: "exact" }],
  };
  published = await signStatement(key, "awp-code-mapping-table+jws", changed);
  expect(await interpretEmployment(claim, options)).toMatchObject({
    ok: false,
    reason: "unsupported-term",
    outcome: "ask-more",
  });
  expect(seenVersions.get(`${table.id}\0${table.version}`)).toBe(digestOf(table));

  published = await signStatement(key, "awp-code-mapping-table+jws", { ...changed, version: "2" });
  settings.policy.routes[0]!.version = "2";
  expect(await interpretEmployment(claim, options)).toMatchObject({ ok: true });
  expect(seenVersions.size).toBe(2);
});
