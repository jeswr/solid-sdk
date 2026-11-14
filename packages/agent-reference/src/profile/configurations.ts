// AUTHORED-BY Codex GPT-6
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
        readonly mechanism: "jws-compact" | "data-integrity";
        readonly alg: "EdDSA" | "ES256";
        readonly curve: "Ed25519" | "P-256";
        readonly specs: readonly string[];
      }
    | { readonly status: "unresolved"; readonly candidate: string }
    | { readonly status: "not-applicable"; readonly limitations: string };
  /** Whether the REQUESTER must sign. Responses are always signed in these configurations. */
  readonly requesterAuthentication: ConcernStatus;
  readonly acceptedDidMethods?: readonly string[];
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
  serialization:
    "Pinned JSON-LD 1.1 with content-addressed attachments; document JWS proofs and digests use RFC 8785 JCS + SHA-256",
  bindings: ["direct-local/0.1", "email-mime/0.1", "mcp-tool/2026-07-28", "a2a-data-part/1.0"],
} as const;

export const CONFIG_ED25519 = `${AWP}config/signed-ed25519/0.1`;
export const CONFIG_P256 = `${AWP}config/signed-p256/0.1`;
export const CONFIG_PUBLIC = `${AWP}config/public-readonly-ed25519/0.1`;
export const CONFIG_SD_CANDIDATE = `${AWP}config/selective-disclosure-candidate/0.1`;

export const CONFIG_PLAIN_LANGUAGE = `${AWP}config/plain-language-upgrade-local/0.1`;
export const CONFIG_MAPPING = `${AWP}config/local-signed-code-mappings/0.1`;
export const CONFIG_EMAIL = `${AWP}config/plaintext-email-human-approval/0.1`;
export const CONFIG_AGREEMENT = `${AWP}config/local-multiparty-agreement/0.1`;
export const CONFIG_QUERY = `${AWP}config/local-approved-query/0.1`;
export const CONFIG_FORUM = `${AWP}config/local-record-forum/0.1`;
export const CONFIG_REFERENCE_LOCAL = `${AWP}config/by-reference-local-holder/0.1`;
export const CONFIG_ORGANIZATIONS = `${AWP}config/organizations-local-resolver/0.1`;
export const CONFIG_SELECTIVE_LOCAL = `${AWP}config/salted-selective-disclosure/0.1`;
export const CONFIG_PAYMENT = `${AWP}config/payment-local/0.1`;
export const CONFIG_CORROBORATION = `${AWP}config/corroboration-local/0.1`;
export const CONFIG_PINNED_LIST = `${AWP}config/pinned-list-local/0.1`;
const localDefinition = (id: string, label: string): ConfigurationDefinition => ({
  id,
  label,
  version: "0.1.0",
  status: "executable",
  requesterAuthentication: "selected",
  integrity: {
    status: "selected",
    mechanism: "jws-compact",
    alg: "EdDSA",
    curve: "Ed25519",
    specs: JWS_SPECS,
  },
  ...COMMON,
  unsignedRequestKinds: [],
  unresolved: [],
});

/** Wire ids for single-layer alternatives; names are labels, ids remain machine references. */
export function alternativeWireId(id: string): string {
  return `${AWP}config/${id}/0.1`;
}
export const CONFIG_AUTHENTICITY_DI = alternativeWireId("authenticity-data-integrity");
export const CONFIG_TRANSPORT_EMAIL = alternativeWireId("transport-email");
export const CONFIG_TRANSPORT_A2A = alternativeWireId("transport-a2a");
export const CONFIG_TRANSPORT_MCP = alternativeWireId("transport-mcp");

