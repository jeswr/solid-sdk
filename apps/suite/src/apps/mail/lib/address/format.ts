// AUTHORED-BY Codex GPT-6.1-Sol
import { domainToUnicode } from "./domain";
import { displayName, record, requireAddress } from "./errors";
import { normaliseAddress } from "./parse";
import type { Address, MailboxAddress, Recipient } from "./types";

/** Validate structured input as strictly as parsed input. Always return a fresh object. */
export function recipient(value: Recipient): MailboxAddress {
  record(value);
  const email = normaliseAddress(value.email as string);
  if (value.name === undefined) return { kind: "mailbox", email };
  displayName(value.name);
  return { kind: "mailbox", email, name: value.name };
}

function phrase(name: string): string {
  displayName(name);
  return /^[a-z0-9!#$%&'*+\-/=?^_`{|}~]+(?: [a-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/i.test(name)
    ? name
    : `"${name.replace(/["\\]/g, "\\$&")}"`;
}

/** The final @ is always the separator, including when the quoted local contains @. */
export function unicodeEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return email.slice(0, at + 1) + domainToUnicode(email.slice(at + 1));
}

export function formatAddressList(entries: readonly Address[], unicodeDomains = false): string {
  requireAddress(Array.isArray(entries) && typeof unicodeDomains === "boolean");
  function mailbox(entry: MailboxAddress): string {
    record(entry);
    requireAddress(entry.kind === "mailbox");
    const address = recipient(entry);
    const email = unicodeDomains ? unicodeEmail(address.email) : address.email;
    return address.name === undefined ? email : `${phrase(address.name)} <${email}>`;
  }
  const result: string[] = [];
  for (const entry of entries as readonly Address[]) {
    record(entry);
    if (entry.kind === "group") {
      requireAddress(Array.isArray(entry.members));
      const members: string[] = [];
      for (const member of entry.members) members.push(mailbox(member));
      result.push(`${phrase(entry.name)}:${members.length > 0 ? ` ${members.join(", ")}` : ""};`);
    } else result.push(mailbox(entry));
  }
  return result.join(", ");
}

/** First mailbox wins across the entire list, including groups; empty groups are retained. */
export function deduplicateAddresses(entries: readonly Address[]): Address[] {
  requireAddress(Array.isArray(entries));
  const seen = new Set<string>();
  function unique(value: MailboxAddress): MailboxAddress[] {
    record(value);
    requireAddress(value.kind === "mailbox");
    const address = recipient(value);
    if (seen.has(address.email)) return [];
    seen.add(address.email);
    return [address];
  }
  const result: Address[] = [];
  for (const entry of entries as readonly Address[]) {
    record(entry);
    if (entry.kind !== "group") result.push(...unique(entry));
    else {
      displayName(entry.name);
      requireAddress(Array.isArray(entry.members));
      const members: MailboxAddress[] = [];
      for (const member of entry.members) members.push(...unique(member));
      result.push({ kind: "group", name: entry.name, members });
    }
  }
  return result;
}
