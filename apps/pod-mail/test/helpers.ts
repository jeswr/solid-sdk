// AUTHORED-BY Claude Opus 4.8
/** Shared test helpers: build a dataset from Turtle via the sanctioned parser. */
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { MailboxDataset } from "../src/model/mailbox.js";

export { DataFactory };

/** An empty mailbox over a fresh n3 Store. */
export function emptyMailbox(): MailboxDataset {
  return new MailboxDataset(new Store(), DataFactory);
}

/** Parse Turtle into a MailboxDataset (round-trip read path). */
export async function mailboxFromTurtle(
  turtle: string,
  baseIRI = "https://pod.example/mail/inbox.ttl",
): Promise<MailboxDataset> {
  const store = await parseRdf(turtle, "text/turtle", { baseIRI });
  return new MailboxDataset(store, DataFactory);
}
