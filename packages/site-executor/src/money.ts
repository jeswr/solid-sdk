// AUTHORED-BY Codex GPT-6
// Authorization uses semantic mappings on the operation (or its flow binding),
// never an unrelated planner price. Keep arithmetic exact, including totals.
import { randomUUID } from "node:crypto";
import type { ActionRequest, Operation, Parameter } from "@jeswr/site-model";
import { SAB, SCHEMA } from "@jeswr/site-model";
import { type CompiledRequest, compileOperation, fillJsonTemplate } from "./compile.js";
import type { ExtractedItem } from "./extract.js";
import { moneyFields } from "./gate.js";
import { normaliseEffect } from "./match.js";
import { expandTemplate, parseTemplate, templateVariables } from "./uri-template.js";
import {
  BindingError,
  canonicalValue,
  expandIri,
  ID_PROPERTIES,
  jsonValue,
  RDF,
} from "./values.js";

export class MoneyRefusal extends BindingError {}

export interface MoneyEvidence {
  amount: string;
  currency: string;
  revalidate: number[];
  binding: {
    quantity: string;
    records: {
      step: number;
      operation: string;
      url: string;
      item: number;
      iri?: string;
      amounts: [string, string[]][];
      currencies: [string, string[]][];
      identity: [string, string[]][];
      inputs: Record<string, string>;
      sources: Record<string, string[]>;
    }[];
  };
}
export interface MoneyRead {
  step: number;
  operation: Operation;
  url: string;
  items: ExtractedItem[];
  values?: Record<string, string>;
  sources?: Record<string, string[]>;
  truncation?: { items: boolean; values: boolean };
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

// Verify a checked input reaches the compiled request exactly once as a whole
// value, across every wire surface. Unused or transformed inputs cannot bind it.
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
    // A second, shortened use must not disappear from marker counting.
    if (
      parseTemplate(operation.request.urlTemplate).some(
        (part) =>
          typeof part !== "string" &&
          part.vars.some((v) => v.name === param.name && v.prefix !== undefined),
      )
    )
      embedded = true;
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
  if (compiled.body) {
    if (operation.request.bodyTemplate !== undefined && compiled.body.kind === "json") {
      inspect(
        fillJsonTemplate(
          operation.request.bodyTemplate,
          marked,
          new Map(operation.inputs.map((p) => [p.name, p])),
          new Set([param.name]),
        ),
      );
    } else if (operation.request.bodyTemplate !== undefined) {
      const fields = new URLSearchParams(operation.request.bodyTemplate);
      for (const [name, value] of fields) {
        const replaced = value.replaceAll(`{${param.name}}`, marker);
        inspect(replaced);
        if (replaced.includes(marker) && fields.getAll(name).length !== 1) embedded = true;
      }
    } else if (param.location === "body" || param.location === "form") count++;
  }
  if (count !== 1 || embedded)
    throw new BindingError("monetary input must be sent exactly once as a whole value");
}

