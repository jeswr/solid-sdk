// AUTHORED-BY Codex GPT-6.1-Sol
/** Canonical namespace and the single migration table for pilot/M1 vocabulary symbols.
 * Legacy prefix names are keys only: legacy namespace IRIs are never emitted or fetched.
 */
export const AGENT = "https://jeswr.org/ns/agent#";
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const SCHEMA = "https://schema.org/";
export const DCT = "http://purl.org/dc/terms/";
export const PROV = "http://www.w3.org/ns/prov#";
export const DPV = "https://w3id.org/dpv#";
export const AS = "https://www.w3.org/ns/activitystreams#";
export const SEC = "https://w3id.org/security#";
/** Every minted term and its normative local definition. */
export const TERM_DEFINITIONS = {
  Account:
    "A channel account descriptor; its channelHandle value is a salted hash, never a raw handle.",
  Acknowledgement: "Migrated M1 lifecycle or intent term Acknowledgement.",
  ActionIntent:
    "Exact operation, version, binding, recipient hash, spend, purpose and consequential parameters to be evaluated.",
  ActionProposal:
    "An executable proposal with exact action intent, rendered preview, provenance and lifecycle state.",
  AgentWorkspace: "Private agent workspace registered in the owner private type index.",
  AgreementRecord:
    "Documentary record relating an identified offer, the accepting message and the exact terms digest (A8).",
  Approval:
    "Owner decision bound to one proposal and its exact terms digest, with expiry and an opaque proof attachment.",
  AuthorisationDecision:
    "A decision evaluated under an identified grant (e.g. an owner mandate) for one concrete action. The grant is not the decision (CT-05).",
  ChannelCapability:
    "Static and credential-dependent description of one channel binding and its carriage and limits.",
  Configuration:
    "One coherent mechanism combination (integrity, authentication, representation, authorisation, binding).",
  Confirmation: "The confirmation-record type (owner-only; the Actor cannot write these).",
  ControlStatement:
    "Owner control statement to halt, resume, change a binding, dispatch, revoke or forget; requires external proof verification.",
  DispatchNow: "Control kind requesting dispatch of a specific proposal through the executor.",
  EvidenceLedger:
    "An append-only hash-chained log kept by one agent. Integrity of the retained entries does not establish completeness (CT-10).",
  Forget: "Control kind requesting deletion of the referenced memory resource.",
  GeneralCommunication: "Migrated M1 lifecycle or intent term GeneralCommunication.",
  Grant:
    "A record that a grant artefact (mandate, data-use, access, onward-use or delegation grant) was loaded, identified by digest.",
  Halt: "Control kind requesting suspension of all execution.",
  HighFriction: "Migrated M1 lifecycle or intent term HighFriction.",
  ImplementationDescription:
    "What one agent implements versus accepts: configurations, operations, bindings. Grants no authority.",
  InboundMessage:
    "An owner-private inbound message with channel provenance and unverified sender identity.",
  LedgerEntry:
    "One sealed entry of an evidence ledger: sequence number, previous hash, entry hash, and the record it carries.",
  LowFriction: "Friction individuals (\u00a77 graduated confirmation).",
  MandateReference:
    "Reference to a signed authorization credential. This graph does not issue or verify that credential.",
  MessageRecord:
    "Record that a protected message with a given digest was received or emitted. Sender fields of inbound records are claims.",
  Operation: "A versioned interaction operation an agent supports (e.g. schedule-meeting).",
  OutcomeConclusion:
    "Pilot logical-model term OutcomeConclusion; records local evidence and conveys no authority by itself.",
  OutcomeRecord:
    "The recording agent's own conclusion about one activity it attempted: completed, not-executed or uncertain, with the method of observation.",
  OwnerMandate:
    "Owner-signed bound on what a software actor may do: autonomous and with-approval ODRL policies plus validity. Not a representation statement.",
  PeerOutcomeReport:
    "A peer's reported conclusion about the peer's own activity. Attributed to the peer; not independently observed.",
  PolicyModule:
    "The evaluator an agent actually uses for a policy profile (name, version, interface, current status). Informative; carries no local paths or digests and grants no authority.",
  PolicyProfile:
    "Shared policy semantics a configuration accepts (e.g. the ODRL pilot subset, three-valued). Independent of which evaluator implements it.",
  ProposalConfirmed: "Migrated M1 lifecycle or intent term ProposalConfirmed.",
  ProposalExecuted: "Migrated M1 lifecycle or intent term ProposalExecuted.",
  ProposalFailed: "Migrated M1 lifecycle or intent term ProposalFailed.",
  ProposalPending: "Status individuals \u2014 a proposal is NEVER sent until it reaches Confirmed.",
  ProposalRejected: "Migrated M1 lifecycle or intent term ProposalRejected.",
  RepresentationAssessment:
    "An evaluator's conclusion whether a software actor speaks for a party for an operation. Not an authorisation.",
  RepresentationStatement:
    "Party-signed statement that an actor key speaks for the party for listed operations. Authorises nothing at the receiver.",
  Resume: "Control kind requesting resumption after a halt.",
  RevokeMandate: "Control kind requesting revocation of the referenced mandate.",
  SchedulingResponse:
    "Agentic purpose individuals (the constrainable purpose left-operand values).",
  SendReceipt: "The outbox SEND RECEIPT type (a PROV entity the executor writes post-send).",
  SetBindingState: "Control kind changing the named binding to a specified state.",
  SignedMessage: "Structured carrier of a protected logical message.",
  SourceAuthorityAssessment:
    "An evaluator's conclusion whether it recognises a source for a claim type about a subject, under an identified local rule version (CT-03).",
  Transmission:
    "Executor record of a transmission attempt, its wire digest, authority references and observed status.",
  VerificationResult:
    "Outcome of an integrity and key-attribution check over exact protected bytes. Establishes neither truth, source authority, representation nor permission.",
  acceptance: "The accepting message.",
  acceptor: "Software actor that accepted.",
  acceptsConfiguration:
    "A configuration the agent accepts for interaction (subset of implemented).",
  accessMode: "public, represented, agreement, ...",
  action: "The agent:ActionIntent evaluated.",
  actionDigest: "Digest identifying the exact action (all consequential parameters).",
  activityType:
    "Informative classification of an activity (e.g. schema:ScheduleAction). Not asserted as rdf:type.",
  agreedEvent: "The schema:Event (meeting slot) fixed by the agreement.",
  amount: "Declared spend, represented by a value and currency.",
  approval: "The owner approval relied on.",
  approves: "Proposal addressed by an approval or denial.",
  "assessment/accepted":
    "accepted value in the assessment concept scheme; an evidence classification, not a grant.",
  "assessment/not-accepted":
    "not-accepted value in the assessment concept scheme; an evidence classification, not a grant.",
  "assessment/unresolved":
    "unresolved value in the assessment concept scheme; an evidence classification, not a grant.",
  assessmentOutcome: "A concept from agent:AssessmentOutcomes.",
  attributedKeyHolder:
    "Identifier the pinned key is bound to in the verifier's local trust store. Attribution of bytes to a key, not of authority.",
  "authorisation/approval-required":
    "approval-required value in the authorisation concept scheme; an evidence classification, not a grant.",
  "authorisation/deny":
    "deny value in the authorisation concept scheme; an evidence classification, not a grant.",
  "authorisation/indeterminate":
    "indeterminate value in the authorisation concept scheme; an evidence classification, not a grant.",
  "authorisation/permit":
    "permit value in the authorisation concept scheme; an evidence classification, not a grant.",
  authorisationOutcome: "A concept from agent:AuthorisationOutcomes.",
  authorizedByConfirmation:
    "Records that an action's authorizing basis was an explicit human confirmation.",
  authorizedByPermit:
    "Links an autonomous action to the specific ODRL permit rule that authorized it.",
  autonomous: "Policy set evaluated without a per-action owner approval.",
  basis: "The agreement or invocation an activity was performed under.",
  "basis/autonomous":
    "autonomous value in the basis concept scheme; an evidence classification, not a grant.",
  "basis/owner-approval":
    "owner-approval value in the basis concept scheme; an evidence classification, not a grant.",
  binding: "Transport binding identifier.",
  bindingEndpoint: "Endpoint advertised for a binding.",
  bindingState: "Account connection state: none, setup-required, connected, error or disabled.",
  carriage: "Versioned metadata carriage profile identifier supported by the binding.",
  channel: "Agent record field channel.",
  channelHandle:
    "Salted hash of an account or sender handle. Raw handles are held only by the daemon.",
  channelMessageId: "The channel's own id for the transmitted message (recorded on the receipt).",
  claimSubject: "The subject the claim is about.",
  claimType: "The claim type the source was assessed for.",
  claimedOnBehalfOf:
    "Represented party as CLAIMED in an inbound message. Deliberately not prov:actedOnBehalfOf.",
  claimedParty: "Party the described agent claims to act for (a claim until assessed).",
  claimedSender: "Sender actor as CLAIMED in an inbound message (not an assessment).",
  compactJws: "Opaque compact JWS carried by a signed message envelope.",
  concerns: "The activity an outcome record or report is about.",
  conclusion: "A concept from agent:OutcomeConclusions.",
  "conclusion/completed":
    "completed value in the conclusion concept scheme; an evidence classification, not a grant.",
  "conclusion/not-executed":
    "not-executed value in the conclusion concept scheme; an evidence classification, not a grant.",
  "conclusion/uncertain":
    "uncertain value in the conclusion concept scheme; an evidence classification, not a grant.",
  confirmFriction: "The graduated-confirm friction level (predicate).",
  confirmationRequired:
    "Reliability gate requires owner confirmation even under an autonomous-send mandate.",
  confirmedAt: "When the proposal was confirmed / executed (xsd:dateTime).",
  confirmsProposal: "The proposal id the confirmation authorizes.",
  contentDigest:
    "The sha256:<hex> content digest the confirmation is bound to (content-locks the approval).",
  controlKind: "Named control action carried by a ControlStatement.",
  conversation: "The conversation a record belongs to.",
  costPerMessage: "Cost per channel message as a nonnegative decimal.",
  credential: "Reference to a signed mandate authorization credential.",
  credentialRef:
    "Daemon profile name or provisioning reference string; never the credential value.",
  credentialState: "Current binding credential state, without credential values.",
  decision: "Owner choice of approve or deny; never trusted before external proof verification.",
  decisionBasis: "A concept from agent:DecisionBases.",
  deliveryReceipts: "Whether the binding supports delivery receipts.",
  describes: "The agent an implementation description is about.",
  digest: "Content digest of an artefact.",
  direction: '"in" or "out".',
  draft: "Whether drafts may be proposed for an account; false by default.",
  effectKey: "Idempotency key of the effect.",
  endToEndEncrypted: "Whether channel content has end-to-end encryption.",
  entryHash: "SHA-256 digest sealing the entry (over seq, time, previous hash and record).",
  evaluatedActor: "The software actor whose representation was assessed.",
  evaluatedPolicy: "The grant or policy the decision was evaluated under.",
  evaluatorImplementation: "The policy evaluator implementation and version used.",
  executedAt: "Migrated M1 lifecycle or intent term executedAt.",
  executedProposal: "Links a receipt to the proposal it executed.",
  expires: "Expiry instant of an approval or control statement.",
  externalId: "Provider-assigned message identifier observed by the executor.",
  finalReport: "True if the reporter marked the report final (xsd:boolean).",
  "grant/access":
    "access value in the grant concept scheme; an evidence classification, not a grant.",
  "grant/data-use":
    "data-use value in the grant concept scheme; an evidence classification, not a grant.",
  "grant/delegation":
    "delegation value in the grant concept scheme; an evidence classification, not a grant.",
  "grant/onward-use":
    "onward-use value in the grant concept scheme; an evidence classification, not a grant.",
  "grant/owner-mandate":
    "owner-mandate value in the grant concept scheme; an evidence classification, not a grant.",
  grantKind: "A concept from agent:GrantKinds.",
  grantee: "The agent a grant is issued to.",
  historyWindow: "Available channel history as an xsd:duration.",
  identityStatus:
    "Sender identity status; inbound messages remain unverified in the logical record.",
  implementsConfiguration: "A configuration the agent implements.",
  inLedger: "The ledger an entry belongs to.",
  inReplyTo: "Reply linkage between channel messages.",
  intent: "Agent record field intent.",
  interactionPattern: "negotiate, invoke, public-read, ...",
  "kind/accept":
    "accept value in the kind concept scheme; an evidence classification, not a grant.",
  "kind/deliver":
    "deliver value in the kind concept scheme; an evidence classification, not a grant.",
  "kind/describe":
    "describe value in the kind concept scheme; an evidence classification, not a grant.",
  "kind/description":
    "description value in the kind concept scheme; an evidence classification, not a grant.",
  "kind/indeterminate":
    "indeterminate value in the kind concept scheme; an evidence classification, not a grant.",
  "kind/invoke":
    "invoke value in the kind concept scheme; an evidence classification, not a grant.",
  "kind/propose":
    "propose value in the kind concept scheme; an evidence classification, not a grant.",
  "kind/receipt":
    "receipt value in the kind concept scheme; an evidence classification, not a grant.",
  "kind/refuse":
    "refuse value in the kind concept scheme; an evidence classification, not a grant.",
  "kind/unsupported":
    "unsupported value in the kind concept scheme; an evidence classification, not a grant.",
  lastIngest: "Timestamp of the most recent ingestion.",
  length:
    "Number of ordered items in a bounded RDF sequence, including zero for an empty sequence.",
  limitation: "A stated limit of what a record establishes.",
  matchedRule: "Identifier of the policy rule that determined the outcome.",
  maxMessageBytes: "Maximum bytes in a channel message.",
  mechanism: "The integrity mechanism profile applied.",
  message: "The message a record is about.",
  messageKind: "A concept from agent:MessageKinds.",
  method: "A concept from agent:ObservationMethods.",
  "method/direct-response":
    "direct-response value in the method concept scheme; an evidence classification, not a grant.",
  "method/reconciliation":
    "reconciliation value in the method concept scheme; an evidence classification, not a grant.",
  "method/recovery":
    "recovery value in the method concept scheme; an evidence classification, not a grant.",
  "method/timeout":
    "timeout value in the method concept scheme; an evidence classification, not a grant.",
  moduleInterface:
    "How the evaluator is invoked (e.g. in-process adapter, local process protocol).",
  moduleStatus:
    "Availability of the policy module when the description was produced (ready or unavailable).",
  note: "A control-stripped human note (e.g. a send failure reason).",
  odrlAction:
    "The ODRL action short-name the outbound intent performs (literal \u2208 ODRL_ACTIONS).",
  offer: "The identified offer message.",
  offeror: "Software actor that made the offer.",
  operation: "The operation concerned.",
  operationVersion: "Version of the referenced operation definition.",
  operator: "Who runs the software.",
  organisation: "Organisation label associated with an account.",
  outcome: "The outcome recorded on a receipt (sent / rejected / failed).",
  parameters: "Consequential action parameters as bounded canonical JSON.",
  perDay: "Maximum transmissions per day.",
  perRecipient: "Maximum transmissions to one recipient in the applicable limit window.",
  policyDigest: "Digest of the grant or policy as evaluated.",
  policyModule: "The policy module an implementation description declares as selected.",
  policyProfile: "The policy profile a policy module evaluates.",
  previousHash: "Entry hash of the preceding entry, or sha-256:genesis.",
  proof: "Agent record field proof.",
  proposalStatus: "The proposal's lifecycle status (predicate).",
  protectedObjectDigest: "Digest of the exact protected bytes examined.",
  provider: "Identifier of the service provider for a channel account.",
  rateLimit: "Owner-imposed rate limits for the binding.",
  rawByteLength: "Byte count of the original inbound channel message.",
  rawSha256: "Digest of the original inbound channel bytes.",
  read: "Whether account ingestion may read; false by default.",
  reasonCode: "Stable reason code; explains an outcome, grants nothing.",
  recipientHash: "Salted hash of the recipient, bound to the exact action terms.",
  recordType: "The runtime record type name (for records without a detailed mapping).",
  recordsStatement: "The record (or identified thing) an entry carries.",
  refersToProposal: "Ordered references from a conversation turn to the proposals it discusses.",
  renderedPreview: "Exact rendered preview associated with the proposal.",
  representedParty: "The party the actor claims to speak for.",
  requestedAction: "An odrl:Action instance (e.g. odrl:use) naming the action class requested.",
  restrictions: "Default-deny per-account read, triage, draft and send restrictions.",
  role: "Conversation-turn role: owner or agent.",
  send: "Whether account sends may be considered by the executor; false by default and never proof of authorization.",
  sendSupported: "Whether the binding implements sending; not an authorization to send.",
  sequence: "Position of an entry in its ledger (xsd:integer).",
  source: "The source whose authority was assessed.",
  sourceRule: "The local source-authority rule applied.",
  sourceRuleVersion: "Version of that rule.",
  spend: "The declared spend for the action (xsd:integer; the ODRL count constraint input).",
  state: "Proposal lifecycle state: proposed, approved, denied, expired, sent or failed.",
  statement: "The representation statement relied on.",
  status: "Transmission state: attempting, sent, not-sent, uncertain or refused.",
  structuredPart:
    "Ordered extracted structured data, represented as a sequence of rdf:JSON literals.",
  structuredPayload: "Whether a binding can carry a structured agent envelope.",
  supportsBinding: "Capability descriptor supported by an agent card.",
  supportsOperation: "An operation the agent supports.",
  target: "Target operation or resource of the action.",
  termsDigest: "JCS/SHA-256 digest of the exact terms.",
  triage: "Whether account messages may be triaged; false by default.",
  underApproval: "Approval that the executor evaluated for this transmission.",
  underMandate:
    "Links an autonomous action to the signed mandate that authorized it (prov:hadPlan-adjacent).",
  validFrom: "Beginning of mandate credential validity.",
  validUntil: "End of validity (exclusive), xsd:dateTime.",
  "verification/invalid":
    "invalid value in the verification concept scheme; an evidence classification, not a grant.",
  "verification/not-applicable":
    "not-applicable value in the verification concept scheme; an evidence classification, not a grant.",
  "verification/unknown-key":
    "unknown-key value in the verification concept scheme; an evidence classification, not a grant.",
  "verification/unsupported":
    "unsupported value in the verification concept scheme; an evidence classification, not a grant.",
  "verification/valid":
    "valid value in the verification concept scheme; an evidence classification, not a grant.",
  verificationMaterial: "Pinned key thumbprint (RFC 7638) used.",
  verificationOutcome: "A concept from agent:VerificationOutcomes.",
  wireDigest: "Digest of the exact rendered channel bytes.",
  wireFormat: "Protection format of a signed message envelope.",
  withApproval: "Policy set requiring a matching verified owner approval.",
} as const;
export type AgentTerm = keyof typeof TERM_DEFINITIONS;
/** Resolve a registered term; refuse accidental vocabulary expansion. */
export function agent(term: string): string {
  if (!Object.hasOwn(TERM_DEFINITIONS, term)) throw new Error(`unregistered agent term ${term}`);
  return `${AGENT}${term}`;
}
/** One symbol mapping for the two imported namespaces (no legacy IRI aliases). */
export const VOCAB_MAPPING = Object.freeze(
  Object.fromEntries([
    ...Object.keys(TERM_DEFINITIONS).flatMap((name) => [
      [`AWP.${name}`, agent(name)],
      [`AGENTIC.${name}`, agent(name)],
    ]),
    ["AGENTIC.RawInboundMessage", agent("InboundMessage")],
  ]),
);
export const AGENTIC = AGENT;
export const RDF_TYPE = `${RDF}type`;
export const XSD_DATE_TIME = `${XSD}dateTime`;
export const XSD_STRING = `${XSD}string`;
export const XSD_BOOLEAN = `${XSD}boolean`;
export const PROV_ENTITY = `${PROV}Entity`;
export const PROV_WAS_DERIVED_FROM = `${PROV}wasDerivedFrom`;
export const PROV_WAS_ATTRIBUTED_TO = `${PROV}wasAttributedTo`;
export const PROV_WAS_ASSOCIATED_WITH = `${PROV}wasAssociatedWith`;
export const PROV_HAD_PLAN = `${PROV}hadPlan`;
export const PROV_GENERATED_AT_TIME = `${PROV}generatedAtTime`;
export const AGENTIC_CHANNEL = `${AGENT}channel`;
export const AGENTIC_IN_REPLY_TO = `${AGENT}inReplyTo`;
export const SCHEMA_START_TIME = `${SCHEMA}startTime`;
export const SCHEMA_END_TIME = `${SCHEMA}endTime`;
export const SCHEMA_NAME = `${SCHEMA}name`;
/** `schema:recipient` — the outbound recipient hash (reused, not minted). */
export const SCHEMA_RECIPIENT = "https://schema.org/recipient";
/** `schema:text` — the human prose body of the outbound message (reused). */
export const SCHEMA_TEXT = "https://schema.org/text";
/** `dct:subject` — the outbound subject line (reused). */
export const DCT_SUBJECT = "http://purl.org/dc/terms/subject";

