// AUTHORED-BY Codex GPT-6
/** The executable scenario suite catalog, shared by schema validation and the runner. */
import { baselineRegistry } from "./baseline.js";
import { withPublicRead } from "./public-read.js";
export function scenarioRegistry() {
  const registry = withPublicRead(baselineRegistry());
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
    name: "Approve each email",
    rulesOnly: false,
    policyLanguage: "exact-text owner approval",
    summary:
      "The principal sees the exact email including its footer before every send; task context is checked.",
  });
  registry.register({
    layer: "commitments",
    id: "agreement-credential",
    name: "Local multi-party agreement credentials",
    agreement: "agreement-credential",
    summary:
      "Every required party signs one digest; durable local holds, conditional completion and fresh signed status.",
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
      status: "not-run",
      summary: "Protocol objects exist; runtime wiring belongs to Brief 25.",
    });
  registry.register({
    layer: "reliance",
    id: "corroboration",
    name: "Exact-value corroboration",
    enforcedAtGate: true,
    summary:
      "Accepted issuers with separately configured controllers must agree on the exact subject, claim, value and period; authenticity alone never establishes truth.",
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
    name: "Organization mandate credentials",
    mandateFormat: "awp-organization-mandate+jws",
    approvalFormat: "exact-action",
    summary:
      "Organization-signed agent-key, entity, role and action scope, with issuer-signed status and bounded freshness.",
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
  return registry;
}
