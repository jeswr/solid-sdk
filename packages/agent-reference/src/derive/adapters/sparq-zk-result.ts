// AUTHORED-BY Codex GPT-6
/** Research-grade, unaudited; sparq commitment-signed credentials (not standard VCs),
 * exclusively test-only issuer keys. No holder, absence or completeness binding. */
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { createHash } from "crypto";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { existsSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { registerHooks } from "module";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { resolve } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath, pathToFileURL } from "url";
import { z } from "zod";
import { resultCredentialGraph } from "../../model/sparq-result.js";
import type { ProofSystem } from "../verifiers.js";

export const SPARQ_ZK_RESULT = {
  method: "sparq-zk-result/5",
  package: "@sparq-org/zk-result",
  version: "0.1.8",
  commit: "7a56f943",
  sha256: "e2b19eead2bcc471661b3698fb43b922caee4f9cf448024687c1f8c98335d86d",
  notice:
    "Research-grade and unaudited; sparq commitment-signed credentials, not standard VCs; test-only issuer keys (testIssuerKeygen).",
} as const;

const uint = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const byte = uint.max(255);
const key = z.string().min(1);
const testIssuer = z.strictObject({ seedHex: z.string().regex(/^[0-9a-fA-F]+$/), publicKey: key });
export const resultPublicKey = z.strictObject({ publicKey: key });
export const resultStatusRef = z.strictObject({
  status_list: z.string(),
  version: uint,
  index: uint,
});
const legacyStatusRef = z.strictObject({
  list: z.string(),
  version: uint,
  index: uint,
  active: z.boolean(),
});
export const resultSnapshot = z.strictObject({
  status_list: z.string(),
  version: uint,
  bits: z.array(byte),
});
export const resultPolicy = z.strictObject({
  trustedIssuers: z.array(key),
  snapshots: z.array(resultSnapshot),
  minVersion: uint,
  maxVersion: uint,
});
export const resultCredential = z.strictObject({
  graphNQuads: z.string(),
  salt: z.string(),
  issuer: key,
  signature: z.string(),
  statusRef: resultStatusRef,
});
const term = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("iri"), value: z.string() }),
  z.strictObject({
    kind: z.literal("literal"),
    value: z.string(),
    datatype: z.string().optional(),
    language: z.string().optional(),
  }),
]);
const rows = z.array(z.record(z.string(), term));
export const resultPresentation = z.strictObject({
  version: uint,
  query: z.string(),
  rows,
  challenge: z.string(),
  issuer_slots: z.array(key),
  integer_capacity: z.enum(["two_digits", "full_u64"]).optional(),
  proof: z.array(byte),
});
export const resultProved = z.strictObject({ presentation: resultPresentation, result: rows });
export const resultVerified = z.strictObject({
  verified: z.boolean(),
  released: rows,
  reason: z.string().optional(),
});
export interface ResultPackage {
  testIssuerKeygen(seedHex: string): unknown;
  issue(
    issuer: z.infer<typeof testIssuer>,
    graph: string,
    status: z.infer<typeof resultStatusRef>,
  ): unknown;
  prove(input: {
    query: string;
    credentials: z.infer<typeof resultCredential>[];
    policy: z.infer<typeof resultPolicy>;
    nonce: string;
  }): Promise<unknown>;
  verify(input: {
    expectedQuery: string;
    presentation: z.infer<typeof resultPresentation>;
    policy: z.infer<typeof resultPolicy>;
    nonce: string;
    seenNonces: { has(key: string): boolean; add(key: string): unknown };
  }): Promise<unknown>;
}

/** Map arbitrary application challenges to one canonical BN254 field encoding. */
function nonceField(nonce: string): string {
  const field =
    BigInt(`0x${createHash("sha256").update(nonce).digest("hex")}`) %
    21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  return `0x${field.toString(16).padStart(64, "0")}`;
}

