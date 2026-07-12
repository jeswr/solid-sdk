// AUTHORED-BY Codex GPT-5

/** Normalize a source label into an ASCII TypeScript constant identifier. */
export function screamingSnakeIdentifier(value: string): string {
  const result = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toUpperCase())
    .join("_");
  if (result.length === 0)
    throw new Error(`Cannot derive a TypeScript constant name from ${value}`);
  return /^\d/.test(result) ? `VALUE_${result}` : result;
}

export function namespaceConstantName(prefix: string): string {
  return `${screamingSnakeIdentifier(prefix)}_NS`;
}
