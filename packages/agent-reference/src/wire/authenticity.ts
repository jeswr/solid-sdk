// AUTHORED-BY Codex GPT-6

import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
import {
  canonicalNQuads,
  type DataIntegrityProof,
  DataIntegritySuite,
  digestQuads,
} from "@jeswr/solid-vc";
import { importJWK } from "jose";
import { canonicalJson, digestBytes } from "../core/canonical.js";
import { DEFAULT_LIMITS, type PilotLimits } from "../core/limits.js";
import { isIsoInstant } from "../core/schema.js";
import {
  type PublicKeyRecord,
  type SigningKey,
  signCompact,
  verifyCompact,
} from "../mechanisms/jws.js";
import { checkDocumentTerms, DocumentError } from "./contexts.js";
import {
  assertBlankNodeLimit,
  type DocumentNode,
  documentDataset,
  type JsonLdDocument,
  type ReadResult,
  readDocument,
  readJson,
  refusal,
  writeDocument,
} from "./document.js";

export type Authenticity = "jws" | "data-integrity";
export interface SignOptions {
  readonly suite: Authenticity;
  readonly key: SigningKey;
  readonly verificationMethod: string;
  readonly created: string;
  readonly limits?: PilotLimits;
}
export interface VerifyOptions {
  readonly suite: Authenticity;
  readonly resolve: (id: string) => PublicKeyRecord | undefined;
  readonly limits?: PilotLimits;
}
const TYP = "awp-jsonld+jws";
const rdfc = new DataIntegritySuite("eddsa-rdfc-2022");

function assertSuite(suite: Authenticity): void {
  if (suite !== "jws" && suite !== "data-integrity")
    throw new DocumentError("configuration-mismatch");
}

async function documentOf(input: JsonLdDocument | DocumentNode): Promise<JsonLdDocument> {
  return "dataset" in input ? writeDocument(input as DocumentNode) : (input as JsonLdDocument);
}

function withoutProof(document: JsonLdDocument): JsonLdDocument {
  const { proof: _proof, ...unsigned } = document;
  return unsigned;
}

/** One canonical-form seam for every document digest and signature. */
export async function canonicalise(
  input: JsonLdDocument | DocumentNode,
  suite: Authenticity,
): Promise<string> {
  assertSuite(suite);
  const document = readJson(JSON.stringify(withoutProof(await documentOf(input))));
  checkDocumentTerms(document);
  if (suite === "jws") return canonicalJson(document);
  const dataset = await documentDataset(document);
  assertBlankNodeLimit(dataset);
  await digestQuads([...dataset]);
  return canonicalNQuads([...dataset]);
}

export async function digest(
  input: JsonLdDocument | DocumentNode,
  suite: Authenticity,
): Promise<string> {
  return digestBytes(await canonicalise(input, suite));
}

/** Emit a signed JSON-LD document. The proof never supplies verification material. */
export async function sign(
  input: JsonLdDocument | DocumentNode,
  options: SignOptions,
): Promise<JsonLdDocument> {
  assertSuite(options.suite);
  if (options.key.alg !== "EdDSA") throw new DocumentError("configuration-mismatch");
  if (!isSafeAbsoluteIri(options.verificationMethod) || !isIsoInstant(options.created))
    throw new DocumentError("malformed-proof-options");
  const document = readJson(JSON.stringify(withoutProof(await documentOf(input))), options.limits);
  const admitted = await readDocument(JSON.stringify(document), "application/ld+json", options);
  if (!admitted.ok)
    throw new DocumentError(
      admitted.detail,
      admitted.reason === "bounds-exceeded" ? "bounds-exceeded" : "malformed",
    );
  if (options.suite === "jws") {
    const canonical = canonicalJson(document);
    const signed = {
      ...document,
      proof: { type: "JwsProof", jws: await signCompact(options.key, TYP, JSON.parse(canonical)) },
    };
    readJson(JSON.stringify(signed), options.limits);
    return signed;
  }
  assertBlankNodeLimit(admitted.dataset);
  await digestQuads([...admitted.dataset]);
  const proof = await rdfc.sign([...admitted.dataset], {
    key: { privateKey: options.key.privateKey, verificationMethod: options.verificationMethod },
    proofPurpose: "assertionMethod",
    created: new Date(options.created),
  });
  const signed = { ...document, proof };
  const final = await readDocument(JSON.stringify(signed), "application/ld+json", options);
  if (!final.ok)
    throw new DocumentError(
      final.detail,
      final.reason === "bounds-exceeded" ? "bounds-exceeded" : "malformed",
    );
  return signed;
}

