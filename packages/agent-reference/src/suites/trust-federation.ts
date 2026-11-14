// AUTHORED-BY Codex GPT-6
/** A presenter supplies a bounded chain. No register or resolver is queried during verification. */
import type { EvidenceItem } from "../core/types.js";
import type { PublicKeyRecord } from "../mechanisms/jws.js";
import { admitEntityStatement } from "../wire/federation.js";
export interface FederationPolicy {
  readonly anchor: string;
  readonly keys: readonly PublicKeyRecord[];
  readonly subject: string;
  readonly purpose: string;
  readonly claimTypes: readonly string[];
  readonly expectedSubjectKey: string;
}
export async function verifyFederationChain(
  evidence: readonly EvidenceItem[],
  policy: FederationPolicy,
  at: string,
): Promise<{
  ok: boolean;
  reason?: "lookup-failed" | "source-not-authoritative";
  path: readonly string[];
  expires?: number;
}> {
  const path: string[] = [];
  let expires = Number.POSITIVE_INFINITY;
  try {
    const statements = evidence.filter(
      (e) => e.role === "membership" && e.format === "openid-entity-statement+jwt",
    );
    if (statements.length < 3 || statements.length > 8)
      return { ok: false, reason: "lookup-failed", path };
    // The fixture presents anchor -> superior statements -> entity configuration. Each JWT
    // is checked before its subject keys or policy can influence the next verification.
    let keys = policy.keys,
      issuer = policy.anchor;
    const claims: string[][] = [],
      purposes: string[][] = [];
    for (let i = 0; i < statements.length; i++) {
      const admitted = await admitEntityStatement(statements[i]!.value, keys, at);
      if (!admitted) return { ok: false, reason: "lookup-failed", path };
      expires = Math.min(expires, admitted.node.number("exp")!);
      const node = admitted.node,
        iss = node.string("iss")!,
        sub = node.string("sub")!,
        last = i === statements.length - 1;
      if (iss !== issuer || (!last && path.includes(sub)))
        return { ok: false, reason: "lookup-failed", path };
      if (i === 0) {
        if (iss !== policy.anchor || sub !== policy.anchor)
          return { ok: false, reason: "lookup-failed", path };
      } else if (last) {
        if (iss !== policy.subject || sub !== policy.subject)
          return { ok: false, reason: "lookup-failed", path };
      } else if (iss === sub) return { ok: false, reason: "lookup-failed", path };
      const md = node.node("metadata")?.node("answerable");
      if (!md) return { ok: false, reason: "lookup-failed", path };
      if (i > 0) {
        claims.push([...md.strings("claim_types")]);
        purposes.push([...md.strings("purposes")]);
      }
      const restrictions = node.node("metadata_policy")?.node("answerable");
      if (restrictions) {
        const claimPolicy = restrictions.node("claim_types"),
          purposePolicy = restrictions.node("purposes");
        if (!claimPolicy || !purposePolicy) return { ok: false, reason: "lookup-failed", path };
        claims.push([...claimPolicy.strings("subset_of")]);
        purposes.push([...purposePolicy.strings("subset_of")]);
      }
      if (i > 0 && !last) {
        // A superior's statement about a child does not self-assert the child's authority hint.
        // The next JWT verifies with this independently authenticated subject JWKS.
        issuer = sub;
      }
      path.push(sub);
      if (last) {
        if (
          admitted.keys.length !== keys.length ||
          !admitted.keys.every((key) => keys.some((prior) => prior.kid === key.kid))
        )
          return { ok: false, reason: "lookup-failed", path };
        if (!node.strings("authority_hints").includes(path[path.length - 3]!))
          return { ok: false, reason: "lookup-failed", path };
        if (!admitted.keys.some((k) => k.kid === policy.expectedSubjectKey))
          return { ok: false, reason: "lookup-failed", path };
      }
      keys = admitted.keys;
    }
    if (
      !purposes.every((p) => p.includes(policy.purpose)) ||
      !claims.every((c) => policy.claimTypes.every((t) => c.includes(t)))
    )
      return { ok: false, reason: "source-not-authoritative", path };
    return { ok: true, path, expires };
  } catch {
    return { ok: false, reason: "lookup-failed", path };
  }
}

import { type Resolution, TrustResolver, type TrustResolverOptions } from "../trust/resolver.js";
export class PresentedFederationResolver extends TrustResolver {
  private checked?: Awaited<ReturnType<typeof verifyFederationChain>>;
  constructor(
    options: TrustResolverOptions,
    readonly policy: FederationPolicy,
  ) {
    super(options);
  }
  async present(evidence: readonly EvidenceItem[], at: string) {
    this.checked = await verifyFederationChain(evidence, this.policy, at);
    return this.checked;
  }
  private result(question: string, at: string, scope: boolean): Resolution {
    const ok =
      this.checked?.ok === true && scope && Date.parse(at) < (this.checked.expires ?? 0) * 1000;
    return {
      question,
      path: [
        {
          at: "The principal’s federation anchor",
          kind: "own-list",
          says: "The principal independently holds this federation authority’s key.",
        },
        ...(this.checked?.path ?? []).map((_, i) => ({
          at:
            i === 0
              ? "The federation authority"
              : i === 1
                ? "The federation superior"
                : "The fictional lender",
          kind: "federation" as const,
          says: "A presented entity-statement signature, expiry, key and metadata policy were checked.",
        })),
      ],
      answer: ok
        ? "Accepted within the presented federation policy."
        : this.checked?.reason === "source-not-authoritative" || !scope
          ? "The federation policy does not cover this claim or purpose."
          : "The presented federation chain cannot be established.",
      outcome: ok
        ? "accepted"
        : this.checked?.reason === "source-not-authoritative" || !scope
          ? "not-accepted"
          : "unresolved",
      checkedAt: at,
    };
  }
  override resolveSource(input: Parameters<TrustResolver["resolveSource"]>[0]): Resolution {
    return input.source === this.policy.subject
      ? this.result(
          "Is the presented lender authoritative for this statement?",
          input.at,
          this.policy.claimTypes.includes(input.claimType),
        )
      : super.resolveSource(input);
  }
  override resolveRecipient(input: Parameters<TrustResolver["resolveRecipient"]>[0]): Resolution {
    return input.party === this.policy.subject
      ? this.result(
          "Does the presented lender’s federation policy cover this application?",
          input.at,
          true,
        )
      : super.resolveRecipient(input);
  }
}
