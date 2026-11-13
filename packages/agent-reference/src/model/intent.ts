// AUTHORED-BY Codex GPT-6
/** The scalar scope of ActionIntentShape; consequential parameters remain a migration boundary. */
import { Store } from "n3";
import type { ActionIntent } from "../core/types.js";
import { AWP } from "../profile/vocabulary.js";
import { RdfNode } from "./nodes.js";

const ODRL = "http://www.w3.org/ns/odrl/2/";
const PURPOSE = "https://w3id.org/dpv#hasPurpose";
export class IntentScopeNode extends RdfNode {
  get operation(): string {
    return this.requiredIri(AWP + "operation");
  }
  get action(): string {
    return this.text(ODRL + "action") ?? "";
  }
  /** Empty when a core's effect intent names no target; the mandate check refuses it. */
  get target(): string {
    return this.iri(ODRL + "target") ?? "";
  }
  get purpose(): string | undefined {
    return this.iri(PURPOSE);
  }
  get recipient(): string | undefined {
    return this.iri(AWP + "recipient");
  }
  get conversation(): string {
    return this.requiredIri(AWP + "conversation");
  }
  private requiredIri(predicate: string): string {
    const value = this.iri(predicate);
    if (value === undefined) throw new TypeError("Missing action scope");
    return value;
  }
  static fromIntent(intent: ActionIntent): IntentScopeNode {
    const node = new IntentScopeNode("urn:awp:intent-scope", new Store());
    node.types.add(AWP + "ActionIntent");
    node.setIri(AWP + "operation", intent.operation);
    node.setText(ODRL + "action", intent.action);
    // An effect intent from a core may omit its target or conversation. Leave them out of
    // the view so the check that needs one refuses at the read, instead of the whole view
    // throwing before checks that do not need them (brief 26a confinement fixture).
    if (intent.target) node.setIri(ODRL + "target", intent.target);
    if (intent.conversation) node.setIri(AWP + "conversation", intent.conversation);
    if (intent.purpose) node.setIri(PURPOSE, intent.purpose);
    if (intent.recipient) node.setIri(AWP + "recipient", intent.recipient);
    return node;
  }
}
