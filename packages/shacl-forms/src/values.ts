// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  applyScalarGuards,
  hasDatasetClass,
  httpIriOrUndefined,
  isSafeAbsoluteIri,
  literalMapper,
  type ManifestField,
  readLiteral,
  sanitizeText,
  tryRead,
  XSD,
} from "@jeswr/model-runtime";
import type { DatasetCore, Term } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { LIMIT, objects, put, RDF, termId, withPrefixes } from "./rdf.js";
import { checkedForm, isIriField } from "./shapes.js";
import type {
  FieldDescriptor,
  FormIssue,
  FormModel,
  FormValue,
  FormValues,
  ValidationResult,
} from "./types.js";

const safeSubject = (value: unknown): value is string =>
  isSafeAbsoluteIri(value) &&
  /^https?:\/\//i.test(value) &&
  httpIriOrUndefined(value) !== undefined;
function manifestField(field: FieldDescriptor): ManifestField {
  return {
    name: field.key,
    predicate: field.path,
    kind: isIriField(field) ? "iri" : "literal",
    datatype: field.datatype,
    guards: {
      minLength: field.minLength,
      minInclusive: field.minInclusive,
      maxInclusive: field.maxInclusive,
      nonBlank: field.pattern === "\\S",
      iriPattern:
        field.pattern === "^https://"
          ? "https"
          : field.pattern === "^https?://"
            ? "http-https"
            : undefined,
    },
  };
}
function optionTerm(
  field: FieldDescriptor,
  option: NonNullable<FieldDescriptor["options"]>[number],
): Term {
  return option.termType === "NamedNode"
    ? DataFactory.namedNode(option.value)
    : DataFactory.literal(option.value, DataFactory.namedNode(field.datatype ?? `${XSD}string`));
}
/** Shared scalar write path: check type via mapper, sanitize text, then guard the stored spelling. */
function writeTerm(field: FieldDescriptor, value: unknown): Term | undefined {
  return tryRead(() => {
    if (typeof value === "string" && value.length > LIMIT.text) return undefined;
    let term: Term;
    let mapped: unknown;
    if (isIriField(field)) {
      if (typeof value !== "string" || applyScalarGuards(manifestField(field), value) === undefined)
        return undefined;
      const iri = httpIriOrUndefined(value);
      if (!iri) return undefined;
      mapped = field.options ? value : iri;
      term = DataFactory.namedNode(mapped as string);
    } else {
      const mapper = literalMapper(field.datatype as string);
      if (
        mapper.jsType === "date"
          ? !(value instanceof Date) || !Number.isFinite(value.getTime())
          : typeof value !== mapper.jsType
      )
        return undefined;
      if (typeof value === "string") {
        if (mapper.lexicalValid && !mapper.lexicalValid(value)) return undefined;
        if (!mapper.lexicalValid) value = sanitizeText(value);
      }
      term = mapper.from(value as never, DataFactory);
      mapped = readLiteral(term);
    }
    if (applyScalarGuards(manifestField(field), mapped) === undefined) return undefined;
    if (field.options && !field.options.some((option) => term.equals(optionTerm(field, option))))
      return undefined;
    return term;
  });
}
function readTerm(field: FieldDescriptor, term: Term, data: DatasetCore): FormValue | undefined {
  return tryRead(() => {
    if (term.value.length > LIMIT.text) return undefined;
    if (field.options && !field.options.some((option) => term.equals(optionTerm(field, option))))
      return undefined;
    if (isIriField(field)) {
      if (
        term.termType !== "NamedNode" ||
        applyScalarGuards(manifestField(field), term.value) === undefined
      )
        return undefined;
      const iri = httpIriOrUndefined(term.value);
      if (
        !iri ||
        (field.hasClass &&
          !hasDatasetClass(new TermWrapper(term, data, DataFactory), term.value, [field.hasClass]))
      )
        return undefined;
      return field.options ? term.value : iri;
    }
    if (term.termType !== "Literal" || term.datatype.value !== field.datatype) return undefined;
    const value = readLiteral(term);
    return applyScalarGuards(manifestField(field), value) as FormValue | undefined;
  });
}
const record = (value: unknown): value is FormValues =>
  value !== null &&
  typeof value === "object" &&
  !(value instanceof Date) &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
