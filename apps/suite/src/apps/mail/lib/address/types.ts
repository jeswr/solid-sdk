// AUTHORED-BY Codex GPT-6.1-Sol
export interface MailboxAddress {
  kind: "mailbox";
  email: string;
  name?: string;
}

export interface AddressGroup {
  kind: "group";
  name: string;
  members: MailboxAddress[];
}

export type Address = MailboxAddress | AddressGroup;

export interface Recipient {
  email: string;
  name?: string;
}

/** Aggregated usage, supplied by the caller; timestamps are epoch milliseconds. */
export interface RecentRecipient extends Recipient {
  frequency: number;
  lastUsed: number;
}

export interface RecipientSuggestion extends MailboxAddress {
  frequency: number;
  lastUsed: number | null;
  source: "contact" | "recent" | "both";
}
