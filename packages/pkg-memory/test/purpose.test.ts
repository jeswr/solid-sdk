// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  LEFT_OPERANDS,
  type OdrlConstraint,
  type OdrlPolicy,
  parsePolicy,
  policyToTurtle,
} from "@jeswr/solid-odrl";
import { expect, it, vi } from "vitest";
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

it.each(
  LEFT_OPERANDS.filter((operand) => !["purpose", "dateTime"].includes(operand)),
)("denies policies requiring missing %s context, including permit-wins prohibitions", async (leftOperand) => {
  for (const conflict of ["prohibit", "perm", "invalid"] as const) {
    const restricted: OdrlPolicy = {
      id: policy.id,
      conflict,
      permissions: [{ type: "permission", action: "read", target: `${NS.pd}Contact` }],
      prohibitions: [
        {
          type: "prohibition",
          action: "read",
          target: `${NS.pd}Contact`,
          constraints: [{ leftOperand, operator: "eq", rightOperand: "restricted" }],
        },
      ],
    };
    const parsed = await parsePolicy(await policyToTurtle(restricted));
    expect(parsed).toBeDefined();
    for (const candidate of [restricted, parsed as OdrlPolicy])
      expect(
        purposeFilter(candidate, "ServiceProvision", client)({ categories: ["pd:Contact"] }),
      ).toBe(false);
  }
});

it.each([
  { leftOperand: "dateTime", operator: "gt", rightOperand: "not a date" },
  { leftOperand: "dateTime", operator: "lt", rightOperand: "2026-02-30T00:00:00Z" },
  { leftOperand: "dateTime", operator: "eq", rightOperand: "2026-10-26T12:00:00" },
  { leftOperand: "dateTime", operator: "neq", rightOperand: 123 },
  { leftOperand: "purpose", operator: "eq", rightOperand: [] },
  { leftOperand: "purpose", operator: "eq", rightOperand: ["one", "two"] },
  { leftOperand: "purpose", operator: "isAnyOf", rightOperand: ["one", ""] },
  { leftOperand: "purpose", operator: "eq", rightOperand: 1 },
  { leftOperand: "purpose", operator: "unknown", rightOperand: "one" },
  { leftOperand: "purpose", operator: "eq", rightOperand: "one", datatype: `${NS.xsd}dateTime` },
  { leftOperand: "dateTime", operator: "lt", rightOperand: "999999-01-01T00:00:00Z" },
] as OdrlConstraint[])("denies unparseable constraint context: %j", (constraint) => {
  const restricted: OdrlPolicy = {
    id: policy.id,
    permissions: [{ type: "permission", action: "read" }],
    prohibitions: [{ type: "prohibition", action: "read", constraints: [constraint] }],
  };
  expect(
    purposeFilter(restricted, "ServiceProvision", client)({ categories: ["pd:Contact"] }),
  ).toBe(false);
});

it("checks permission and duty context and rechecks owner policy edits on each read", () => {
  const constraint: OdrlConstraint = { leftOperand: "count", operator: "lt", rightOperand: 2 };
  for (const restricted of [
    { permissions: [{ type: "permission", action: "read", constraints: [constraint] }] },
    { obligations: [{ action: "inform", constraints: [constraint] }] },
    {
      permissions: [
        {
          type: "permission",
          action: "read",
          duties: [{ action: "inform", constraints: [constraint] }],
        },
      ],
    },
  ] satisfies Partial<OdrlPolicy>[]) {
    expect(
      purposeFilter(
        { id: policy.id, ...restricted },
        "ServiceProvision",
        client,
      )({ categories: ["pd:Contact"] }),
    ).toBe(false);
  }
  const mutable = {
    id: policy.id,
    permissions: [{ type: "permission", action: "read" }],
  } satisfies OdrlPolicy;
  const filter = purposeFilter(mutable, "ServiceProvision", client);
  expect(filter({ categories: ["pd:Contact"] })).toBe(true);
  Object.assign(mutable, {
    prohibitions: [{ type: "prohibition", action: "read", constraints: [constraint] }],
  });
  expect(filter({ categories: ["pd:Contact"] })).toBe(false);
});

it("evaluates supported purpose and time constraints with an implicit evaluation instant", () => {
  vi.useFakeTimers().setSystemTime(new Date("2026-10-26T12:00:00Z"));
  try {
    const timed: OdrlPolicy = {
      id: policy.id,
      permissions: [
        {
          type: "permission",
          action: "read",
          constraints: [
            {
              leftOperand: "purpose",
              operator: "isAnyOf",
              rightOperand: [MEMORY_PURPOSES.ServiceProvision],
              datatype: `${NS.xsd}string`,
            },
          ],
        },
      ],
      prohibitions: [
        {
          type: "prohibition",
          action: "read",
          constraints: [
            {
              leftOperand: "dateTime",
              operator: "gteq",
              rightOperand: "2026-10-27T00:00:00Z",
              datatype: `${NS.xsd}dateTime`,
            },
          ],
        },
      ],
    };
    const filter = purposeFilter(timed, "ServiceProvision", client);
    expect(filter({ categories: ["pd:Contact"] })).toBe(true);
    expect(purposeFilter(timed, "Personalisation", client)({ categories: ["pd:Contact"] })).toBe(
      false,
    );
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    expect(filter({ categories: ["pd:Contact"] })).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
