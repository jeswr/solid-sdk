// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { type FhirErrorCode, FhirExportError, MAX_FHIR_RECORDS } from "./types";

export function requireValid(valid: boolean, code: FhirErrorCode, message: string): asserts valid {
  if (!valid) throw new FhirExportError(code, message);
}

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject unknown fields and non-data records instead of dropping input silently. */
export function record(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  code: FhirErrorCode = "INVALID_INPUT",
): asserts value is Record<string, unknown> {
  requireValid(object(value), code, "Expected a plain record");
  const prototype: unknown = Object.getPrototypeOf(value);
  requireValid(
    prototype === Object.prototype || prototype === null,
    code,
    "Expected a plain record",
  );
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
  }
  requireValid(
    required.every((key) => Object.hasOwn(value, key)),
    code,
    "Missing required field",
  );
}

export function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function id(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9.-]{1,64}$/.test(value);
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

export function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value)
  );
}

export function checkCount(count: number): void {
  requireValid(count <= MAX_FHIR_RECORDS, "TOO_MANY_RECORDS", "Too many health records");
}

/** Count is checked by callers before inspecting any array elements or allocating copies. */
export function array(value: unknown, code: FhirErrorCode): asserts value is unknown[] {
  requireValid(Array.isArray(value), code, "Expected an array");
  requireValid(Object.getPrototypeOf(value) === Array.prototype, code, "Expected a plain array");
  requireValid(
    Reflect.ownKeys(value).length === value.length + 1,
    code,
    "Expected a dense data array",
  );
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    requireValid(
      descriptor?.enumerable === true && "value" in descriptor,
      code,
      "Expected a dense data array",
    );
  }
}
