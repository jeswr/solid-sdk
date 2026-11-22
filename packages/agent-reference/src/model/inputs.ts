// AUTHORED-BY Codex GPT-6
/** Construction and persistence data only. Gates receive each wrapper's live facade. */
import type {
  AudienceRef,
  Basis,
  ContentPart,
  Iri,
  JsonObject,
  MessageKind,
  OperationRef,
  OutcomeConclusion,
  ParticipantRef,
  ReasonCode,
} from "../core/types.js";

export type {
  AudienceRef,
  Basis,
  ContentPart,
  Iri,
  JsonObject,
  MessageKind,
  OperationRef,
  OutcomeConclusion,
  ParticipantRef,
  ReasonCode,
} from "../core/types.js";

export interface EvidenceItem {
  /** What the item is offered as. The receiver decides what it establishes. */
  readonly role:
    | "representation"
    | "approval"
    | "credential"
    | "grant"
    | "membership"
    | "authorisation";
  /** The protection format (a mechanism profile identifier, e.g. `jws-compact`). */
  readonly format: string;
  /** The protected statement itself. */
  readonly value: string;
}

export interface DescribeBody {
  readonly want?: readonly string[];
}

export interface DescriptionBody {
  readonly description: JsonObject;
}

export interface ProposeBody {
  readonly operation: OperationRef;
  readonly terms: JsonObject;
  /** Digest of `terms`; must match (content identity of the offer). */
  readonly termsDigest: string;
  /** 1 for an opening offer; incremented by each counter-proposal. */
  readonly round: number;
  /** The proposal this one counters, if any. */
  readonly counters?: Iri;
}

export interface AcceptBody {
  readonly proposal: Iri;
  readonly termsDigest: string;
  /** The option chosen where the offer permitted a choice. */
  readonly selection?: JsonObject;
  /** Deterministic agreement id (both sides compute and compare it). */
  readonly agreement: Iri;
}

export interface ChallengeBody {
  readonly ref: Iri;
  readonly reason: ReasonCode;
  readonly detail?: string;
  /** A stronger approval or replacement claim requested by the gate, with a bound retry. */
  readonly needs: {
    readonly id: Iri;
    readonly nonce: Iri;
    readonly expiresAt: string;
  } & ({ readonly approval: Iri; readonly label: string } | { readonly claim: string });
}

export interface RefuseBody {
  readonly ref: Iri;
  readonly reason: ReasonCode;
  readonly detail?: string;
}

export interface InvokeBody {
  readonly challenge?: { readonly id: Iri; readonly nonce: Iri };
  readonly operation: OperationRef;
  readonly input: JsonObject;
  readonly basis: Basis;
  readonly purpose?: Iri;
}

export interface DeliverBody {
  readonly ref: Iri;
  readonly basis: Basis;
  readonly operation: OperationRef;
  readonly output: JsonObject;
}

export interface ReceiptBody {
  readonly ref: Iri;
  readonly activity: Iri;
  readonly outcome: OutcomeConclusion;
  readonly observed?: JsonObject;
  /** True if this is the reporter's final receipt for `ref`. */
  readonly final?: boolean;
}

export interface UnsupportedBody {
  readonly ref: Iri;
  readonly reason: ReasonCode;
  readonly detail?: string;
}

export interface IndeterminateBody {
  readonly ref: Iri;
  readonly reason: ReasonCode;
  readonly detail?: string;
}

export interface BodyByKind {
  describe: DescribeBody;
  description: DescriptionBody;
  propose: ProposeBody;
  accept: AcceptBody;
  refuse: RefuseBody;
  challenge: ChallengeBody;
  invoke: InvokeBody;
  deliver: DeliverBody;
  receipt: ReceiptBody;
  unsupported: UnsupportedBody;
  indeterminate: IndeterminateBody;
}

export interface Message<K extends MessageKind = MessageKind> {
  readonly profile: string;
  readonly configuration: string;
  readonly id: Iri;
  readonly conversation: Iri;
  readonly kind: K;
  readonly from: ParticipantRef;
  readonly to?: AudienceRef;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly inReplyTo?: Iri;
  readonly authorship?: { readonly method: "model-output"; readonly onBehalfOf: Iri };
  readonly body: BodyByKind[K];
  readonly evidence?: readonly EvidenceItem[];
  readonly content?: readonly ContentPart[];
}

export interface ActionIntent {
  /** Identity of the concrete action: digest over everything below. */
  readonly operation: Iri;
  /** The ODRL-level action class (e.g. `use`, `distribute`, `compensate`, `read`). */
  readonly action: string;
  /** Target asset/operation/resource. */
  readonly target: Iri;
  readonly purpose?: Iri;
  /** The party that receives the effect or data. */
  readonly recipient?: Iri;
  /** Consequential parameters (exact terms digest, amounts, fields). */
  readonly parameters: JsonObject;
  readonly conversation: Iri;
}

export interface Agreement {
  readonly type: "agreement";
  readonly id: Iri;
  readonly conversation: Iri;
  readonly operation: OperationRef;
  readonly offer: Iri;
  readonly acceptance: Iri;
  readonly termsDigest: string;
  readonly terms: JsonObject;
  readonly selection?: JsonObject;
  readonly offeror: ParticipantRef;
  readonly acceptor: ParticipantRef;
  readonly formedAt: string;
}

export type AnyMessage = { [K in MessageKind]: Message<K> }[MessageKind];
