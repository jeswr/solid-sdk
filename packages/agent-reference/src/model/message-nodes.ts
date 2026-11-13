// AUTHORED-BY Codex GPT-6
import "./evidence-item.js";
/** Complete core object facades over live RDF datasets. Full admission diagnostics are generated. */
import type { Term } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import type {
  AcceptBody,
  ActionIntent,
  Agreement,
  AnyMessage,
  AudienceRef,
  Basis,
  BodyByKind,
  ChallengeBody,
  ContentPart,
  DeliverBody,
  DescribeBody,
  DescriptionBody,
  EvidenceItem,
  IndeterminateBody,
  InvokeBody,
  Message,
  MessageKind,
  OperationRef,
  ParticipantRef,
  ProposeBody,
  ReceiptBody,
  RefuseBody,
  UnsupportedBody,
} from "../core/types.js";
import { MESSAGE_KINDS, REASON_CODES } from "../core/types.js";
import { entities as generatedEntities } from "../generated/model.js";
import { AWP } from "../profile/vocabulary.js";
import { CoreNode, type ModelSpec, makeNode, registerModel } from "./core-node.js";
import type { EvidenceItemNode } from "./evidence-item.js";
import type { NamedValuesNode } from "./named-values.js";
import { MessageNode as EnvelopeMessageNode } from "./nodes.js";

type InvokeChallenge = NonNullable<InvokeBody["challenge"]>;
type ChallengeNeeds = ChallengeBody["needs"];
type MessageAuthorship = NonNullable<Message["authorship"]>;

export const participantRefSpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#ParticipantRef",
  fields: {
    actor: {
      term: "https://w3id.org/jeswr/awp#actor",
      kind: "iri",
      optional: true,
    },
    onBehalfOf: {
      term: "http://www.w3.org/ns/prov#actedOnBehalfOf",
      kind: "iri",
      optional: true,
    },
    operator: {
      term: "https://w3id.org/jeswr/awp#operator",
      kind: "iri",
      optional: true,
    },
  },
};

export const audienceRefSpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#AudienceRef",
  fields: {
    actor: {
      term: "https://w3id.org/jeswr/awp#actor",
      kind: "iri",
    },
    party: {
      term: "https://w3id.org/jeswr/awp#party",
      kind: "iri",
      optional: true,
    },
  },
};

export const operationRefSpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#OperationRef",
  fields: {
    id: {
      term: "@id",
      kind: "id",
    },
    version: {
      term: "https://w3id.org/jeswr/awp#version",
      kind: "text",
    },
  },
};

export const basisSpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#RequestBasis",
  fields: {
    kind: {
      term: "https://w3id.org/jeswr/awp#basisKind",
      kind: "enum",
      values: ["agreement", "public", "represented", "grant", "invocation"],
      prefix: "https://w3id.org/jeswr/awp#basis/",
    },
    agreement: {
      term: "https://w3id.org/jeswr/awp#agreement",
      kind: "iri",
      optional: true,
    },
    grant: {
      term: "https://w3id.org/jeswr/awp#grant",
      kind: "iri",
      optional: true,
    },
    invocation: {
      term: "https://w3id.org/jeswr/awp#invocation",
      kind: "iri",
      optional: true,
    },
  },
};

export const invokeChallengeSpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#InvokeBodyChallenge",
  fields: {
    id: {
      term: "@id",
      kind: "id",
    },
    nonce: {
      term: "https://w3id.org/jeswr/awp#nonce",
      kind: "iri",
    },
  },
};

export const challengeNeedsSpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#ChallengeNeeds",
  fields: {
    id: {
      term: "@id",
      kind: "id",
    },
    nonce: {
      term: "https://w3id.org/jeswr/awp#nonce",
      kind: "iri",
    },
    expiresAt: {
      term: "https://w3id.org/jeswr/awp#expiresAt",
      kind: "time",
    },
    approval: {
      term: "https://w3id.org/jeswr/awp#approval",
      kind: "iri",
      optional: true,
    },
    label: {
      term: "http://www.w3.org/2000/01/rdf-schema#label",
      kind: "text",
      optional: true,
    },
    claim: {
      term: "https://w3id.org/jeswr/awp#claimType",
      kind: "text",
      optional: true,
    },
  },
};

export const messageAuthorshipSpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#MessageAuthorship",
  fields: {
    method: {
      term: "https://w3id.org/jeswr/awp#method",
      kind: "text",
    },
    onBehalfOf: {
      term: "http://www.w3.org/ns/prov#actedOnBehalfOf",
      kind: "iri",
    },
  },
};

export const contentPartSpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#ContentPart",
  fields: {
    id: {
      term: "@id",
      kind: "id",
    },
    mediaType: {
      term: "https://schema.org/encodingFormat",
      kind: "text",
    },
    digest: {
      term: "https://w3id.org/jeswr/awp#digest",
      kind: "text",
    },
    bytes: {
      term: "https://w3id.org/jeswr/awp#bytes",
      kind: "value",
    },
  },
};

export const describeBodySpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#DescribeBody",
  fields: {
    want: {
      term: "https://w3id.org/jeswr/awp#want",
      kind: "strings",
      optional: true,
    },
  },
};

export const descriptionBodySpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#DescriptionBody",
  fields: {
    description: {
      term: "https://w3id.org/jeswr/awp#description",
      kind: "open",
    },
  },
};

export const proposeBodySpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#ProposeBody",
  fields: {
    operation: {
      term: "https://w3id.org/jeswr/awp#operation",
      kind: "node",
      model: "OperationRef",
    },
    terms: {
      term: "https://w3id.org/jeswr/awp#terms",
      kind: "open",
    },
    termsDigest: {
      term: "https://w3id.org/jeswr/awp#termsDigest",
      kind: "text",
    },
    round: {
      term: "https://w3id.org/jeswr/awp#round",
      kind: "integer",
    },
    counters: {
      term: "https://w3id.org/jeswr/awp#counters",
      kind: "iri",
      optional: true,
    },
  },
};

