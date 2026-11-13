// AUTHORED-BY Codex GPT-6
// Authorization uses semantic mappings on the operation (or its flow binding),
// never an unrelated planner price. Keep arithmetic exact, including totals.
import { randomUUID } from "node:crypto";
import type { ActionRequest, Operation, Parameter } from "@jeswr/site-model";
import { SAB, SCHEMA } from "@jeswr/site-model";
import { type CompiledRequest, fillJsonTemplate } from "./compile.js";
import type { ExtractedItem } from "./extract.js";
import { moneyFields } from "./gate.js";
import { normaliseEffect } from "./match.js";
import { expandTemplate, templateVariables } from "./uri-template.js";
import { BindingError, expandIri, ID_PROPERTIES, idFromIri, jsonValue, RDF } from "./values.js";

export class MoneyRefusal extends BindingError {}

export interface MoneyEvidence {
  amount: string;
  currency: string;
  binding: {
    step: number;
    operation: string;
    url: string;
    item: number;
    iri?: string;
    property: string;
    currencyProperty: string;
    quantity: string;
    write?: number;
    identity: [string, string[]][];
  };
}
export interface MoneyRead {
  step: number;
  operation: Operation;
  url: string;
  items: ExtractedItem[];
}
export interface MoneyWrite {
  step: number;
  operation: Operation;
  values: Record<string, string>;
  sources: Record<string, string[]>;
  compiled: CompiledRequest;
}

interface Decimal {
  units: bigint;
  scale: number;
}
function decimal(value: string): Decimal {
  if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || value.length > 100)
    throw new BindingError("invalid nonnegative monetary amount");
  const [whole = "0", fraction = ""] = value.replace(/^\+/, "").split(".");
  return { units: BigInt(whole + fraction), scale: fraction.length };
}
function text(d: Decimal): string {
  const digits = d.units.toString().padStart(d.scale + 1, "0");
  if (!d.scale) return digits;
  return `${digits.slice(0, -d.scale)}.${digits.slice(-d.scale)}`.replace(/\.?0+$/, "");
}
export function addAmounts(a: string, b: string): string {
  const x = decimal(a),
    y = decimal(b);
  const scale = Math.max(x.scale, y.scale);
  return text({
    units: x.units * 10n ** BigInt(scale - x.scale) + y.units * 10n ** BigInt(scale - y.scale),
    scale,
  });
}
function equal(a: string, b: string): boolean {
  return text(decimal(a)) === text(decimal(b));
}
function greater(a: string, b: string): boolean {
  const x = decimal(a),
    y = decimal(b);
  return x.units * 10n ** BigInt(y.scale) > y.units * 10n ** BigInt(x.scale);
}
function multiply(a: string, b: string): string {
  const x = decimal(a),
    y = decimal(b);
  return text({ units: x.units * y.units, scale: x.scale + y.scale });
}
function kind(path: string[]): "amount" | "price" | "currency" | "quantity" | undefined {
  const terms = path.map(expandIri);
  const last = terms.at(-1);
  if (last === `${SCHEMA}price`) return "price";
  if (
    last === `${SCHEMA}amount` ||
    last === `${SCHEMA}totalPaymentDue` ||
    (last === `${SCHEMA}value` &&
      terms.some((t) => t === `${SCHEMA}amount` || t === `${SCHEMA}totalPaymentDue`))
  )
    return "amount";
  if (last === `${SCHEMA}priceCurrency` || last === `${SCHEMA}currency`) return "currency";
  if (last === `${SCHEMA}orderQuantity` || last === `${SAB}quantity`) return "quantity";
  return undefined;
}

// Verify a monetary mapping actually reaches the compiled request as a whole
// value. Unused inputs or interpolations like "1{charge}" cannot authorize it.
function assertSent(
  operation: Operation,
  param: Parameter,
  values: Record<string, string>,
  compiled: CompiledRequest,
): void {
  const marker = `sab_${randomUUID().replaceAll("-", "")}`;
  const marked = { ...values, [param.name]: marker };
  let count = 0,
    embedded = false;
  const inspect = (value: unknown): void => {
    if (typeof value === "string") {
      if (value === marker) count++;
      else if (value.includes(marker)) embedded = true;
    } else if (Array.isArray(value)) value.forEach(inspect);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(inspect);
  };
  if (templateVariables(operation.request.urlTemplate).includes(param.name)) {
    const url = new URL(expandTemplate(operation.request.urlTemplate, marked), compiled.url);
    // Only entire query values or path segments can carry monetary values.
    for (const [name, value] of url.searchParams) {
      inspect(value);
      if (value.includes(marker) && url.searchParams.getAll(name).length !== 1) embedded = true;
    }
    for (const part of url.pathname.split("/")) inspect(decodeURIComponent(part));
    if (url.hash.includes(marker) || url.host.includes(marker)) embedded = true;
  } else if (param.location === "query") {
    const sent = compiled.url.searchParams.getAll(param.name);
    if (sent.length === 1 && sent[0] === values[param.name]) count++;
  }
  if (
    param.location === "header" &&
    compiled.headers[param.name.toLowerCase()] === values[param.name]
  )
    count++;
  if (param.location === "body" || param.location === "form") {
    if (operation.request.bodyTemplate !== undefined && compiled.body?.kind === "json") {
      inspect(
        fillJsonTemplate(
          operation.request.bodyTemplate,
          marked,
          new Map(operation.inputs.map((p) => [p.name, p])),
          new Set([param.name]),
        ),
      );
    } else if (operation.request.bodyTemplate !== undefined && compiled.body) {
      const fields = new URLSearchParams(operation.request.bodyTemplate);
      for (const [name, value] of fields) {
        const replaced = value.replaceAll(`{${param.name}}`, marker);
        inspect(replaced);
        if (replaced.includes(marker) && fields.getAll(name).length !== 1) embedded = true;
      }
    } else if (compiled.body) count++;
  }
  if (count !== 1 || embedded)
    throw new BindingError("monetary input must be sent exactly once as a whole value");
}

