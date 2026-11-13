// AUTHORED-BY Codex GPT-6
// Authorization uses semantic mappings on the operation (or its flow binding),
// never an unrelated planner price. Keep arithmetic exact, including totals.
import { randomUUID } from "node:crypto";
import type { ActionRequest, Operation, Parameter } from "@jeswr/site-model";
import { SAB, SCHEMA } from "@jeswr/site-model";
import { type CompiledRequest, fillJsonTemplate } from "./compile.js";
import type { ExtractedItem } from "./extract.js";
import { canonicalJson, moneyFields } from "./gate.js";
import { normaliseEffect } from "./match.js";
import { expandTemplate, templateVariables } from "./uri-template.js";
import {
  BindingError,
  canonicalValue,
  expandIri,
  ID_PROPERTIES,
  idFromIri,
  jsonValue,
  RDF,
} from "./values.js";

export class MoneyRefusal extends BindingError {}

export interface MoneyEvidence {
  amount: string;
  currency: string;
  revalidate: number[];
  binding: {
    step: number;
    operation: string;
    url: string;
    item: number;
    iri?: string;
    property: string;
    currencyProperty: string;
    quantity: string;
    identity: [string, string[]][];
    amounts: [string, string[]][];
    currencies: [string, string[]][];
    quantities: [number, string][];
    readings?: MoneyEvidence["binding"][];
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
  identities?: ItemIdentity[];
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
    if (
      sent.length === 1 &&
      sent[0] === canonicalValue(param, values[param.name] ?? param.default ?? "")
    )
      count++;
  }
  if (
    param.location === "header" &&
    compiled.headers[param.name.toLowerCase()] ===
      canonicalValue(param, values[param.name] ?? param.default ?? "")
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

export interface ItemIdentity {
  type: "iri" | "fallback" | string;
  value: string;
}

function normalizedIri(value: string): string | undefined {
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}

/** Keep identifier provenance even when class-valued wire inputs use an IRI suffix. */
export function inputIdentities(
  path: string[],
  value?: string,
  request?: ActionRequest,
): ItemIdentity[] {
  const terms = path.map(expandIri);
  const last = terms.at(-1) ?? "";
  if (ID_PROPERTIES.includes(last)) return value === undefined ? [] : [{ type: last, value }];
  if (last !== `${SCHEMA}object` && last !== "@id") return [];
  const result: ItemIdentity[] = [];
  if (request) {
    for (const type of ID_PROPERTIES)
      for (const v of request.values([...terms, type])) result.push({ type, value: v });
    for (const v of request.values(terms))
      if (/^https?:/i.test(v)) result.push({ type: "iri", value: normalizedIri(v) ?? v });
  }
  if (!result.length && value !== undefined)
    result.push({ type: /^https?:/i.test(value) ? "iri" : "fallback", value });
  return result;
}

const AMOUNTS = ["totalPaymentDue", "price", "amount", "value"].map((p) => SCHEMA + p);
const CURRENCIES = ["priceCurrency", "currency"].map((p) => SCHEMA + p);
const identityMatches = (item: ExtractedItem, id: ItemIdentity): boolean => {
  if (id.type === "iri")
    return [item.iri, ...(item.values.get(`${SCHEMA}object`) ?? [])].some(
      (v) => v !== undefined && normalizedIri(v) === normalizedIri(id.value),
    );
  if (id.type === "fallback") return !!item.iri && idFromIri(item.iri) === id.value;
  return item.values.get(id.type)?.includes(id.value) ?? false;
};

/** Only structured, trusted values from earlier on-origin reads can supply money. */
export function factsMoney(
  origin: string,
  reads: MoneyRead[],
  writes: MoneyWrite[],
  lastWrite: number,
  request?: ActionRequest,
): MoneyEvidence | undefined {
  const onOrigin = (iri: string): boolean => {
    try {
      return new URL(iri).origin === origin;
    } catch {
      return false;
    }
  };
  const candidates = reads
    .filter((r) => onOrigin(r.url))
    .flatMap((read) =>
      read.items.flatMap((item, index) => {
        if (item.iri && !onOrigin(item.iri)) return [];
        const types = [
          read.operation.extraction?.itemType ?? "",
          ...(item.values.get(`${RDF}type`) ?? []),
        ].map(expandIri);
        const total =
          ["Order", "Invoice"].some((t) => types.includes(SCHEMA + t)) ||
          item.values.has(`${SCHEMA}totalPaymentDue`);
        return [{ read, item, index, total }];
      }),
    );
  const identities = (w: MoneyWrite): ItemIdentity[] =>
    w.identities ??
    w.operation.inputs.flatMap((p) =>
      inputIdentities(
        p.path.length ? p.path : (w.sources[p.name] ?? []),
        w.values[p.name] ?? p.default,
      ),
    );
  const requestIds = request ? inputIdentities([`${SCHEMA}object`], undefined, request) : [];
  const quantities = (w: MoneyWrite): string[] =>
    w.operation.inputs.flatMap((p) => {
      if ((kind(p.path) ?? kind(w.sources[p.name] ?? [])) !== "quantity") return [];
      const v = w.values[p.name] ?? p.default;
      if (v === undefined) return [];
      assertSent(w.operation, p, w.values, w.compiled);
      decimal(v);
      const wire = jsonValue(p, v);
      if (
        typeof wire === "number" &&
        (!/^\d+(?:\.\d*)?$/.test(String(wire)) || !equal(v, String(wire)))
      )
        throw new BindingError("monetary quantity cannot be represented exactly on the wire");
      return [v];
    });
  const bound = writes.map((write) => ({
    write,
    ids: identities(write),
    quantities: quantities(write),
  }));
  const payment = bound.at(-1);
  const reading = (
    { read, item, index }: (typeof candidates)[number],
    quantity: string,
  ): MoneyEvidence | undefined => {
    const amounts = AMOUNTS.filter((p) => item.values.get(p)?.length).map(
      (p): [string, string[]] => [p, [...(item.values.get(p) ?? [])]],
    );
    const currencies = CURRENCIES.filter((p) => item.values.get(p)?.length).map(
      (p): [string, string[]] => [p, [...(item.values.get(p) ?? [])]],
    );
    if (!amounts.length || !currencies.length) return undefined;
    const values = amounts
      .flatMap(([, v]) => v)
      .map((v) => {
        try {
          return text(decimal(v));
        } catch {
          throw new MoneyRefusal("conflicting or invalid site monetary amounts");
        }
      });
    const codes = currencies.flatMap(([, v]) => v).map((v) => v.toUpperCase());
    if (new Set(values).size > 1) throw new MoneyRefusal("conflicting site monetary amounts");
    if (new Set(codes).size > 1) throw new MoneyRefusal("conflicting site currencies");
    const currency = codes[0];
    const amount = values[0];
    if (currency === undefined || amount === undefined) return undefined;
    if (!/^[A-Z]{3}$/.test(currency)) throw new MoneyRefusal("invalid site currency");
    return {
      amount: multiply(amount, quantity),
      currency,
      revalidate: [read.step],
      binding: {
        step: read.step,
        operation: read.operation.id,
        url: read.url,
        item: index,
        ...(item.iri ? { iri: item.iri } : {}),
        property: amounts[0]?.[0] ?? "",
        currencyProperty: currencies[0]?.[0] ?? "",
        quantity,
        amounts,
        currencies,
        quantities: bound.flatMap(({ write, quantities }) =>
          quantities.map((q): [number, string] => [write.step, q]),
        ),
        identity: [...item.values].filter(([p]) =>
          [
            ...ID_PROPERTIES,
            `${SCHEMA}orderNumber`,
            `${SCHEMA}url`,
            `${SCHEMA}object`,
            `${SCHEMA}orderQuantity`,
          ].includes(p),
        ),
      },
    };
  };
  // Inspect every fresh total for conflicts before checking its purchase binding.
  const totals = candidates
    .filter((c) => c.total && c.read.step > lastWrite)
    .flatMap((c) => {
      const evidence = reading(c, "1");
      return evidence ? [{ candidate: c, evidence }] : [];
    });
  const totalIdentity = (e: MoneyEvidence): string =>
    canonicalJson({
      amount: text(decimal(e.amount)),
      currency: e.currency,
      iri: e.binding.iri ? normalizedIri(e.binding.iri) : undefined,
      identity: e.binding.identity
        .map(([p, values]) => [
          p,
          values
            .map((v) =>
              p === `${SCHEMA}orderQuantity`
                ? text(decimal(v))
                : p === `${SCHEMA}url` || p === `${SCHEMA}object`
                  ? (normalizedIri(v) ?? v)
                  : v,
            )
            .sort(),
        ])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    });
  if (new Set(totals.map(({ evidence }) => totalIdentity(evidence))).size > 1)
    throw new MoneyRefusal("conflicting fresh basket totals");
  const total = totals.find(({ candidate: { item } }) => {
    if (!payment) return true;
    if (
      ![...payment.ids, ...(payment.ids.length ? requestIds : [])].every((id) =>
        identityMatches(item, id),
      )
    )
      return false;
    const quantity = item.values.get(`${SCHEMA}orderQuantity`) ?? [];
    return payment.quantities.every(
      (q) => quantity.length > 0 && quantity.every((v) => equal(v, q)),
    );
  });
  if (total) {
    total.evidence.revalidate = [...new Set(totals.map(({ evidence }) => evidence.binding.step))];
    total.evidence.binding.readings = totals.map(({ evidence }) => ({ ...evidence.binding }));
    return total.evidence;
  }
  if (!candidates.length) {
    if (bound.slice(0, -1).some((b) => b.quantities.length))
      throw new MoneyRefusal(
        "needs a fresh basket total: quantities cannot be related to product prices",
      );
    return undefined;
  }
  const identified = bound.filter(({ ids }) => ids.length);
  const ids = [...requestIds, ...identified.flatMap((b) => b.ids)];
  if (!ids.length && !bound.some((b) => b.quantities.length)) return undefined;
  const products = candidates.filter((c) => !c.total);
  if (ids.some((id) => id.type === "fallback")) {
    // A fallback is never permission to exchange SKU, productID and identifier.
    if (requestIds.some((id) => ID_PROPERTIES.includes(id.type)))
      throw new MoneyRefusal("needs a fresh basket total: typed identity cannot use IRI fallback");
    for (const id of ids.filter((id) => id.type === "fallback")) {
      const matches = products.filter(
        ({ item }) =>
          identityMatches(item, id) ||
          ID_PROPERTIES.some((p) => item.values.get(p)?.includes(id.value)),
      );
      if (matches.length > 1) throw new MoneyRefusal("ambiguous product identifier fallback");
    }
  }
  const selected = products.find(
    ({ item }) => ids.length && ids.every((id) => identityMatches(item, id)),
  );
  if (!selected) {
    if (writes.length)
      throw new MoneyRefusal(
        "needs a fresh basket total: product identity or price cannot be established",
      );
    return undefined;
  }
  // A total explains the entire basket; unit prices require every quantity write
  // to identify this same product and agree on its quantity.
  if (
    bound.some((b) => b.quantities.length && !b.ids.length) ||
    bound.filter(
      (b) => b.quantities.length && normaliseEffect(b.write.operation.effect) !== "payment",
    ).length > 1 ||
    identified.filter((b) => normaliseEffect(b.write.operation.effect) === "reversible-write")
      .length > 1
  )
    throw new MoneyRefusal(
      "needs a fresh basket total: quantities cannot be related to product prices",
    );
  const qs = bound.flatMap((b) => b.quantities);
  if (qs.some((q) => !equal(q, qs[0] ?? "1")))
    throw new MoneyRefusal("needs a fresh basket total: conflicting quantities across writes");
  for (const { write } of identified)
    for (const p of write.operation.inputs)
      if (
        inputIdentities(
          p.path.length ? p.path : (write.sources[p.name] ?? []),
          write.values[p.name] ?? p.default,
        ).length
      )
        assertSent(write.operation, p, write.values, write.compiled);
  return reading(selected, qs[0] ?? "1");
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
      "needs a fresh basket total: payment requires wire-mapped amount and currency or trusted site facts",
    );
  return {
    ...(amount !== undefined ? { amount } : {}),
    ...(currency !== undefined ? { currency } : {}),
  };
}
