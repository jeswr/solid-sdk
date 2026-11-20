import { LiteralFrom, RequiredAs } from "@rdfjs/wrapper";
// AUTHORED-BY Codex GPT-6
/** Legacy ingress adapter while body/evidence vocabularies are being migrated. */
import type { AnyMessage } from "../core/types.js";
import { AWP } from "../profile/vocabulary.js";
import { AudienceNode, MessageNode, ParticipantNode } from "./nodes.js";

/**
 * The envelope projection of MessageShape, whose full class is rejected by codegen.
 * This is deliberately not a complete Message document and must never be sent/displayed
 * as one: legacy bodies and protected evidence are still outside this projection.
 */
export class MessageEnvelopeNode extends MessageNode {
  get conversationId(): string {
    const value = this.conversation;
    if (value === undefined) throw new TypeError("Missing conversation in envelope");
    return value;
  }
  get configurationId(): string {
    const value = this.configuration;
    if (value === undefined) throw new TypeError("Missing configuration in envelope");
    return value;
  }
  get messageKind(): AnyMessage["kind"] {
    const value = this.kind;
    if (value === undefined) throw new TypeError("Missing kind in envelope");
    return value;
  }
  get participant(): ParticipantNode {
    const value = this.from;
    if (value === undefined) throw new TypeError("Missing sender in envelope");
    return value;
  }
  static fromMessage(message: AnyMessage): MessageEnvelopeNode {
    const base = MessageNode.create(message.id, message.kind);
    const node = new MessageEnvelopeNode(base.id, base.dataset);
    node.profile = message.profile;
    node.configuration = message.configuration;
    node.conversation = message.conversation;
    // The verifier must decide reversed/empty windows; the emitter's setWindow builder
    // deliberately refuses them and therefore is not an admission reader.
    RequiredAs.object(node, AWP + "createdAt", new Date(message.createdAt), LiteralFrom.dateTime);
    RequiredAs.object(node, AWP + "expiresAt", new Date(message.expiresAt), LiteralFrom.dateTime);
    const sender = new ParticipantNode(message.id + ":envelope-sender", node.dataset);
    if (message.from.actor) sender.actor = message.from.actor;
    if (message.from.onBehalfOf) sender.onBehalfOf = message.from.onBehalfOf;
    if (message.from.operator) sender.operator = message.from.operator;
    node.from = sender;
    if (message.to) {
      const audience = new AudienceNode(message.id + ":envelope-audience", node.dataset);
      audience.actor = message.to.actor;
      if (message.to.party) audience.party = message.to.party;
      node.to = audience;
    }
    if (message.inReplyTo) node.inReplyTo = message.inReplyTo;
    return node;
  }
}
