// Ported from apps/pod-manager/src/lib/forms/subject-edit.ts
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
// AUTHORED-BY Claude Opus 5.5
/**
 * The pure heart of the generic editing engine: apply a field edit to a parsed
 * dataset, producing a NEW `n3.Store` that **preserves every unrelated triple**
 * and only replaces the `(subject, predicate)` triples the edit targets.
 *
 * This is the "never silently clobber" guarantee at the data level: an editor
 * reads a resource (keeping its ETag), edits one field, and writes the WHOLE
 * document back conditionally (`If-Match`). Because we start from the parsed
 * dataset and surgically replace only the edited statements, the round-trip is
 * byte-faithful for everything the user did not touch — no triple is dropped,
 * no blank-node graph is mangled, no provenance is lost.
 *
 * House rule: we operate on quads via `n3.Store` + `DataFactory`, never by
 * hand-concatenating Turtle. The object term is built per the field's
 * {@link ValueMode} (plain literal, typed literal, IRI, or `mailto:`/`tel:`).
 *
 * No React, no DOM, no I/O. `write.ts` wraps this with the conditional PUT.
 */
import { safeHttpIri } from "@jeswr/rdf-serialize";
import type { DatasetCore, Quad, Term } from "@rdfjs/types";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import {
  type FieldSpec,
  XSD_BOOLEAN,
  XSD_DATE,
  XSD_DATETIME,
  XSD_DECIMAL,
  XSD_INTEGER,
} from "./field-types.js";

const { namedNode, literal: lit } = DataFactory;
const VCARD = "http://www.w3.org/2006/vcard/ns#";
/** vCard links a structured value (often typed vcard:Work/Home) to the value itself. */
const INNER_VALUE_PREDICATES = [`${VCARD}hasValue`, `${VCARD}value`] as const;
/** Shown on a field Home will not edit, because editing it would lose data. */
export const MULTIPLE_VALUES_HINT = "Edit these in the app that created them.";
export const STRUCTURED_VALUE_HINT = "Edit this in the app that created it.";

class EditableSubject extends TermWrapper {
  values(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, TermAs.term, TermFrom.itself);
  }
}

/** A field's current shape: what it shows, and where an edit would write. */
export interface FieldState {
  /** Display strings for every value (never a blank-node label). */
  values: string[];
  /** Why the form must not edit this field; absent when it is safe to edit. */
  lockedReason?: string;
  /** The structured node and inner predicate an edit writes to, instead of the link. */
  inner?: { node: Term; predicate: string };
}

/** The `vcard:hasValue`/`vcard:value` statements of a structured value node. */
function innerValues(dataset: DatasetCore, node: Term): { predicate: string; object: Term }[] {
  if (node.termType !== "NamedNode" && node.termType !== "BlankNode") return [];
  const found: { predicate: string; object: Term }[] = [];
  for (const predicate of INNER_VALUE_PREDICATES)
    for (const q of dataset.match(
      node as Quad["subject"],
      namedNode(predicate),
      null,
      null,
    ) as Iterable<Quad>)
      found.push({ predicate, object: q.object });
  return found;
}

function displayValue(spec: FieldSpec, term: Term): string {
  if (spec.mode !== "mailto" && spec.mode !== "tel") return term.value;
  // A contact field shows an address or number, never an unrelated link.
  if (term.termType !== "Literal" && !/^(?:mailto|tel):/i.test(term.value)) return "";
  return /^mailto:/i.test(term.value) ? displayAddress(term.value) : stripScheme(term.value);
}

/** A run of valid `%XX` escapes, which {@link toMailto} keeps as they are. */
const PERCENT_ESCAPE = /%[0-9A-Fa-f]{2}/;

/**
 * Show a stored address decoded (`jörg@…`, not `j%C3%B6rg@…`) so an edit re-encodes it to
 * the same IRI. When decoding fails, or would yield text that itself looks escaped (from a
 * literal `%25`), the raw form is shown: {@link toMailto} keeps its escapes unchanged.
 */
function displayAddress(value: string): string {
  const raw = value.slice("mailto:".length);
  try {
    const decoded = decodeURIComponent(raw);
    return PERCENT_ESCAPE.test(decoded) ? raw : decoded;
  } catch {
    return raw;
  }
}

