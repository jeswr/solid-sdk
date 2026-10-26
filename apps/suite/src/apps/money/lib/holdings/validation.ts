// AUTHORED-BY Codex GPT-6.1-Sol
import { TEN, ZERO } from "./exact";
import {
  type HoldingsOptions,
  type InvestmentTransaction,
  MAX_CURRENCY_MINOR_UNITS,
  MAX_QUANTITY_DECIMALS,
  MAX_SIGNIFICANT_DIGITS,
  MAX_TRANSACTIONS,
} from "./types";

export type HoldingsErrorCode =
  | "OVERSOLD"
  | "CURRENCY_MISMATCH"
  | "INVALID_AMOUNT"
  | "INVALID_SPLIT"
  | "VALUE_TOO_LARGE"
  | "INVALID_INPUT";

/** Never embeds financial input values in messages. */
export class HoldingsError extends Error {
  constructor(public readonly code: HoldingsErrorCode) {
    super(`Investment holdings: ${code}`);
    this.name = "HoldingsError";
  }
}

export function requireValue(
  condition: unknown,
  code: HoldingsErrorCode = "INVALID_INPUT",
): asserts condition {
  if (!condition) throw new HoldingsError(code);
}

function record(
  value: unknown,
  keys?: readonly string[],
): asserts value is Record<string, unknown> {
  requireValue(typeof value === "object" && value !== null && !Array.isArray(value));
  const prototype = Object.getPrototypeOf(value);
  requireValue(prototype === Object.prototype || prototype === null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    requireValue(
      typeof key === "string" &&
        (!keys || keys.includes(key)) &&
        descriptor.enumerable &&
        "value" in descriptor,
    );
  }
}

function currency(value: unknown): asserts value is string {
  requireValue(typeof value === "string" && /^[A-Z]{3}$/.test(value));
}

function identifier(value: unknown): asserts value is string {
  requireValue(typeof value === "string" && value.length > 0 && value.trim() === value);
}

export function decimal(value: unknown, decimals: number): bigint {
  requireValue(typeof value === "string", "INVALID_AMOUNT");
  // O(1) guard before regex, slicing or BigInt conversion. The bound is derived
  // from the exported digit/scale limits and permits leading fractional zeroes.
  requireValue(value.length <= MAX_SIGNIFICANT_DIGITS + decimals + 2, "VALUE_TOO_LARGE");
  requireValue(/^(0|[1-9]\d*)(\.\d+)?$/.test(value), "INVALID_AMOUNT");
  const [whole, fractional = ""] = value.split(".") as [string, string?];
  requireValue(fractional.length <= decimals, "INVALID_AMOUNT");
  const coefficient = (whole + fractional).replace(/^0+/, "");
  requireValue(coefficient.length <= MAX_SIGNIFICANT_DIGITS, "VALUE_TOO_LARGE");
  return BigInt(whole + fractional) * TEN ** BigInt(decimals - fractional.length);
}

export function splitRatio(value: unknown): readonly [bigint, bigint] {
  requireValue(typeof value === "string", "INVALID_SPLIT");
  requireValue(value.length <= MAX_SIGNIFICANT_DIGITS * 2 + 1, "VALUE_TOO_LARGE");
  requireValue(/^[1-9]\d*:[1-9]\d*$/.test(value), "INVALID_SPLIT");
  const [n, m] = value.split(":") as [string, string];
  requireValue(
    n.length <= MAX_SIGNIFICANT_DIGITS && m.length <= MAX_SIGNIFICANT_DIGITS,
    "VALUE_TOO_LARGE",
  );
  return [BigInt(n), BigInt(m)];
}

export function options(value: HoldingsOptions): { decimals: number; price: bigint } {
  record(value, ["method", "currency", "minorUnits", "currentPrice"]);
  requireValue(value.method === "fifo" || value.method === "average");
  currency(value.currency);
  record(value.minorUnits);
  for (const [code, decimals] of Object.entries(value.minorUnits)) {
    currency(code);
    requireValue(Number.isInteger(decimals) && decimals >= 0);
    requireValue(decimals <= MAX_CURRENCY_MINOR_UNITS, "VALUE_TOO_LARGE");
  }
  requireValue(Object.hasOwn(value.minorUnits, value.currency));
  const decimals = value.minorUnits[value.currency]!;
  return { decimals, price: decimal(value.currentPrice, decimals) };
}

export interface ParsedTransaction {
  readonly id: string;
  readonly date: string;
  readonly kind: InvestmentTransaction["kind"];
  readonly quantity: bigint;
  readonly price: bigint;
  readonly fee: bigint;
  readonly ratio: readonly [bigint, bigint] | null;
}

/** Count is checked before options, array traversal, allocation or sorting. */
export function transactionCount(value: readonly InvestmentTransaction[]): void {
  requireValue(Array.isArray(value));
  requireValue(value.length <= MAX_TRANSACTIONS, "VALUE_TOO_LARGE");
  requireValue(Object.getPrototypeOf(value) === Array.prototype);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    requireValue(
      typeof key === "string" &&
        /^(0|[1-9]\d*)$/.test(key) &&
        descriptor.enumerable &&
        "value" in descriptor,
    );
  }
}

export function transactions(
  values: readonly InvestmentTransaction[],
  currencyCode: string,
  decimals: number,
): ParsedTransaction[] {
  const ids = new Set<string>();
  const result: ParsedTransaction[] = [];
  for (let index = 0; index < values.length; index++) {
    requireValue(Object.hasOwn(values, index));
    const value = values[index];
    record(value, ["id", "date", "kind", "quantity", "price", "fee", "currency", "ratio"]);
    identifier(value.id);
    requireValue(!ids.has(value.id));
    ids.add(value.id);
    requireValue(typeof value.date === "string" && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value.date));
    const time = Date.parse(`${value.date}T00:00:00.000Z`);
    requireValue(Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value.date);
    currency(value.currency);
    requireValue(value.currency === currencyCode, "CURRENCY_MISMATCH");
    requireValue(["buy", "sell", "split", "dividend", "fee"].includes(value.kind as string));
    const quantity = decimal(value.quantity, MAX_QUANTITY_DECIMALS);
    const price = decimal(value.price, decimals);
    const fee = decimal(value.fee, decimals);
    let ratio: readonly [bigint, bigint] | null = null;
    if (value.kind === "split") {
      ratio = splitRatio(value.ratio);
      requireValue(quantity === ZERO && price === ZERO && fee === ZERO, "INVALID_SPLIT");
    } else {
      requireValue(!Object.hasOwn(value, "ratio"));
      if (value.kind === "buy" || value.kind === "sell") {
        requireValue(quantity > ZERO, "INVALID_AMOUNT");
      } else {
        requireValue(quantity === ZERO, "INVALID_AMOUNT");
        if (value.kind === "fee") requireValue(price === ZERO, "INVALID_AMOUNT");
      }
    }
    result.push({
      id: value.id,
      date: value.date,
      kind: value.kind as InvestmentTransaction["kind"],
      quantity,
      price,
      fee,
      ratio,
    });
  }
  return result.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}
