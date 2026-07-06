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
import { verifyCredential, } from "@jeswr/solid-vc";
import { refuseRedirect } from "../pod/write.js";
async function getText(fetchFn, url) {
    const res = await fetchFn(url, { method: "GET", redirect: "manual" });
    refuseRedirect(res, "GET", url);
    if (!res.ok)
        return undefined;
    const text = await res.text();
    const contentType = (res.headers.get("content-type") ?? "text/turtle").split(";")[0]?.trim();
    return { text, contentType: contentType || "text/turtle" };
}
/** Read the `policy` IRI a credential subject references, tolerating an object or array. */
function policyIriOf(vc) {
    const subjects = Array.isArray(vc.credentialSubject)
        ? vc.credentialSubject
        : [vc.credentialSubject];
    for (const subject of subjects) {
        if (subject && typeof subject === "object") {
            const policy = subject.policy;
            if (typeof policy === "string" && policy.length > 0)
                return policy;
        }
    }
    return undefined;
}
/** Build the fail-closed, solid-vc-backed mandate verifier. */
export function createSolidVcMandateVerifier(options) {
    return {
        async load() {
            const mandateDoc = await getText(options.readFetch, options.mandateUrl);
            if (!mandateDoc)
                return undefined;
            let vc;
            try {
                vc = JSON.parse(mandateDoc.text);
            }
            catch {
                return undefined; // the signed VC must be stored as JSON-LD
            }
            const policyUrl = options.policyUrl ?? policyIriOf(vc);
            if (!policyUrl)
                return undefined; // a mandate with no bound policy is unusable
            const policyDoc = await getText(options.readFetch, policyUrl);
            if (!policyDoc)
                return undefined;
            const result = await verifyCredential(vc, {
                resolveKey: options.resolveKey,
                ...(options.isControlledBy ? { isControlledBy: options.isControlledBy } : {}),
                ...(options.resolveStatus ? { resolveStatus: options.resolveStatus } : {}),
                // Bind the policy CONTENT into the verification (G1) — a substituted policy fails.
                presentedResources: {
                    [policyUrl]: { content: policyDoc.text, contentType: policyDoc.contentType },
                },
            });
            if (!result.verified || result.issuer !== options.ownerWebId)
                return undefined;
            const policy = await parsePolicy(policyDoc.text, policyDoc.contentType, policyUrl);
            if (!policy)
                return undefined;
            return {
                policy,
                issuer: result.issuer,
                ...(typeof vc.id === "string" ? { credentialId: vc.id } : {}),
            };
        },
    };
}
//# sourceMappingURL=solid-vc-verifier.js.map