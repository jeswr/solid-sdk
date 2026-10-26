/**
 * SYNTHETIC EU industrial maintenance (UC-05) fixture: organisations, agent identities, owner
 * mandates, representation scopes, NordWerk's internal roles, source-authority rules and the
 * synthetic programme credential. Used by BOTH the in-process scenario
 * (`scenarios/industrial.ts`) and the durable roles (`roles/industrial.ts`).
 *
 * Three organisations: Alpine (the user of the connected product: a planner agent and a data
 * authority agent that issues third-party access authorisations with its OWN issuing key),
 * Orbis (the data holder: a telemetry provider agent) and NordWerk (the recipient: a contracting
 * agent and a diagnostic agent). Agents of one organisation share the organisation's owner key
 * (it signs their mandates and representation statements) but have independent actor keys.
 * Nothing here is a real company, data space, connector, programme membership or legal
 * eligibility (no Catena-X/DSP certification, no Data Act conclusion).
 */
import { newUrn } from "../core/canonical.js";
import type { Iri } from "../core/types.js";
import {
  ASSET,
  CLAIM_TPA,
  DATA_OFFER_OP,
  DATASET_READ_OP,
  INTERNAL_TPA_OP,
  RECOMMENDATION_OP,
  TPA_TARGET,
  TRANSFER_OP,
} from "../domains/industrial.js";
import type { InternalRole } from "../domains/purpose-store.js";
import { generateSigningKey } from "../mechanisms/jws.js";
import { signStatement, TYP } from "../mechanisms/statements.js";
import type { SourceAuthorityRule } from "../mechanisms/trust.js";
import { PURPOSE } from "../profile/vocabulary.js";
import { mandateOf, permit } from "../scenarios/common.js";

export const ALPINE = "https://alpine-motion.example/#org";
export const ORBIS = "https://orbis-robotics.example/#org";
export const NORDWERK = "https://nordwerk.example/#org";
export const CHEAPFIX = "https://cheapfix.example/#org";
export const PROGRAMME = "https://dataspace-programme.example/#issuer";
export const ALPINE_ISSUER = "https://alpine-motion.example/#data-authority-issuer";
export const NW_PRODUCT = "https://nordwerk.example/agents/product-analytics#agent";

export const PLANNER = {
  name: "alpine-planner",
  party: ALPINE,
  actor: "https://alpine-motion.example/agents/planner#agent",
  operator: ALPINE,
};
export const AUTHORITY = {
  name: "alpine-authority",
  party: ALPINE,
  actor: "https://alpine-motion.example/agents/data-authority#agent",
  operator: ALPINE,
};
export const ORBIS_TP = {
  name: "orbis-telemetry",
  party: ORBIS,
  actor: "https://orbis-robotics.example/agents/telemetry-provider#agent",
  operator: ORBIS,
};
/** A second Orbis endpoint still offering the OLD model version (incompatibility isolation). */
export const ORBIS_LEGACY = {
  name: "orbis-legacy",
  party: ORBIS,
  actor: "https://orbis-robotics.example/agents/telemetry-legacy#agent",
  operator: ORBIS,
};
export const NW_CONTRACT = {
  name: "nordwerk-contracting",
  party: NORDWERK,
  actor: "https://nordwerk.example/agents/contracting#agent",
  operator: NORDWERK,
};
export const NW_DIAG = {
  name: "nordwerk-diagnostic",
  party: NORDWERK,
  actor: "https://nordwerk.example/agents/diagnostic#agent",
  operator: NORDWERK,
};

/** Representation scopes (what each organisation's owner key says the agent may act in). */
export const REPRESENTATION = {
  planner: [INTERNAL_TPA_OP.id, RECOMMENDATION_OP.id],
  authority: [INTERNAL_TPA_OP.id],
  provider: [DATA_OFFER_OP.id, TRANSFER_OP.id],
  contracting: [DATA_OFFER_OP.id, TRANSFER_OP.id],
  // Not DATA_OFFER_OP: NordWerk does not let its diagnostic agent contract for it.
  diagnostic: [RECOMMENDATION_OP.id, DATASET_READ_OP.id],
} as const;

export function plannerMandate() {
  return mandateOf("planner", [
    permit("use", INTERNAL_TPA_OP.id, [PURPOSE.maintenance], [ALPINE]),
    permit("use", RECOMMENDATION_OP.id, [PURPOSE.maintenance], [NORDWERK]),
  ]);
}

