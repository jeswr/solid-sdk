// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  canonicalNQuads,
  credentialToJsonLd,
  parseCredentialRdf,
  readValidCredential,
  type VerifiableCredential,
  type VerificationResult,
  type VerifyCredentialOptions,
  verifyCredential,
} from "@jeswr/solid-vc";
export const MAX_CREDENTIAL_BYTES = 262_144;
/** Decode original UTF-8 bytes without removing a BOM or replacing invalid bytes. */
export function credentialFileText(bytes: ArrayBuffer): string {
  if (bytes.byteLength > MAX_CREDENTIAL_BYTES)
    throw new TypeError("Credential must be smaller than 256 KiB");
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function label(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const item = record(value);
  return typeof item.name === "string"
    ? item.name
    : typeof item.id === "string"
      ? item.id
      : undefined;
}
function strings(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => typeof item === "string",
  );
}
/** Display ONLY: none of these fields asserts authenticity, identity or entitlement. */
export function summariseCredential(value: unknown) {
  const vc = record(value);
  const subjectValues = Array.isArray(vc.credentialSubject)
    ? vc.credentialSubject
    : [vc.credentialSubject];
  const fields = subjectValues.flatMap((subject, index) =>
    Object.entries(record(subject))
      .slice(0, 100)
      .map(([name, field]) => ({
        subject: index + 1,
        name,
        value: typeof field === "string" ? field : (JSON.stringify(field) ?? ""),
      })),
  );
  return {
    types: strings(vc.type),
    issuer: label(vc.issuer) ?? "Unknown issuer",
    validFrom: label(vc.validFrom) ?? label(vc.issuanceDate),
    validUntil: label(vc.validUntil) ?? label(vc.expirationDate),
    holderName:
      label(record(subjectValues[0]).name) ??
      label(record(subjectValues[0])["https://schema.org/name"]),
    fields,
    status: vc.credentialStatus,
  };
}
/** Byte-exact source is retained separately. Reject a lossy graph projection before checking a signature. */
export async function parseCredential(source: string): Promise<VerifiableCredential> {
  if (new TextEncoder().encode(source).length > MAX_CREDENTIAL_BYTES)
    throw new TypeError("Credential must be smaller than 256 KiB");
  const parseSource = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const raw: unknown = JSON.parse(parseSource);
  const vc = record(raw);
  const dataset = await parseCredentialRdf(parseSource, "application/ld+json");
  const valid = readValidCredential(dataset);
  if (!valid.valid) throw new TypeError(valid.error);
  if (typeof vc.issuer !== "string" || !vc.id || !vc.credentialSubject || !vc.proof)
    throw new TypeError(
      "This credential needs a supported id, issuer, subject and Data Integrity proof",
    );
  const candidate = vc as unknown as VerifiableCredential;
  const reconstructed = await parseCredentialRdf(
    JSON.stringify({ ...credentialToJsonLd(candidate), proof: candidate.proof }),
    "application/ld+json",
  );
  if ((await canonicalNQuads([...dataset])) !== (await canonicalNQuads([...reconstructed])))
    throw new TypeError(
      "This JSON-LD claim or proof structure cannot be checked without losing information",
    );
  return candidate;
}
export type CredentialCheck = {
  state: "verified" | "invalid" | "expired" | "revoked" | "unknown";
  title: string;
  reason: string;
};
export function verificationDisplay(result: VerificationResult, issuer: string): CredentialCheck {
  if (result.verified)
    return {
      state: "verified",
      title: `Verified by ${issuer}`,
      reason:
        "Signature, issuer key control, dates and any supplied revocation status checked. This does not establish that the issuer is a trusted authority.",
    };
  const codes = result.errors.map((error) => error.code);
  const state = codes.includes("STATUS_REVOKED")
    ? "revoked"
    : codes.includes("EXPIRED")
      ? "expired"
      : codes.includes("INVALID_SIGNATURE")
        ? "invalid"
        : "unknown";
  return {
    state,
    title:
      state === "revoked"
        ? "Revoked"
        : state === "expired"
          ? "Expired"
          : state === "invalid"
            ? "Signature invalid"
            : "Could not check",
    reason:
      result.errors.map((error) => error.message).join("; ") ||
      "The verifier did not return a complete result.",
  };
}
export async function checkCredential(
  source: string,
  options: VerifyCredentialOptions,
): Promise<CredentialCheck> {
  try {
    const credential = await parseCredential(source);
    let unavailableKey = false;
    const result = await verifyCredential(credential, {
      ...options,
      async resolveKey(method) {
        try {
          const key = await options.resolveKey(method);
          if (!key) unavailableKey = true;
          return key;
        } catch {
          unavailableKey = true;
          return undefined;
        }
      },
    });
    if (unavailableKey && !result.verified)
      return {
        state: "unknown",
        title: "Could not check",
        reason:
          "The issuer's public key could not be resolved. Reconnect and try again; the issuer may also use an unsupported key identifier.",
      };
    return verificationDisplay(result, credential.issuer);
  } catch (error) {
    return {
      state: "unknown",
      title: "Could not check",
      reason: error instanceof Error ? error.message : "Credential could not be read",
    };
  }
}