/** Static fields named for a quote or checked identity can override the checked value. */
function assertNoStaticShadows(payment: MoneyWrite, names: ReadonlySet<string>): void {
  const prefix = `sab_${randomUUID().replaceAll("-", "")}_`;
  const marked = Object.fromEntries(
    payment.operation.inputs.flatMap((p) =>
      (payment.values[p.name] ?? p.default) === undefined ? [] : [[p.name, prefix + p.name]],
    ),
  );
  const dynamic = (value: unknown): boolean => {
    if (typeof value === "string") return value.includes(prefix);
    if (Array.isArray(value)) return value.some(dynamic);
    return value !== null && typeof value === "object" && Object.values(value).some(dynamic);
  };
  const inspect = (name: string, value: unknown): void => {
    if (names.has(name) && !dynamic(value))
      throw new BindingError("static payment field shadows a quoted input or checked identity");
  };
  const url = new URL(
    expandTemplate(payment.operation.request.urlTemplate, marked),
    payment.compiled.url,
  );
  for (const [name, value] of url.searchParams) inspect(name, value);
  const template = payment.operation.request.bodyTemplate;
  if (template === undefined || !payment.compiled.body) return;
  if (payment.compiled.body.kind === "json") {
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node !== null && typeof node === "object")
        for (const [name, value] of Object.entries(node)) {
          inspect(name, value);
          walk(value);
        }
    };
    walk(
      fillJsonTemplate(
        template,
        marked,
        new Map(payment.operation.inputs.map((p) => [p.name, p])),
        new Set(Object.keys(marked)),
      ),
    );
  } else
    for (const [name, value] of new URLSearchParams(template))
      inspect(
        name,
        value.replace(
          /\{([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}/g,
          (_all, p: string) => marked[p] ?? "",
        ),
      );
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
  if ([...ID_PROPERTIES, `${SCHEMA}orderNumber`].includes(last))
    return value === undefined ? [] : [{ type: last, value }];
  if (![`${SCHEMA}object`, `${SCHEMA}referencesOrder`, "@id"].includes(last)) return [];
  const result: ItemIdentity[] = [];
  if (request) {
    for (const type of [...ID_PROPERTIES, `${SCHEMA}orderNumber`])
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
    return item.iri !== undefined && normalizedIri(item.iri) === normalizedIri(id.value);
  // Identifier-free suffixes cannot demonstrate a typed purchase identity.
  if (id.type === "fallback") return false;
  return item.values.get(id.type)?.includes(id.value) ?? false;
};

/** Payment evidence has two paths: fresh basket totals, or direct-buy unit prices. */
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
  const payment = writes.at(-1);
  if (!payment) return undefined;
  const ids =
    payment.identities ??
    payment.operation.inputs.flatMap((p) =>
      inputIdentities(
        p.path.length ? p.path : (payment.sources[p.name] ?? []),
        payment.values[p.name] ?? p.default,
      ),
    );
  const totalRequired = lastWrite >= 0;
  const window = reads.filter((r) => onOrigin(r.url) && (!totalRequired || r.step > lastWrite));
  const refusal = totalRequired
    ? "needs one fresh basket total"
    : "needs one unambiguous product price";
  for (const read of window) {
    const ex = read.operation.extraction;
    const couldSupplyMoney =
      ex &&
      ([`${SCHEMA}Order`, `${SCHEMA}Invoice`].includes(expandIri(ex.itemType)) ||
        ex.fields.some(
          (f) =>
            !f.untrusted &&
            [...AMOUNTS, ...CURRENCIES, `${RDF}type`].includes(expandIri(f.property)),
        ));
    if (couldSupplyMoney && (read.truncation?.items || read.truncation?.values))
      throw new MoneyRefusal(`${refusal}: incomplete extracted money evidence`);
  }
  const candidates = window.flatMap((read) =>
    read.items.flatMap((item, index) => {
      if (item.iri && !onOrigin(item.iri)) return [];
      const types = [
        read.operation.extraction?.itemType ?? "",
        ...(item.values.get(`${RDF}type`) ?? []),
      ].map(expandIri);
      const total =
        types.includes(`${SCHEMA}Order`) ||
        types.includes(`${SCHEMA}Invoice`) ||
        item.values.has(`${SCHEMA}totalPaymentDue`);
      return [{ read, item, index, total }];
    }),
  );
  const orderIds = ids.filter((id) =>
    ["iri", "fallback", `${SCHEMA}orderNumber`, `${SCHEMA}identifier`].includes(id.type),
  );
  const productIds = [
    ...ids,
    ...(ids.length && request ? inputIdentities([`${SCHEMA}object`], undefined, request) : []),
  ];
  const selected = candidates.filter((c) =>
    totalRequired ? c.total : !c.total && productIds.some((id) => identityMatches(c.item, id)),
  );
  if (totalRequired) {
    // A duplicate can carry only identity claims and need not repeat the total's
    // type. Follow shared own IRIs/typed order IDs, including chains of records.
    const identities = (item: ExtractedItem): ItemIdentity[] => [
      ...(item.iri ? [{ type: "iri", value: item.iri }] : []),
      ...[`${SCHEMA}orderNumber`, `${SCHEMA}identifier`].flatMap((type) =>
        (item.values.get(type) ?? []).map((value) => ({ type, value })),
      ),
    ];
    const remaining = new Set(candidates.filter((c) => !selected.includes(c)));
    for (const { item } of selected) {
      const ids = identities(item);
      for (const candidate of remaining)
        if (ids.some((id) => identityMatches(candidate.item, id))) {
          selected.push(candidate);
          remaining.delete(candidate);
        }
    }
    const claims = new Map<string, Set<string>>();
    for (const { item } of selected)
      for (const id of identities(item)) {
        const values = claims.get(id.type) ?? new Set<string>();
        values.add(id.type === "iri" ? (normalizedIri(id.value) ?? id.value) : id.value);
        claims.set(id.type, values);
      }
    if ([...claims.values()].some((values) => values.size > 1))
      throw new MoneyRefusal(`${refusal}: conflicting order identity claims`);
  }
  if (
    !totalRequired &&
    !selected.some(
      (c) => productIds.length && productIds.every((id) => identityMatches(c.item, id)),
    )
  )
    throw new MoneyRefusal(`${refusal}: product identity is ambiguous or does not match`);
  let quantity = "1";
  if (!totalRequired) {
    if (normaliseEffect(payment.operation.effect) === "payment")
      assertPaymentConfiguration(payment, origin);
    const quantities = payment.operation.inputs.flatMap((p) => {
      if ((kind(p.path) ?? kind(payment.sources[p.name] ?? [])) !== "quantity") return [];
      const v = payment.values[p.name] ?? p.default;
      if (v === undefined) return [];
      assertSent(payment.operation, p, payment.values, payment.compiled);
      const wire = jsonValue(p, v);
      if (
        typeof wire === "number" &&
        (!/^\d+(?:\.\d*)?$/.test(String(wire)) || !equal(v, String(wire)))
      )
        throw new BindingError("monetary quantity cannot be represented exactly on the wire");
      return [text(decimal(v))];
    });
    if (new Set(quantities).size > 1) throw new MoneyRefusal("conflicting mapped quantities");
    quantity = quantities[0] ?? "1";
    for (const p of payment.operation.inputs)
      if (
        inputIdentities(
          p.path.length ? p.path : (payment.sources[p.name] ?? []),
          payment.values[p.name] ?? p.default,
        ).length
      )
        assertSent(payment.operation, p, payment.values, payment.compiled);
  }
  const records: MoneyEvidence["binding"]["records"] = [];
  const allAmounts = new Set<string>();
  const allCurrencies = new Set<string>();
  for (const { read, item, index } of selected) {
    const amounts = AMOUNTS.filter((p) => item.values.get(p)?.length).map(
      (p): [string, string[]] => [p, [...(item.values.get(p) ?? [])]],
    );
    const currencies = CURRENCIES.filter((p) => item.values.get(p)?.length).map(
      (p): [string, string[]] => [p, [...(item.values.get(p) ?? [])]],
    );
    if (
      totalRequired &&
      (amounts.length || currencies.length) &&
      orderIds.length &&
      !orderIds.every((id) => {
        if (id.type === "iri") return identityMatches(item, id);
        const values = item.values.get(id.type) ?? [];
        return values.length > 0 && values.every((value) => value === id.value);
      })
    )
      throw new MoneyRefusal(`${refusal}: order identity does not match`);
    // Identity-only records contribute to consistency and retry binding too.
    if (!amounts.length && !currencies.length && !totalRequired) continue;
    for (const raw of amounts.flatMap(([, values]) => values)) {
      try {
        allAmounts.add(multiply(text(decimal(raw)), quantity));
      } catch {
        throw new MoneyRefusal(`${refusal}: conflicting or invalid site monetary amounts`);
      }
    }
    for (const code of currencies.flatMap(([, values]) => values)) {
      const currency = code.toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new MoneyRefusal(`${refusal}: invalid site currency`);
      allCurrencies.add(currency);
    }
    if (
      totalRequired &&
      (amounts.length || currencies.length) &&
      normaliseEffect(payment.operation.effect) === "payment"
    )
      assertPaymentConfiguration(payment, origin, read);
    records.push({
      step: read.step,
      operation: read.operation.id,
      url: read.url,
      item: index,
      ...(item.iri ? { iri: item.iri } : {}),
      amounts,
      currencies,
      identity: [...item.values].filter(([p]) =>
        [...ID_PROPERTIES, `${SCHEMA}orderNumber`, `${SCHEMA}referencesOrder`].includes(p),
      ),
      inputs: { ...read.values },
      sources: { ...read.sources },
    });
  }
  if (allAmounts.size !== 1 || allCurrencies.size !== 1)
    throw new MoneyRefusal(`${refusal}: conflicting or missing site amounts/currencies`);
  return {
    amount: [...allAmounts][0] as string,
    currency: [...allCurrencies][0] as string,
    revalidate: [...new Set(records.map((r) => r.step))],
    binding: { quantity, records },
  };
}

/** Every payment option must be covered by the evidence's concrete configuration. */
function assertPaymentConfiguration(payment: MoneyWrite, origin: string, total?: MoneyRead): void {
  const path = (p: Parameter, sources: Record<string, string[]> = {}) =>
    (p.path.length ? p.path : (sources[p.name] ?? [])).map(expandIri);
  const protectedNames = new Set(
    total?.operation.inputs
      .filter((p) => (total.values?.[p.name] ?? p.default) !== undefined)
      .map((p) => p.name),
  );
  for (const p of payment.operation.inputs) {
    const value = payment.values[p.name] ?? p.default;
    if (value === undefined) continue;
    const semantic = path(p, payment.sources);
    const ids = inputIdentities(semantic, value);
    const quoted = total?.operation.inputs.some(
      (candidate) =>
        candidate.name === p.name ||
        (semantic.length > 0 && semantic.join("\0") === path(candidate, total.sources).join("\0")),
    );
    // CSRF/session decoration is attached separately, after evidence and approval.
    if (
      !ids.length &&
      !semantic.length &&
      !quoted &&
      payment.operation.csrf?.some(
        (rule) =>
          rule.target.name === p.name &&
          (rule.target.kind === p.location ||
            (rule.target.kind === "form" && p.location === "body")),
      )
    )
      continue;
    // Quote matching and identity checks are meaningful only for the effective
    // payment request, with no unused, embedded, duplicated or shadowed values.
    try {
      assertSent(payment.operation, p, payment.values, payment.compiled);
    } catch {
      throw new MoneyRefusal(
        "needs a fresh basket total for these options: payment input must be sent exactly once as a whole value",
      );
    }
    protectedNames.add(p.name);
    // Identity checks above already bind these identifiers to the evidence.
    if (
      ids.length &&
      (!total ||
        ids.every((id) =>
          ["iri", "fallback", `${SCHEMA}orderNumber`, `${SCHEMA}identifier`].includes(id.type),
        ))
    )
      continue;
    // Direct-buy arithmetic and resolvedMoney cross-check every monetary mapping.
    if (!total && kind(semantic)) continue;
    if (
      total?.operation.inputs.some((candidate) => {
        const readValue = total.values?.[candidate.name] ?? candidate.default;
        const readPath = path(candidate, total.sources);
        const same =
          candidate.name === p.name ||
          (semantic.length > 0 && semantic.join("\0") === readPath.join("\0"));
        if (
          !same ||
          readValue === undefined ||
          canonicalValue(candidate, readValue) !== canonicalValue(p, value)
        )
          return false;
        // A declared but unused value cannot establish the site's quoted configuration.
        try {
          const inputs = total.values ?? {};
          assertSent(
            total.operation,
            candidate,
            inputs,
            compileOperation(total.operation, inputs, origin),
          );
          return true;
        } catch {
          return false;
        }
      })
    )
      continue;
    throw new MoneyRefusal("needs a fresh basket total for these options");
  }
  if (payment.operation.csrf?.some((rule) => protectedNames.has(rule.target.name)))
    throw new MoneyRefusal(
      "needs a fresh basket total for these options: CSRF target shadows a quoted input or checked identity",
    );
  try {
    assertNoStaticShadows(payment, protectedNames);
  } catch {
    throw new MoneyRefusal(
      "needs a fresh basket total for these options: static payment field shadows a quoted input or checked identity",
    );
  }
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
    (!facts || amount === undefined || currency === undefined)
  )
    throw new MoneyRefusal("payment needs trusted site price evidence");
  return {
    ...(amount !== undefined ? { amount } : {}),
    ...(currency !== undefined ? { currency } : {}),
  };
}
