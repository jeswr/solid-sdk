// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Vocabulary — the IRI constants this package writes for its ONE new concept: the
 * outbound ACTION PROPOSAL record (the Reader/Actor/outbox split's only new data
 * shape). House rule: mint minimally, reuse the standards. Everything that has a
 * schema.org / Dublin Core / PROV term uses it; the only minted namespace is
 * `agentic:` = `https://w3id.org/jeswr/agentic#` (reused from
 * `@jeswr/agentic-legacy-bridge` — the raw-anchor + reliability vocabulary), and
 * only for the proposal lifecycle, which has no standard equivalent.
 *
 * These are string constants, not RDF terms — callers wrap them in `namedNode()`
 * and serialise with `n3.Writer` + typed quads. Triples are NEVER hand-concatenated.
 */
import { vocab as bridge } from "@jeswr/agentic-legacy-bridge";
/** Re-export the bridge's shared vocabulary bases so callers have one import. */
export const { RDF_TYPE, XSD_DATE_TIME, XSD_STRING, XSD_BOOLEAN, SCHEMA, DCT, PROV_ENTITY, PROV_WAS_DERIVED_FROM, PROV_WAS_ATTRIBUTED_TO, PROV_WAS_ASSOCIATED_WITH, PROV_HAD_PLAN, PROV_GENERATED_AT_TIME, AGENTIC, AGENTIC_CHANNEL, AGENTIC_IN_REPLY_TO, SCHEMA_START_TIME, SCHEMA_END_TIME, SCHEMA_NAME, } = bridge;
/** `schema:recipient` — the outbound recipient handle (reused, not minted). */
export const SCHEMA_RECIPIENT = "https://schema.org/recipient";
/** `schema:text` — the human prose body of the outbound message (reused). */
export const SCHEMA_TEXT = "https://schema.org/text";
/** `dct:subject` — the outbound subject line (reused). */
export const DCT_SUBJECT = "http://purl.org/dc/terms/subject";
/** The minted proposal-record type. */
export const AGENTIC_ACTION_PROPOSAL = `${AGENTIC}ActionProposal`;
/** The proposal's lifecycle status (predicate). */
export const AGENTIC_PROPOSAL_STATUS = `${AGENTIC}proposalStatus`;
/** Status individuals — a proposal is NEVER sent until it reaches `Confirmed`. */
export const AGENTIC_PROPOSAL_PENDING = `${AGENTIC}ProposalPending`;
export const AGENTIC_PROPOSAL_CONFIRMED = `${AGENTIC}ProposalConfirmed`;
export const AGENTIC_PROPOSAL_EXECUTED = `${AGENTIC}ProposalExecuted`;
export const AGENTIC_PROPOSAL_FAILED = `${AGENTIC}ProposalFailed`;
export const AGENTIC_PROPOSAL_REJECTED = `${AGENTIC}ProposalRejected`;
/** The graduated-confirm friction level (predicate). */
export const AGENTIC_CONFIRM_FRICTION = `${AGENTIC}confirmFriction`;
/** Friction individuals (§7 graduated confirmation). */
export const AGENTIC_LOW_FRICTION = `${AGENTIC}LowFriction`;
export const AGENTIC_HIGH_FRICTION = `${AGENTIC}HighFriction`;
/** When the proposal was confirmed / executed (`xsd:dateTime`). */
export const AGENTIC_CONFIRMED_AT = `${AGENTIC}confirmedAt`;
export const AGENTIC_EXECUTED_AT = `${AGENTIC}executedAt`;
/** A control-stripped human note (e.g. a send failure reason). */
export const AGENTIC_NOTE = `${AGENTIC}note`;
/** The outbox SEND RECEIPT type (a PROV entity the executor writes post-send). */
export const AGENTIC_SEND_RECEIPT = `${AGENTIC}SendReceipt`;
/** Links a receipt to the proposal it executed. */
export const AGENTIC_EXECUTED_PROPOSAL = `${AGENTIC}executedProposal`;
/** The channel's own id for the transmitted message (recorded on the receipt). */
export const AGENTIC_CHANNEL_MESSAGE_ID = `${AGENTIC}channelMessageId`;
// --- The OWNER-ONLY confirmation record (the unforgeable human-confirm gate). ---
/** The confirmation-record type (owner-only; the Actor cannot write these). */
export const AGENTIC_CONFIRMATION = `${AGENTIC}Confirmation`;
/** The proposal id the confirmation authorizes. */
export const AGENTIC_CONFIRMS_PROPOSAL = `${AGENTIC}confirmsProposal`;
/** The `sha256:<hex>` content digest the confirmation is bound to (content-locks the approval). */
export const AGENTIC_CONTENT_DIGEST = `${AGENTIC}contentDigest`;
// --- Receipt outcome flags. ---
/** The outcome recorded on a receipt (`sent` / `rejected` / `failed`). */
export const AGENTIC_OUTCOME = `${AGENTIC}outcome`;
/** Links an autonomous action to the signed mandate that authorized it (`prov:hadPlan`-adjacent). */
export const AGENTIC_UNDER_MANDATE = `${AGENTIC}underMandate`;
/** Links an autonomous action to the specific ODRL permit rule that authorized it. */
export const AGENTIC_AUTHORIZED_BY_PERMIT = `${AGENTIC}authorizedByPermit`;
/** Records that an action's authorizing basis was an explicit human confirmation. */
export const AGENTIC_AUTHORIZED_BY_CONFIRMATION = `${AGENTIC}authorizedByConfirmation`;
// --- The ODRL-intent descriptor a proposal carries, so the outbox executor can
// --- evaluate it against the owner's signed ODRL mandate (dogfooding @jeswr/solid-odrl). ---
/** The ODRL action short-name the outbound intent performs (literal ∈ ODRL_ACTIONS). */
export const AGENTIC_ODRL_ACTION = `${AGENTIC}odrlAction`;
/** The declared spend for the action (`xsd:integer`; the ODRL `count` constraint input). */
export const AGENTIC_SPEND = `${AGENTIC}spend`;
export const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";
/** DPV — reused for the purpose the action is performed for (`dpv:hasPurpose`). */
export const DPV = "https://w3id.org/dpv#";
export const DPV_HAS_PURPOSE = `${DPV}hasPurpose`;
/** Agentic purpose individuals (the constrainable `purpose` left-operand values). */
export const AGENTIC_PURPOSE_SCHEDULING = `${AGENTIC}SchedulingResponse`;
export const AGENTIC_PURPOSE_ACKNOWLEDGEMENT = `${AGENTIC}Acknowledgement`;
export const AGENTIC_PURPOSE_GENERAL = `${AGENTIC}GeneralCommunication`;
//# sourceMappingURL=vocab.js.map