export const acceptBodySpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#AcceptBody",
  fields: {
    proposal: {
      term: "https://w3id.org/jeswr/awp#proposal",
      kind: "iri",
    },
    termsDigest: {
      term: "https://w3id.org/jeswr/awp#termsDigest",
      kind: "text",
    },
    selection: {
      term: "https://w3id.org/jeswr/awp#selection",
      kind: "open",
      optional: true,
    },
    agreement: {
      term: "https://w3id.org/jeswr/awp#agreement",
      kind: "iri",
    },
  },
};

export const challengeBodySpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#ChallengeBody",
  fields: {
    ref: {
      term: "https://w3id.org/jeswr/awp#ref",
      kind: "iri",
    },
    reason: {
      term: "https://w3id.org/jeswr/awp#reason",
      kind: "enum",
      values: REASON_CODES,
      prefix: "https://w3id.org/jeswr/awp#reason/",
    },
    detail: {
      term: "https://w3id.org/jeswr/awp#detail",
      kind: "text",
      optional: true,
    },
    needs: {
      term: "https://w3id.org/jeswr/awp#needs",
      kind: "node",
      model: "ChallengeNeeds",
    },
  },
};

export const invokeBodySpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#InvokeBody",
  fields: {
    challenge: {
      term: "https://w3id.org/jeswr/awp#challenge",
      kind: "node",
      optional: true,
      model: "InvokeChallenge",
    },
    operation: {
      term: "https://w3id.org/jeswr/awp#operation",
      kind: "node",
      model: "OperationRef",
    },
    input: {
      term: "https://w3id.org/jeswr/awp#input",
      kind: "open",
    },
    basis: {
      term: "https://w3id.org/jeswr/awp#basis",
      kind: "node",
      model: "Basis",
    },
    purpose: {
      term: "https://w3id.org/dpv#hasPurpose",
      kind: "iri",
      optional: true,
    },
  },
};

export const deliverBodySpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#DeliverBody",
  fields: {
    ref: {
      term: "https://w3id.org/jeswr/awp#ref",
      kind: "iri",
    },
    basis: {
      term: "https://w3id.org/jeswr/awp#basis",
      kind: "node",
      model: "Basis",
    },
    operation: {
      term: "https://w3id.org/jeswr/awp#operation",
      kind: "node",
      model: "OperationRef",
    },
    output: {
      term: "https://w3id.org/jeswr/awp#output",
      kind: "open",
    },
  },
};

export const receiptBodySpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#ReceiptBody",
  fields: {
    ref: {
      term: "https://w3id.org/jeswr/awp#ref",
      kind: "iri",
    },
    activity: {
      term: "https://w3id.org/jeswr/awp#activity",
      kind: "iri",
    },
    outcome: {
      term: "https://w3id.org/jeswr/awp#outcome",
      kind: "enum",
      values: ["completed", "not-executed", "uncertain"],
      prefix: "https://w3id.org/jeswr/awp#outcome/",
    },
    observed: {
      term: "https://w3id.org/jeswr/awp#observed",
      kind: "open",
      optional: true,
    },
    final: {
      term: "https://w3id.org/jeswr/awp#final",
      kind: "boolean",
      optional: true,
    },
  },
};

export const actionIntentSpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#ActionIntent",
  fields: {
    evidence: { term: AWP + "evidence", kind: "nodes", optional: true, model: "IntentEvidenceRef" },
    operation: {
      term: "https://w3id.org/jeswr/awp#operation",
      kind: "iri",
    },
    action: {
      term: "http://www.w3.org/ns/odrl/2/action",
      kind: "text",
    },
    target: {
      term: "http://www.w3.org/ns/odrl/2/target",
      kind: "iri",
    },
    purpose: {
      term: "https://w3id.org/dpv#hasPurpose",
      kind: "iri",
      optional: true,
    },
    recipient: {
      term: "https://w3id.org/jeswr/awp#recipient",
      kind: "iri",
      optional: true,
    },
    parameters: {
      term: "https://w3id.org/jeswr/awp#parameters",
      kind: "open",
    },
    conversation: {
      term: "https://w3id.org/jeswr/awp#conversation",
      kind: "iri",
    },
  },
};

export const agreementSpec: ModelSpec = {
  type: "http://www.w3.org/ns/odrl/2/Agreement",
  fields: {
    type: {
      term: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      kind: "constant",
      constant: "agreement",
    },
    id: {
      term: "@id",
      kind: "id",
    },
    conversation: {
      term: "https://w3id.org/jeswr/awp#conversation",
      kind: "iri",
    },
    operation: {
      term: "https://w3id.org/jeswr/awp#operation",
      kind: "node",
      model: "OperationRef",
    },
    offer: {
      term: "https://w3id.org/jeswr/awp#offer",
      kind: "iri",
    },
    acceptance: {
      term: "https://w3id.org/jeswr/awp#acceptance",
      kind: "iri",
    },
    termsDigest: {
      term: "https://w3id.org/jeswr/awp#termsDigest",
      kind: "text",
    },
    terms: {
      term: "https://w3id.org/jeswr/awp#terms",
      kind: "open",
    },
    selection: {
      term: "https://w3id.org/jeswr/awp#selection",
      kind: "open",
      optional: true,
    },
    offeror: {
      term: "https://w3id.org/jeswr/awp#offeror",
      kind: "node",
      model: "ParticipantRef",
    },
    acceptor: {
      term: "https://w3id.org/jeswr/awp#acceptor",
      kind: "node",
      model: "ParticipantRef",
    },
    formedAt: {
      term: "https://w3id.org/jeswr/awp#formedAt",
      kind: "time",
    },
  },
};