export const CONFIG_WEBID = alternativeWireId("identity-webid");
export const CONFIG_SOLID_ACCESS = alternativeWireId("usage-control-solid-access-control");
export const CONFIG_POD_MIRROR = alternativeWireId("accountability-pod-mirror");
export const CONFIG_SOLID_INBOX = alternativeWireId("transport-solid-inbox");
export const CONFIG_SOLID_REFERENCE = alternativeWireId("data-access-by-reference-solid");
export const CONFIGURATIONS: Readonly<Record<string, ConfigurationDefinition>> = {
  [alternativeWireId("trust-reputation")]: localDefinition(
    alternativeWireId("trust-reputation"),
    "Signed agent ratings and the unchanged register requirement",
  ),
  [alternativeWireId("trust-federation")]: localDefinition(
    alternativeWireId("trust-federation"),
    "Presented OpenID Federation 1.0 trust chain",
  ),
  [alternativeWireId("trust-trusted-index")]: localDefinition(
    alternativeWireId("trust-trusted-index"),
    "Source signatures and signed Merkle inclusion and consistency receipts",
  ),
  [alternativeWireId("authenticity-origin-hosted")]: localDefinition(
    alternativeWireId("authenticity-origin-hosted"),
    "Unsigned products fetched from independently registered source addresses",
  ),
  [alternativeWireId("authenticity-selective-disclosure")]: localDefinition(
    alternativeWireId("authenticity-selective-disclosure"),
    "Issuer-signed payroll projection: annual gross income and employer only",
  ),
  [alternativeWireId("trust-pinned-list")]: localDefinition(
    alternativeWireId("trust-pinned-list"),
    "Only the principal’s scoped own list; no register fallback",
  ),
  [alternativeWireId("accountability-reputation-score")]: {
    ...localDefinition(
      alternativeWireId("accountability-reputation-score"),
      "Evidence-backed contested reputation score — not run",
    ),
    status: "unresolved",
    unresolved: [
      "Design 26 section 9 requires a checkable public post and regulator decision, a rating-service exchange, signed score and evidence-backed contest. The prerequisite mortgage post and regulator route are unresolved. Those added signed exchanges also violate design section 2 confinement outside specification 19's evidence feed. Specification 19 explicitly leaves the evidence-admission, scoring, contest and service-accountability policy unspecified (AC-7/8); no numerical score is invented from unchecked evidence. Reading the result as a trust input belongs to the separate reputation trust suite, which this lane does not implement.",
    ],
  },
  [alternativeWireId("accountability-reputation-post")]: {
    ...localDefinition(
      alternativeWireId("accountability-reputation-post"),
      "Evidence-backed organisational reputation post — not run",
    ),
    status: "unresolved",
    unresolved: [
      "Brief 31 section 2.9: the revised confinement rule admits added exchanges, so the post is unblocked after the regulator claim (section 2.3), with a narrower post. The bank's and the payroll provider's signed terms do not permit publication and nothing waives them (UC-9, AC-4), so the post may carry only Sam's own statement and the forum's signed decision. Not built: the regulator claim, a publication service party, a separately keyed reader agent whose inbound checks fetch the post and the lender's signed reply (the reader's inbound checks), and a public recipient class that terms can permit or prohibit. No post about an individual is published.",
    ],
  },
  [alternativeWireId("accountability-vendor-fault")]: {
    ...localDefinition(
      alternativeWireId("accountability-vendor-fault"),
      "Claim against the gate operator — not run",
    ),
    status: "unresolved",
    unresolved: [
      "Brief 31 section 2.8: a main path may not run a faulty gate (confinement C3). Not built: a signed component statement naming who builds and who operates the gate and the core (CORE-L-13), the record audit that checks each released action again against the mandate, a gate-operator party with its own agent, and the onlyUnder branch in which brief 20's labelled fault stand-in releases one action outside the mandate. An ordinary refused out-of-mandate action is not evidence that a faulty gate released one; no live security gate is bypassed to fabricate a main run.",
    ],
  },
  [alternativeWireId("usage-control-odrl-model-tighten")]: localDefinition(
    alternativeWireId("usage-control-odrl-model-tighten"),
    "ODRL rules followed by a model that can only narrow",
  ),
  [alternativeWireId("accountability-regulator-claim")]: localDefinition(
    alternativeWireId("accountability-regulator-claim"),
    "Fee claim to the ombudsman the lender's register entry names, decided on both records",
  ),
  [alternativeWireId("commitments-agreement-credential")]: localDefinition(
    alternativeWireId("commitments-agreement-credential"),
    "Native two-proof Data Integrity valuation credential inside signed messages",
  ),
  [alternativeWireId("usage-control-human-approval")]: localDefinition(
    alternativeWireId("usage-control-human-approval"),
    "Principal approval of an undecided use of the principal's own statement",
  ),
  [alternativeWireId("meaning-negotiated")]: localDefinition(
    alternativeWireId("meaning-negotiated"),
    "Exact-exchange principal approval of a recorded term proposal",
  ),
  [alternativeWireId("reliance-quality-certificate")]: localDefinition(
    alternativeWireId("reliance-quality-certificate"),
    "Accepted, scoped quality certificate for the product index",
  ),
  [alternativeWireId("reliance-stated-confidence")]: localDefinition(
    alternativeWireId("reliance-stated-confidence"),
    "Source confidence as statement-level DQV measurements",
  ),
  [alternativeWireId("reliance-corroboration")]: localDefinition(
    alternativeWireId("reliance-corroboration"),
    "Independent payroll and bank salary-credit corroboration",
  ),
  [alternativeWireId("meaning-registry-lookup")]: localDefinition(
    alternativeWireId("meaning-registry-lookup"),
    "Signed employment code-list mapping lookup",
  ),
  [alternativeWireId("meaning-plain-language-upgrade")]: {
    ...localDefinition(
      alternativeWireId("meaning-plain-language-upgrade"),
      "Prose contact followed by structured exchange — not run",
    ),
    status: "unresolved",
    unresolved: [
      "Brief 31 section 2.5: the revised confinement rule admits a prose opening as an added segment. Not built: a correspondent with both a mailbox and an agent (a mailbox binding for the lender's agent whose reply to a prose email attaches its signed description) and a lasting structured-only marking that refuses any later step down. The unsigned ScriptedMailbox has no correspondent agent or advertisement, so the upgrade boundary is not implemented; the change touches the runtime lane.",
    ],
  },
  [alternativeWireId("authority-agent-registry")]: localDefinition(
    alternativeWireId("authority-agent-registry"),
    "Principal mandate checked against current signed registration",
  ),
  [alternativeWireId("authority-authorization-server")]: localDefinition(
    alternativeWireId("authority-authorization-server"),
    "Principal-approved key-bound authorization grant",
  ),
  [alternativeWireId("identity-anonymous")]: localDefinition(
    alternativeWireId("identity-anonymous"),
    "Anonymous lender lookup in the sector register, answered by signed register entries",
  ),
  [alternativeWireId("identity-email-endpoint")]: {
    ...localDefinition(
      alternativeWireId("identity-email-endpoint"),
      "Payroll mailbox identity — not run",
    ),
    status: "unresolved",
    unresolved: [
      "Brief 31 section 2.4: the revised confinement rule admits the email exchange as an added segment. Not built: proof that the replier controls the payroll mailbox, namely a Paywell-signed statement naming its contact mailbox and a mailbox challenge in which Sam's agent sends a fresh nonce and accepts a reply only if it carries the nonce and arrives from the named address. The existing mailbox binding has no challenge-control proof. No prose is substituted for structured payroll evidence.",
    ],
  },
  [alternativeWireId("identity-did")]: {
    ...localDefinition(alternativeWireId("identity-did"), "DID web identities resolved in process"),
    acceptedDidMethods: ["web"],
    authentication:
      "did:web Multikey documents matched against separately signed key commitments with explicit validity",
  },
  [alternativeWireId("authority-mandate-credential")]: localDefinition(
    alternativeWireId("authority-mandate-credential"),
    "Principal mandate credential with suspension and revocation lists",
  ),
  ...Object.fromEntries(
    ["x402", "mpp", "ap2", "acp"].map((suite) => {
      const id = alternativeWireId(`settlement-${suite}`);
      return [id, localDefinition(id, `Signed RDF messages with ${suite} settlement`)];
    }),
  ),
  [CONFIG_WEBID]: {
    ...localDefinition(
      CONFIG_WEBID,
      "WebID keys from safely fetched Controlled Identifier profiles",
    ),
    authentication:
      "Controlled Identifier Multikey profiles; key thumbprints and lifetimes committed by an independently signed fictional register answer",
  },
  [CONFIG_SOLID_ACCESS]: {
    ...localDefinition(CONFIG_SOLID_ACCESS, "Solid access control — not run"),
    status: "unresolved",
    unresolved: [
      "Brief 31 section 2.7: Specification 17 requires data to stay in a pod, but the single-layer configuration retains baseline by-value access. The cell must require data-access-by-reference-solid and be compared with that run, so it stays blocked behind the protected-reference transaction (section 2.6); its own remaining work is translating the terms into access rules that each name their policy.",
    ],
  },
  [CONFIG_POD_MIRROR]: localDefinition(
    CONFIG_POD_MIRROR,
    "Independent principal-owned record mirror",
  ),
  [CONFIG_SOLID_INBOX]: {
    ...localDefinition(CONFIG_SOLID_INBOX, "Signed messages through Solid inboxes"),
    bindings: ["solid-inbox/0.1"],
  },
  [CONFIG_SOLID_REFERENCE]: {
    ...localDefinition(CONFIG_SOLID_REFERENCE, "Solid reference access — not run"),
    status: "unresolved",
    unresolved: [
      "Brief 31 section 2.6: the revised confinement rule admits the lender's read as an added exchange. Not built: the protected-reference transaction, namely one outbound action that applies the Web Access Control grant and releases the pointer together or not at all, and the reference read as a signed request and signed response admitted through all five inbound checks; the existing ResourceReader admits statements, not a signed reference-read message.",
    ],
  },
  [CONFIG_AUTHENTICITY_DI]: {
    ...localDefinition(CONFIG_AUTHENTICITY_DI, "Signed RDF with Data Integrity"),
    integrity: {
      status: "selected",
      mechanism: "data-integrity",
      alg: "EdDSA",
      curve: "Ed25519",
      specs: ["Data Integrity", "eddsa-rdfc-2022", "RDFC-1.0"],
    },
    serialization:
      "Pinned JSON-LD; content-addressed attachments; eddsa-rdfc-2022 over canonical RDF",
  },
  [CONFIG_TRANSPORT_EMAIL]: {
    ...localDefinition(CONFIG_TRANSPORT_EMAIL, "Signed messages by email"),
    bindings: ["email-mime/0.1"],
  },
  [CONFIG_TRANSPORT_A2A]: {
    ...localDefinition(CONFIG_TRANSPORT_A2A, "Signed messages through A2A"),
    bindings: ["a2a-data-part/1.0"],
  },
  [CONFIG_TRANSPORT_MCP]: {
    ...localDefinition(CONFIG_TRANSPORT_MCP, "Signed messages through MCP"),
    bindings: ["mcp-tool/2026-07-28"],
  },
  [CONFIG_MAPPING]: localDefinition(
    CONFIG_MAPPING,
    "Signed versioned code-list mapping lookup with original-source standing",
  ),
  [CONFIG_EMAIL]: {
    ...localDefinition(
      CONFIG_EMAIL,
      "Unsigned plain-text email to principal-pinned endpoints; approval before every send",
    ),
    integrity: {
      status: "not-applicable",
      limitations:
        "Email has no signature. Local owner pins and approvals remain JWS-protected; only the endpoint address is known.",
    },
    requesterAuthentication: "not-applicable",
    authentication: "Address-only identity, neither a verified person nor a claims issuer",
    representation:
      "Only this agent's principal is represented; the correspondent is a mailbox with no agent",
    serialization:
      "Unsigned plain text with agent/represented-principal and structured-reply footer",
    bindings: ["scripted-mailbox/0.1"],
    unsignedRequestKinds: [],
  },
  [CONFIG_AGREEMENT]: localDefinition(
    CONFIG_AGREEMENT,
    "Multi-party signed agreement credentials with conditional local completion",
  ),
  [CONFIG_QUERY]: localDefinition(
    CONFIG_QUERY,
    "Source-signed approved-query answers with durable per-grant caps",
  ),
  [CONFIG_FORUM]: localDefinition(
    CONFIG_FORUM,
    "Signed record claims to a separately keyed fictional forum; no core re-execution",
  ),
  [CONFIG_PLAIN_LANGUAGE]: localDefinition(
    CONFIG_PLAIN_LANGUAGE,
    "Digest-bound unstructured content and source-signed structured form upgrade",
  ),
  [CONFIG_REFERENCE_LOCAL]: localDefinition(
    CONFIG_REFERENCE_LOCAL,
    "By-reference with a fictional local holder; not Solid access control",
  ),
  [CONFIG_ORGANIZATIONS]: {
    ...localDefinition(
      CONFIG_ORGANIZATIONS,
      "Organization identifier documents and mandate credentials via local resolver and signed issuer status",
    ),
    representation:
      "organization-signed mandate credential binding actor key, entity, roles, action kinds, validity and issuer status; current registrar document membership is mandatory",
    authentication:
      "introduced public verification material restricted by registrar-signed current organization and delegated-agent key documents through the local resolver",
  },
  [CONFIG_SELECTIVE_LOCAL]: localDefinition(
    CONFIG_SELECTIVE_LOCAL,
    "Salted claim digests with JWS; ordinary selective disclosure, no hidden predicate proofs",
  ),
  [CONFIG_PAYMENT]: localDefinition(
    CONFIG_PAYMENT,
    "Local structured payments, signed bank submissions, calendar-month mandate limits; fictional bank only",
  ),
  [CONFIG_CORROBORATION]: localDefinition(
    CONFIG_CORROBORATION,
    "Signed claims with exact-value corroboration and independently configured controllers",
  ),
  [CONFIG_PINNED_LIST]: localDefinition(
    CONFIG_PINNED_LIST,
    "Introduced keys with purpose-scoped principal trust pins and no register fallback",
  ),
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
