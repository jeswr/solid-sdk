// AUTHORED-BY Codex GPT-6
export interface Money {
  amount: string;
  currency: string;
}
export interface UnitAmount {
  units: string;
  currency: string;
}

/** Currency precision is explicit profile data; no inferred currency or asset registry. */
export function convertMoney(value: Money, decimals: number): UnitAmount;
export function convertMoney(value: UnitAmount, decimals: number): Money;
export function convertMoney(value: Money | UnitAmount, decimals: number): Money | UnitAmount {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36)
    throw new Error("invalid precision");
  if (!/^[A-Za-z][A-Za-z0-9._:-]{1,127}$/.test(value.currency)) throw new Error("invalid currency");
  if ("amount" in value) {
    if (!/^(0|[1-9]\d*)(?:\.\d+)?$/.test(value.amount)) throw new Error("invalid decimal amount");
    const [whole, fraction = ""] = value.amount.split(".");
    if (fraction.length > decimals) throw new Error("excess amount precision");
    return {
      units: BigInt(`${whole}${fraction.padEnd(decimals, "0")}`).toString(),
      currency: value.currency,
    };
  }
  if (!/^(0|[1-9]\d*)$/.test(value.units)) throw new Error("invalid units");
  const padded = value.units.padStart(decimals + 1, "0");
  const amount = decimals ? `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}` : padded;
  return { amount, currency: value.currency };
}

/** Integer arithmetic for the provider ledger, without a fixed currency precision. */
export function decimalParts(amount: string): { value: bigint; scale: number } {
  if (!/^(0|[1-9]\d*)(?:\.\d+)?$/.test(amount) || amount.length > 128)
    throw new Error("invalid amount");
  const [whole, fraction = ""] = amount.split(".");
  return { value: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

export function decimalText(value: bigint, scale: number): string {
  const padded = value.toString().padStart(scale + 1, "0");
  return scale ? `${padded.slice(0, -scale)}.${padded.slice(-scale)}` : padded;
}