/** The minted proposal-record type. */
export const AGENTIC_ACTION_PROPOSAL = `${AGENT}ActionProposal`;
/** Reliability gate requires owner confirmation even under an autonomous-send mandate. */
export const AGENTIC_CONFIRMATION_REQUIRED = `${AGENT}confirmationRequired`;
/** The proposal's lifecycle status (predicate). */
export const AGENTIC_PROPOSAL_STATUS = `${AGENT}proposalStatus`;
/** Status individuals — a proposal is NEVER sent until it reaches `Confirmed`. */
export const AGENTIC_PROPOSAL_PENDING = `${AGENT}ProposalPending`;
export const AGENTIC_PROPOSAL_CONFIRMED = `${AGENT}ProposalConfirmed`;
export const AGENTIC_PROPOSAL_EXECUTED = `${AGENT}ProposalExecuted`;
export const AGENTIC_PROPOSAL_FAILED = `${AGENT}ProposalFailed`;
export const AGENTIC_PROPOSAL_REJECTED = `${AGENT}ProposalRejected`;
/** The graduated-confirm friction level (predicate). */
export const AGENTIC_CONFIRM_FRICTION = `${AGENT}confirmFriction`;
/** Friction individuals (§7 graduated confirmation). */
export const AGENTIC_LOW_FRICTION = `${AGENT}LowFriction`;
export const AGENTIC_HIGH_FRICTION = `${AGENT}HighFriction`;
/** When the proposal was confirmed / executed (`xsd:dateTime`). */
export const AGENTIC_CONFIRMED_AT = `${AGENT}confirmedAt`;
export const AGENTIC_EXECUTED_AT = `${AGENT}executedAt`;
/** A control-stripped human note (e.g. a send failure reason). */
export const AGENTIC_NOTE = `${AGENT}note`;
/** The outbox SEND RECEIPT type (a PROV entity the executor writes post-send). */
export const AGENTIC_SEND_RECEIPT = `${AGENT}SendReceipt`;
/** Links a receipt to the proposal it executed. */
export const AGENTIC_EXECUTED_PROPOSAL = `${AGENT}executedProposal`;
/** The channel's own id for the transmitted message (recorded on the receipt). */
export const AGENTIC_CHANNEL_MESSAGE_ID = `${AGENT}channelMessageId`;

