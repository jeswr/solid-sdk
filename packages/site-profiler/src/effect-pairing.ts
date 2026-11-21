// AUTHORED-BY Codex GPT-6
import {
  compileOperation,
  type EffectVerification,
  effectiveWireFields,
  effectValueEquals,
  learnEffectValueFormat,
  sentInputValue,
} from "@jeswr/site-executor";
import type { Extraction, Operation, Parameter } from "@jeswr/site-model";

type Item = Record<string, string[]>;

const normalizeKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const pointerLeaf = (name: string) =>
  name.split("/").at(-1)?.replace(/~1/g, "/").replace(/~0/g, "~") ?? "";

/** Wire leaves, not semantic terms: product[stock_data][qty] and /qty share a key. */
export function leafKey(name: string): string {
  return normalizeKey(
    name
      .split(/[[\].]/)
      .filter(Boolean)
      .at(-1) ?? "",
  );
}

function inputLeaves(
  operation: Operation,
  values: Record<string, string>,
  input: Parameter,
  origin: string,
) {
  const actual = effectiveWireFields(compileOperation(operation, values, origin));
  let marker = "sab_pairing_leaf_marker";
  while (actual.some((field) => field.value.includes(marker))) marker += "_x";
  const compiled = compileOperation(operation, { ...values, [input.name]: marker }, origin, {
    placeholders: new Set([input.name]),
  });
  return new Set(
    effectiveWireFields(compiled)
      .filter((f) => f.value === marker && !f.sessionToken)
      .map((f) =>
        compiled.body?.kind === "json" && f.location === "body"
          ? normalizeKey(pointerLeaf(f.name))
          : leafKey(f.name),
      )
      .filter(Boolean),
  );
}

/** Change evidence outranks a leaf match. Equal-strength fields are never picked arbitrarily. */
export function pairSubmittedField(
  operation: Operation,
  values: Record<string, string>,
  input: Parameter,
  origin: string,
  extraction: Extraction,
  before: readonly Item[],
  after: readonly Item[],
): EffectVerification["changes"][number] | undefined {
  const submitted = sentInputValue(operation, values, input.name, origin);
  if (submitted === undefined) return;
  const leaves = inputLeaves(operation, values, input, origin);
  const pairing = pairSubmittedValue(submitted, input.range, leaves, extraction, before, after);
  return pairing ? { input: input.name, ...pairing } : undefined;
}

/**
 * Literal and bound state fields use exactly the same witnessed pairing rule. `before` holds
 * the reads at the write's identity since the previous write, oldest first: only the latest
 * read observing a field is its baseline, and without one there is no change evidence.
 */
export function pairSubmittedValue(
  submitted: string,
  range: string | undefined,
  leaves: ReadonlySet<string>,
  extraction: Extraction,
  before: readonly Item[],
  after: readonly Item[],
): { property: string; format?: EffectVerification["changes"][number]["format"] } | undefined {
  const candidates = extraction.fields
    .flatMap((field) => {
      // A private property pairing cannot address two separate rules sharing that property.
      if (extraction.fields.filter((f) => f.property === field.property).length !== 1) return [];
      const key =
        extraction.format === "json"
          ? pointerLeaf(field.path)
          : /\[name=(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\]/
              .exec(field.path)
              ?.slice(1)
              .find((v) => v !== undefined);
      const leaf = key
        ? leaves.has(extraction.format === "json" ? normalizeKey(key) : leafKey(key))
        : false;
      const matches = after.flatMap((item) => {
        const observed = item[field.property];
        if (observed?.length !== 1) return [];
        const value = observed[0] ?? "";
        const format = /#(?:decimal|integer)$/.test(range ?? "")
          ? learnEffectValueFormat(submitted, value)
          : undefined;
        if (!effectValueEquals(submitted, value, range, format)) return [];
        const previous = before.findLast((item) => item[field.property]?.length)?.[field.property];
        const previousFormat =
          previous?.length === 1 && /#(?:decimal|integer)$/.test(range ?? "")
            ? learnEffectValueFormat(submitted, previous[0] ?? "")
            : undefined;
        const changed =
          previous?.length === 1 &&
          !effectValueEquals(submitted, previous[0] ?? "", range, previousFormat);
        return changed || leaf ? [{ strength: changed ? 2 : 1, format }] : [];
      });
      const strongest = matches.sort((a, b) => b.strength - a.strength)[0];
      return strongest ? [{ property: field.property, ...strongest }] : [];
    })
    .sort((a, b) => b.strength - a.strength);
  const best = candidates[0];
  if (!best || candidates[1]?.strength === best.strength) return;
  return {
    property: best.property,
    ...(best.format ? { format: best.format } : {}),
  };
}
