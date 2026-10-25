/** Re-export the bridge's shared vocabulary bases so callers have one import. */
export declare const RDF_TYPE: string, XSD_DATE_TIME: string, XSD_STRING: string, XSD_BOOLEAN: string, SCHEMA: string, DCT: string, PROV_ENTITY: string, PROV_WAS_DERIVED_FROM: string, PROV_WAS_ATTRIBUTED_TO: string, PROV_WAS_ASSOCIATED_WITH: string, PROV_HAD_PLAN: string, PROV_GENERATED_AT_TIME: string, AGENTIC: string, AGENTIC_CHANNEL: string, AGENTIC_IN_REPLY_TO: string, SCHEMA_START_TIME: string, SCHEMA_END_TIME: string, SCHEMA_NAME: string;
/** `schema:recipient` — the outbound recipient handle (reused, not minted). */
export declare const SCHEMA_RECIPIENT = "https://schema.org/recipient";
/** `schema:text` — the human prose body of the outbound message (reused). */
export declare const SCHEMA_TEXT = "https://schema.org/text";
/** `dct:subject` — the outbound subject line (reused). */
export declare const DCT_SUBJECT = "http://purl.org/dc/terms/subject";
/** The minted proposal-record type. */
export declare const AGENTIC_ACTION_PROPOSAL: string;
/** The proposal's lifecycle status (predicate). */
export declare const AGENTIC_PROPOSAL_STATUS: string;
/** Status individuals — a proposal is NEVER sent until it reaches `Confirmed`. */
export declare const AGENTIC_PROPOSAL_PENDING: string;
export declare const AGENTIC_PROPOSAL_CONFIRMED: string;
export declare const AGENTIC_PROPOSAL_EXECUTED: string;
export declare const AGENTIC_PROPOSAL_FAILED: string;
export declare const AGENTIC_PROPOSAL_REJECTED: string;
/** The graduated-confirm friction level (predicate). */
export declare const AGENTIC_CONFIRM_FRICTION: string;
/** Friction individuals (§7 graduated confirmation). */
export declare const AGENTIC_LOW_FRICTION: string;
export declare const AGENTIC_HIGH_FRICTION: string;
/** When the proposal was confirmed / executed (`xsd:dateTime`). */
export declare const AGENTIC_CONFIRMED_AT: string;
export declare const AGENTIC_EXECUTED_AT: string;
/** A control-stripped human note (e.g. a send failure reason). */
export declare const AGENTIC_NOTE: string;
/** The outbox SEND RECEIPT type (a PROV entity the executor writes post-send). */
export declare const AGENTIC_SEND_RECEIPT: string;
/** Links a receipt to the proposal it executed. */
export declare const AGENTIC_EXECUTED_PROPOSAL: string;
/** The channel's own id for the transmitted message (recorded on the receipt). */
export declare const AGENTIC_CHANNEL_MESSAGE_ID: string;
/** The confirmation-record type (owner-only; the Actor cannot write these). */
export declare const AGENTIC_CONFIRMATION: string;
/** The proposal id the confirmation authorizes. */
export declare const AGENTIC_CONFIRMS_PROPOSAL: string;
/** The `sha256:<hex>` content digest the confirmation is bound to (content-locks the approval). */
export declare const AGENTIC_CONTENT_DIGEST: string;
/** The outcome recorded on a receipt (`sent` / `rejected` / `failed`). */
export declare const AGENTIC_OUTCOME: string;
/** Links an autonomous action to the signed mandate that authorized it (`prov:hadPlan`-adjacent). */
export declare const AGENTIC_UNDER_MANDATE: string;
/** Links an autonomous action to the specific ODRL permit rule that authorized it. */
export declare const AGENTIC_AUTHORIZED_BY_PERMIT: string;
/** Records that an action's authorizing basis was an explicit human confirmation. */
export declare const AGENTIC_AUTHORIZED_BY_CONFIRMATION: string;
/** The ODRL action short-name the outbound intent performs (literal ∈ ODRL_ACTIONS). */
export declare const AGENTIC_ODRL_ACTION: string;
/** The declared spend for the action (`xsd:integer`; the ODRL `count` constraint input). */
export declare const AGENTIC_SPEND: string;
export declare const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";
/** DPV — reused for the purpose the action is performed for (`dpv:hasPurpose`). */
export declare const DPV = "https://w3id.org/dpv#";
export declare const DPV_HAS_PURPOSE = "https://w3id.org/dpv#hasPurpose";
/** Agentic purpose individuals (the constrainable `purpose` left-operand values). */
export declare const AGENTIC_PURPOSE_SCHEDULING: string;
export declare const AGENTIC_PURPOSE_ACKNOWLEDGEMENT: string;
export declare const AGENTIC_PURPOSE_GENERAL: string;
//# sourceMappingURL=vocab.d.ts.map