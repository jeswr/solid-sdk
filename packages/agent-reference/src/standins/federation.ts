// AUTHORED-BY Codex GPT-6
/** Independently keyed fictional members issue the entity statements, never verdicts. */
import type { EvidenceItem } from "../core/types.js";
import type { SigningKey } from "../mechanisms/jws.js";
import { signCompact } from "../mechanisms/jws.js";
export async function presentFederation(input: {
  anchor: { id: string; key: SigningKey };
  superior: { id: string; key: SigningKey };
  subject: { id: string; key: SigningKey; actorKey: SigningKey };
  purpose: string;
  claimTypes: readonly string[];
  at: string;
  expired?: boolean;
  businessOnly?: boolean;
}): Promise<EvidenceItem[]> {
  const iat = Math.floor(Date.parse(input.at) / 1000),
    exp = iat + 86400;
  const keys = (...xs: SigningKey[]) => ({
    keys: xs.map((k) => ({ ...k.publicJwk, kid: k.kid, alg: k.alg, use: "sig" })),
  });
  const md = { answerable: { claim_types: input.claimTypes, purposes: [input.purpose] } };
  const restricted = {
    answerable: {
      claim_types: { subset_of: input.claimTypes },
      purposes: {
        subset_of: [input.businessOnly ? "urn:purpose:business-lending" : input.purpose],
      },
    },
  };
  const records = [
    {
      key: input.anchor.key,
      payload: {
        iss: input.anchor.id,
        sub: input.anchor.id,
        iat,
        exp,
        jwks: keys(input.anchor.key),
        authority_hints: [],
        metadata: md,
        metadata_policy: restricted,
      },
    },
    {
      key: input.anchor.key,
      payload: {
        iss: input.anchor.id,
        sub: input.superior.id,
        iat,
        exp: input.expired ? iat : exp,
        jwks: keys(input.superior.key),
        authority_hints: [input.anchor.id],
        metadata: md,
        metadata_policy: restricted,
      },
    },
    {
      key: input.superior.key,
      payload: {
        iss: input.superior.id,
        sub: input.subject.id,
        iat,
        exp,
        jwks: keys(input.subject.key, input.subject.actorKey),
        authority_hints: [input.superior.id],
        metadata: md,
        metadata_policy: restricted,
      },
    },
    {
      key: input.subject.key,
      payload: {
        iss: input.subject.id,
        sub: input.subject.id,
        iat,
        exp,
        jwks: keys(input.subject.key, input.subject.actorKey),
        authority_hints: [input.superior.id],
        metadata: md,
      },
    },
  ];
  return Promise.all(
    records.map(async (r) => ({
      role: "membership" as const,
      format: "openid-entity-statement+jwt",
      value: await signCompact(r.key, "entity-statement+jwt", r.payload),
    })),
  );
}
