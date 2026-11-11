// AUTHORED-BY Codex (GPT-6.1 Sol)
import { NS } from "@jeswr/suite-vocab";
import type { Term } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  OptionalAs,
  OptionalFrom,
  TermAs,
  TermWrapper,
} from "@rdfjs/wrapper";
import { Store } from "n3";
import {
  type AccountWrapper,
  type BalanceWrapper,
  type CategoryWrapper,
  entities,
  type MonetaryAmountWrapper,
  type TransactionWrapper,
} from "./generated/model.js";
import { V } from "./vocab.js";

const decimalLexical = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const floatingLexical = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const numericLexicals = new Map([
  [`${NS.XSD}integer`, /^[+-]?\d+$/],
  [`${NS.XSD}decimal`, decimalLexical],
  [`${NS.XSD}double`, floatingLexical],
  [`${NS.XSD}float`, floatingLexical],
]);

/** Expand RDF numeric lexical forms without rounding the significand through Number. */
export function rdfAmount(term: TermWrapper): string {
  if (term.termType !== "Literal") throw new TypeError("Invalid money amount");
  const text = LiteralAs.string(term);
  const pattern = numericLexicals.get(term.datatype.value);
  if (pattern === undefined) return text;
  if (!pattern.test(text)) throw new TypeError("Invalid money amount");
  const [mantissa, exponent = "0"] = text.replace(/^[+-]/, "").split(/[eE]/) as [string, string?];
  const [whole, fraction = ""] = mantissa.split(".") as [string, string?];
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (!Number.isSafeInteger(point)) throw new TypeError("Invalid money amount");
  const decimal =
    point <= 0
      ? `0.${"0".repeat(-point)}${digits}`
      : point >= digits.length
        ? digits + "0".repeat(point - digits.length)
        : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return `${text.startsWith("-") ? "-" : ""}${decimal.replace(/^0+(?=\d)/, "")}`;
}

/** Compatibility view: only blank-node links, exact decimals and lexical dates are local.
 * Ordinary fields reuse the generated property descriptors, including all runtime guards.
 */
export class MoneyNode extends TermWrapper {
  declare readonly types: AccountWrapper["types"];
  declare label: AccountWrapper["label"];
  declare parent: CategoryWrapper["parent"];
  declare account: TransactionWrapper["account"];
  declare balanceAccount: BalanceWrapper["balanceAccount"];
  declare category: TransactionWrapper["category"];
  declare payee: TransactionWrapper["payee"];
  declare derivedFrom: TransactionWrapper["derivedFrom"];
  declare debitAccount: TransactionWrapper["debitAccount"];
  declare creditAccount: TransactionWrapper["creditAccount"];
  declare description: TransactionWrapper["description"];
  declare currency: MonetaryAmountWrapper["currency"];
  get amountNode(): Term | undefined {
    return OptionalFrom.subjectPredicate(this, V.amountNode, TermAs.term);
  }
  set amountNode(value: string | Term | undefined) {
    OptionalAs.object(this, V.amountNode, value, (reference, factory) =>
      typeof reference === "string" ? factory.namedNode(reference) : reference,
    );
  }
  get asOf(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.asOf, LiteralAs.string);
  }
  set asOf(value: string | undefined) {
    OptionalAs.object(this, V.asOf, value, (text, factory) =>
      LiteralFrom.datatypeTuple(
        [`${NS.XSD}${text.length === 10 ? "date" : "dateTime"}`, text],
        factory,
      ),
    );
  }
  get postingTime(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.postingTime, LiteralAs.string);
  }
  set postingTime(value: string | undefined) {
    OptionalAs.object(this, V.postingTime, value, (text, factory) =>
      LiteralFrom.datatypeTuple(
        [`${NS.XSD}${text.length === 10 ? "date" : "dateTime"}`, text],
        factory,
      ),
    );
  }
  get amount(): string | undefined {
    return OptionalFrom.subjectPredicate(this, V.amount, rdfAmount);
  }
  set amount(value: string | undefined) {
    OptionalAs.object(this, `${NS.FINANCE}amount`, undefined, LiteralFrom.string);
    OptionalAs.object(this, V.amount, value, (text, factory) =>
      LiteralFrom.datatypeTuple([`${NS.XSD}decimal`, text], factory),
    );
  }
}

// The public view accepts blank subjects; generated constructors accept NamedNodes only.
// Reuse their descriptors rather than reproducing vocabulary accessors. Writes run on
// the subject's outgoing quads: this profile has no aliases or composite links, and
// migration.ts already canonicalises vocabulary. This also keeps shard appends bounded
// instead of invoking the runtime's whole-document migration scan for every field.
for (const [entity, keys] of [
  [entities.Account, ["types", "label"]],
  [entities.Category, ["parent"]],
  [entities.Balance, ["balanceAccount"]],
  [entities.MonetaryAmount, ["currency"]],
  [
    entities.Transaction,
    ["account", "description", "category", "payee", "derivedFrom", "debitAccount", "creditAccount"],
  ],
] as const) {
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(entity.Wrapper.prototype, key);
    if (!descriptor) throw new TypeError(`Missing generated Money accessor: ${key}`);
    Object.defineProperty(MoneyNode.prototype, key, {
      ...descriptor,
      ...(descriptor.set
        ? {
            set(this: MoneyNode, value: unknown) {
              const term = TermAs.term(this);
              const before = [...this.dataset.match(term)];
              const store = new Store(before);
              const view = new TermWrapper(term, store, this.factory);
              if (key === "currency")
                OptionalAs.object(view, `${NS.FINANCE}currency`, undefined, LiteralFrom.string);
              descriptor.set?.call(view, value);
              for (const quad of before) if (!store.has(quad)) this.dataset.delete(quad);
              for (const quad of store) if (!this.dataset.has(quad)) this.dataset.add(quad);
            },
          }
        : {}),
    });
  }
}
