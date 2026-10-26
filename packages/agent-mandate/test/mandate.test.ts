// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import {
  buildBitstringStatusListCredential,
  createBitstringStatusResolver,
  createStatusBitstring,
  credentialToRdf,
  digestQuads,
  issue,
  type JsonValue,
  type KeyPair,
  setStatusBit,
  type VerifiableCredential,
} from "@jeswr/solid-vc";
import { beforeAll, expect, it } from "vitest";
import { mandateToTurtle, parseMandateCredential } from "../src/document.js";
import {
  createVcMandateVerifier,
  defaultMandate,
  issueMandate,
  limitConstraint,
  mandateCredential,
  type VcMandateOptions,
} from "../src/mandate.js";
import { evaluateIntent } from "../src/policy.js";
import { AGENT, LIMIT_OPERANDS, ODRL } from "../src/types.js";
import {
  ACTOR,
  clock,
  edKey,
  ID,
  intent,
  mandate,
  NOW,
  OWNER,
  profileResolver,
  STATUS,
} from "./helpers.js";

let key: KeyPair;
let options: VcMandateOptions;
let credential: VerifiableCredential;
beforeAll(async () => {
  key = await edKey();
  credential = await issueMandate(mandate(), key, {
    statusListCredential: STATUS,
    statusListIndex: "1",
  });
  options = {
    read: async () => credential,
    ownerWebId: OWNER,
    agentWebId: ACTOR,
    statusListCredential: STATUS,
    webIdKeyResolver: await profileResolver(key),
    resolveStatus: async () => ({ status: "valid" }),
    now: clock,
  };
});
it("loads a signed embedded agreement and evaluates the default mandate", async () => {
  const m = await createVcMandateVerifier(options).load();
  expect(m).toMatchObject({ id: ID, issuer: OWNER, subject: ACTOR, validFrom: NOW.toISOString() });
  expect(await evaluateIntent(m, intent())).toEqual({
    decision: "confirm-required",
    reason: "owner-approval",
  });
  expect((await evaluateIntent(m, intent({ action: `${AGENT}Transfer` }))).decision).toBe(
    "prohibited",
  );
});
it.each([
  "prototype",
  "non-enumerable",
] as const)("calls resolver callbacks with their receiver when key control is %s", async (placement) => {
  class Resolver {
    keyCalls = 0;
    controlCalls = 0;
    constructor(readonly allowed: boolean) {}
    readonly resolveKey = async function (this: Resolver, method: string) {
      expect(method).toBe(key.verificationMethod);
      this.keyCalls++;
      return key.publicKey;
    };
    async isControlledBy(method: string, issuer: string) {
      expect(method).toBe(key.verificationMethod);
      expect(issuer).toBe(OWNER);
      this.controlCalls++;
      return this.allowed;
    }
  }
  for (const allowed of [false, true]) {
    const resolver = new Resolver(allowed);
    if (placement === "non-enumerable")
      Object.defineProperty(resolver, "isControlledBy", { value: resolver.isControlledBy });
    const loaded = await createVcMandateVerifier({ ...options, webIdKeyResolver: resolver }).load();
    if (allowed) {
      expect(loaded?.id).toBe(ID);
      expect(resolver.keyCalls).toBeGreaterThan(0);
    } else expect(loaded).toBeUndefined();
    expect(resolver.controlCalls).toBeGreaterThan(0);
  }
});
it("requires both resolver callbacks at runtime instead of falling back to prefix trust", async () => {
  const resolveKey = async () => key.publicKey;
  const isControlledBy = async () => true;
  for (const resolver of [
    undefined,
    null,
    {},
    { resolveKey },
    { isControlledBy },
    { resolveKey: "invalid", isControlledBy },
    { resolveKey, isControlledBy: "invalid" },
  ])
    expect(
      await createVcMandateVerifier({
        ...options,
        webIdKeyResolver: resolver as unknown as VcMandateOptions["webIdKeyResolver"],
      }).load(),
    ).toBeUndefined();
});
it("rejects invalid hashes and invalid accounting limits", () => {
  for (const recipientHashes of [[], ["plaintext"], [`sha256:${"g".repeat(64)}`]])
    expect(() =>
      defaultMandate({ id: ID, ownerWebId: OWNER, agentWebId: ACTOR, recipientHashes, now: NOW }),
    ).toThrow("hashes");
  for (const [operand, value, enforcement] of [
    ["unknown", 1, "soft"],
    [LIMIT_OPERANDS[0] as string, -1, "hard"],
    [LIMIT_OPERANDS[0] as string, Number.NaN, "soft"],
    [LIMIT_OPERANDS[0] as string, 1, "unknown"],
  ] as const)
    expect(() => limitConstraint(operand, value, enforcement as "hard")).toThrow("limit");
});
it("round-trips hard and soft ODRL limit vocabulary", async () => {
  const m = {
    ...mandate(),
    limits: LIMIT_OPERANDS.map((operand, i) =>
      limitConstraint(operand, i + 0.5, i % 2 ? "hard" : "soft"),
    ),
  };
  const vc = await issueMandate(m, key, { statusListCredential: STATUS, statusListIndex: "2" });
  expect(
    (await createVcMandateVerifier({ ...options, read: async () => vc }).load())?.limits,
  ).toEqual(m.limits);
});
it("refuses to issue ambiguous scalar constraints throughout a mandate", async () => {
  const constraint = { leftOperand: "count", operator: "eq", rightOperand: [1, 2] } as const;
  const rule = { type: "permission" as const, action: "read", constraints: [constraint] };
  const duty = { action: "inform" as const, constraints: [constraint] };
  for (const changes of [
    { autonomous: { ...mandate().autonomous, permissions: [rule] } },
    { withApproval: { ...mandate().withApproval, permissions: [rule] } },
    { prohibitions: [{ ...rule, type: "prohibition" as const }] },
    {
      autonomous: {
        ...mandate().autonomous,
        permissions: [{ ...rule, constraints: [], duties: [duty] }],
      },
    },
    { withApproval: { ...mandate().withApproval, obligations: [duty] } },
  ]) {
    await expect(
      issueMandate({ ...mandate(), ...changes }, key, {
        statusListCredential: STATUS,
        statusListIndex: "1",
      }),
    ).rejects.toThrow("right operand");
  }
});
it("rejects signed scalar operands in either RDF order during verification and Turtle parsing", async () => {
  const digests: string[] = [];
  for (const rightOperand of [
    [1, 2],
    [2, 1],
  ]) {
    const claims = mandateCredential(mandate(), {
      statusListCredential: STATUS,
      statusListIndex: "1",
    });
    const agreement = (claims.credentialSubject as Record<string, JsonValue>)[
      `${AGENT}agreement`
    ] as Record<string, JsonValue>;
    agreement[`${ODRL}prohibition`] = [
      {
        [`${ODRL}action`]: `${AGENT}SendMessage`,
        [`${ODRL}constraint`]: [
          {
            [`${ODRL}leftOperand`]: `${ODRL}count`,
            [`${ODRL}operator`]: `${ODRL}eq`,
            [`${ODRL}rightOperand`]: rightOperand,
          },
        ],
      },
    ];
    const signed = await issue({ credential: claims, key, options: { created: NOW } });
    digests.push(await digestQuads(credentialToRdf(signed)));
    expect(
      await createVcMandateVerifier({ ...options, read: async () => signed }).load(),
    ).toBeUndefined();
    expect(await parseMandateCredential(await mandateToTurtle(signed))).toBeUndefined();
  }
  expect(digests[0]).toBe(digests[1]);
});
it("rejects unavailable credentials, status and invalid proofs", async () => {
  for (const changes of [
    { read: async () => undefined },
    {
      read: async () => {
        throw new Error("offline");
      },
    },
    { resolveStatus: async () => ({ status: "revoked" as const, reason: "fixture revoked" }) },
    { resolveStatus: async () => ({ status: "unreachable" as const, reason: "fixture offline" }) },
    {
      resolveStatus: async () => {
        throw new Error("unreadable");
      },
    },
    { now: () => new Date("2099-01-01") },
    { now: () => new Date("2000-01-01") },
    { webIdKeyResolver: { resolveKey: async () => undefined, isControlledBy: async () => false } },
  ])
    expect(await createVcMandateVerifier({ ...options, ...changes }).load()).toBeUndefined();
});
it("refuses missing validity, owner, suite, status and policy bindings", async () => {
  for (const mutate of [
    (v: VerifiableCredential) => {
      delete (v as { id?: string }).id;
    },
    (v: VerifiableCredential) => {
      (v as { issuer: string }).issuer = "https://other.example/#me";
    },
    (v: VerifiableCredential) => {
      delete (v as { validFrom?: string }).validFrom;
    },
    (v: VerifiableCredential) => {
      delete (v as { validUntil?: string }).validUntil;
    },
    (v: VerifiableCredential) => {
      (v as { proof: unknown }).proof = [];
    },
    (v: VerifiableCredential) => {
      (v as { proof: unknown }).proof = [
        { ...(v.proof as object), cryptosuite: "ecdsa-rdfc-2019" },
      ];
    },
    (v: VerifiableCredential) => {
      delete (v as { credentialStatus?: unknown }).credentialStatus;
    },
    (v: VerifiableCredential) => {
      (v as { credentialStatus: unknown }).credentialStatus = [
        { ...(v.credentialStatus as object), statusPurpose: "suspension" },
      ];
    },
    (v: VerifiableCredential) => {
      (v as { credentialStatus: unknown }).credentialStatus = {
        ...(v.credentialStatus as object),
        statusListCredential: "https://other.example/status",
      };
    },
    (v: VerifiableCredential) => {
      (v.credentialSubject as Record<string, unknown>)[`${AGENT}agreement`] = undefined;
    },
  ]) {
    const vc = structuredClone(credential);
    mutate(vc);
    expect(
      await createVcMandateVerifier({ ...options, read: async () => vc }).load(),
    ).toBeUndefined();
  }
  expect(
    await createVcMandateVerifier({
      ...options,
      statusListCredential: "https://pod.example/wrong",
    }).load(),
  ).toBeUndefined();
});
it("rejects signed graphs with a mismatching agreement binding", async () => {
  for (const [field, value] of [
    ["http://www.w3.org/1999/02/22-rdf-syntax-ns#type", "urn:wrong"],
    ["http://www.w3.org/ns/odrl/2/assigner", "https://other.example/#me"],
    ["http://www.w3.org/ns/odrl/2/assignee", "https://other.example/#me"],
    ["http://www.w3.org/ns/odrl/2/uid", "urn:wrong"],
  ]) {
    const vc = structuredClone(credential);
    const agreement = (vc.credentialSubject as Record<string, Record<string, unknown>>)[
      `${AGENT}agreement`
    ] as Record<string, unknown>;
    agreement[field as string] = value;
    const signed = await issue({ credential: vc, key, options: { created: NOW } });
    expect(
      await createVcMandateVerifier({ ...options, read: async () => signed }).load(),
    ).toBeUndefined();
  }
});
it("rejects a signed limit outside the accounting vocabulary", async () => {
  const m = {
    ...mandate(),
    limits: [
      {
        leftOperand: "urn:unsupported",
        operator: "lteq" as const,
        rightOperand: 1,
        enforcement: "hard" as const,
      },
    ],
  };
  const vc = await issueMandate(m, key, { statusListCredential: STATUS, statusListIndex: "1" });
  expect(
    await createVcMandateVerifier({ ...options, read: async () => vc }).load(),
  ).toBeUndefined();
});
it("rejects an absent status result and invalid verification clock", async () => {
  expect(
    await createVcMandateVerifier({
      ...options,
      resolveStatus: async () => ({ status: "absent" }),
    }).load(),
  ).toBeUndefined();
  expect(
    await createVcMandateVerifier({ ...options, now: () => new Date("invalid") }).load(),
  ).toBeUndefined();
  expect(
    await createVcMandateVerifier({
      ...options,
      now: () => new Date(credential.validUntil as string),
    }).load(),
  ).toBeUndefined();
});
it("verifies actual signed bitstring status lists and refuses revoked or unreadable lists", async () => {
  for (const revoked of [false, true]) {
    const bits = createStatusBitstring();
    setStatusBit(bits, 1, revoked);
    const list = await issue({
      credential: await buildBitstringStatusListCredential({
        id: STATUS,
        issuer: OWNER,
        statusPurpose: "revocation",
        bits,
        validFrom: NOW.toISOString(),
        validUntil: "2026-11-01T00:00:00Z",
      }),
      key,
      options: { created: NOW },
    });
    const resolveStatus = createBitstringStatusResolver({
      ...options.webIdKeyResolver,
      now: NOW,
      fetch: async () =>
        new Response(JSON.stringify(list), { headers: { "content-type": "application/ld+json" } }),
    });
    const result = await createVcMandateVerifier({ ...options, resolveStatus }).load();
    if (revoked) expect(result).toBeUndefined();
    else expect(result?.id).toBe(ID);
  }
  const resolveStatus = createBitstringStatusResolver({
    ...options.webIdKeyResolver,
    now: NOW,
    fetch: async () => new Response("unreadable", { status: 503 }),
  });
  expect(await createVcMandateVerifier({ ...options, resolveStatus }).load()).toBeUndefined();
});
