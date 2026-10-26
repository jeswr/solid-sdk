// AUTHORED-BY Codex GPT-6.1-Sol
export function finite(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Expected a finite number");
  return value;
}

export function timestamp(value: number): number {
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) {
    throw new RangeError("Expected integer Unix milliseconds within the Date range");
  }
  return value;
}
