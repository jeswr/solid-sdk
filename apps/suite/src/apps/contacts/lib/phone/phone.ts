// AUTHORED-BY Codex GPT-6.1-Sol
import { PhoneNumberError } from "./errors";
import { callingPlans, type PhoneRegion, SUPPORTED_PHONE_REGIONS } from "./plans";

export interface ParsedPhoneNumber {
  readonly e164: string;
  readonly callingCode: string;
  readonly nationalNumber: string;
  /** Null when absent; extension digits (including leading zeroes) are preserved. */
  readonly extension: string | null;
}

export type PhoneNumberResult =
  | { readonly ok: true; readonly original: string; readonly number: ParsedPhoneNumber }
  | { readonly ok: false; readonly original: string; readonly error: PhoneNumberError };

export type PhoneNumberFormat = "national" | "international";

function assertInput(input: string): void {
  // A fixed bound also limits work on untrusted import data.
  if (typeof input !== "string" || input.length > 256 || /[^\x20-\x7e]/.test(input)) {
    throw new PhoneNumberError("invalid-input");
  }
}

/** International input requires +; national input requires an explicit supported region. */
function parse(input: string, defaultRegion?: PhoneRegion) {
  assertInput(input);
  if (defaultRegion !== undefined && !SUPPORTED_PHONE_REGIONS.includes(defaultRegion)) {
    throw new PhoneNumberError("invalid-region");
  }
  // Only ASCII spaces may surround the value; controls and Unicode digits are not rewritten.
  let body = input.replace(/^ +| +$/g, "");
  let extension: string | null = null;
  const suffix = /(?: *;ext=| *ext\.? *| *x *)([0-9]{1,10})$/i.exec(body);
  if (suffix) {
    extension = suffix[1] as string;
    body = body.slice(0, suffix.index).replace(/ +$/g, "");
  }
  if (/[;a-z]/i.test(body)) throw new PhoneNumberError("invalid-extension");
  // Full-token grammar: every separator must lie between digit groups. Parentheses
  // enclose a nonempty group, never an optional international trunk marker.
  // Single bare-digit tokens avoid ambiguous nested repetition on malformed input.
  if (!/^\+?(?:[0-9]|\([0-9]+\))(?:[ .-]*(?:[0-9]|\([0-9]+\)))*$/.test(body)) {
    throw new PhoneNumberError("invalid-input");
  }
  const digits = body.replace(/[ .()-]/g, "");
  let plan: (typeof callingPlans)[PhoneRegion];
  let nationalNumber: string;
  if (digits.startsWith("+")) {
    const matched = Object.values(callingPlans).find((entry) =>
      digits.startsWith(`+${entry.callingCode}`),
    );
    if (!matched) throw new PhoneNumberError("unsupported-number");
    plan = matched;
    nationalNumber = digits.slice(plan.callingCode.length + 1);
  } else {
    if (defaultRegion === undefined) throw new PhoneNumberError("missing-region");
    plan = callingPlans[defaultRegion];
    // US/CA accept ten digits or an explicit domestic 1. GB/AU require trunk 0.
    if (plan.callingCode === "1") {
      nationalNumber = digits.startsWith("1") ? digits.slice(1) : digits;
    } else {
      if (!digits.startsWith(plan.trunk)) throw new PhoneNumberError("unsupported-number");
      nationalNumber = digits.slice(1);
    }
  }
  const numberClass = plan.classes.find((entry) => entry.pattern.test(nationalNumber));
  if (!numberClass) {
    throw new PhoneNumberError("unsupported-number");
  }
  return {
    number: {
      e164: `+${plan.callingCode}${nationalNumber}`,
      callingCode: plan.callingCode,
      nationalNumber,
      extension,
    },
    plan,
    numberClass,
  };
}

/** International input requires +; national input requires an explicit supported region. */
export function parsePhoneNumber(input: string, defaultRegion?: PhoneRegion): ParsedPhoneNumber {
  return parse(input, defaultRegion).number;
}

/** Preserve unusable string input exactly, with no guessed number or duplicate key. */
export function normalisePhoneNumber(
  input: string,
  defaultRegion?: PhoneRegion,
): PhoneNumberResult {
  if (typeof input !== "string") throw new PhoneNumberError("invalid-input");
  try {
    return { ok: true, original: input, number: parsePhoneNumber(input, defaultRegion) };
  } catch (error) {
    if (!(error instanceof PhoneNumberError)) throw error;
    return { ok: false, original: input, error };
  }
}

/** Display format is chosen from the parsed calling plan, never the caller's locale. */
export function formatPhoneNumber(
  input: string,
  format: PhoneNumberFormat,
  defaultRegion?: PhoneRegion,
): string {
  if (format !== "national" && format !== "international") {
    throw new PhoneNumberError("invalid-format");
  }
  const { number: parsed, plan, numberClass } = parse(input, defaultRegion);
  let offset = 0;
  const parts = numberClass.groups.map((size) => {
    const part = parsed.nationalNumber.slice(offset, offset + size);
    offset += size;
    return part;
  });
  let display: string;
  if (format === "international") {
    display = `+${plan.callingCode} ${parts.join(" ")}`;
  } else if (plan.callingCode === "1") {
    display = `(${parts[0]}) ${parts[1]}-${parts[2]}`;
  } else if (plan.callingCode === "61" && !numberClass.mobile) {
    display = `(0${parts[0]}) ${parts.slice(1).join(" ")}`;
  } else {
    display = `0${parts.join(" ")}`;
  }
  return parsed.extension === null ? display : `${display} ext. ${parsed.extension}`;
}

/** Both operands must parse; extensions are significant, including leading zeroes. */
export function phoneNumbersEqual(
  left: string,
  right: string,
  defaultRegion?: PhoneRegion,
): boolean {
  const a = parsePhoneNumber(left, defaultRegion);
  const b = parsePhoneNumber(right, defaultRegion);
  return a.e164 === b.e164 && a.extension === b.extension;
}
