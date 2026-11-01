// AUTHORED-BY Codex GPT-6
export function must<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error("Expected a value in the test fixture");
  return value;
}
