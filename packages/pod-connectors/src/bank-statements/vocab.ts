// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
} from "@rdfjs/wrapper";
import { Invoice, PodThing } from "../core/vocab.js";

/** Source metadata supplements the existing Invoice mapping, including OFX. */
export const BANK = {
  Account: `${NS.SCHEMA}BankAccount`,
  account: `${NS.POD_MONEY}account`,
  fee: `${NS.SCHEMA}feesAndCommissionsSpecification`,
  postingTime: `${NS.SCHEMA}dateCreated`,
} as const;

export class BankInvoice extends Invoice {
  get account(): string | undefined {
    return OptionalFrom.subjectPredicate(this, BANK.account, NamedNodeAs.string);
  }
  set account(value: string | undefined) {
    OptionalAs.object(this, BANK.account, value, NamedNodeFrom.string);
  }
  get fee(): string | undefined {
    return OptionalFrom.subjectPredicate(this, BANK.fee, LiteralAs.string);
  }
  set fee(value: string | undefined) {
    OptionalAs.object(this, BANK.fee, value, (text, factory) =>
      LiteralFrom.datatypeTuple([`${NS.XSD}decimal`, text], factory),
    );
  }
  get postingTime(): string | undefined {
    return OptionalFrom.subjectPredicate(this, BANK.postingTime, LiteralAs.string);
  }
  set postingTime(value: string | undefined) {
    OptionalAs.object(this, BANK.postingTime, value, (text, factory) =>
      LiteralFrom.datatypeTuple(
        [`${NS.XSD}${text.length === 10 ? "date" : "dateTime"}`, text],
        factory,
      ),
    );
  }
}

export class BankAccount extends PodThing {
  mark(): this {
    this.types.add(BANK.Account);
    return this;
  }
}
