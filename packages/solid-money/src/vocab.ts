// AUTHORED-BY Codex (GPT-6.1 Sol)
import { NS } from "@jeswr/suite-vocab";

export const V = {
  type: `${NS.RDF}type`,
  accountClass: `${NS.FINANCE}FinancialAccount`,
  transactionClass: `${NS.FINANCE}Transaction`,
  transferClass: `${NS.FINANCE}Transfer`,
  balanceClass: `${NS.FINANCE}Balance`,
  categoryClass: `${NS.FINANCE}BudgetCategory`,
  amountClass: `${NS.FINANCE}MonetaryAmount`,
  amountNode: `${NS.FINANCE}hasMonetaryAmount`,
  amount: `${NS.SCHEMA}value`,
  currency: `${NS.SCHEMA}currency`,
  label: `${NS.SKOS}prefLabel`,
  parent: `${NS.SKOS}broader`,
  account: `${NS.POD_MONEY}account`,
  balanceAccount: `${NS.POD_MONEY}ofAccount`,
  asOf: `${NS.POD_MONEY}asOf`,
  postingTime: `${NS.FINANCE}postingTime`,
  category: `${NS.POD_MONEY}category`,
  payee: `${NS.FINANCE}hasCounterparty`,
  description: `${NS.SCHEMA}description`,
  derivedFrom: `${NS.PROV}wasDerivedFrom`,
  debitAccount: `${NS.FINANCE}debitAccount`,
  creditAccount: `${NS.FINANCE}creditAccount`,
} as const;