/**
 * Inspect a field before editing it. A field is locked (read-only in the form, and refused
 * by the writer) when it has more than one value — replacing it would delete the others —
 * or when its value is a nested structure Home can't edit in place. A single structured
 * vCard value (`vcard:hasEmail [ a vcard:Work; vcard:value <mailto:…> ]`) is editable: the
 * edit goes to its inner value, so the link, its type and any other details are kept.
 */
export function fieldState(
  dataset: DatasetCore,
  subject: string | Term,
  spec: FieldSpec,
): FieldState {
  const s = typeof subject === "string" ? namedNode(subject) : subject;
  const objects = [
    ...(dataset.match(
      s as Quad["subject"],
      namedNode(spec.predicate),
      null,
      null,
    ) as Iterable<Quad>),
  ].map((q) => q.object);
  const values: string[] = [];
  let structured = false;
  let inner: FieldState["inner"];
  for (const object of objects) {
    const nested = innerValues(dataset, object);
    if (nested.length) {
      structured = true;
      // An inner value that is itself a nested node is shown as nothing, never its label.
      const plain = nested.filter((value) => value.object.termType !== "BlankNode");
      for (const value of plain) values.push(displayValue(spec, value.object));
      if (nested.length === 1 && plain.length === 1)
        inner = { node: object, predicate: (nested[0] as { predicate: string }).predicate };
    } else if (object.termType === "BlankNode") structured = true;
    else values.push(displayValue(spec, object));
  }
  // Any second value (even a nested one with nothing to show) would be lost by an edit.
  if (values.length > 1 || objects.length > 1)
    return { values, lockedReason: MULTIPLE_VALUES_HINT };
  if (structured && !inner) return { values, lockedReason: STRUCTURED_VALUE_HINT };
  return inner ? { values, inner } : { values };
}

/**
 * Mark fields the form must not edit as read-only, with a hint saying why. Used for both
 * the first read and a re-read (the 412 "Keep my changes" path).
 */
export function lockUneditableFields(
  fields: readonly FieldSpec[],
  dataset: DatasetCore,
  subject: string | Term,
): FieldSpec[] {
  return fields.map((field) => {
    if (field.readOnly) return field;
    const reason = fieldState(dataset, subject, field).lockedReason;
    return reason ? { ...field, readOnly: true, hint: reason } : field;
  });
}

/** Replace a field's single value, refusing any edit that would drop other data. */
function replaceField(store: Store, subject: Term, spec: FieldSpec, term: Term | undefined) {
  const state = fieldState(store, subject, spec);
  if (state.lockedReason) throw new FieldValidationError(spec.id, state.lockedReason);
  const node = new EditableSubject(subject, store, DataFactory);
  if (state.inner) {
    const holder = new EditableSubject(state.inner.node, store, DataFactory);
    if (term) {
      const values = holder.values(state.inner.predicate);
      values.clear();
      values.add(term);
      return;
    }
    // Clearing a structured value removes the link and the now-unused value node.
    node.values(spec.predicate).delete(state.inner.node);
    const valueNode = state.inner.node;
    const quads = [...store];
    if (!quads.some((q) => q.object.equals(valueNode)))
      store.removeQuads(quads.filter((q) => q.subject.equals(valueNode)));
    return;
  }
  const values = node.values(spec.predicate);
  values.clear();
  if (term) values.add(term);
}

/** Thrown when a field's value fails validation before any write is attempted. */
export class FieldValidationError extends Error {
  readonly fieldId: string;
  constructor(fieldId: string, message: string) {
    super(message);
    this.name = "FieldValidationError";
    this.fieldId = fieldId;
  }
}

/** Copy every quad of `source` into a fresh `n3.Store` (a mutable working copy). */
export function cloneToStore(source: DatasetCore): Store {
  const store = new Store();
  for (const q of source as Iterable<Quad>) store.addQuad(q);
  return store;
}

