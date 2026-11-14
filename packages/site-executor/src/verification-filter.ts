// AUTHORED-BY Codex GPT-6
import { type Operation, SCHEMA } from "@jeswr/site-model";
import type { CompiledRequest } from "./compile.js";
import { wireInputSources } from "./verification-context.js";
import { effectiveWireFields } from "./wire.js";

/** Only whole equality filters (including a closed from/to range) isolate an identity. */
export function exactIdentityFilter(
  read: Operation,
  compiled: CompiledRequest,
  bind: Record<string, { input: string } | { value: string }>,
  identityInput: string,
  identity: string,
): boolean {
  const keys =
    read.extraction?.fields
      .filter(
        (f) => !f.untrusted && f.property === `${SCHEMA}identifier` && /^\/[^/]+$/.test(f.path),
      )
      .map((f) => f.path.slice(1).replaceAll("~1", "/").replaceAll("~0", "~")) ?? [];
  const fields = effectiveWireFields(compiled).filter((f) => f.location === "query");
  if (fields.some((f) => /(?:^|\[)(?:or|operator|condition_type)(?:\]|$)/i.test(f.name)))
    return false;
  const sources = wireInputSources(read, compiled.url.origin);
  const bound = (name: string) => {
    const actual = fields.filter((f) => f.name === name);
    const probe = sources.filter((f) => f.location === "query" && f.name === name);
    const at = /^sab_scope_input_(\d+)_end$/.exec(probe[0]?.value ?? "")?.[1];
    const input = at === undefined ? undefined : read.inputs[Number(at)]?.name;
    const binding = input === undefined ? undefined : bind[input];
    return (
      actual.length === 1 &&
      actual[0]?.value === identity &&
      probe.length === 1 &&
      binding !== undefined &&
      "input" in binding &&
      binding.input === identityInput
    );
  };
  return keys.some((key) =>
    [key, `filter[${key}]`, `filters[${key}]`].some((base) => {
      const names = fields
        .filter((f) => f.name === base || f.name.startsWith(`${base}[`))
        .map((f) => f.name);
      if (names.length === 1 && (names[0] === base || names[0] === `${base}[eq]`))
        return bound(names[0]);
      return (
        names.length === 2 &&
        names.includes(`${base}[from]`) &&
        names.includes(`${base}[to]`) &&
        names.every(bound)
      );
    }),
  );
}
