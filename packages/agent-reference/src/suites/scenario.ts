// AUTHORED-BY Codex GPT-6
/** The executable scenario suite catalog, shared by schema validation and the runner. */
import { baselineRegistry } from "./baseline.js";
import { withPublicRead } from "./public-read.js";
export function scenarioRegistry() {
  const registry = withPublicRead(baselineRegistry());
  registry.register({
    layer: "accountability",
    id: "reputation-score",
    name: "Evidence-backed contested reputation score",
    record: "hash-chained-local",
    summary:
      "Not run: the regulator and public-post prerequisites are unresolved, and no evidence-admission, scoring, contest or service-accountability policy is specified.",
  });
  registry.register({
    layer: "accountability",
    id: "reputation-post",
    name: "Evidence-backed organisational reputation post",
    record: "hash-chained-local",
    summary:
      "Not run: regulator outcome, authorised public evidence, attached organisational reply and independent reader admission are required; the added exchanges violate accountability confinement.",
  });
  registry.register({
    layer: "accountability",
    id: "vendor-fault",
    name: "Fault claim against the gate operator",
    record: "hash-chained-local",
    summary:
      "Not run: signed gate/core attribution and a fault-claim exchange are required; the added exchange cannot satisfy accountability confinement.",
  });
  registry.register({
    layer: "usage-control",
    id: "odrl-model-tighten",
    name: "Rules with a model that may tighten",
    rulesOnly: false,
    policyLanguage: "ODRL pilot subset plus a narrowing model opinion",
    summary:
      "Rules decide first; only permitted uses reach the host-installed model, whose opinion may narrow but never grant a use. The mortgage uses a declared fixed stand-in.",
  });
  registry.register({
    layer: "authority",
    id: "agent-registry",
    name: "Current signed agent registration",
    mandateFormat: "principal mandate plus signed registration",
    approvalFormat: "existing exact-action approval",
    summary:
      "The receiver accepts a separately keyed registry through its trust chain and verifies the current principal, actor-key binding, registration status and operation scope.",
  });
  registry.register({
    layer: "authority",
    id: "authorization-server",
    name: "Key-bound authorization-server grant",
    mandateFormat: "at+jwt with authorization_details",
    approvalFormat: "principal consent plus existing exact-action approval",
    summary:
      "A separately keyed fictional server issues RFC 9396 authorization details with an RFC 8693 actor and key confirmation; gates read the explicitly lifted ODRL policies.",
  });
  registry.register({
    layer: "identity",
    id: "did",
    name: "Decentralized identifier (did:web)",
    resolution: "resolved",
    summary:
      "DID documents served by a fictional in-process web host; only explicitly configured methods are accepted and key lifetimes are signed independently.",
  });
  registry.register({
    layer: "meaning",
    id: "negotiated",
    name: "Principal-approved term proposals",
    vocabulary: "immutable exchange-scoped definitions",
    summary:
      "A separately keyed fictional deliberation platform records an agent proposal and exact-exchange principal signatures; agreement between agents alone never authorizes reliance.",
  });
  registry.register({
    layer: "reliance",
    id: "quality-certificate",
    name: "Certified index quality",
    enforcedAtGate: true,
    summary:
      "A separately accepted certifier signs source, dataset, category, quality policy and validity; otherwise per-record quality checks still run.",
  });
  registry.register({
    layer: "reliance",
    id: "stated-confidence",
    name: "Source-stated confidence",
    enforcedAtGate: true,
    summary:
      "Statement-level DQV measurements name their metric, source, method and uncertainty; an uncalibrated model estimate meets no threshold.",
  });
  registry.register({
    layer: "meaning",
    id: "registry-lookup",
    name: "Signed code-list mappings",
    vocabulary: "profile-selected signed mapping tables",
    summary:
      "A derived local statement names the mapping version and original digest and retains its source and quality; current status is resolved afresh.",
  });
  registry.register({
    layer: "transport",
    id: "email",
    name: "Email",
    binding: "email-mime/0.1",
    summary:
      "Signed bytes in MIME with a gate-built readable copy; the legacy prose mailbox remains separate.",
  });
  registry.register({
    layer: "identity",
    id: "email-endpoint",
    name: "Email endpoint only",
    resolution: "pinned",
    summary: "An owner-signed pin recognizes only an address, never a person or claims authority.",
  });
  registry.register({
    layer: "usage-control",
    id: "human-approval",
    name: "Principal approval of undecided uses",
    rulesOnly: false,
    policyLanguage: "ODRL pilot subset plus exact-action principal approval",
    summary:
      "The existing exact-action approval also protects email sends; the mortgage valuer-disclosure alternative is unresolved because its added exchanges violate confinement and its bank terms restrict recipients.",
  });
  registry.register({
    layer: "commitments",
    id: "agreement-credential",
    name: "Two-proof agreement credentials",
    agreement: "agreement-credential",
    summary:
      "The mortgage uses one native Data Integrity credential with proofs from the valuer and Sam's approved agent, plus signed current status. The legacy local JWS coordinator retains its separate conditional multi-party holds.",
  });
  for (const [id, name] of [
    ["ap2", "Agent Payments Protocol 0.2"],
    ["acp", "Agentic Commerce Protocol 2026-04-17"],
    ["x402", "x402 version 2"],
    ["mpp", 'Machine Payments Protocol (the "Payment" HTTP authentication scheme, draft 01)'],
  ] as const)
    registry.register({
      layer: "settlement",
      id,
      name,
      partOf: "commitments",
      status: "run",
      summary: "Native protocol settlement runs under its mortgage matrix configuration.",
    });
  registry.register({
    layer: "reliance",
    id: "corroboration",
    name: "Independent-source corroboration",
    enforcedAtGate: true,
    summary:
      "Accepted issuers with separately configured controllers must agree on the subject, currency and period, using exact values or a stated task tolerance; statements derived from one record count once.",
  });
  registry.register({
    layer: "trust",
    id: "pinned-list",
    name: "Scoped own-list pins",
    anchors: "pinned",
    summary:
      "Reviewed verification keys require a purpose-scoped, expiring own-list pin; unknown trust is held for a digest-bound principal decision.",
  });
  registry.register({
    layer: "meaning",
    vocabulary: "profile-declared types",
    id: "plain-language-upgrade",
    name: "Structured form from the source",
    summary:
      "Content remains unstructured data. Typed quarantined readings retain agent authorship and digest; unaccepted readings require source-signed claims.",
  });
  registry.register({
    layer: "data-access",
    id: "by-reference-local-holder",
    name: "Signed grants and local resource holder",
    mode: "by-reference",
    summary:
      "A separately keyed local holder verifies signed reader identity, item, purpose and expiry; this does not implement Solid access control.",
  });
  registry.register({
    layer: "identity",
    id: "organization-document-local",
    name: "Registrar-served current organization documents",
    resolution: "resolved",
    summary:
      "A local resolver serves registrar-signed current key and delegated-agent lists; no live DID method is claimed.",
  });
  registry.register({
    layer: "authority",
    id: "mandate-credential",
    name: "Principal and organization mandate credentials",
    mandateFormat: "principal operational VC with Bitstring Status Lists; organization-mandate+jws",
    approvalFormat: "exact-action",
    summary:
      "Principal-signed operational mandates carry suspension and revocation lists; the existing organization profile retains signed agent-key, entity, role and action scope with fresh issuer status.",
  });
  registry.register({
    layer: "authenticity",
    id: "selective-disclosure",
    name: "Salted claim digests inside signed credentials",
    mechanism: "JWS and salted SHA-256 claim commitments",
    algs: ["EdDSA"],
    summary:
      "Each revealed claim is checked against issuer-signed salted digests; no proof about hidden values or unlinkability is claimed.",
  });
  registry.register({
    layer: "accountability",
    id: "regulator-claim",
    name: "Local signed-record forum",
    record: "hash-chained-local",
    summary:
      "A separately keyed fictional forum verifies signed segments and compares records and admitted observations; it never re-runs a core.",
  });
  for (const [id, name, binding] of [
    ["a2a", "A2A", "a2a-data-part/1.0"],
    ["mcp", "MCP", "mcp-tool/2026-07-28"],
  ] as const)
    registry.register({
      layer: "transport",
      id,
      name,
      binding,
      summary: "Opaque signed message bytes over an in-process HTTP exchange.",
    });
  registry.register({
    layer: "authenticity",
    id: "data-integrity",
    name: "Data Integrity",
    mechanism: "eddsa-rdfc-2022",
    algs: ["EdDSA"],
    summary:
      "Complete JSON-LD documents signed with eddsa-rdfc-2022; embedded issuer JWSs retain their original verification.",
  });
  registry.register({
    layer: "data-access",
    id: "by-reference-solid",
    name: "By reference on Solid",
    mode: "by-reference",
    summary:
      "Not run: the runtime lacks atomic WAC grant-and-pointer release and a five-check reference-message admission boundary.",
  });
  registry.register({
    layer: "transport",
    id: "solid-inbox",
    name: "Solid inbox",
    binding: "solid-inbox/0.1",
    summary:
      "Receiver-description discovery, LDN POST, receiver listing and byte-exact retrieval under WAC; storage observes every read.",
  });
  registry.register({
    layer: "accountability",
    id: "pod-mirror",
    name: "Record mirrored to a pod",
    record: "pod-mirror",
    summary:
      "The evidence gate requires the actual signed record entries in independent principal-owned Solid storage before exposing an action.",
  });
  registry.register({
    layer: "usage-control",
    id: "solid-access-control",
    name: "Solid access control",
    rulesOnly: true,
    policyLanguage: "ODRL pilot subset, narrowed to WAC Read plus scheduled ACL withdrawal",
    summary:
      "Not run: pod-only access needs the protected-reference transaction, while this single-layer configuration retains baseline by-value delivery.",
  });
  registry.register({
    layer: "identity",
    id: "webid",
    name: "WebID",
    resolution: "resolved",
    summary:
      "Safely fetched Controlled Identifier profiles supply the public keys; independently signed register thumbprints bind the names, methods and key lifetimes.",
  });
  registry.register({
    layer: "authenticity",
    id: "origin-hosted",
    name: "Fetched from a register-bound source address",
    mechanism: "origin fetch with signed register address binding",
    algs: ["EdDSA"],
    summary:
      "Each verifier fetches an unsigned product only at its independently signed register address; the local origin observation cannot be forwarded as evidence.",
  });
  registry.register({
    layer: "trust",
    id: "trusted-index",
    name: "Source-signed records in an append-only index",
    anchors: "register-chain",
    summary:
      "The source signature and source acceptance stay separate from signed log heads, per-record inclusion proofs and checkpoint consistency. JSON replaces SCITT COSE explicitly.",
  });
  registry.register({
    layer: "trust",
    id: "federation",
    name: "Presented OpenID Federation entity statements",
    anchors: "federation",
    summary:
      "Presented signed entity-statement JWTs chain to the principal’s independently held anchor; expiry, JWKS bindings and narrowing metadata policies are checked without querying a register.",
  });
  registry.register({
    layer: "trust",
    id: "reputation",
    name: "A principal’s minimum reputation score",
    anchors: "register-chain",
    summary:
      "An accepted rating service’s signed score tightens the principal’s rule; a high score never replaces source acceptance through the register.",
  });
  return registry;
}
