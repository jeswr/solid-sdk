/**
 * Named, coherent mechanism configurations (framework parts C and D).
 *
 * A configuration is ONE selection across every concern. Advertising two configurations
 * never implies their Cartesian product: a message declares exactly one configuration,
 * and the receiver checks that the mechanism actually used (e.g. the JWS `alg`) is the
 * one that configuration names. A configuration with any unresolved concern has status
 * `unresolved` and can never be selected.
 */
import { AWP } from "./vocabulary.js";

export type ConcernStatus = "selected" | "not-applicable" | "unresolved";

export interface ConfigurationDefinition {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly status: "executable" | "unresolved";
  readonly integrity:
    | {
        readonly status: "selected";
        readonly mechanism: "jws-compact";
        readonly alg: "EdDSA" | "ES256";
        readonly curve: "Ed25519" | "P-256";
        readonly specs: readonly string[];
      }
    | { readonly status: "unresolved"; readonly candidate: string };
  /** Whether the REQUESTER must sign. Responses are always signed in these configurations. */
  readonly requesterAuthentication: ConcernStatus;
  readonly authentication: string;
  readonly representation: string;
  readonly authorisation: string;
  /** The policy profile (semantics) this configuration's authorisation uses, if any. */
  readonly policyProfile?: string;
  readonly replayProtection: string;
  readonly serialization: string;
  readonly bindings: readonly string[];
  /** Message kinds a requester may send unsigned (only for anonymous public access). */
  readonly unsignedRequestKinds: readonly string[];
  readonly unresolved: readonly string[];
}

const JWS_SPECS = ["RFC 7515 (JWS compact)", "RFC 8037 (OKP/EdDSA)", "RFC 7638 (kid thumbprint)"];

/**
 * The shared POLICY PROFILE a configuration accepts: the semantics of owner-mandate and grant
 * policies (ODRL 2.2 pilot subset, three-valued). Which evaluator implements it is an
 * implementation choice declared in the implementation description (`policyModule`), not part
 * of the configuration — peers need not run the same evaluator to interoperate.
 */
export const POLICY_PROFILE = `${AWP}policy-profile/odrl-pilot-subset/0.1`;

export const POLICY_PROFILE_SUMMARY =
  "ODRL 2.2 pilot subset (Set policies; permissions/prohibitions; use/read/distribute/compensate/transfer; " +
  "dateTime, purpose, recipient constraints; conflict prohibit; no duties). Three-valued: a rule that " +
  "would apply but whose constraint cannot be decided from the request is indeterminate, never a permit.";

const COMMON = {
  authentication:
    "pinned actor key: kid = RFC 7638 thumbprint looked up ONLY in the local trust store; " +
    "jwk/jku/x5u/x5c headers refused",
  representation:
    "party-signed RepresentationStatement (JWS) naming actor, actor key thumbprint, " +
    "operation scope and validity; verified with the pinned PARTY key",
  authorisation:
    "receiver-side: local rules + own owner mandate in the awp ODRL pilot policy profile " +
    "(see policyProfile; evaluator declared per implementation); owner approval JWS bound to " +
    "the action digest when required",
  policyProfile: POLICY_PROFILE,
  replayProtection:
    "unique message id + createdAt/expiresAt window + persistent seen-set; " +
    "same id with different content = replay-conflict",
  serialization: "awp-json 0.1 (UTF-8 JSON payload; digests use RFC 8785 JCS + SHA-256)",
  bindings: ["direct-local/0.1", "email-mime/0.1", "mcp-tool/0.1", "a2a-data-part/0.2"],
} as const;

export const CONFIG_ED25519 = `${AWP}config/signed-ed25519/0.1`;
export const CONFIG_P256 = `${AWP}config/signed-p256/0.1`;
export const CONFIG_PUBLIC = `${AWP}config/public-readonly-ed25519/0.1`;
export const CONFIG_SD_CANDIDATE = `${AWP}config/selective-disclosure-candidate/0.1`;

export const CONFIGURATIONS: Readonly<Record<string, ConfigurationDefinition>> = {
  [CONFIG_ED25519]: {
    id: CONFIG_ED25519,
    version: "0.1.0",
    label: "Signed interaction, Ed25519 JWS, pinned keys, owner mandate",
    status: "executable",
    integrity: {
      status: "selected",
      mechanism: "jws-compact",
      alg: "EdDSA",
      curve: "Ed25519",
      specs: JWS_SPECS,
    },
    requesterAuthentication: "selected",
    ...COMMON,
    unsignedRequestKinds: [],
    unresolved: [],
  },
  [CONFIG_P256]: {
    id: CONFIG_P256,
    version: "0.1.0",
    label: "Signed interaction, ES256 (P-256) JWS, pinned keys, owner mandate",
    status: "executable",
    integrity: {
      status: "selected",
      mechanism: "jws-compact",
      alg: "ES256",
      curve: "P-256",
      specs: ["RFC 7515 (JWS compact)", "RFC 7518 §3.4 (ES256)", "RFC 7638 (kid thumbprint)"],
    },
    requesterAuthentication: "selected",
    ...COMMON,
    unsignedRequestKinds: [],
    unresolved: [],
  },
  [CONFIG_PUBLIC]: {
    id: CONFIG_PUBLIC,
    version: "0.1.0",
    label: "Anonymous public read-only retrieval; responses signed (Ed25519) by the source",
    status: "executable",
    integrity: {
      status: "selected",
      mechanism: "jws-compact",
      alg: "EdDSA",
      curve: "Ed25519",
      specs: JWS_SPECS,
    },
    requesterAuthentication: "not-applicable",
    authentication: "responder only (pinned responder key); requester is not identified",
    representation: "not-applicable (no represented party on requests)",
    authorisation: "published open access for operations marked public; no grant evaluated",
    replayProtection: COMMON.replayProtection,
    serialization: COMMON.serialization,
    bindings: ["direct-local/0.1"],
    unsignedRequestKinds: ["describe", "invoke"],
    unresolved: [],
  },
  [CONFIG_SD_CANDIDATE]: {
    id: CONFIG_SD_CANDIDATE,
    version: "0.0.1",
    label: "Design candidate: selective disclosure of evidence (SD-JWT or BBS) — NOT executable",
    status: "unresolved",
    integrity: { status: "unresolved", candidate: "SD-JWT (RFC 9901) or BBS Data Integrity" },
    requesterAuthentication: "selected",
    ...COMMON,
    unsignedRequestKinds: [],
    unresolved: ["integrity/selective-disclosure mechanism", "holder binding", "linkability"],
  },
};

export function configurationById(id: string): ConfigurationDefinition | undefined {
  return Object.hasOwn(CONFIGURATIONS, id) ? CONFIGURATIONS[id] : undefined;
}

export function isExecutable(id: string): boolean {
  return configurationById(id)?.status === "executable";
}