export const messageSpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#Message",
  fields: {
    profile: {
      term: "https://w3id.org/jeswr/awp#profile",
      kind: "iri",
    },
    configuration: {
      term: "https://w3id.org/jeswr/awp#configuration",
      kind: "iri",
    },
    id: {
      term: "@id",
      kind: "id",
    },
    conversation: {
      term: "https://w3id.org/jeswr/awp#conversation",
      kind: "iri",
    },
    kind: {
      term: "https://w3id.org/jeswr/awp#kind",
      kind: "enum",
      values: MESSAGE_KINDS,
      prefix: "https://w3id.org/jeswr/awp#kind/",
    },
    from: {
      term: "https://w3id.org/jeswr/awp#from",
      kind: "node",
      model: "ParticipantRef",
    },
    to: {
      term: "https://w3id.org/jeswr/awp#to",
      kind: "node",
      optional: true,
      model: "AudienceRef",
    },
    createdAt: {
      term: "https://w3id.org/jeswr/awp#createdAt",
      kind: "time",
    },
    expiresAt: {
      term: "https://w3id.org/jeswr/awp#expiresAt",
      kind: "time",
    },
    inReplyTo: {
      term: "https://w3id.org/jeswr/awp#inReplyTo",
      kind: "iri",
      optional: true,
    },
    authorship: {
      term: "https://w3id.org/jeswr/awp#authorship",
      kind: "node",
      optional: true,
      model: "MessageAuthorship",
    },
    body: {
      term: "https://w3id.org/jeswr/awp#body",
      kind: "node",
      model: "$body",
    },
    evidence: {
      term: "https://w3id.org/jeswr/awp#evidence",
      kind: "nodes",
      optional: true,
      model: "EvidenceItem",
    },
    content: {
      term: "https://w3id.org/jeswr/awp#content",
      kind: "nodes",
      optional: true,
      model: "ContentPart",
    },
  },
};

export const refuseBodySpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#RefuseBody",
  fields: {
    ref: {
      term: "https://w3id.org/jeswr/awp#ref",
      kind: "iri",
    },
    reason: {
      term: "https://w3id.org/jeswr/awp#reason",
      kind: "enum",
      values: REASON_CODES,
      prefix: "https://w3id.org/jeswr/awp#reason/",
    },
    detail: {
      term: "https://w3id.org/jeswr/awp#detail",
      kind: "text",
      optional: true,
    },
  },
};

export const unsupportedBodySpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#UnsupportedBody",
  fields: {
    ref: {
      term: "https://w3id.org/jeswr/awp#ref",
      kind: "iri",
    },
    reason: {
      term: "https://w3id.org/jeswr/awp#reason",
      kind: "enum",
      values: REASON_CODES,
      prefix: "https://w3id.org/jeswr/awp#reason/",
    },
    detail: {
      term: "https://w3id.org/jeswr/awp#detail",
      kind: "text",
      optional: true,
    },
  },
};

export const indeterminateBodySpec: ModelSpec = {
  type: "https://w3id.org/jeswr/awp#IndeterminateBody",
  fields: {
    ref: {
      term: "https://w3id.org/jeswr/awp#ref",
      kind: "iri",
    },
    reason: {
      term: "https://w3id.org/jeswr/awp#reason",
      kind: "enum",
      values: REASON_CODES,
      prefix: "https://w3id.org/jeswr/awp#reason/",
    },
    detail: {
      term: "https://w3id.org/jeswr/awp#detail",
      kind: "text",
      optional: true,
    },
  },
};

export class ParticipantRefNode extends CoreNode<ParticipantRef> {
  readonly modelName = "ParticipantRef";
  get actor(): ParticipantRef["actor"] {
    return this.getField("actor") as ParticipantRef["actor"];
  }
  set actor(value: ParticipantRef["actor"]) {
    this.setField("actor", value);
  }
  get onBehalfOf(): ParticipantRef["onBehalfOf"] {
    return this.getField("onBehalfOf") as ParticipantRef["onBehalfOf"];
  }
  set onBehalfOf(value: ParticipantRef["onBehalfOf"]) {
    this.setField("onBehalfOf", value);
  }
  get operator(): ParticipantRef["operator"] {
    return this.getField("operator") as ParticipantRef["operator"];
  }
  set operator(value: ParticipantRef["operator"]) {
    this.setField("operator", value);
  }
  static toNode(object: ParticipantRef, id?: string, dataset?: Store): ParticipantRefNode {
    const node = makeNode("ParticipantRef", object, id, dataset) as ParticipantRefNode;
    return node;
  }
  static fromNode(node: ParticipantRefNode): ParticipantRef {
    return node.toObject();
  }
}

export class AudienceRefNode extends CoreNode<AudienceRef> {
  readonly modelName = "AudienceRef";
  get actor(): AudienceRef["actor"] {
    return this.getField("actor") as AudienceRef["actor"];
  }
  set actor(value: AudienceRef["actor"]) {
    this.setField("actor", value);
  }
  get party(): AudienceRef["party"] {
    return this.getField("party") as AudienceRef["party"];
  }
  set party(value: AudienceRef["party"]) {
    this.setField("party", value);
  }
  static toNode(object: AudienceRef, id?: string, dataset?: Store): AudienceRefNode {
    const node = makeNode("AudienceRef", object, id, dataset) as AudienceRefNode;
    return node;
  }
  static fromNode(node: AudienceRefNode): AudienceRef {
    return node.toObject();
  }
}

export class OperationRefNode extends CoreNode<OperationRef> {
  readonly modelName = "OperationRef";
  get version(): OperationRef["version"] {
    return this.getField("version") as OperationRef["version"];
  }
  set version(value: OperationRef["version"]) {
    this.setField("version", value);
  }
  static toNode(object: OperationRef, id?: string, dataset?: Store): OperationRefNode {
    const node = makeNode("OperationRef", object, id, dataset) as OperationRefNode;
    return node;
  }
  static fromNode(node: OperationRefNode): OperationRef {
    return node.toObject();
  }
}

export class BasisNode extends CoreNode<Basis> {
  readonly modelName = "Basis";
  get kind(): Basis["kind"] {
    return this.getField("kind") as Basis["kind"];
  }
  set kind(value: Basis["kind"]) {
    this.setField("kind", value);
  }
  get agreement(): string | undefined {
    return this.getField("agreement") as string | undefined;
  }
  set agreement(value: string | undefined) {
    this.setField("agreement", value);
  }
  get grant(): string | undefined {
    return this.getField("grant") as string | undefined;
  }
  set grant(value: string | undefined) {
    this.setField("grant", value);
  }
  get invocation(): string | undefined {
    return this.getField("invocation") as string | undefined;
  }
  set invocation(value: string | undefined) {
    this.setField("invocation", value);
  }
  static toNode(object: Basis, id?: string, dataset?: Store): BasisNode {
    const node = makeNode("Basis", object, id, dataset) as BasisNode;
    return node;
  }
  static fromNode(node: BasisNode): Basis {
    return node.toObject();
  }
}