// --- The OWNER-ONLY confirmation record (the unforgeable human-confirm gate). ---

/** The confirmation-record type (owner-only; the Actor cannot write these). */
export const AGENTIC_CONFIRMATION = `${AGENT}Confirmation`;
/** The proposal id the confirmation authorizes. */
export const AGENTIC_CONFIRMS_PROPOSAL = `${AGENT}confirmsProposal`;
/** The `sha256:<hex>` content digest the confirmation is bound to (content-locks the approval). */
export const AGENTIC_CONTENT_DIGEST = `${AGENT}contentDigest`;

// --- Receipt outcome flags. ---

/** The outcome recorded on a receipt (`sent` / `rejected` / `failed`). */
export const AGENTIC_OUTCOME = `${AGENT}outcome`;
/** Links an autonomous action to the signed mandate that authorized it (`prov:hadPlan`-adjacent). */
export const AGENTIC_UNDER_MANDATE = `${AGENT}underMandate`;
/** Links an autonomous action to the specific ODRL permit rule that authorized it. */
export const AGENTIC_AUTHORIZED_BY_PERMIT = `${AGENT}authorizedByPermit`;
/** Records that an action's authorizing basis was an explicit human confirmation. */
export const AGENTIC_AUTHORIZED_BY_CONFIRMATION = `${AGENT}authorizedByConfirmation`;

// --- The ODRL-intent descriptor a proposal carries, so the outbox executor can
// --- evaluate it against the owner's signed ODRL mandate (dogfooding @jeswr/solid-odrl). ---

/** The ODRL action short-name the outbound intent performs (literal ∈ ODRL_ACTIONS). */
export const AGENTIC_ODRL_ACTION = `${AGENT}odrlAction`;
/** The declared spend for the action (`xsd:integer`; the ODRL `count` constraint input). */
export const AGENTIC_SPEND = `${AGENT}spend`;
export const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";

/** DPV — reused for the purpose the action is performed for (`dpv:hasPurpose`). */

export const DPV_HAS_PURPOSE = `${DPV}hasPurpose`;

/** Agentic purpose individuals (the constrainable `purpose` left-operand values). */
export const AGENTIC_PURPOSE_SCHEDULING = `${AGENT}SchedulingResponse`;
export const AGENTIC_PURPOSE_ACKNOWLEDGEMENT = `${AGENT}Acknowledgement`;
export const AGENTIC_PURPOSE_GENERAL = `${AGENT}GeneralCommunication`;