interface Budget {
  reads: number;
}
function visit(budget: Budget): void {
  if (++budget.reads > LIMIT.values)
    throw new TypeError("response exceeds the 10,000-value budget");
}
export function validate(form: FormModel, values: FormValues): ValidationResult {
  form = checkedForm(form);
  const issues: FormIssue[] = [];
  const budget = { reads: 0 };
  const walk = (model: FormModel, input: unknown, prefix: string, ancestors: Set<object>): void => {
    if (!record(input) || ancestors.has(input)) {
      issues.push({
        key: prefix || "$",
        path: model.shape,
        message: "Expected an acyclic values object",
        severity: "violation",
      });
      return;
    }
    const next = new Set(ancestors).add(input);
    for (const field of model.fields) {
      const key = prefix + field.key;
      const issue = (message: string, severity = field.severity): void => {
        issues.push({ key, path: field.path, message: field.message ?? message, severity });
      };
      const inputValue = Object.hasOwn(input, field.key) ? input[field.key] : undefined;
      const entries =
        inputValue === undefined ? [] : Array.isArray(inputValue) ? inputValue : [inputValue];
      // Count the RDF values that will actually be emitted, not duplicate JS entries.
      const distinct = new Map<string, unknown>();
      for (const entry of entries) {
        visit(budget);
        if (field.kind === "node") {
          if (!record(entry)) {
            issue("Expected nested form values");
            continue;
          }
          distinct.set(String(distinct.size), entry);
        } else {
          const term = writeTerm(field, entry);
          if (!term) {
            issue("Value does not satisfy the field constraints");
            continue;
          }
          distinct.set(termId(term), entry);
        }
      }
      if (distinct.size < field.minCount) issue(`Expected at least ${field.minCount} value(s)`);
      if (field.maxCount !== undefined && distinct.size > field.maxCount)
        issue(`Expected at most ${field.maxCount} value(s)`);
      if (field.form) {
        let i = 0;
        for (const entry of distinct.values()) {
          const before = issues.length;
          walk(field.form, entry, `${key}${entries.length > 1 ? `[${i++}]` : ""}.`, next);
          if (issues.length > before) issue("Nested value does not conform to its shape");
        }
      }
    }
  };
  try {
    walk(form, values, "", new Set());
  } catch {
    issues.push({
      key: "$",
      path: form.shape,
      message: "Response budget exceeded or unreadable values",
      severity: "violation",
    });
  }
  return { valid: !issues.some((issue) => issue.severity === "violation"), issues };
}
export function build(form: FormModel, subject: string, values: FormValues): Store {
  if (!safeSubject(subject)) throw new TypeError("subject must be a safe absolute http(s) URL");
  form = checkedForm(form);
  const result = validate(form, values);
  if (!result.valid)
    throw new TypeError(
      result.issues
        .filter((issue) => issue.severity === "violation")
        .map((issue) => `${issue.key}: ${issue.message}`)
        .join("; "),
    );
  const store = withPrefixes(new Store(), form.prefixes);
  const budget = { reads: 0 };
  let childId = 0;
  const occupied = new Set([subject]);
  // Collect caller-supplied IRI identities before minting child subjects.
  const collect = (model: FormModel, input: FormValues): void => {
    for (const field of model.fields) {
      const value = Object.hasOwn(input, field.key) ? input[field.key] : undefined;
      const entries = value === undefined ? [] : Array.isArray(value) ? value : [value];
      for (const entry of entries) {
        visit(budget);
        if (field.form && record(entry)) collect(field.form, entry);
        else {
          const term = writeTerm(field, entry);
          if (term?.termType === "NamedNode") occupied.add(term.value);
        }
      }
    }
  };
  collect(form, values);
  budget.reads = 0;
  const walk = (model: FormModel, id: string, input: FormValues): void => {
    const node = DataFactory.namedNode(id);
    if (model.targetClass) put(store, node, `${RDF}type`, DataFactory.namedNode(model.targetClass));
    for (const field of model.fields) {
      const value = Object.hasOwn(input, field.key) ? input[field.key] : undefined;
      const entries = value === undefined ? [] : Array.isArray(value) ? value : [value];
      let emitted = 0;
      const emittedTerms = new Set<string>();
      for (const entry of entries) {
        visit(budget);
        if (field.maxCount !== undefined && emitted >= field.maxCount) break;
        if (field.form) {
          if (!record(entry) || validate(field.form, entry).issues.length > 0) continue;
          let child: string;
          do {
            const url = new URL(subject);
            url.hash = `form-node-${++childId}`;
            child = url.href;
          } while (occupied.has(child));
          occupied.add(child);
          const term = DataFactory.namedNode(child);
          put(store, node, field.path, term);
          if (field.hasClass) put(store, term, `${RDF}type`, DataFactory.namedNode(field.hasClass));
          walk(field.form, child, entry);
          emitted++;
        } else {
          const term = writeTerm(field, entry);
          if (!term || emittedTerms.has(termId(term))) continue;
          emittedTerms.add(termId(term));
          put(store, node, field.path, term);
          if (field.hasClass && term.termType === "NamedNode")
            put(store, term, `${RDF}type`, DataFactory.namedNode(field.hasClass));
          emitted++;
        }
      }
    }
  };
  walk(form, subject, values);
  if (store.size > LIMIT.quads) throw new TypeError("response quad limit exceeded");
  return store;
}
export function parse(form: FormModel, subject: string, data: DatasetCore): FormValues {
  try {
    if (!safeSubject(subject)) return {};
    form = checkedForm(form);
    const budget = { reads: 0 };
    const walk = (
      model: FormModel,
      id: string,
      strict: boolean,
      ancestors: Set<string>,
    ): { values: FormValues; conforms: boolean } => {
      if (ancestors.has(id)) return { values: {}, conforms: false };
      const next = new Set(ancestors).add(id);
      const values: FormValues = {};
      let conforms = true;
      for (const field of model.fields) {
        const raw = new Map<string, Term>();
        let overflow = false;
        for (const term of objects(data, DataFactory.namedNode(id), field.path)) {
          visit(budget);
          raw.set(termId(term), term);
          if (field.maxCount !== undefined && raw.size > field.maxCount) {
            overflow = true;
            break;
          }
        }
        const valid: FormValue[] = [];
        if (!overflow)
          for (const term of raw.values()) {
            let value: FormValue | undefined;
            if (field.form) {
              if (
                term.termType === "NamedNode" &&
                safeSubject(term.value) &&
                (!field.hasClass ||
                  hasDatasetClass(new TermWrapper(term, data, DataFactory), term.value, [
                    field.hasClass,
                  ]))
              ) {
                const child = walk(field.form, term.value, true, next);
                if (child.conforms) value = child.values;
              }
            } else value = readTerm(field, term, data);
            if (value !== undefined) valid.push(value);
          }
        const bad = overflow || valid.length < field.minCount || valid.length !== raw.size;
        if (bad) conforms = false;
        if (overflow || valid.length < field.minCount || (strict && bad)) continue;
        if (valid.length)
          values[field.key] = field.maxCount === 1 ? (valid[0] as FormValue) : valid;
      }
      return { values, conforms };
    };
    return walk(form, subject, false, new Set()).values;
  } catch {
    return {};
  }
}
