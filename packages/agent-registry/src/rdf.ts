// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { Account as PodAccount } from "@jeswr/agent-model";
import { toRdf } from "@jeswr/agent-model/rdf";
import { AGENT } from "@jeswr/agent-model/vocab";
import { Store, Writer } from "n3";
import type { Account } from "./model.js";

export { AGENT };
/** Project inventory onto the shared account schema; keep scalar primary fields scalar. */
export function accountRecord(account: Account, url: string): PodAccount {
  return {
    type: "account",
    id: url,
    channel: account.channel,
    provider: account.provider,
    organisation: account.organisation,
    ...(account.channelHandles[0] ? { channelHandleHash: account.channelHandles[0] } : {}),
    ...(account.credentialRefs[0] ? { credentialRef: account.credentialRefs[0] } : {}),
    bindingState: account.bindingState,
    restrictions: account.restrictions,
    inventory: {
      ...account.inventory,
      channelHandles: account.channelHandles,
      credentialRefs: account.credentialRefs,
      evidence: account.evidence,
      identityConflicts: account.identityConflicts,
    },
  };
}
/** Typed RDF construction; handles and conflicts have already been reduced to salted hashes. */
export function accountDataset(account: Account, url: string): Store {
  return new Store([...toRdf(accountRecord(account, url))]);
}
/** Canonical deterministic Turtle through N3 Writer; never hand-built triples or Turtle. */
export function accountTurtle(dataset: Store): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ prefixes: { agent: AGENT } });
    writer.addQuads([...dataset]);
    writer.end((error, output) => (error ? reject(error) : resolve(output)));
  });
}