export class InvokeChallengeNode extends CoreNode<InvokeChallenge> {
  /** Thin facade over an admitted generated component; the aggregate graph remains rejected. */
  override getField(name: string): unknown {
    const view = new generatedEntities.InvokeBodyChallenge.Wrapper(
      this.id,
      this.dataset,
      DataFactory,
    );
    if (name === "nonce") {
      const value = view.nonce;
      if (value === undefined) throw new TypeError("Missing nonce");
      return value;
    }
    return super.getField(name);
  }
  override setField(name: string, value: unknown): void {
    const view = new generatedEntities.InvokeBodyChallenge.Wrapper(
      this.id,
      this.dataset,
      DataFactory,
    );
    if (name === "nonce") {
      view.nonce = value as string;
      return;
    }
    super.setField(name, value);
  }

  readonly modelName = "InvokeChallenge";
  get nonce(): InvokeChallenge["nonce"] {
    return this.getField("nonce") as InvokeChallenge["nonce"];
  }
  set nonce(value: InvokeChallenge["nonce"]) {
    this.setField("nonce", value);
  }
  static toNode(object: InvokeChallenge, id?: string, dataset?: Store): InvokeChallengeNode {
    const node = makeNode("InvokeChallenge", object, id, dataset) as InvokeChallengeNode;
    return node;
  }
  static fromNode(node: InvokeChallengeNode): InvokeChallenge {
    return node.toObject();
  }
}

export class ChallengeNeedsNode extends CoreNode<ChallengeNeeds> {
  readonly modelName = "ChallengeNeeds";
  get nonce(): ChallengeNeeds["nonce"] {
    return this.getField("nonce") as ChallengeNeeds["nonce"];
  }
  set nonce(value: ChallengeNeeds["nonce"]) {
    this.setField("nonce", value);
  }
  get expiresAt(): ChallengeNeeds["expiresAt"] {
    return this.getField("expiresAt") as ChallengeNeeds["expiresAt"];
  }
  set expiresAt(value: ChallengeNeeds["expiresAt"]) {
    this.setField("expiresAt", value);
  }
  get approval(): string | undefined {
    return this.getField("approval") as string | undefined;
  }
  set approval(value: string | undefined) {
    this.setField("approval", value);
  }
  get label(): string | undefined {
    return this.getField("label") as string | undefined;
  }
  set label(value: string | undefined) {
    this.setField("label", value);
  }
  get claim(): string | undefined {
    return this.getField("claim") as string | undefined;
  }
  set claim(value: string | undefined) {
    this.setField("claim", value);
  }
  static toNode(object: ChallengeNeeds, id?: string, dataset?: Store): ChallengeNeedsNode {
    const node = makeNode("ChallengeNeeds", object, id, dataset) as ChallengeNeedsNode;
    return node;
  }
  static fromNode(node: ChallengeNeedsNode): ChallengeNeeds {
    return node.toObject();
  }
}

export class MessageAuthorshipNode extends CoreNode<MessageAuthorship> {
  /** Thin facade over an admitted generated component; the aggregate graph remains rejected. */
  override getField(name: string): unknown {
    const view = new generatedEntities.MessageAuthorship.Wrapper(
      this.id,
      this.dataset,
      DataFactory,
    );
    if (name === "method") {
      const value = view.method;
      if (value === undefined) throw new TypeError("Missing method");
      return value;
    }
    if (name === "onBehalfOf") {
      const value = view.onBehalfOf;
      if (value === undefined) throw new TypeError("Missing onBehalfOf");
      return value;
    }
    return super.getField(name);
  }
  override setField(name: string, value: unknown): void {
    const view = new generatedEntities.MessageAuthorship.Wrapper(
      this.id,
      this.dataset,
      DataFactory,
    );
    if (name === "method") {
      view.method = value as MessageAuthorship["method"];
      return;
    }
    if (name === "onBehalfOf") {
      view.onBehalfOf = value as string;
      return;
    }
    super.setField(name, value);
  }

  readonly modelName = "MessageAuthorship";
  get method(): MessageAuthorship["method"] {
    return this.getField("method") as MessageAuthorship["method"];
  }
  set method(value: MessageAuthorship["method"]) {
    this.setField("method", value);
  }
  get onBehalfOf(): MessageAuthorship["onBehalfOf"] {
    return this.getField("onBehalfOf") as MessageAuthorship["onBehalfOf"];
  }
  set onBehalfOf(value: MessageAuthorship["onBehalfOf"]) {
    this.setField("onBehalfOf", value);
  }
  static toNode(object: MessageAuthorship, id?: string, dataset?: Store): MessageAuthorshipNode {
    const node = makeNode("MessageAuthorship", object, id, dataset) as MessageAuthorshipNode;
    return node;
  }
  static fromNode(node: MessageAuthorshipNode): MessageAuthorship {
    return node.toObject();
  }
}

export class ContentPartNode extends CoreNode<ContentPart> {
  readonly modelName = "ContentPart";
  get mediaType(): ContentPart["mediaType"] {
    return this.getField("mediaType") as ContentPart["mediaType"];
  }
  set mediaType(value: ContentPart["mediaType"]) {
    this.setField("mediaType", value);
  }
  get digest(): ContentPart["digest"] {
    return this.getField("digest") as ContentPart["digest"];
  }
  set digest(value: ContentPart["digest"]) {
    this.setField("digest", value);
  }
  get bytes(): ContentPart["bytes"] {
    return this.getField("bytes") as ContentPart["bytes"];
  }
  set bytes(value: ContentPart["bytes"]) {
    this.setField("bytes", value);
  }
  static toNode(object: ContentPart, id?: string, dataset?: Store): ContentPartNode {
    const node = makeNode("ContentPart", object, id, dataset) as ContentPartNode;
    return node;
  }
  static fromNode(node: ContentPartNode): ContentPart {
    return node.toObject();
  }
}