/** Only structured, trusted values from earlier on-origin reads can supply money. */
export function factsMoney(
  origin: string,
  reads: MoneyRead[],
  writes: MoneyWrite[],
  lastReversible: number,
): MoneyEvidence | undefined {
  const onOrigin = (iri: string): boolean => {
    try {
      return new URL(iri).origin === origin;
    } catch {
      return false;
    }
  };
  // Select by priority before parsing amounts; an irrelevant unit price must
  // not override (or invalidate) a fresh checkout total.
  for (const wantTotal of [true, false]) {
    for (const read of reads) {
      if (!onOrigin(read.url)) continue;
      for (const [index, item] of read.items.entries()) {
        if (item.iri && !onOrigin(item.iri)) continue;
        const property = ["totalPaymentDue", "price", "value"]
          .map((p) => SCHEMA + p)
          .find((p) => item.values.get(p)?.length);
        const currencyProperty = ["priceCurrency", "currency"]
          .map((p) => SCHEMA + p)
          .find((p) => item.values.get(p)?.length);
        if (!property || !currencyProperty) continue;
        const amount = item.values.get(property)?.[0] as string;
        const currency = (item.values.get(currencyProperty)?.[0] ?? "").toUpperCase();
        const types = [
          read.operation.extraction?.itemType ?? "",
          ...(item.values.get(`${RDF}type`) ?? []),
        ].map(expandIri);
        const total =
          ["Order", "Invoice"].some((t) => types.includes(SCHEMA + t)) ||
          item.values.has(`${SCHEMA}totalPaymentDue`);
        if (total !== wantTotal) continue;
        let write: MoneyWrite | undefined;
        let quantity: string | undefined;
        if (total) {
          if (read.step <= lastReversible) continue;
        } else {
          const ids = ID_PROPERTIES.flatMap((key) => item.values.get(key) ?? []);
          if (item.iri) ids.push(item.iri, idFromIri(item.iri));
          const identified = writes
            .map((w) => ({
              write: w,
              parameters: w.operation.inputs.filter((p) => {
                const path = (p.path.length ? p.path : (w.sources[p.name] ?? [])).map(expandIri);
                return (
                  (w.values[p.name] ?? p.default) !== undefined &&
                  (ID_PROPERTIES.includes(path.at(-1) ?? "") ||
                    expandIri(p.range) === `${SCHEMA}Product` ||
                    path.at(-1) === `${SCHEMA}object` ||
                    path.at(-1) === "@id")
                );
              }),
            }))
            .filter(({ parameters }) => parameters.length);
          // A unit price cannot explain a multi-product basket or conflicting
          // identifiers. Such a flow needs a site total (or wire money).
          if (
            !identified.length ||
            identified.some(({ write: w, parameters }) =>
              parameters.some((p) => !ids.includes(w.values[p.name] ?? p.default ?? "")),
            )
          )
            continue;
          if (
            identified.filter(
              ({ write: w }) => normaliseEffect(w.operation.effect) === "reversible-write",
            ).length > 1
          )
            continue;
          write = identified[0]?.write;
          for (const { write: w, parameters } of identified) {
            for (const p of parameters) assertSent(w.operation, p, w.values, w.compiled);
            for (const p of w.operation.inputs) {
              if ((kind(p.path) ?? kind(w.sources[p.name] ?? [])) !== "quantity") continue;
              const value = w.values[p.name] ?? p.default;
              if (value === undefined) continue;
              assertSent(w.operation, p, w.values, w.compiled);
              decimal(value);
              const wire = jsonValue(p, value);
              if (
                typeof wire === "number" &&
                (!/^\d+(?:\.\d*)?$/.test(String(wire)) || !equal(value, String(wire)))
              )
                throw new BindingError(
                  "monetary quantity cannot be represented exactly on the wire",
                );
              if (quantity !== undefined && !equal(quantity, value))
                throw new BindingError("conflicting mapped quantities");
              quantity = value;
            }
          }
        }
        decimal(amount);
        if (!/^[A-Z]{3}$/.test(currency)) throw new BindingError("invalid site currency");
        const evidence: MoneyEvidence = {
          amount: total ? amount : multiply(amount, quantity ?? "1"),
          currency,
          binding: {
            step: read.step,
            operation: read.operation.id,
            url: read.url,
            item: index,
            ...(item.iri ? { iri: item.iri } : {}),
            property,
            currencyProperty,
            quantity: quantity ?? "1",
            identity: [...item.values].filter(([p]) =>
              [...ID_PROPERTIES, `${SCHEMA}orderNumber`, `${SCHEMA}url`].includes(p),
            ),
            ...(write ? { write: write.step } : {}),
          },
        };
        return evidence;
      }
    }
  }
  return undefined;
}

