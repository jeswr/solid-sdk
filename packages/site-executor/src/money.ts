// AUTHORED-BY Codex GPT-6
// Authorization uses semantic mappings on the operation (or its flow binding),
// never an unrelated planner price. Keep arithmetic exact, including totals.
import { randomUUID } from "node:crypto";
import type { ActionRequest, Operation, Parameter } from "@jeswr/site-model";
import { SCHEMA } from "@jeswr/site-model";
import { type CompiledRequest, fillJsonTemplate } from "./compile.js";
import { moneyFields } from "./gate.js";
import { normaliseEffect } from "./match.js";
import { expandTemplate, templateVariables } from "./uri-template.js";
import { BindingError, expandIri, jsonValue } from "./values.js";

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
  if (last === `${SCHEMA}orderQuantity`) return "quantity";
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

export function resolvedMoney(
  request: ActionRequest,
  operation: Operation,
  values: Record<string, string>,
  sources: Record<string, string[]> = {},
  compiled?: CompiledRequest,
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
      if (!/^\+?\d+$/.test(value)) throw new BindingError("invalid monetary quantity");
      if (quantity !== undefined && !equal(quantity, value))
        throw new BindingError("conflicting mapped quantities");
      quantity = value;
    }
  }
  if (price !== undefined) {
    const d = decimal(price);
    const total = text({ units: d.units * decimal(quantity ?? "1").units, scale: d.scale });
    if (amount !== undefined && !equal(amount, total))
      throw new BindingError("mapped total disagrees with price and quantity");
    amount ??= total;
  }
  if (amount !== undefined && claims.amount !== undefined && !equal(claims.amount, price ?? amount))
    throw new BindingError("planner monetary amount disagrees with the resolved payment");
  if (currency !== undefined && claims.currency !== undefined && claims.currency !== currency)
    throw new BindingError("planner currency disagrees with the resolved payment");
  if (
    normaliseEffect(operation.effect) === "payment" &&
    (amount === undefined || currency === undefined)
  )
    throw new BindingError("payment requires explicitly mapped amount and currency inputs");
  return {
    ...(amount !== undefined ? { amount } : {}),
    ...(currency !== undefined ? { currency } : {}),
  };
}
