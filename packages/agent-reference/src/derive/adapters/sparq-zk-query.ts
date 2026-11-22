// AUTHORED-BY Codex GPT-6.2 Sol
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
import { queryCredentialGraphs } from "../../model/sparq-query.js";
import { strictJson } from "../../wire/strict-json.js";
import { DERIVATION_LIMITS, type ProofBinds, type ProofSystem } from "../verifiers.js";
import { trustMember } from "./sparq-zk-result.js";

export const SPARQ_ZK_QUERY = {
  method: "sparq-zk-query/1",
  package: "@sparq-org/zk-query",
  version: "0.1.8",
  commit: "95c7b325476b3b0cf6ae69ca287926d05b6e87cd",
  sha256: "8b4bacb109c5f190e04565483c86c11efe3af5050b23ada80ab48512dbedc8b3",
  notice:
    "Research-grade and unaudited. Uses sparq Merkle-suite credentials and test-only issuer keys (testIssuerKeygen).",
} as const;

const hex = z.string().regex(/^(?:[0-9a-f]{2})+$/);
const word = z.string().regex(/^[0-9a-f]{64}$/);
const uint = z.number().int().nonnegative();
const pos = uint.min(1);
const testIssuer = z.strictObject({ seedHex: hex, publicKey: hex });
const credential = z.strictObject({
  graphNQuads: z.string(),
  proofConfigNQuads: z.string(),
  saltHex: hex,
  rootHex: hex,
  count: pos,
  issuer: hex,
  signatureHex: hex,
});
export const queryPolicyOptions = z.strictObject({
  bounds: z.strictObject({ credentials: pos, quadsPerCredential: pos, rowsPerTable: pos }),
  audience: z.string(),
  notBefore: uint,
  notAfter: uint,
  credentialQuadBounds: z.array(pos).optional(),
  inputCommitment: word.optional(),
  maxPresentationBytes: pos.optional(),
  maxResultSize: pos.optional(),
  holderBinding: z.strictObject({ issuers: z.array(z.string()).min(1).optional() }).optional(),
  acceptedSnapshots: z
    .strictObject({ digests: z.array(hex), allowMissing: z.boolean().optional() })
    .optional(),
  validityTime: uint.optional(),
  earliestCreated: uint.optional(),
  tableRowBounds: z.array(pos).optional(),
  openingProfile: z.enum(["solid", "long-objects", "extended"]).optional(),
});
const policySchema = queryPolicyOptions.extend({
  trustedIssuers: z.array(hex).min(1),
  trustMembers: z.array(trustMember).min(1),
});
const request = z.strictObject({
  query: z.string(),
  policy: policySchema,
  nonce: hex,
  planHash: hex,
  verificationKey: hex,
  digest: hex,
  requestRdf: z.string(),
});
const result = z.union([
  z.strictObject({ boolean: z.boolean() }),
  z.strictObject({ variables: z.array(z.string()), rows: z.array(z.array(z.string().nullable())) }),
]);
const presentation = z.strictObject({
  requestDigest: hex,
  inputCommitment: hex,
  signatureMode: uint,
  result,
  proof: hex,
});
const proved = z.strictObject({ presentation, result });
const verified = z.discriminatedUnion("verified", [
  z.strictObject({
    verified: z.literal(true),
    released: result,
    report: z.strictObject({
      rule: z.strictObject({ query: z.string(), planHash: hex }),
      issuers: z.array(hex).min(1),
      subject: z.array(z.string()),
      fresh: hex,
      complete: z.literal(true),
      issuerRoot: hex,
      trustMembers: z.array(trustMember).min(1),
      status: z
        .strictObject({ acceptedSnapshots: z.array(hex), allowMissing: z.boolean() })
        .optional(),
      validityTime: uint.optional(),
      earliestCreated: uint.optional(),
      tableRowBounds: z.array(pos).optional(),
    }),
  }),
  z.strictObject({ verified: z.literal(false), released: z.tuple([]), reason: z.string() }),
]);

