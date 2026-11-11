// AUTHORED-BY Codex (GPT-6.1 Sol)

import type { WalletItemData as GeneratedWalletItemData } from "./generated/model.js";
import { entities } from "./generated/model.js";

type RequiredFields = "name" | "kind" | "created" | "modified";
/** Undefined clears optional metadata; generated writes omit those values. */
export type WalletItemData = Pick<GeneratedWalletItemData, RequiredFields> & {
  [Key in Exclude<keyof GeneratedWalletItemData, RequiredFields>]?:
    | GeneratedWalletItemData[Key]
    | undefined;
};
/** Every RDF read, write and serialisation is generated. */
export const walletItem = entities.WalletItem;
export const WALLET_CLASS = "https://schema.org/DigitalDocument";
export const ITEM_KINDS = [
  "passport",
  "identity-card",
  "driving-licence",
  "residence-permit",
  "insurance",
  "membership",
  "ticket",
  "vaccination",
  "certificate",
  "verifiable-credential",
  "other",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const KIND_LABELS: Record<ItemKind, string> = {
  passport: "Passports",
  "identity-card": "Identity cards",
  "driving-licence": "Driving licences",
  "residence-permit": "Residence permits",
  insurance: "Insurance",
  membership: "Memberships",
  ticket: "Tickets",
  vaccination: "Vaccinations",
  certificate: "Certificates",
  "verifiable-credential": "Verifiable credentials",
  other: "Other documents",
};
