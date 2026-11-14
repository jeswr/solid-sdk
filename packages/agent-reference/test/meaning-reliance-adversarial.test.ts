// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { signStatement } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { SuiteValuesNode } from "../src/model/suite-values.js";
import { testKey } from "../src/reference/keys.js";
import { negotiatedRequestMatches } from "../src/suites/meaning-negotiated.js";
import { certifiedQuality } from "../src/suites/reliance-certificate.js";
import { corroborateIncome } from "../src/suites/reliance-corroboration.js";

const at = "2026-11-13T09:00:00Z";
const period = { start: "2026-10", end: "2026-10" };
const payroll = {
  id: "urn:payroll",
  issuer: "urn:payroll-provider",
  subject: "urn:sam",
  claimType: "income.gross.monthly-series",
  method: "recorded-by-authority",
  issuedAt: at,
  currency: "USD",
  period,
  monthly: [{ month: "2026-10", gross: 7500 }],
  incomeProvenance: { rootRecords: ["urn:payroll-record"] },
};
const bank = {
  id: "urn:bank-statement",
  issuer: "urn:bank",
  subject: "urn:sam",
  claimType: "deposit.balance",
  method: "recorded-by-authority",
  issuedAt: at,
  currency: "USD",
  period,
  salaryCredits: {
    currency: "USD",
    period,
    monthly: [{ month: "2026-10", amount: 7500 }],
    method: "recorded-by-authority",
    rootRecords: ["urn:bank-record"],
  },
};

it("checks tolerance against live RDF and rejects non-independent, stale, mismatched and unqualified observations", async () => {
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:lender",
    keys: [],
    controllers: {
      "urn:payroll-provider": "urn:payroll-controller",
      "urn:bank": "urn:bank-controller",
    },
    sourceAuthority: [
      {
        id: "urn:credits-rule",
        version: "1",
        source: "urn:bank",
        claimTypes: ["income.salary-credits"],
        subjects: ["urn:sam"],
      },
    ],
  });
  const options = {
    settings: { receivers: [], payroll: "urn:payroll-provider", bank: "urn:bank", tolerance: 1 },
    trust,
    at,
    verifier: "urn:lender-agent",
    reliance: {
      id: "urn:reliance",
      rules: [
        {
          id: "urn:deposit-fitness",
          claimType: "deposit.balance",
          methods: ["recorded-by-authority"],
          maxAgeDays: 31,
          text: "Current recorded balances.",
        },
      ],
    },
    record: () => {},
  };
  const live = SuiteValuesNode.fromSignedPayload(bank);
  const check = (candidate: unknown = live) => corroborateIncome(payroll, [candidate], options).ok;
  expect(check()).toBe(true);
  const amount = live
    .node("salaryCredits")!
    .records("monthly")[0]!
    .entries.find((entry) => entry.name === "amount")!;
  amount.domainValue = amount.factory.literal(
    "7500.5",
    amount.factory.namedNode("http://www.w3.org/2001/XMLSchema#decimal"),
  );
  expect(check()).toBe(true);
  amount.domainValue = amount.factory.literal(
    "7501.01",
    amount.factory.namedNode("http://www.w3.org/2001/XMLSchema#decimal"),
  );
  expect(check()).toBe(false);
  for (const candidate of [
    { ...bank, salaryCredits: { ...bank.salaryCredits, rootRecords: ["urn:payroll-record"] } },
    { ...bank, salaryCredits: { ...bank.salaryCredits, rootRecords: [] } },
    { ...bank, salaryCredits: { ...bank.salaryCredits, currency: "GBP" } },
    {
      ...bank,
      salaryCredits: { ...bank.salaryCredits, period: { start: "2026-09", end: "2026-09" } },
    },
    {
      ...bank,
      salaryCredits: { ...bank.salaryCredits, monthly: [{ month: "2026-09", amount: 7500 }] },
    },
    {
      ...bank,
      salaryCredits: {
        ...bank.salaryCredits,
        monthly: [
          { month: "2026-10", amount: 7500 },
          { month: "2026-10", amount: 7500 },
        ],
      },
    },
    { ...bank, salaryCredits: { ...bank.salaryCredits, qualifier: "unverified" } },
    { ...bank, subject: "urn:another-person" },
    { ...bank, asOf: "2025-01-01T00:00:00Z" },
    { ...bank, method: "reported-by-subject" },
  ])
    expect(check(candidate)).toBe(false);
  const sameController = await TrustStore.load({
    ...trust.data,
    controllers: {
      "urn:payroll-provider": "urn:same-controller",
      "urn:bank": "urn:same-controller",
    },
  });
  expect(corroborateIncome(payroll, [bank], { ...options, trust: sameController }).ok).toBe(false);
  const noAuthority = await TrustStore.load({ ...trust.data, sourceAuthority: [] });
  expect(corroborateIncome(payroll, [bank], { ...options, trust: noAuthority }).ok).toBe(false);
});