type NativeRequest = z.infer<typeof request>;
interface QueryPackage {
  testIssuerKeygen(seedHex: string): unknown;
  testIssue(input: {
    issuer: z.infer<typeof testIssuer>;
    graphNQuads: string;
    status: { proofConfigNQuads: string };
    seedHex: string;
  }): unknown;
  request(input: Pick<NativeRequest, "query" | "policy" | "nonce">): unknown;
  prove(input: {
    request: NativeRequest;
    credentials: z.infer<typeof credential>[];
    backend: "native" | "wasm" | { type: "native" | "wasm"; presentationSaltHex: string };
  }): Promise<unknown>;
  verify(input: {
    request: NativeRequest;
    presentation: z.infer<typeof presentation>;
    seenNonces: { consume(nonce: string): "fresh" | "alreadyConsumed" };
  }): Promise<unknown>;
}

function released(value: z.infer<typeof result>, booleanResult = false) {
  if ("boolean" in value) return value.boolean;
  const [row] = value.rows;
  if (
    value.variables.length === 1 &&
    (booleanResult || value.variables[0] === "result") &&
    value.rows.length === 1 &&
    row?.length === 1
  ) {
    const [term] = row;
    const datatype = '"^^<http://www.w3.org/2001/XMLSchema#boolean>';
    if (term === `"true${datatype}` || term === `"1${datatype}`) return true;
    if (term === `"false${datatype}` || term === `"0${datatype}`) return false;
  }
  if (booleanResult) throw new Error("The query must release exactly one Boolean result");
  return value;
}

function hash(domain: string, seed: string | Uint8Array) {
  return createHash("sha256").update(domain).update("\0").update(seed).digest("hex");
}

export class SparqZkQuery implements ProofSystem {
  readonly method = SPARQ_ZK_QUERY.method;
  readonly kind = "real" as const;
  readonly binds = ["rule", "issuers", "fresh", "complete"] as const;

  constructor(
    private readonly native: QueryPackage,
    private readonly backend: "native" | "wasm" = "native",
    private readonly prepareFixture?: (input: string) => string,
  ) {}

  issuerKeygen: ProofSystem["issuerKeygen"] = async (seed) => {
    const issuer = testIssuer.parse(
      this.native.testIssuerKeygen(hash("sparq-zk-query issuer", seed)),
    );
    return { publicKey: { publicKey: issuer.publicKey }, secretKey: issuer };
  };

  issue: ProofSystem["issue"] = async (input) => {
    const issuer = testIssuer.parse(input.issuerKey);
    if (input.status) throw new Error("Query credential status requires a status-list envelope");
    const { graphNQuads, proofConfigNQuads } = await queryCredentialGraphs(
      input.subject,
      input.claims,
    );
    return credential.parse(
      this.native.testIssue({
        issuer,
        graphNQuads,
        status: { proofConfigNQuads },
        seedHex: hash("sparq-zk-query issuance", issuer.seedHex),
      }),
    );
  };

  private request(query: string, rawPolicy: unknown, nonce: string) {
    return request.parse(
      this.native.request({
        query,
        policy: policySchema.parse(rawPolicy),
        nonce: hash("sparq-zk-query challenge", nonce),
      }),
    );
  }

  /** Compute a pin for the verifier's independently selected scenario fixture dataset. */
  fixtureInputCommitment(input: Parameters<ProofSystem["prove"]>[0]): string {
    if (!this.prepareFixture) throw new Error("Query fixture commitment host unavailable");
    const prepared = strictJson(
      this.prepareFixture(
        JSON.stringify({
          request: this.request(input.query, input.policy, input.nonce),
          credentials: input.credentials.map((value) => credential.parse(value)),
          clock: Math.floor(Date.now() / 1000),
          presentationSaltHex: word.parse(input.presentationSaltHex),
        }),
      ),
      DERIVATION_LIMITS.maxEnvelopeBytes,
    );
    return z.object({ presentationSkeleton: z.object({ inputCommitment: word }) }).parse(prepared)
      .presentationSkeleton.inputCommitment;
  }

