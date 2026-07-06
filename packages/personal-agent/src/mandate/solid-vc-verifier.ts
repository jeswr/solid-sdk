// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The concrete {@link MandateVerifier} — the CREDENTIAL SEAM that loads the owner's
 * signed autonomy mandate from the pod and verifies it, dogfooding `@jeswr/solid-vc`
 * (signature + G1 policy-content binding) and `@jeswr/solid-odrl` (`parsePolicy`).
 *
 * It is fail-closed in EVERY branch: a mandate that is absent, not JSON-LD, unsigned, has
 * an invalid signature, is revoked, is bound to a substituted policy, or is not issued by
 * the pod owner all resolve to `undefined` (→ the executor refuses ALL actions). The
 * mandate is fetched READ-ONLY; this module never writes it (the agent's writable surface
 * excludes its own mandate — the OpenClaw failure mode the design rejects).
 *
 * `resolveKey` (how to obtain the owner's public verification key) is the caller's
 * injected credential seam — this module holds no crypto of its own. NOT exercised by the
 * hermetic golden tests (those inject a scripted verifier); it needs a live-key
 * integration test (a `needs:user` follow-up).
 */
import { parsePolicy } from "@jeswr/solid-odrl";
import {
  type VerifiableCredential,
  type VerifyCredentialOptions,
  verifyCredential,
} from "@jeswr/solid-vc";
import type { PodFetch } from "../config.js";
import { refuseRedirect } from "../pod/write.js";
import type { LoadedMandate, MandateVerifier } from "./types.js";

/** Options for {@link createSolidVcMandateVerifier}. */
export interface SolidVcMandateVerifierOptions {
  /** A pod authed `fetch` used READ-ONLY to load the mandate + policy. */
  readonly readFetch: PodFetch;
  /** The signed mandate credential's URL (a JSON-LD `AgentAuthorizationCredential`). */
  readonly mandateUrl: string;
  /** The pod owner's WebID — the mandate MUST verify as issued by this WebID. */
  readonly ownerWebId: string;
  /** Resolve a `verificationMethod` IRI to the owner's public key (the credential seam). */
  readonly resolveKey: VerifyCredentialOptions["resolveKey"];
  /** Override the WebID-controller check (default: the `#key` / key-path convention). */
  readonly isControlledBy?: VerifyCredentialOptions["isControlledBy"];
  /** The revocation/suspension status seam (fail-closed when supplied). */
  readonly resolveStatus?: VerifyCredentialOptions["resolveStatus"];
  /** The ODRL policy resource URL; default: the credential's `credentialSubject.policy` IRI. */
  readonly policyUrl?: string;
}

async function getText(
  fetchFn: PodFetch,
  url: string,
): Promise<{ text: string; contentType: string } | undefined> {
  const res = await fetchFn(url, { method: "GET", redirect: "manual" });
  refuseRedirect(res, "GET", url);
  if (!res.ok) return undefined;
  const text = await res.text();
  const contentType = (res.headers.get("content-type") ?? "text/turtle").split(";")[0]?.trim();
  return { text, contentType: contentType || "text/turtle" };
}

/** Read the `policy` IRI a credential subject references, tolerating an object or array. */
function policyIriOf(vc: VerifiableCredential): string | undefined {
  const subjects = Array.isArray(vc.credentialSubject)
    ? vc.credentialSubject
    : [vc.credentialSubject];
  for (const subject of subjects) {
    if (subject && typeof subject === "object") {
      const policy = (subject as Record<string, unknown>).policy;
      if (typeof policy === "string" && policy.length > 0) return policy;
    }
  }
  return undefined;
}

/** Build the fail-closed, solid-vc-backed mandate verifier. */
export function createSolidVcMandateVerifier(
  options: SolidVcMandateVerifierOptions,
): MandateVerifier {
  return {
    async load(): Promise<LoadedMandate | undefined> {
      const mandateDoc = await getText(options.readFetch, options.mandateUrl);
      if (!mandateDoc) return undefined;
      let vc: VerifiableCredential;
      try {
        vc = JSON.parse(mandateDoc.text) as VerifiableCredential;
      } catch {
        return undefined; // the signed VC must be stored as JSON-LD
      }

      const policyUrl = options.policyUrl ?? policyIriOf(vc);
      if (!policyUrl) return undefined; // a mandate with no bound policy is unusable
      const policyDoc = await getText(options.readFetch, policyUrl);
      if (!policyDoc) return undefined;

      const result = await verifyCredential(vc, {
        resolveKey: options.resolveKey,
        ...(options.isControlledBy ? { isControlledBy: options.isControlledBy } : {}),
        ...(options.resolveStatus ? { resolveStatus: options.resolveStatus } : {}),
        // Bind the policy CONTENT into the verification (G1) — a substituted policy fails.
        presentedResources: {
          [policyUrl]: { content: policyDoc.text, contentType: policyDoc.contentType },
        },
      });
      if (!result.verified || result.issuer !== options.ownerWebId) return undefined;

      const policy = await parsePolicy(policyDoc.text, policyDoc.contentType, policyUrl);
      if (!policy) return undefined;
      return {
        policy,
        issuer: result.issuer,
        ...(typeof vc.id === "string" ? { credentialId: vc.id } : {}),
      };
    },
  };
}
