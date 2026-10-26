// AUTHORED-BY Codex GPT-6.1-Sol
import { type OdrlPolicy, parsePolicy, policyToTurtle } from "@jeswr/solid-odrl";
import { expect, it } from "vitest";
import {
  createDefaultPolicy,
  isSpecialCategory,
  MEMORY_PURPOSES,
  type MemoryPurpose,
  purposeFilter,
} from "../src/index.js";
import { NS } from "../src/rdf.js";

const client = "https://example.org/client";
const owner = "https://example.org/owner#me";
const policy = createDefaultPolicy("https://example.org/policy", owner);

it.each(
  Object.keys(MEMORY_PURPOSES) as MemoryPurpose[],
)("default deny/permit matrix for %s survives RDF roundtrip", async (purpose) => {
  const parsed = await parsePolicy(await policyToTurtle(policy));
  expect(parsed).toBeDefined();
  for (const candidate of [policy, parsed as OdrlPolicy]) {
    for (const agent of [client, "https://example.org/other-client"]) {
      const filter = purposeFilter(candidate, purpose, agent);
      for (const category of [
        "Contact",
        "EmailAddress",
        "TelephoneNumber",
        "PhysicalAddress",
        "HomeLocation",
        "Preference",
      ])
        expect(filter({ categories: [NS.pd + category] })).toBe(true);
      for (const category of [
        "MedicalHealth",
        "MentalHealth",
        "Genetic",
        "Financial",
        "Unknown",
        "SocialNetwork",
      ])
        expect(filter({ categories: [`pd:${category}`] })).toBe(false);
      expect(filter({ categories: [] })).toBe(false);
      expect(filter({ categories: ["pd:Contact", "pd:MedicalHealth"] })).toBe(false);
    }
  }
});

it("requires a supported purpose and safe client identity", () => {
  for (const purpose of ["Research", "", "toString", "__proto__"])
    expect(() => purposeFilter(policy, purpose as MemoryPurpose, client)).toThrow("purpose");
  expect(() => purposeFilter(policy, "ServiceProvision", "not an iri")).toThrow();
});

it("evaluates purpose, client, conflict strategy and duties on every call", () => {
  const scoped: OdrlPolicy = {
    id: policy.id,
    assignee: client,
    permissions: [
      {
        type: "permission",
        action: "read",
        target: `${NS.pd}MedicalHealth`,
        constraints: [
          {
            leftOperand: "purpose",
            operator: "eq",
            rightOperand: MEMORY_PURPOSES.ServiceProvision,
          },
        ],
      },
    ],
  };
  const fact = { categories: ["pd:MedicalHealth"] };
  expect(purposeFilter(scoped, "ServiceProvision", client)(fact)).toBe(true);
  expect(purposeFilter(scoped, "Personalisation", client)(fact)).toBe(false);
  expect(purposeFilter(scoped, "ServiceProvision", "https://example.org/other")(fact)).toBe(false);
  const conflicted = { ...scoped, prohibitions: policy.prohibitions };
  expect(purposeFilter(conflicted, "ServiceProvision", client)(fact)).toBe(false);
  expect(purposeFilter({ ...conflicted, conflict: "perm" }, "ServiceProvision", client)(fact)).toBe(
    true,
  );
  const duty: OdrlPolicy = {
    ...scoped,
    permissions: [{ type: "permission", action: "read", duties: [{ action: "inform" }] }],
  };
  expect(purposeFilter(duty, "ServiceProvision", client)(fact)).toBe(false);
  expect(purposeFilter({ id: policy.id }, "ServiceProvision", client)(fact)).toBe(false);
  expect(() =>
    purposeFilter(scoped, "ServiceProvision", client)({ categories: ["bad category"] }),
  ).toThrow();
});

it("detects DPV special categories including health and biometric descendants, separately from finance", () => {
  for (const category of [
    "MedicalHealth",
    "Genetic",
    "MentalHealth",
    "Prescription",
    "HealthRecord",
    "Biometric",
    "Fingerprint",
    "EthnicOrigin",
    "PoliticalAffiliation",
    "Religion",
    "SexualPreference",
    "TradeUnionMembership",
  ])
    expect(isSpecialCategory(`pd:${category}`)).toBe(true);
  expect(isSpecialCategory(`${NS.dpv}SpecialCategoryPersonalData`)).toBe(true);
  expect(isSpecialCategory(`${NS.pd}MedicalHealth`)).toBe(true);
  for (const category of ["Contact", "Financial", "Preference", "Unknown"])
    expect(isSpecialCategory(`pd:${category}`)).toBe(false);
});