export function assertFactsCap(
  claims: { amount?: string; currency?: string },
  facts: { amount: string; currency: string },
): void {
  if (
    (claims.amount !== undefined && greater(facts.amount, claims.amount)) ||
    (claims.currency !== undefined && claims.currency !== facts.currency)
  )
    throw new MoneyRefusal(
      `the site's real price is ${facts.currency} ${facts.amount}; it exceeds the planner's cap or uses a different currency`,
    );
}

export function resolvedMoney(
  request: ActionRequest,
  operation: Operation,
  values: Record<string, string>,
  sources: Record<string, string[]> = {},
  compiled?: CompiledRequest,
  facts?: MoneyEvidence,
): { amount?: string; currency?: string } {
  // This also rejects contradictory planner claims, even if neither is sent.
  const claims = moneyFields(request);
  let amount: string | undefined,
    price: string | undefined,
    currency: string | undefined,
    quantity: string | undefined;
  for (const param of operation.inputs) {
    const value = values[param.name] ?? param.default;
    if (value === undefined) continue;
    const mapping = kind(param.path) ?? kind(sources[param.name] ?? []);
    if (mapping && compiled) assertSent(operation, param, values, compiled);
    if (mapping === "amount" || mapping === "price") {
      decimal(value);
      const wireValue = jsonValue(param, value);
      if (
        typeof wireValue === "number" &&
        (!/^\d+(?:\.\d*)?$/.test(String(wireValue)) || !equal(value, String(wireValue)))
      )
        throw new BindingError("monetary amount cannot be represented exactly on the wire");
      const previous = mapping === "amount" ? amount : price;
      if (previous !== undefined && !equal(previous, value))
        throw new BindingError("conflicting mapped monetary amounts");
      if (mapping === "amount") amount = value;
      else price = value;
    } else if (mapping === "currency") {
      if (!/^[A-Za-z]{3}$/.test(value)) throw new BindingError("invalid mapped currency");
      const next = value.toUpperCase();
      if (currency !== undefined && currency !== next)
        throw new BindingError("conflicting mapped currencies");
      currency = next;
    } else if (mapping === "quantity") {
      decimal(value);
      const wireValue = jsonValue(param, value);
      if (
        typeof wireValue === "number" &&
        (!/^\d+(?:\.\d*)?$/.test(String(wireValue)) || !equal(value, String(wireValue)))
      )
        throw new BindingError("monetary quantity cannot be represented exactly on the wire");
      if (quantity !== undefined && !equal(quantity, value))
        throw new BindingError("conflicting mapped quantities");
      quantity = value;
    }
  }
  if (price !== undefined) {
    const total = multiply(price, quantity ?? "1");
    if (amount !== undefined && !equal(amount, total))
      throw new BindingError("mapped total disagrees with price and quantity");
    amount ??= total;
  }
  if (facts) {
    if (
      (amount !== undefined && !equal(amount, facts.amount)) ||
      (currency !== undefined && currency !== facts.currency)
    )
      throw new MoneyRefusal(
        `mapped payment disagrees with the site's real price: ${facts.currency} ${facts.amount}`,
      );
    amount ??= facts.amount;
    currency ??= facts.currency;
    assertFactsCap(claims, facts);
  } else {
    if (
      amount !== undefined &&
      claims.amount !== undefined &&
      !equal(claims.amount, price ?? amount)
    )
      throw new MoneyRefusal("planner monetary amount disagrees with the resolved payment");
    if (currency !== undefined && claims.currency !== undefined && claims.currency !== currency)
      throw new MoneyRefusal("planner currency disagrees with the resolved payment");
  }
  if (
    normaliseEffect(operation.effect) === "payment" &&
    (amount === undefined || currency === undefined)
  )
    throw new MoneyRefusal(
      "payment requires wire-mapped amount and currency or trusted site facts",
    );
  return {
    ...(amount !== undefined ? { amount } : {}),
    ...(currency !== undefined ? { currency } : {}),
  };
}