export class DescribeBodyNode extends CoreNode<DescribeBody> {
  readonly modelName = "DescribeBody";
  get want(): DescribeBody["want"] {
    return this.getField("want") as DescribeBody["want"];
  }
  set want(value: DescribeBody["want"]) {
    this.setField("want", value);
  }
  static toNode(object: DescribeBody, id?: string, dataset?: Store): DescribeBodyNode {
    const node = makeNode("DescribeBody", object, id, dataset) as DescribeBodyNode;
    return node;
  }
  static fromNode(node: DescribeBodyNode): DescribeBody {
    return node.toObject();
  }
}

export class DescriptionBodyNode extends CoreNode<DescriptionBody> {
  readonly modelName = "DescriptionBody";
  get description(): NamedValuesNode {
    return this.getField("description") as NamedValuesNode;
  }
  set description(value: NamedValuesNode | import("../core/types.js").JsonObject) {
    this.setField("description", value);
  }
  static toNode(object: DescriptionBody, id?: string, dataset?: Store): DescriptionBodyNode {
    const node = makeNode("DescriptionBody", object, id, dataset) as DescriptionBodyNode;
    return node;
  }
  static fromNode(node: DescriptionBodyNode): DescriptionBody {
    return node.toObject();
  }
}

export class ProposeBodyNode extends CoreNode<ProposeBody> {
  readonly modelName = "ProposeBody";
  get operation(): OperationRefNode {
    return this.getField("operation") as OperationRefNode;
  }
  set operation(value: OperationRefNode | OperationRef) {
    this.setField("operation", value);
  }
  get terms(): NamedValuesNode {
    return this.getField("terms") as NamedValuesNode;
  }
  set terms(value: NamedValuesNode | import("../core/types.js").JsonObject) {
    this.setField("terms", value);
  }
  get termsDigest(): ProposeBody["termsDigest"] {
    return this.getField("termsDigest") as ProposeBody["termsDigest"];
  }
  set termsDigest(value: ProposeBody["termsDigest"]) {
    this.setField("termsDigest", value);
  }
  get round(): ProposeBody["round"] {
    return this.getField("round") as ProposeBody["round"];
  }
  set round(value: ProposeBody["round"]) {
    this.setField("round", value);
  }
  get counters(): ProposeBody["counters"] {
    return this.getField("counters") as ProposeBody["counters"];
  }
  set counters(value: ProposeBody["counters"]) {
    this.setField("counters", value);
  }
  static toNode(object: ProposeBody, id?: string, dataset?: Store): ProposeBodyNode {
    const node = makeNode("ProposeBody", object, id, dataset) as ProposeBodyNode;
    return node;
  }
  static fromNode(node: ProposeBodyNode): ProposeBody {
    return node.toObject();
  }
}

export class AcceptBodyNode extends CoreNode<AcceptBody> {
  readonly modelName = "AcceptBody";
  get proposal(): AcceptBody["proposal"] {
    return this.getField("proposal") as AcceptBody["proposal"];
  }
  set proposal(value: AcceptBody["proposal"]) {
    this.setField("proposal", value);
  }
  get termsDigest(): AcceptBody["termsDigest"] {
    return this.getField("termsDigest") as AcceptBody["termsDigest"];
  }
  set termsDigest(value: AcceptBody["termsDigest"]) {
    this.setField("termsDigest", value);
  }
  get selection(): NamedValuesNode | undefined {
    return this.getField("selection") as NamedValuesNode | undefined;
  }
  set selection(value: NamedValuesNode | undefined | import("../core/types.js").JsonObject) {
    this.setField("selection", value);
  }
  get agreement(): AcceptBody["agreement"] {
    return this.getField("agreement") as AcceptBody["agreement"];
  }
  set agreement(value: AcceptBody["agreement"]) {
    this.setField("agreement", value);
  }
  static toNode(object: AcceptBody, id?: string, dataset?: Store): AcceptBodyNode {
    const node = makeNode("AcceptBody", object, id, dataset) as AcceptBodyNode;
    return node;
  }
  static fromNode(node: AcceptBodyNode): AcceptBody {
    return node.toObject();
  }
}

export class ChallengeBodyNode extends CoreNode<ChallengeBody> {
  readonly modelName = "ChallengeBody";
  get ref(): ChallengeBody["ref"] {
    return this.getField("ref") as ChallengeBody["ref"];
  }
  set ref(value: ChallengeBody["ref"]) {
    this.setField("ref", value);
  }
  get reason(): ChallengeBody["reason"] {
    return this.getField("reason") as ChallengeBody["reason"];
  }
  set reason(value: ChallengeBody["reason"]) {
    this.setField("reason", value);
  }
  get detail(): ChallengeBody["detail"] {
    return this.getField("detail") as ChallengeBody["detail"];
  }
  set detail(value: ChallengeBody["detail"]) {
    this.setField("detail", value);
  }
  get needs(): ChallengeNeedsNode {
    return this.getField("needs") as ChallengeNeedsNode;
  }
  set needs(value: ChallengeNeedsNode | ChallengeNeeds) {
    this.setField("needs", value);
  }
  static toNode(object: ChallengeBody, id?: string, dataset?: Store): ChallengeBodyNode {
    const node = makeNode("ChallengeBody", object, id, dataset) as ChallengeBodyNode;
    return node;
  }
  static fromNode(node: ChallengeBodyNode): ChallengeBody {
    return node.toObject();
  }
}

export class InvokeBodyNode extends CoreNode<InvokeBody> {
  readonly modelName = "InvokeBody";
  get challenge(): InvokeChallengeNode | undefined {
    return this.getField("challenge") as InvokeChallengeNode | undefined;
  }
  set challenge(value: InvokeChallengeNode | undefined | InvokeChallenge) {
    this.setField("challenge", value);
  }
  get operation(): OperationRefNode {
    return this.getField("operation") as OperationRefNode;
  }
  set operation(value: OperationRefNode | OperationRef) {
    this.setField("operation", value);
  }
  get input(): NamedValuesNode {
    return this.getField("input") as NamedValuesNode;
  }
  set input(value: NamedValuesNode | import("../core/types.js").JsonObject) {
    this.setField("input", value);
  }
  get basis(): BasisNode {
    return this.getField("basis") as BasisNode;
  }
  set basis(value: BasisNode | Basis) {
    this.setField("basis", value);
  }
  get purpose(): InvokeBody["purpose"] {
    return this.getField("purpose") as InvokeBody["purpose"];
  }
  set purpose(value: InvokeBody["purpose"]) {
    this.setField("purpose", value);
  }
  static toNode(object: InvokeBody, id?: string, dataset?: Store): InvokeBodyNode {
    const node = makeNode("InvokeBody", object, id, dataset) as InvokeBodyNode;
    return node;
  }
  static fromNode(node: InvokeBodyNode): InvokeBody {
    return node.toObject();
  }
}

