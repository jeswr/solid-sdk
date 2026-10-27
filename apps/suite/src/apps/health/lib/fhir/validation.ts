// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  type FhirErrorCode,
  FhirExportError,
  MAX_FHIR_RECORDS,
  MAX_FHIR_STRING_LENGTH,
} from "./types";

export function requireValid(valid: boolean, code: FhirErrorCode, message: string): asserts valid {
  if (!valid) throw new FhirExportError(code, message);
}

/** Reflection on caller data can execute proxy traps; never expose their exceptions. */
function readData<T>(code: FhirErrorCode, read: () => T): T {
  try {
    return read();
  } catch {
    throw new FhirExportError(code, "Expected plain data");
  }
}

/** Validate and copy own data values once; callers only read the returned snapshot. */
export function record(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  code: FhirErrorCode = "INVALID_INPUT",
): Record<string, unknown> {
  return readData(code, () => {
    requireValid(
      typeof value === "object" && value !== null && !Array.isArray(value),
      code,
      "Expected a plain record",
    );
    const prototype: unknown = Object.getPrototypeOf(value);
    requireValid(
      prototype === Object.prototype || prototype === null,
      code,
      "Expected a plain record",
    );
    const snapshot: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      requireValid(
        typeof key === "string" &&
          (required.includes(key) || optional.includes(key)) &&
          descriptor?.enumerable === true &&
          "value" in descriptor,
        code,
        "Unexpected or non-data field",
      );
      snapshot[key] = descriptor.value;
    }
    requireValid(
      required.every((key) => Object.hasOwn(snapshot, key)),
      code,
      "Missing required field",
    );
    return snapshot;
  });
}

export function text(value: unknown, prefixLength = 0): value is string {
  if (typeof value !== "string") return false;
  let length = value.length + prefixLength;
  if (length > MAX_FHIR_STRING_LENGTH) {
    // Reject oversized UTF-16 data before scanning. Count surrogate pairs as one character.
    if (length > MAX_FHIR_STRING_LENGTH * 2) return false;
    for (const character of value) length -= character.length - 1;
    if (length > MAX_FHIR_STRING_LENGTH) return false;
  }
  return value.trim().length > 0;
}

export function id(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9.-]{1,64}$/.test(value);
}

/** Absolute REST Patient URLs can resolve independently of the bundle's UUID fullUrls. */
export function patientReference(value: unknown): value is string {
  if (!text(value) || !URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === "" &&
    /\/Patient\/[A-Za-z0-9.-]{1,64}$/.test(url.pathname) &&
    url.href === value
  );
}

export function numeric(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= Number.MAX_SAFE_INTEGER
  );
}

/** Strict Gregorian dates, zoned time, and millisecond precision; never Date.parse alone. */
export function date(value: unknown, allowDay = true): value is string {
  if (typeof value !== "string") return false;
  const pattern =
    /^(?!0000)(\d{4}-\d{2}-\d{2})(?:T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,3})?(Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00))?$/;
  const match = pattern.exec(value);
  if (!match) return false;
  if (!allowDay && match[2] === undefined) return false;
  const day = match[1];
  const midnight = Date.parse(`${day}T00:00:00Z`);
  return (
    Number.isFinite(midnight) &&
    new Date(midnight).toISOString().slice(0, 10) === day &&
    Number.isFinite(Date.parse(value))
  );
}

/** Compare validated dates at their supplied precision; Period.end includes matching times. */
export function periodOrdered(start: string, end: string): boolean {
  // A date has no timezone. Compare calendar days when either boundary is date-only.
  if (start.length === 10 || end.length === 10) return start.slice(0, 10) <= end.slice(0, 10);
  const fraction = /\.(\d+)/.exec(end)?.[1];
  const endPrecisionMs = fraction === undefined ? 1000 : 10 ** (3 - fraction.length);
  return Date.parse(start) < Date.parse(end) + endPrecisionMs;
}

export function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value)
  );
}

export function checkCount(count: number): void {
  requireValid(count <= MAX_FHIR_RECORDS, "TOO_MANY_RECORDS", "Too many health records");
}

/** Capture lengths before any element work, including the combined export count check. */
export function arrayLength(value: unknown, code: FhirErrorCode): number {
  return readData(code, () => {
    requireValid(Array.isArray(value), code, "Expected an array");
    // Real arrays always have an own length data descriptor. Proxies hiding it throw here.
    const { value: length } = Object.getOwnPropertyDescriptor(
      value,
      "length",
    ) as PropertyDescriptor;
    requireValid(
      Number.isSafeInteger(length) && length >= 0,
      code,
      "Expected a nonnegative safe array length",
    );
    return length;
  });
}

/** Copy descriptors using only the captured length, after checking the size bound. */
export function array(
  value: unknown,
  code: FhirErrorCode,
  length = arrayLength(value, code),
): unknown[] {
  checkCount(length);
  return readData(code, () => {
    requireValid(Object.getPrototypeOf(value) === Array.prototype, code, "Expected a plain array");
    requireValid(
      Reflect.ownKeys(value as object).length === length + 1,
      code,
      "Expected a dense data array",
    );
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      requireValid(
        descriptor?.enumerable === true && "value" in descriptor,
        code,
        "Expected a dense data array",
      );
      snapshot.push(descriptor.value);
    }
    return snapshot;
  });
}