function proofOf(document: JsonLdDocument): Record<string, unknown> {
  if (!document.proof || typeof document.proof !== "object" || Array.isArray(document.proof))
    throw new DocumentError("malformed-proof");
  return document.proof as Record<string, unknown>;
}

/** Context/key admission precedes JWS verification; JWS verification precedes RDF conversion. */
export async function verify(
  bytes: string | Uint8Array,
  mediaType: string,
  options: VerifyOptions,
): Promise<ReadResult> {
  try {
    assertSuite(options.suite);
    if (mediaType.split(";")[0]?.trim().toLowerCase() !== "application/ld+json")
      throw new DocumentError("unsupported-media-type");
    const limits = options.limits ?? DEFAULT_LIMITS;
    const document = readJson(bytes, limits);
    const proof = proofOf(document);
    const unsigned = withoutProof(document);
    if (options.suite === "jws") {
      if (proof.type !== "JwsProof" || typeof proof.jws !== "string")
        throw new DocumentError("malformed-proof");
      if (Object.keys(proof).some((key) => key !== "type" && key !== "jws"))
        throw new DocumentError("malformed-proof");
      const checked = await verifyCompact(proof.jws, {
        resolve: options.resolve,
        typ: TYP,
        allowedAlgs: ["EdDSA"],
        limits,
      });
      if (checked.outcome !== "valid")
        return {
          ok: false,
          reason:
            checked.reason === "unknown-key"
              ? "unknown-key"
              : checked.reason === "bounds-exceeded"
                ? "bounds-exceeded"
                : "bad-signature",
          detail: checked.reason,
        };
      const canonical = canonicalJson(unsigned);
      const payload = Buffer.from(proof.jws.split(".")[1] ?? "", "base64url").toString("utf8");
      if (payload !== canonical || canonicalJson(checked.payload) !== canonical)
        return {
          ok: false,
          reason: "bad-signature",
          detail: "document-differs-from-signed-payload",
        };
      return readDocument(JSON.stringify(document), "application/ld+json", {
        limits,
        suite: "jws",
      });
    }
    if (
      proof.type !== "DataIntegrityProof" ||
      proof.cryptosuite !== "eddsa-rdfc-2022" ||
      proof.proofPurpose !== "assertionMethod" ||
      typeof proof.verificationMethod !== "string" ||
      typeof proof.proofValue !== "string" ||
      typeof proof.created !== "string"
    )
      throw new DocumentError("malformed-proof");
    if (!isSafeAbsoluteIri(proof.verificationMethod) || !isIsoInstant(proof.created))
      throw new DocumentError("malformed-proof-options");
    if (
      Object.keys(proof).some(
        (key) =>
          ![
            "type",
            "cryptosuite",
            "proofPurpose",
            "verificationMethod",
            "proofValue",
            "created",
          ].includes(key),
      )
    )
      throw new DocumentError("malformed-proof");
    const admitted = await readDocument(JSON.stringify(document), "application/ld+json", {
      limits,
      suite: "data-integrity",
    });
    if (!admitted.ok) return admitted;
    const dataset = await documentDataset(unsigned, limits);
    assertBlankNodeLimit(dataset);
    await digestQuads([...dataset]);
    const pinned = options.resolve(proof.verificationMethod);
    if (!pinned || pinned.alg !== "EdDSA")
      return { ok: false, reason: "unknown-key", detail: "verification-method-not-pinned" };
    const publicKey = await importJWK(pinned.publicJwk, "EdDSA");
    const valid = await rdfc.verify([...dataset], proof as unknown as DataIntegrityProof, {
      resolveKey: () => publicKey as CryptoKey,
    });
    return valid
      ? admitted
      : { ok: false, reason: "bad-signature", detail: "signature-did-not-verify" };
  } catch (error) {
    return refusal(error);
  }
}