export class DeliverBodyNode extends CoreNode<DeliverBody> {
  readonly modelName = "DeliverBody";
  get ref(): DeliverBody["ref"] {
    return this.getField("ref") as DeliverBody["ref"];
  }
  set ref(value: DeliverBody["ref"]) {
    this.setField("ref", value);
  }
  get basis(): BasisNode {
    return this.getField("basis") as BasisNode;
  }
  set basis(value: BasisNode | Basis) {
    this.setField("basis", value);
  }
  get operation(): OperationRefNode {
    return this.getField("operation") as OperationRefNode;
  }
  set operation(value: OperationRefNode | OperationRef) {
    this.setField("operation", value);
  }
  get output(): NamedValuesNode {
    return this.getField("output") as NamedValuesNode;
  }
  set output(value: NamedValuesNode | import("../core/types.js").JsonObject) {
    this.setField("output", value);
  }
  static toNode(object: DeliverBody, id?: string, dataset?: Store): DeliverBodyNode {
    const node = makeNode("DeliverBody", object, id, dataset) as DeliverBodyNode;
    return node;
  }
  static fromNode(node: DeliverBodyNode): DeliverBody {
    return node.toObject();
  }
}

export class ReceiptBodyNode extends CoreNode<ReceiptBody> {
  readonly modelName = "ReceiptBody";
  get ref(): ReceiptBody["ref"] {
    return this.getField("ref") as ReceiptBody["ref"];
  }
  set ref(value: ReceiptBody["ref"]) {
    this.setField("ref", value);
  }
  get activity(): ReceiptBody["activity"] {
    return this.getField("activity") as ReceiptBody["activity"];
  }
  set activity(value: ReceiptBody["activity"]) {
    this.setField("activity", value);
  }
  get outcome(): ReceiptBody["outcome"] {
    return this.getField("outcome") as ReceiptBody["outcome"];
  }
  set outcome(value: ReceiptBody["outcome"]) {
    this.setField("outcome", value);
  }
  get observed(): NamedValuesNode | undefined {
    return this.getField("observed") as NamedValuesNode | undefined;
  }
  set observed(value: NamedValuesNode | undefined | import("../core/types.js").JsonObject) {
    this.setField("observed", value);
  }
  get final(): ReceiptBody["final"] {
    return this.getField("final") as ReceiptBody["final"];
  }
  set final(value: ReceiptBody["final"]) {
    this.setField("final", value);
  }
  static toNode(object: ReceiptBody, id?: string, dataset?: Store): ReceiptBodyNode {
    const node = makeNode("ReceiptBody", object, id, dataset) as ReceiptBodyNode;
    return node;
  }
  static fromNode(node: ReceiptBodyNode): ReceiptBody {
    return node.toObject();
  }
}

export class ActionIntentNode extends CoreNode<ActionIntent> {
  readonly modelName = "ActionIntent";
  /** Runtime intent extensions carry evidence even though the legacy interface omits it. */
  get evidence(): readonly IntentEvidenceRefNode[] | undefined {
    return this.getField("evidence") as readonly IntentEvidenceRefNode[] | undefined;
  }
  set evidence(value: readonly IntentEvidenceRefNode[] | readonly IntentEvidenceRef[] | undefined) {
    this.setField("evidence", value);
  }
  get operation(): ActionIntent["operation"] {
    return this.getField("operation") as ActionIntent["operation"];
  }
  set operation(value: ActionIntent["operation"]) {
    this.setField("operation", value);
  }
  get action(): ActionIntent["action"] {
    return this.getField("action") as ActionIntent["action"];
  }
  set action(value: ActionIntent["action"]) {
    this.setField("action", value);
  }
  get target(): ActionIntent["target"] {
    return this.getField("target") as ActionIntent["target"];
  }
  set target(value: ActionIntent["target"]) {
    this.setField("target", value);
  }
  get purpose(): ActionIntent["purpose"] {
    return this.getField("purpose") as ActionIntent["purpose"];
  }
  set purpose(value: ActionIntent["purpose"]) {
    this.setField("purpose", value);
  }
  get recipient(): ActionIntent["recipient"] {
    return this.getField("recipient") as ActionIntent["recipient"];
  }
  set recipient(value: ActionIntent["recipient"]) {
    this.setField("recipient", value);
  }
  get parameters(): NamedValuesNode {
    return this.getField("parameters") as NamedValuesNode;
  }
  set parameters(value: NamedValuesNode | import("../core/types.js").JsonObject) {
    this.setField("parameters", value);
  }
  get conversation(): ActionIntent["conversation"] {
    return this.getField("conversation") as ActionIntent["conversation"];
  }
  set conversation(value: ActionIntent["conversation"]) {
    this.setField("conversation", value);
  }
  static toNode(object: ActionIntent, id?: string, dataset?: Store): ActionIntentNode {
    const node = makeNode("ActionIntent", object, id, dataset) as ActionIntentNode;
    return node;
  }
  static fromNode(node: ActionIntentNode): ActionIntent {
    return node.toObject();
  }
}