export class SparqZkResult implements ProofSystem {
  readonly method = SPARQ_ZK_RESULT.method;
  readonly kind = "real" as const;
  readonly binds = ["rule", "issuers", "fresh"] as const;
  constructor(private readonly native: ResultPackage) {}
  issuerKeygen: ProofSystem["issuerKeygen"] = async (seed) => {
    const seedHex = createHash("sha256").update(seed).digest("hex").slice(0, 16);
    const issued = testIssuer.parse(this.native.testIssuerKeygen(seedHex));
    return { publicKey: resultPublicKey.parse({ publicKey: issued.publicKey }), secretKey: issued };
  };
  issue: ProofSystem["issue"] = async (input) => {
    const issuer = testIssuer.parse(input.issuerKey);
    const legacy = legacyStatusRef.safeParse(input.status);
    const status = resultStatusRef.parse(
      legacy.success
        ? { status_list: legacy.data.list, version: legacy.data.version, index: legacy.data.index }
        : input.status,
    );
    const graph = await resultCredentialGraph(input.subject, input.claims);
    return resultCredential.parse(this.native.issue(issuer, graph, status));
  };
  prove: ProofSystem["prove"] = async (input) => {
    const checked = resultProved.parse(
      await this.native.prove({
        query: input.query,
        credentials: input.credentials.map((c) => resultCredential.parse(c)),
        policy: resultPolicy.parse(input.policy),
        nonce: nonceField(input.nonce),
      }),
    );
    return checked;
  };
  verify: ProofSystem["verify"] = async (input) => {
    if (!input.seenNonces) return { ok: false, reason: "persistent nonce store missing" };
    const presentation = resultPresentation.parse(input.presentation);
    const policy = resultPolicy.parse(input.policy);
    const checked = resultVerified.parse(
      await this.native.verify({
        expectedQuery: input.expectedQuery,
        presentation,
        policy,
        nonce: nonceField(input.nonce),
        seenNonces: input.seenNonces,
      }),
    );
    if (!checked.verified)
      return { ok: false, reason: checked.reason ?? "result verifier refused without a reason" };
    // These slots are public inputs reconstructed by the real verifier, not trusted
    // merely because the holder supplied them. Reject unfamiliar slots even on success.
    if (
      !presentation.issuer_slots.length ||
      presentation.issuer_slots.some((k) => !policy.trustedIssuers.includes(k))
    )
      return { ok: false, reason: "verified issuer slots do not match receiver policy" };
    return {
      ok: true,
      released: checked.released,
      binds: this.binds,
      issuerKeys: [...new Set(presentation.issuer_slots)].map((publicKey) => ({ publicKey })),
    };
  };
}

export async function loadSparqZkResult(): Promise<SparqZkResult | undefined> {
  const directory =
    process.env.ANSWERABLE_SPARQ_ZK_RESULT ??
    fileURLToPath(new URL("../../../.sparq/sparq-zk-result/", import.meta.url));
  const entry = resolve(directory, "index.js");
  if (!existsSync(entry)) return undefined;
  // A narrowly scoped Node resolver hook keeps the import literal, as required by
  // the layer guard, while supporting a host-selected offline installation directory.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        specifier === "../../../.sparq/sparq-zk-result/index.js" &&
        context.parentURL === import.meta.url
      )
        return { url: pathToFileURL(entry).href, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  try {
    // biome-ignore lint/suspicious/noTsIgnore: the optional archive may be present or absent at typecheck time
    // @ts-ignore Optional delivery is absent in ordinary SDK installations.
    const loaded: unknown = await import("../../../.sparq/sparq-zk-result/index.js");
    const api = z
      .strictObject({
        testIssuerKeygen: z.function(),
        issue: z.function(),
        prove: z.function(),
        verify: z.function(),
      })
      .parse(loaded);
    return new SparqZkResult(api as ResultPackage);
  } finally {
    hooks.deregister();
  }
}