/** A `%XX` escape that decodes to a control character (C0 or DEL). */
const CONTROL_ESCAPE = /^%(?:[01][0-9A-Fa-f]|7[Ff])$/;
/** Characters an email address may never carry into a `mailto:` IRI. */
const UNSAFE_EMAIL = /[\s<>"{}|\\^`]/;
/** One `@`, a dotted domain, and nothing that could break out of an IRI. */
export function isEmailAddress(value: string): boolean {
  return !UNSAFE_EMAIL.test(value) && /^[^@]+@[^@]+\.[^@]+$/.test(value);
}

/**
 * Wrap a bare email in a `mailto:` IRI; empty or unsafe → undefined. The address is
 * percent-encoded (`?` and `#` too, so it can't add headers or a fragment). Valid `%XX`
 * escapes are kept as they are, so a stored address shown undecoded doesn't gain another
 * `%25` on every edit; any other `%` is encoded, and so is the `%` of an escape for a control
 * character (`%00`–`%1F`, `%7F`), so a typed `%0D%0A` can never become a line break.
 */
export function toMailto(email: string): string | undefined {
  const v = email.trim();
  if (!v || !isEmailAddress(v)) return undefined;
  try {
    const encoded = v
      .split(/(%[0-9A-Fa-f]{2})/)
      .map((part, index) =>
        index % 2
          ? CONTROL_ESCAPE.test(part)
            ? `%25${part.slice(1)}`
            : part
          : encodeURI(part).replace(/[?#]/g, (ch) => encodeURIComponent(ch)),
      )
      .join("");
    return `mailto:${encoded}`;
  } catch {
    return undefined; // a lone surrogate can't be encoded
  }
}

/**
 * Wrap a bare phone in a `tel:` IRI. RFC 3966 disallows spaces, so strip
 * everything but digits and a leading `+`; empty → undefined.
 */
export function toTel(phone: string): string | undefined {
  const v = phone.trim();
  if (!v) return undefined;
  const digits = v.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : undefined;
}

/**
 * Validate + normalise a single string value for a field, returning the RDF
 * object `Term` to store — or `undefined` when the value is empty (the edit
 * then just *removes* the field's triples).
 *
 * @throws FieldValidationError for malformed non-empty input (bad URL, NaN
 *   number, unparsable date) so the UI can surface a precise message and the
 *   write never produces a corrupt graph.
 */
export function valueToTerm(spec: FieldSpec, raw: string): Term | undefined {
  const value = raw.trim();
  if (value === "") return undefined; // empty → clear the field

  switch (spec.mode) {
    case "iri": {
      const iri = absoluteHttpUrl(value);
      if (!iri) throw new FieldValidationError(spec.id, "Enter a valid http(s) URL.");
      return namedNode(iri);
    }
    case "mailto": {
      const m = toMailto(value);
      if (!m) throw new FieldValidationError(spec.id, "Enter a valid email address.");
      return namedNode(m);
    }
    case "tel": {
      const t = toTel(value);
      if (!t) throw new FieldValidationError(spec.id, "Enter a valid phone number.");
      return namedNode(t);
    }
    case "literal":
      return literalTermFor(spec, value);
  }
}

/** Build the literal term for a literal-mode field, validating by kind. */
function literalTermFor(spec: FieldSpec, value: string): Term {
  switch (spec.kind) {
    case "number": {
      if (!/^[+-]?\d+$/.test(value))
        throw new FieldValidationError(spec.id, "Enter a whole number.");
      return lit(value, namedNode(spec.datatype ?? XSD_INTEGER));
    }
    case "decimal": {
      if (!Number.isFinite(Number(value)))
        throw new FieldValidationError(spec.id, "Enter a number.");
      return lit(value, namedNode(spec.datatype ?? XSD_DECIMAL));
    }
    case "boolean": {
      const b = value === "true" || value === "1" ? "true" : "false";
      return lit(b, namedNode(spec.datatype ?? XSD_BOOLEAN));
    }
    case "date": {
      // Accept the browser's `yyyy-mm-dd` (xsd:date) verbatim once validated.
      if (Number.isNaN(Date.parse(value)))
        throw new FieldValidationError(spec.id, "Enter a valid date.");
      return lit(value, namedNode(spec.datatype ?? XSD_DATE));
    }
    case "datetime": {
      const iso = toIsoDateTime(value);
      if (!iso) throw new FieldValidationError(spec.id, "Enter a valid date and time.");
      return lit(iso, namedNode(spec.datatype ?? XSD_DATETIME));
    }
    default: {
      // text / textarea / choice / url-as-literal → plain string literal.
      // A datatype other than xsd:string is preserved if the spec carries one.
      const dt = spec.datatype;
      return dt && dt !== "http://www.w3.org/2001/XMLSchema#string"
        ? lit(value, namedNode(dt))
        : lit(value);
    }
  }
}

/**
 * A stored xsd:dateTime → the browser `datetime-local` value (`yyyy-mm-ddThh:mm`) in the
 * user's time zone. Slicing the ISO string would show UTC wall time and shift the instant
 * on save; {@link valueToTerm} converts the local wall time back to the same instant.
 */
export function toDatetimeLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A browser `datetime-local` value (local wall time) → an ISO-8601 UTC instant. */
function toIsoDateTime(value: string): string | undefined {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toISOString();
}

/**
 * Return `value` as an injection-safe absolute http(s) IRI (IRI-forbidden characters such
 * as spaces, `<` and `>` percent-encoded), else `undefined`.
 */
function absoluteHttpUrl(value: string): string | undefined {
  return safeHttpIri(value);
}

/**
 * Apply a single-valued field edit to `dataset`, returning a NEW store with
 * every `(subject, spec.predicate)` triple replaced by (at most) one new triple
 * for `rawValue`. An empty value clears the field. ALL other triples — other
 * predicates on the subject, other subjects, blank-node trees — are preserved
 * verbatim.
 *
 * @throws FieldValidationError when `rawValue` is malformed (see {@link valueToTerm}).
 */
export function applyFieldEdit(
  dataset: DatasetCore,
  subject: string | Term,
  spec: FieldSpec,
  rawValue: string,
): Store {
  const store = cloneToStore(dataset);
  replaceField(
    store,
    typeof subject === "string" ? namedNode(subject) : subject,
    spec,
    valueToTerm(spec, rawValue),
  );
  return store;
}

/**
 * Apply several single-valued field edits in one pass (so a multi-field save is
 * one document write). Edits are keyed by field `id`; only present keys are
 * touched, so omitting a field leaves it exactly as read.
 *
 * @throws FieldValidationError on the first malformed value (nothing is written).
 */
export function applyFieldEdits(
  dataset: DatasetCore,
  subject: string | Term,
  fields: readonly FieldSpec[],
  values: Readonly<Record<string, string>>,
): Store {
  // Validate everything FIRST so a bad value never leaves a half-applied store.
  for (const f of fields) {
    if (f.readOnly) continue;
    if (Object.hasOwn(values, f.id)) valueToTerm(f, values[f.id] as string);
  }
  const store = cloneToStore(dataset);
  const s = typeof subject === "string" ? namedNode(subject) : subject;
  for (const f of fields) {
    if (f.readOnly || !Object.hasOwn(values, f.id)) continue;
    replaceField(store, s, f, valueToTerm(f, values[f.id] as string));
  }
  return store;
}

/**
 * Read the current string value of a field off a subject (the inverse of
 * {@link valueToTerm}, for seeding the editor). Returns the first value's lexical form,
 * reading through a structured vCard value and stripping `mailto:`/`tel:` for display.
 * Absent, or a nested structure with no plain value → empty string (never a blank-node label).
 */
export function readFieldValue(
  dataset: DatasetCore,
  subject: string | Term,
  spec: FieldSpec,
): string {
  return fieldState(dataset, subject, spec).values[0] ?? "";
}

/** Read every value of a (possibly multi-valued) field as display strings. */
export function readFieldValues(
  dataset: DatasetCore,
  subject: string | Term,
  spec: FieldSpec,
): string[] {
  return fieldState(dataset, subject, spec).values;
}

/** Strip a `mailto:`/`tel:` scheme for display; anything else passes through. */
export function stripScheme(uri: string): string {
  const m = /^(?:mailto|tel):(.*)$/i.exec(uri);
  if (!m) return uri;
  try {
    return decodeURIComponent(m[1] as string);
  } catch {
    return m[1] as string;
  }
}