export class AgreementNode extends CoreNode<Agreement> {
  readonly modelName = "Agreement";
  get type(): Agreement["type"] {
    return this.getField("type") as Agreement["type"];
  }
  get conversation(): Agreement["conversation"] {
    return this.getField("conversation") as Agreement["conversation"];
  }
  set conversation(value: Agreement["conversation"]) {
    this.setField("conversation", value);
  }
  get operation(): OperationRefNode {
    return this.getField("operation") as OperationRefNode;
  }
  set operation(value: OperationRefNode | OperationRef) {
    this.setField("operation", value);
  }
  get offer(): Agreement["offer"] {
    return this.getField("offer") as Agreement["offer"];
  }
  set offer(value: Agreement["offer"]) {
    this.setField("offer", value);
  }
  get acceptance(): Agreement["acceptance"] {
    return this.getField("acceptance") as Agreement["acceptance"];
  }
  set acceptance(value: Agreement["acceptance"]) {
    this.setField("acceptance", value);
  }
  get termsDigest(): Agreement["termsDigest"] {
    return this.getField("termsDigest") as Agreement["termsDigest"];
  }
  set termsDigest(value: Agreement["termsDigest"]) {
    this.setField("termsDigest", value);
  }
  get terms(): NamedValuesNode {
    return this.getField("terms") as NamedValuesNode;
  }
  set terms(value: NamedValuesNode | import("../core/types.js").JsonObject) {
    this.setField("terms", value);
  }
  get selection(): NamedValuesNode | undefined {
    return this.getField("selection") as NamedValuesNode | undefined;
  }
  set selection(value: NamedValuesNode | undefined | import("../core/types.js").JsonObject) {
    this.setField("selection", value);
  }
  get offeror(): ParticipantRefNode {
    return this.getField("offeror") as ParticipantRefNode;
  }
  set offeror(value: ParticipantRefNode | ParticipantRef) {
    this.setField("offeror", value);
  }
  get acceptor(): ParticipantRefNode {
    return this.getField("acceptor") as ParticipantRefNode;
  }
  set acceptor(value: ParticipantRefNode | ParticipantRef) {
    this.setField("acceptor", value);
  }
  get formedAt(): Agreement["formedAt"] {
    return this.getField("formedAt") as Agreement["formedAt"];
  }
  set formedAt(value: Agreement["formedAt"]) {
    this.setField("formedAt", value);
  }
  static toNode(object: Agreement, id?: string, dataset?: Store): AgreementNode {
    const node = makeNode("Agreement", object, id, dataset) as AgreementNode;
    return node;
  }
  static fromNode(node: AgreementNode): Agreement {
    return node.toObject();
  }
}

export class MessageNode extends CoreNode<AnyMessage> {
  readonly modelName = "Message";
  /** Compatibility builder for the earlier envelope-only API. Use toNode for a complete document. */
  static create(id: string, kind: MessageKind, dataset = new Store()): EnvelopeMessageNode {
    return EnvelopeMessageNode.create(id, kind, dataset);
  }
  get profile(): AnyMessage["profile"] {
    return this.getField("profile") as AnyMessage["profile"];
  }
  set profile(value: AnyMessage["profile"]) {
    this.setField("profile", value);
  }
  get configuration(): AnyMessage["configuration"] {
    return this.getField("configuration") as AnyMessage["configuration"];
  }
  set configuration(value: AnyMessage["configuration"]) {
    this.setField("configuration", value);
  }
  get conversation(): AnyMessage["conversation"] {
    return this.getField("conversation") as AnyMessage["conversation"];
  }
  set conversation(value: AnyMessage["conversation"]) {
    this.setField("conversation", value);
  }
  get kind(): AnyMessage["kind"] {
    return this.getField("kind") as AnyMessage["kind"];
  }
  set kind(value: AnyMessage["kind"]) {
    this.setField("kind", value);
  }
  get from(): ParticipantRefNode {
    return this.getField("from") as ParticipantRefNode;
  }
  set from(value: ParticipantRefNode | ParticipantRef) {
    this.setField("from", value);
  }
  get to(): AudienceRefNode | undefined {
    return this.getField("to") as AudienceRefNode | undefined;
  }
  set to(value: AudienceRefNode | undefined | AudienceRef) {
    this.setField("to", value);
  }
  get createdAt(): AnyMessage["createdAt"] {
    return this.getField("createdAt") as AnyMessage["createdAt"];
  }
  set createdAt(value: AnyMessage["createdAt"]) {
    this.setField("createdAt", value);
  }
  get expiresAt(): AnyMessage["expiresAt"] {
    return this.getField("expiresAt") as AnyMessage["expiresAt"];
  }
  set expiresAt(value: AnyMessage["expiresAt"]) {
    this.setField("expiresAt", value);
  }
  get inReplyTo(): AnyMessage["inReplyTo"] {
    return this.getField("inReplyTo") as AnyMessage["inReplyTo"];
  }
  set inReplyTo(value: AnyMessage["inReplyTo"]) {
    this.setField("inReplyTo", value);
  }
  get authorship(): MessageAuthorshipNode | undefined {
    return this.getField("authorship") as MessageAuthorshipNode | undefined;
  }
  set authorship(value: MessageAuthorshipNode | undefined | MessageAuthorship) {
    this.setField("authorship", value);
  }
  get body(): CoreBodyNode {
    return this.getField("body") as CoreBodyNode;
  }
  set body(value: CoreBodyNode) {
    this.setField("body", value);
  }
  get evidence(): readonly EvidenceItemNode[] | undefined {
    return this.getField("evidence") as readonly EvidenceItemNode[] | undefined;
  }
  set evidence(value: readonly EvidenceItemNode[] | undefined | readonly EvidenceItem[]) {
    this.setField("evidence", value);
  }
  get content(): readonly ContentPartNode[] | undefined {
    return this.getField("content") as readonly ContentPartNode[] | undefined;
  }
  set content(value: readonly ContentPartNode[] | undefined | readonly ContentPart[]) {
    this.setField("content", value);
  }
  static toNode(object: AnyMessage, id?: string, dataset?: Store): MessageNode {
    const node = makeNode("Message", object, id, dataset) as MessageNode;
    node.types.add(AWP + object.kind[0]!.toUpperCase() + object.kind.slice(1));
    return node;
  }
  static fromNode(node: MessageNode): AnyMessage {
    return node.toObject();
  }
}

export class RefuseBodyNode extends CoreNode<RefuseBody> {
  readonly modelName = "RefuseBody";
  get ref(): RefuseBody["ref"] {
    return this.getField("ref") as RefuseBody["ref"];
  }
  set ref(value: RefuseBody["ref"]) {
    this.setField("ref", value);
  }
  get reason(): RefuseBody["reason"] {
    return this.getField("reason") as RefuseBody["reason"];
  }
  set reason(value: RefuseBody["reason"]) {
    this.setField("reason", value);
  }
  get detail(): RefuseBody["detail"] {
    return this.getField("detail") as RefuseBody["detail"];
  }
  set detail(value: RefuseBody["detail"]) {
    this.setField("detail", value);
  }
  static toNode(object: RefuseBody, id?: string, dataset?: Store): RefuseBodyNode {
    const node = makeNode("RefuseBody", object, id, dataset) as RefuseBodyNode;
    return node;
  }
  static fromNode(node: RefuseBodyNode): RefuseBody {
    return node.toObject();
  }
}