  prove: ProofSystem["prove"] = async ({
    query,
    policy,
    nonce,
    credentials,
    booleanResult,
    presentationSaltHex,
  }) => {
    const stored = this.request(query, policy, nonce);
    if (stored.policy.inputCommitment && !presentationSaltHex)
      throw new Error("The pinned query dataset requires its presentation salt");
    const proof = proved.parse(
      await this.native.prove({
        request: stored,
        credentials: credentials.map((value) => credential.parse(value)),
        backend:
          presentationSaltHex === undefined
            ? this.backend
            : { type: this.backend, presentationSaltHex: word.parse(presentationSaltHex) },
      }),
    );
    return { presentation: proof.presentation, result: released(proof.result, booleanResult) };
  };

  verify: ProofSystem["verify"] = async (input) => {
    const store = input.seenNonces;
    if (!store) return { ok: false, reason: "persistent nonce store missing" };
    try {
      const stored = this.request(input.expectedQuery, input.policy, input.nonce);
      const checked = verified.parse(
        await this.native.verify({
          request: stored,
          presentation: presentation.parse(input.presentation),
          seenNonces: {
            consume(nonce) {
              if (nonce !== stored.nonce) throw new Error("Unexpected nonce-store key");
              if (store.has(nonce)) return "alreadyConsumed";
              store.add(nonce);
              return "fresh";
            },
          },
        }),
      );
      if (!checked.verified) return { ok: false, reason: checked.reason };
      const { report } = checked;
      const bindings: ProofBinds[] = ["rule", "issuers", "fresh"];
      if (stored.policy.inputCommitment && report.complete) bindings.push("complete");
      return {
        ok: true,
        released: released(checked.released, input.booleanResult),
        binds: bindings,
        // This is the complete authorization set. The gate must approve every
        // member for the claims in the rule because individual signers are hidden.
        issuerKeys: [...new Set(report.issuers)].map((publicKey) => ({ publicKey })),
      };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  };
}

export async function loadSparqZkQuery(
  backend: "native" | "wasm" = "native",
): Promise<SparqZkQuery | undefined> {
  const directory =
    process.env.ANSWERABLE_SPARQ_ZK_QUERY ??
    fileURLToPath(new URL("../../../.sparq/sparq-zk-query/", import.meta.url));
  const entry = resolve(directory, "index.js");
  if (!existsSync(entry)) return undefined;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === import.meta.url) {
        if (specifier === "../../../.sparq/sparq-zk-query/index.js")
          return { url: pathToFileURL(entry).href, shortCircuit: true };
        if (specifier === "../../../.sparq/sparq-zk-query/wasm/sparq_zk_query_wasm.cjs")
          return {
            url: pathToFileURL(resolve(directory, "wasm/sparq_zk_query_wasm.cjs")).href,
            shortCircuit: true,
          };
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    // biome-ignore lint/suspicious/noTsIgnore: the optional archive may be absent at typecheck time
    // @ts-ignore Optional delivery is absent in ordinary SDK installations.
    const loaded: unknown = await import("../../../.sparq/sparq-zk-query/index.js");
    const api = z
      .object({
        testIssuerKeygen: z.function(),
        testIssue: z.function(),
        request: z.function(),
        prove: z.function(),
        verify: z.function(),
      })
      .parse(loaded);
    const host: unknown = await import(
      // biome-ignore lint/suspicious/noTsIgnore: the optional archive may be absent at typecheck time
      // @ts-ignore Optional fixture commitment host from the pinned archive.
      "../../../.sparq/sparq-zk-query/wasm/sparq_zk_query_wasm.cjs"
    );
    const wasm = z
      .object({
        hostCall: z.function({
          input: [z.literal("prepareProof"), z.string()],
          output: z.string(),
        }),
      })
      .parse(host);
    return new SparqZkQuery(api as QueryPackage, backend, (input) =>
      wasm.hostCall("prepareProof", input),
    );
  } finally {
    hooks.deregister();
  }
}
