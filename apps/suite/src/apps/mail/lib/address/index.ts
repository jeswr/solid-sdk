// AUTHORED-BY Codex GPT-6.1-Sol
export { domainToASCII, domainToUnicode } from "./domain";
export { AddressError, type AddressErrorCode } from "./errors";
export { deduplicateAddresses, formatAddressList } from "./format";
export { normaliseAddress, parseAddressList } from "./parse";
export { rankRecipients } from "./rank";
export type {
  Address,
  AddressGroup,
  MailboxAddress,
  RecentRecipient,
  Recipient,
  RecipientSuggestion,
} from "./types";
