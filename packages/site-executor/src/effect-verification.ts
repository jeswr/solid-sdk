// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
// Runtime evidence for existing resources; flashes never establish an effect.
import { type Extraction, SCHEMA } from "@jeswr/site-model";
import { jsonPointer } from "./dom.js";
import { extract } from "./extract.js";
import { jsonEnvelope, responsePageError } from "./response-evidence.js";
import { canonicalValue, validateValue } from "./values.js";
import { type EffectVerification, readBackIdentityMatches } from "./write-response.js";

export interface EffectSnapshot {
  values: Map<string, string[]>;
  envelope?: string[][];
  collection?: boolean;
}

/** The read must return one complete, explicitly identified target in its learned namespace. */
export async function effectSnapshot(
  ex: Extraction,
  body: string,
  url: string,
  identity: string,
  declaration: EffectVerification,
  redact: (value: string) => string,
): Promise<EffectSnapshot | undefined> {
  const ct = ex.format === "json" ? "application/json" : "text/html";
  if (responsePageError(body, ct, false) || redact(identity) !== identity) return;
  try {
    const out = await extract(ex, body, { baseUrl: url, redact });
    const item = out.items[0];
    if (!item || out.items.length !== 1 || out.truncation.items || out.truncation.values) return;
    const identityUrls = [
      ...(item.values.get(`${SCHEMA}url`) ?? []),
      ...(item.iri ? [item.iri] : []),
    ].map((value) => {
      if (!declaration.displaySlug || !/^\d+$/.test(identity)) return value;
      const candidate = new URL(value, url);
      const patterns = [declaration.identityPattern, ...(declaration.identityAliases ?? [])];
      return patterns.some((pattern) => {
        const expected = new URL(pattern.replace("{id}", encodeURIComponent(identity)), url);
        return (
          candidate.origin === expected.origin &&
          !candidate.search &&
          !candidate.hash &&
          candidate.pathname.startsWith(`${expected.pathname}/`) &&
          candidate.pathname.split("/").length === expected.pathname.split("/").length + 1 &&
          /^(?:-|[a-z][a-z0-9]*(?:-[a-z0-9]+)+)$/i.test(candidate.pathname.split("/").at(-1) ?? "")
        );
      })
        ? candidate.href.slice(0, candidate.href.lastIndexOf("/"))
        : value;
    });
    if (
      !readBackIdentityMatches(
        item.values.get(`${SCHEMA}identifier`) ?? [],
        identityUrls,
        identity,
        new URL(url).origin,
        [declaration.identityPattern, ...(declaration.identityAliases ?? [])],
      )
    )
      return;
    // This private equality extraction never enters observations or flow bindings.
    const equality = await extract(
      { ...ex, fields: ex.fields.map((field) => ({ ...field, untrusted: false })) },
      body,
      { baseUrl: url, redact },
    );
    if (equality.truncation.items || equality.truncation.values) return;
    const values = equality.items[0]?.values;
    if (!values) return;
    const envelope = ex.format === "json" ? jsonEnvelope(JSON.parse(body), ex.itemPath) : undefined;
    if (envelope?.failed) return;
    return {
      values,
      ...(envelope ? { envelope: envelope.keys } : {}),
      collection:
        ex.format === "json" && Array.isArray(jsonPointer(JSON.parse(body), ex.itemPath ?? "")),
    };
  } catch {
    return;
  }
}

/** An empty, identity-filtered list is evidence only in the baseline's success envelope. */
export function emptyEffectCollection(
  ex: Extraction,
  body: string,
  baseline: EffectSnapshot,
): boolean {
  if (
    ex.format !== "json" ||
    !baseline.collection ||
    responsePageError(body, "application/json", false)
  )
    return false;
  try {
    const doc: unknown = JSON.parse(body);
    const rows = jsonPointer(doc, ex.itemPath ?? "");
    const envelope = jsonEnvelope(doc, ex.itemPath);
    return (
      Array.isArray(rows) &&
      rows.length === 0 &&
      !envelope.failed &&
      JSON.stringify(envelope.keys) === JSON.stringify(baseline.envelope) &&
      (ex.totalPath === undefined || jsonPointer(doc, ex.totalPath) === 0)
    );
  } catch {
    return false;
  }
}

export function effectChangesMatch(
  declaration: EffectVerification,
  baseline: EffectSnapshot,
  after: EffectSnapshot,
  submitted: (input: string) => string | undefined,
  range: (input: string) => string | undefined = () => undefined,
): boolean {
  return (
    (declaration.changes.length > 0 || !!declaration.constantChanges?.length) &&
    declaration.changes.every((change) => {
      const sent = submitted(change.input);
      const values = after.values.get(change.property);
      if (sent === undefined || values?.length !== 1) return false;
      if (change.mode !== "delta")
        return effectValueEquals(sent, values[0] ?? "", range(change.input), change.format);
      const before = baseline.values.get(change.property);
      return (
        before?.length === 1 &&
        [before[0], values[0], sent].every((v) => v !== undefined && /^[+-]?\d{1,100}$/.test(v)) &&
        BigInt(values[0] ?? "0") - BigInt(before[0] ?? "0") === BigInt(sent)
      );
    })
  );
}

/** Private submitted-value equality, using the input's datatype without relabelling the read. */
export function effectValueEquals(
  submitted: string,
  observed: string,
  range?: string,
  format?: EffectVerification["changes"][number]["format"],
): boolean {
  if (format) return observed === formatEffectValue(submitted, format);
  if (!range) return observed === submitted;
  const parameter = {
    name: "verification",
    range,
    path: [],
    location: "body" as const,
    required: false,
  };
  try {
    validateValue(parameter, submitted);
    validateValue(parameter, observed);
    return canonicalValue(parameter, submitted) === canonicalValue(parameter, observed);
  } catch {
    return false;
  }
}

/** Effect-only presentation matching never changes observations or money evidence. */
export function formatEffectValue(
  value: string,
  format: NonNullable<EffectVerification["changes"][number]["format"]>,
): string | undefined {
  if (
    !Number.isSafeInteger(format.scale) ||
    format.scale < 0 ||
    format.scale > 20 ||
    format.prefix.length > 32 ||
    format.suffix.length > 32
  )
    return;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return;
  const fraction = match[3] ?? "";
  if (/[^0]/.test(fraction.slice(format.scale))) return;
  const whole = (match[2] ?? "0").replace(/^0+(?=\d)/, "");
  const sign = match[1] === "-" && /[1-9]/.test(whole + fraction) ? "-" : "";
  return `${format.prefix}${sign}${whole}${format.scale ? `.${fraction.slice(0, format.scale).padEnd(format.scale, "0")}` : ""}${format.suffix}`;
}

export function learnEffectValueFormat(
  submitted: string,
  observed: string,
): EffectVerification["changes"][number]["format"] {
  const match = /^([^\d+-]{0,32})([+-]?\d+(?:\.\d{1,20})?)([^\d]{0,32})$/.exec(observed);
  if (!match || submitted === observed) return;
  const format = {
    prefix: match[1] ?? "",
    suffix: match[3] ?? "",
    scale: match[2]?.split(".")[1]?.length ?? 0,
  };
  return formatEffectValue(submitted, format) === observed ? format : undefined;
}