export class UnsupportedBodyNode extends CoreNode<UnsupportedBody> {
  readonly modelName = "UnsupportedBody";
  get ref(): UnsupportedBody["ref"] {
    return this.getField("ref") as UnsupportedBody["ref"];
  }
  set ref(value: UnsupportedBody["ref"]) {
    this.setField("ref", value);
  }
  get reason(): UnsupportedBody["reason"] {
    return this.getField("reason") as UnsupportedBody["reason"];
  }
  set reason(value: UnsupportedBody["reason"]) {
    this.setField("reason", value);
  }
  get detail(): UnsupportedBody["detail"] {
    return this.getField("detail") as UnsupportedBody["detail"];
  }
  set detail(value: UnsupportedBody["detail"]) {
    this.setField("detail", value);
  }
  static toNode(object: UnsupportedBody, id?: string, dataset?: Store): UnsupportedBodyNode {
    const node = makeNode("UnsupportedBody", object, id, dataset) as UnsupportedBodyNode;
    return node;
  }
  static fromNode(node: UnsupportedBodyNode): UnsupportedBody {
    return node.toObject();
  }
}

export class IndeterminateBodyNode extends CoreNode<IndeterminateBody> {
  readonly modelName = "IndeterminateBody";
  get ref(): IndeterminateBody["ref"] {
    return this.getField("ref") as IndeterminateBody["ref"];
  }
  set ref(value: IndeterminateBody["ref"]) {
    this.setField("ref", value);
  }
  get reason(): IndeterminateBody["reason"] {
    return this.getField("reason") as IndeterminateBody["reason"];
  }
  set reason(value: IndeterminateBody["reason"]) {
    this.setField("reason", value);
  }
  get detail(): IndeterminateBody["detail"] {
    return this.getField("detail") as IndeterminateBody["detail"];
  }
  set detail(value: IndeterminateBody["detail"]) {
    this.setField("detail", value);
  }
  static toNode(object: IndeterminateBody, id?: string, dataset?: Store): IndeterminateBodyNode {
    const node = makeNode("IndeterminateBody", object, id, dataset) as IndeterminateBodyNode;
    return node;
  }
  static fromNode(node: IndeterminateBodyNode): IndeterminateBody {
    return node.toObject();
  }
}
registerModel("ParticipantRef", participantRefSpec, ParticipantRefNode);
registerModel("AudienceRef", audienceRefSpec, AudienceRefNode);
registerModel("OperationRef", operationRefSpec, OperationRefNode);
registerModel("Basis", basisSpec, BasisNode);
registerModel("InvokeChallenge", invokeChallengeSpec, InvokeChallengeNode);
registerModel("ChallengeNeeds", challengeNeedsSpec, ChallengeNeedsNode);
registerModel("MessageAuthorship", messageAuthorshipSpec, MessageAuthorshipNode);
registerModel("ContentPart", contentPartSpec, ContentPartNode);
registerModel("DescribeBody", describeBodySpec, DescribeBodyNode);
registerModel("DescriptionBody", descriptionBodySpec, DescriptionBodyNode);
registerModel("ProposeBody", proposeBodySpec, ProposeBodyNode);
registerModel("AcceptBody", acceptBodySpec, AcceptBodyNode);
registerModel("ChallengeBody", challengeBodySpec, ChallengeBodyNode);
registerModel("InvokeBody", invokeBodySpec, InvokeBodyNode);
registerModel("DeliverBody", deliverBodySpec, DeliverBodyNode);
registerModel("ReceiptBody", receiptBodySpec, ReceiptBodyNode);
registerModel("ActionIntent", actionIntentSpec, ActionIntentNode);
registerModel("Agreement", agreementSpec, AgreementNode);
registerModel("Message", messageSpec, MessageNode);
registerModel("RefuseBody", refuseBodySpec, RefuseBodyNode);
registerModel("UnsupportedBody", unsupportedBodySpec, UnsupportedBodyNode);
registerModel("IndeterminateBody", indeterminateBodySpec, IndeterminateBodyNode);

export type CoreBodyNode = (
  | DescribeBodyNode
  | DescriptionBodyNode
  | ProposeBodyNode
  | AcceptBodyNode
  | ChallengeBodyNode
  | InvokeBodyNode
  | DeliverBodyNode
  | ReceiptBodyNode
  | RefuseBodyNode
  | UnsupportedBodyNode
  | IndeterminateBodyNode
) & { readonly want?: readonly string[] };

export const toNode = MessageNode.toNode;
export const fromNode = MessageNode.fromNode;

export interface IntentEvidenceRef {
  readonly itemId: string;
  readonly claimType: string;
}
export const intentEvidenceRefSpec: ModelSpec = {
  type: AWP + "IntentEvidenceRef",
  fields: {
    itemId: { term: "http://purl.org/dc/terms/references", kind: "iri" },
    claimType: { term: AWP + "claimType", kind: "text" },
  },
};
export class IntentEvidenceRefNode extends CoreNode<IntentEvidenceRef> {
  readonly modelName = "IntentEvidenceRef";
  get itemId(): string {
    return this.getField("itemId") as string;
  }
  set itemId(value: string) {
    this.setField("itemId", value);
  }
  get claimType(): string {
    return this.getField("claimType") as string;
  }
  set claimType(value: string) {
    this.setField("claimType", value);
  }
  static toNode(object: IntentEvidenceRef, id?: string, dataset?: Store): IntentEvidenceRefNode {
    return makeNode("IntentEvidenceRef", object, id, dataset) as IntentEvidenceRefNode;
  }
  static fromNode(node: IntentEvidenceRefNode): IntentEvidenceRef {
    return node.toObject();
  }
}
registerModel("IntentEvidenceRef", intentEvidenceRefSpec, IntentEvidenceRefNode);