/** The data-authority agent may authorise third-party access for NordWerk only. */
export function authorityMandate() {
  return mandateOf("data-authority", [
    permit("use", TPA_TARGET, [PURPOSE.maintenance], [NORDWERK]),
  ]);
}

export function providerMandate() {
  return mandateOf("telemetry-provider", [permit("use", DATA_OFFER_OP.id, [PURPOSE.maintenance])]);
}

export function contractingMandate() {
  return mandateOf("contracting", [
    permit("use", DATA_OFFER_OP.id, [PURPOSE.maintenance, PURPOSE.productDevelopment], [ORBIS]),
    permit("use", TRANSFER_OP.id, [PURPOSE.maintenance], [ORBIS]),
  ]);
}

/**
 * The diagnostic agent's LOCAL mandate is deliberately over-broad: it lists contracting with
 * Orbis (NordWerk's org-signed representation scope does not — Orbis checks that) and internal
 * dataset reads for product development (NordWerk's enforcement point does not allow that — the
 * store checks it). Both refusals are therefore observed at the other service's boundary.
 */
export function diagnosticMandate() {
  return mandateOf("diagnostic", [
    permit("use", RECOMMENDATION_OP.id, [PURPOSE.maintenance], [ALPINE]),
    permit("use", DATA_OFFER_OP.id, [PURPOSE.maintenance], [ORBIS]),
    permit(
      "use",
      DATASET_READ_OP.id,
      [PURPOSE.maintenance, PURPOSE.productDevelopment],
      [NORDWERK],
    ),
  ]);
}

/**
 * NordWerk's internal roles at its enforcement point: TRUSTED-OPERATOR configuration made at
 * provisioning (which NordWerk agent may do what, for which purposes). At request time the
 * agent is NOT selected by an operator: it is the verified signer of the internal message.
 */
export function nordwerkInternalRoles(): InternalRole[] {
  return [
    {
      agent: NW_DIAG.actor,
      label: "diagnostic agent",
      purposes: [PURPOSE.maintenance],
      actions: ["read"],
    },
    {
      agent: NW_PRODUCT,
      label: "product analytics agent",
      purposes: [PURPOSE.productDevelopment],
      actions: ["read"],
    },
    {
      agent: NW_CONTRACT.actor,
      label: "contracting agent",
      purposes: [PURPOSE.maintenance],
      actions: ["read", "distribute"],
    },
  ];
}

/** Orbis accepts third-party access authorisations for this asset from Alpine's issuer only. */
export function providerSourceRules(validUntil: string): SourceAuthorityRule[] {
  return [
    {
      id: "https://orbis-robotics.example/rules/tpa/1",
      version: "1",
      source: ALPINE_ISSUER,
      claimTypes: [CLAIM_TPA],
      subjects: [ASSET],
      validUntil,
      framework: "Orbis synthetic connected-product user register",
    },
  ];
}

/** NordWerk accepts telemetry about this asset from Orbis (the data holder) only. */
export function recipientSourceRules(validUntil: string): SourceAuthorityRule[] {
  return [
    {
      id: "https://nordwerk.example/rules/telemetry/1",
      version: "1",
      source: ORBIS,
      claimTypes: ["telemetry.*"],
      subjects: [ASSET],
      validUntil,
    },
  ];
}

/**
 * A synthetic programme issuer and one participant credential for NordWerk. The issuer's
 * PRIVATE key is discarded when this returns: only the public card and the signed credential
 * remain (a test programme, not a real data space membership).
 */
export async function syntheticProgramme(now: Date, subject: Iri = NORDWERK) {
  const { key } = await generateSigningKey("EdDSA");
  const validUntil = new Date(now.getTime() + 365 * 86_400_000).toISOString();
  const credential = await signStatement(key, TYP.statement, {
    type: "ParticipantCredential",
    id: newUrn(),
    issuer: PROGRAMME,
    subject,
    programme: "synthetic dataspace test programme",
    issuedAt: now.toISOString(),
    validUntil,
  });
  return {
    issuers: {
      version: 1 as const,
      issuers: [{ issuer: PROGRAMME, kid: key.kid, alg: key.alg, publicJwk: key.publicJwk }],
      note: "synthetic programme test issuer (private key discarded)",
    },
    membership: { version: 1 as const, subject, credential, synthetic: true as const },
  };
}
