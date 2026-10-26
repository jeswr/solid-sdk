// AUTHORED-BY Codex GPT-6.1-Sol
/** Require a fixture produced earlier in a test, with a useful failure if setup broke. */
export function fixtureValue<T>(value: T | undefined | null): NonNullable<T> {
  if (value === undefined || value === null) throw new Error("required test fixture is missing");
  return value as NonNullable<T>;
}
