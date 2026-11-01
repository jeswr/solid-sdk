// AUTHORED-BY Codex GPT-6.1-Sol
import type { Address } from "postal-mime";

/** mailto IRIs for every address, flattening groups (MAI-01 `addresses`). */
export function mailtos(values: readonly Address[] | undefined): string[] {
  return (values ?? []).flatMap((value) =>
    value.group
      ? mailtos(value.group)
      : value.address
        ? [`mailto:${encodeURIComponent(value.address)}`]
        : [],
  );
}
