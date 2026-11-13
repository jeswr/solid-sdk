// AUTHORED-BY Codex GPT-6

import type { SigningKey } from "../mechanisms/jws.js";
import type { PaymentAgreementNode, PaymentFacts } from "../model/payment.js";
import type { JsonLdDocument } from "../wire/document.js";
import type { Ledger } from "./ledger.js";
/** Opaque protocol bytes/objects. Gates read only lift()'s dataset wrappers. */
export interface ProtocolObjects {
  suite: string;
  objects: readonly { name: string; form: string; shown: unknown }[];
  /** Adapters retain their authenticated local profile/association here, never core authority. */
  native?: unknown;
}
export interface AmountDue {
  agreement: PaymentAgreementNode;
  invoice: string;
  dueDate: string;
  account: string;
}
export interface PayeeContext {
  party: string;
}
export interface PayerContext {
  party: string;
  key?: SigningKey;
}
export interface ProviderContext {
  party: string;
  payerAccount: string;
  ledger: Ledger;
  now: string;
}
/** Created only after P1-P8, bound to the exact lifted graph. */
export interface CheckedPayment {
  facts: PaymentFacts;
  digest: string;
}
export interface PaymentApprovalBinding {
  termsDigest: string;
  orderDigest: string;
}
export interface SettlementSuite {
  id: string;
  request(due: AmountDue, payee: PayeeContext): Promise<ProtocolObjects>;
  order(checked: CheckedPayment, payer: PayerContext): Promise<ProtocolObjects>;
  settle(order: ProtocolObjects, provider: ProviderContext): Promise<ProtocolObjects>;
  lift(objects: ProtocolObjects): PaymentFacts;
}
export interface SettlementTrace {
  suite: string;
  objects: readonly { name: string; form: string; shown: unknown }[];
  facts: JsonLdDocument;
  sameDocument?: string;
}
