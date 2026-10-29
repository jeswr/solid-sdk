// AUTHORED-BY Codex GPT-6.1-Sol

/** A zoned calendar instant; Date.parse alone normalizes invalid days and offsets. */
export function validInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/.test(
      value,
    ) &&
    new Date(value.slice(0, 10)).toISOString().slice(0, 10) === value.slice(0, 10)
  );
}