it("requires a genuine accepted certificate for this source, dataset, category, policy and time", async () => {
  const key = await testKey("certificate-unit");
  const certificate = {
    type: "QualityCertificate",
    id: "urn:certificate",
    issuer: "urn:certifier",
    source: "urn:index",
    dataset: "urn:dataset",
    category: "residential",
    policy: "urn:quality-policy:v1",
    claimType: "mortgage.product",
    quality: { accurate: true, current: true, complete: true },
    validFrom: "2026-11-01T00:00:00Z",
    validUntil: "2026-12-01T00:00:00Z",
  };
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:sam",
    keys: [
      {
        kid: key.kid,
        alg: key.alg,
        publicJwk: key.publicJwk,
        role: "issuer",
        subject: "urn:certifier",
      },
    ],
    sourceAuthority: [
      {
        id: "urn:certifier-rule",
        version: "1",
        source: "urn:certifier",
        claimTypes: ["dataset.quality"],
        subjects: ["urn:dataset"],
      },
    ],
  });
  const claim = {
    claimType: "mortgage.product",
    qualityDataset: "urn:dataset",
    productCategory: "residential",
  };
  const policy = {
    references: {},
    certifier: "urn:certifier",
    source: "urn:index",
    dataset: "urn:dataset",
    category: "residential",
    policy: "urn:quality-policy:v1",
  };
  let signed = await signStatement(key, "awp-quality-certificate+jws", certificate);
  const options = {
    policy,
    reference: "urn:certificate",
    resolver: { resolve: async () => signed },
    trust,
    at,
    verifier: "urn:sam-agent",
    carriedBy: "urn:index",
    record: () => {},
  };
  expect(await certifiedQuality(claim, options)).toBe(true);
  expect(await certifiedQuality(claim, { ...options, carriedBy: "urn:another-index" })).toBe(false);
  expect(await certifiedQuality({ ...claim, qualityDataset: "urn:other-dataset" }, options)).toBe(
    false,
  );
  expect(await certifiedQuality({ ...claim, productCategory: 123 }, options)).toBe(false);
  for (const change of [
    { category: "business" },
    { dataset: "urn:other-dataset" },
    { source: "urn:other-index" },
    { policy: "urn:policy:v2" },
    { validUntil: at },
    { validFrom: "2026-11-14T00:00:00Z" },
    { quality: { accurate: true, current: true, complete: false } },
  ]) {
    signed = await signStatement(key, "awp-quality-certificate+jws", { ...certificate, ...change });
    expect(await certifiedQuality(claim, options)).toBe(false);
  }
  signed = await signStatement(key, "awp-quality-certificate+jws", certificate);
  signed = signed.slice(0, -8) + "AAAAAAAA";
  expect(await certifiedQuality(claim, options)).toBe(false);
});

it("never applies approval of one definition to an unknown or omitted request term", () => {
  const request = (term: string) => ({
    evidenceRequest: [{ claimType: "income.gross.monthly-series", incomeDefinition: { term } }],
  });
  expect(negotiatedRequestMatches(request("urn:term:approved"), "urn:term:approved")).toBe(true);
  expect(negotiatedRequestMatches(request("urn:term:other"), "urn:term:approved")).toBe(false);
  expect(
    negotiatedRequestMatches(
      { evidenceRequest: [{ claimType: "income.gross.monthly-series" }] },
      "urn:term:approved",
    ),
  ).toBe(false);
  expect(negotiatedRequestMatches(null, "urn:term:approved")).toBe(false);
});
