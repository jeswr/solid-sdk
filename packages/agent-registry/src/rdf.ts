// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { LiteralFrom, NamedNodeFrom, RequiredAs, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import type { Account } from "./model.js";

/** Canonical agent vocabulary, local until agent-model's vocabulary surface is available. */
export const AGENT = "https://jeswr.org/ns/agent#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
class AccountNode extends TermWrapper {
  literals(predicate: string): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      AGENT + predicate,
      (term) => term.value,
      LiteralFrom.string,
    );
  }
  text(predicate: string, value: string): void {
    RequiredAs.object(this, AGENT + predicate, value, LiteralFrom.string);
  }
  boolean(predicate: string, value: boolean): void {
    RequiredAs.object(this, AGENT + predicate, value, LiteralFrom.boolean);
  }
  iri(predicate: string, value: string): void {
    RequiredAs.object(this, predicate, value, NamedNodeFrom.string);
  }
}
/** Typed RDF construction; handles and conflicts have already been reduced to salted hashes. */
export function accountDataset(account: Account, url: string): Store {
  const store = new Store();
  const factory = DataFactory as unknown as ConstructorParameters<typeof TermWrapper>[2];
  const node = new AccountNode(url, store, factory);
  node.iri(RDF_TYPE, `${AGENT}Account`);
  node.text("channel", account.channel);
  node.text("provider", account.provider);
  node.text("organisation", account.organisation);
  node.text("bindingState", account.bindingState);
  node.text("setupStatus", account.inventory.setupStatus);
  if (account.inventory.observedAt) node.text("observedAt", account.inventory.observedAt);
  if (account.inventory.lastTested) node.text("lastTested", account.inventory.lastTested);
  for (const hash of account.channelHandles) node.literals("channelHandle").add(hash);
  for (const ref of account.credentialRefs) node.literals("credentialRef").add(ref);
  for (const conflict of account.identityConflicts)
    node.literals("identityConflict").add(JSON.stringify(conflict));
  const restrictions = new AccountNode(`${url}#restrictions`, store, factory);
  node.iri(`${AGENT}restrictions`, restrictions.value);
  for (const key of ["read", "triage", "draft", "send"] as const)
    restrictions.boolean(key, account.restrictions[key]);
  return store;
}
/** Canonical deterministic Turtle through N3 Writer; never hand-built triples or Turtle. */
export function accountTurtle(dataset: Store): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ prefixes: { agent: AGENT } });
    writer.addQuads([...dataset]);
    writer.end((error, output) => (error ? reject(error) : resolve(output)));
  });
}
