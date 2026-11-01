// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { autoFormFor, hasAutoForm } from "../src/apps/home/lib/forms/auto-form";
import { EDIT_MAP, editFieldsFor } from "../src/apps/home/lib/forms/edit-map";
import {
  defaultDatatypeFor,
  type FieldKind,
  type FieldSpec,
  normaliseField,
} from "../src/apps/home/lib/forms/field-types";
import { resolveForm } from "../src/apps/home/lib/forms/resolve-form";
import {
  applyFieldEdits,
  readFieldValue,
  readFieldValues,
  stripScheme,
  toMailto,
  toTel,
  valueToTerm,
} from "../src/apps/home/lib/forms/subject-edit";
import {
  findFormSubject,
  labelFromPredicate,
  parseUiForm,
} from "../src/apps/home/lib/forms/ui-form";
import { saveFieldEdit, saveFormEdits } from "../src/apps/home/lib/forms/write";

const url = "https://pod.example/test.ttl";
const subject = `${url}#it`;
const parse = (body: string) => parseRdf(body, "text/turtle", { baseIRI: url });
const field = (kind: FieldKind, extras: Partial<FieldSpec> = {}): FieldSpec => ({
  id: "f",
  label: "Value",
  predicate: "https://example.org/value",
  kind,
  mode: "literal",
  ...extras,
});
afterEach(() => vi.unstubAllGlobals());

it("infers all remaining widget types and ignores sibling subjects, types and duplicate predicates", async () => {
  const ds = await parse(`@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
    <#other> <https://e.org/x> "other" .
    <#it> a <https://e.org/Thing>; <https://e.org/date> "2026-01-01T00:00:00Z"^^xsd:dateTime;
      <https://e.org/decimal> "2.5"^^xsd:decimal; <https://e.org/float> "1.2"^^xsd:float;
      <https://e.org/double> "1.2"^^xsd:double; <https://e.org/long> "line\\nline";
      <https://e.org/nested> [ <https://e.org/name> "nested" ]; <https://e.org/decimal> "3.5"^^xsd:decimal.`);
  expect(autoFormFor(ds, subject).map((f) => f.kind)).toEqual([
    "datetime",
    "decimal",
    "decimal",
    "decimal",
    "textarea",
  ]);
  // A nested blank node gets no field: a text box would show its internal label.
  expect(autoFormFor(ds, subject).some((f) => f.predicate === "https://e.org/nested")).toBe(false);
  expect(hasAutoForm(ds, "https://absent.example/#it")).toBe(false);
  expect(autoFormFor(ds, "https://absent.example/#it")).toEqual([]);
  for (const kind of [
    "text",
    "textarea",
    "url",
    "email",
    "tel",
    "date",
    "datetime",
    "number",
    "decimal",
    "boolean",
    "choice",
  ] as const)
    expect(
      normaliseField({ label: "Value", predicate: "https://e.org/value", kind, mode: "literal" })
        .datatype,
    ).toBe(defaultDatatypeFor(kind));
  expect(defaultDatatypeFor("url")).toBeUndefined();
  expect(normaliseField(field("url", { mode: "iri" })).datatype).toBeUndefined();
});

it("validates numeric, boolean, date, phone and URL inputs and retains explicit datatypes", () => {
  for (const [kind, good, datatype] of [
    ["number", "12", "integer"],
    ["decimal", "1.2", "decimal"],
    ["date", "2026-01-01", "date"],
    ["datetime", "2026-01-01T12:00:00Z", "dateTime"],
  ] as const) {
    const term = valueToTerm(field(kind), good);
    expect(term?.termType).toBe("Literal");
    expect(
      valueToTerm(field(kind, { datatype: `https://example.org/${datatype}` }), good)?.value,
    ).toBe(term?.value);
    expect(() => valueToTerm(field(kind), "nonsense")).toThrow();
  }
  for (const input of ["true", "1", "false"])
    expect(valueToTerm(field("boolean"), input)?.value).toBe(input === "false" ? "false" : "true");
  expect(valueToTerm(field("boolean", { datatype: "https://e.org/bool" }), "false")?.value).toBe(
    "false",
  );
  expect(valueToTerm(field("text", { datatype: "https://e.org/code" }), "A")?.value).toBe("A");
  expect(
    valueToTerm(field("text", { datatype: "http://www.w3.org/2001/XMLSchema#string" }), "A")?.value,
  ).toBe("A");
  expect(() => valueToTerm(field("url", { mode: "iri" }), "bad")).toThrow();
  expect(valueToTerm(field("url", { mode: "iri" }), "http://example.org")?.value).toBe(
    "http://example.org",
  );
  expect(valueToTerm(field("tel", { mode: "tel" }), "+44 123")?.value).toBe("tel:+44123");
  expect(() => valueToTerm(field("tel", { mode: "tel" }), "abc")).toThrow();
  expect(toTel(" ")).toBeUndefined();
  expect(toTel("abc")).toBeUndefined();
  expect(toMailto(" ")).toBeUndefined();
  expect(toMailto("a@b.com")).toBe("mailto:a@b.com");
  expect(stripScheme("mailto:a%40b.com")).toBe("a@b.com");
  expect(stripScheme("plain")).toBe("plain");
});

it("reads missing/multiple fields and prevents read-only edits from changing the graph", async () => {
  const ds = await parse(`<#it> <https://example.org/value> <tel:+123>, <mailto:a@b.com>.`);
  expect(readFieldValue(ds, subject, field("tel", { mode: "tel" }))).toBe("+123");
  expect(readFieldValue(ds, subject, field("date"))).toBe("tel:+123");
  expect(readFieldValue(ds, subject, field("text"))).toBe("tel:+123");
  expect(readFieldValue(ds, "https://e.org/absent", field("text"))).toBe("");
  expect(readFieldValues(ds, subject, field("email", { mode: "mailto" }))).toEqual([
    "+123",
    "a@b.com",
  ]);
  expect(readFieldValues(ds, subject, field("text"))).toEqual(["tel:+123", "mailto:a@b.com"]);
  expect(readFieldValues(ds, subject, field("tel", { mode: "tel" }))).toHaveLength(2);
  expect([
    ...applyFieldEdits(ds, subject, [field("text", { readOnly: true })], { f: "changed" }),
  ]).toEqual([...ds]);
});

it("uses subject-local edit maps and falls back from empty authored forms", async () => {
  for (const cls of [
    "http://www.w3.org/2006/vcard/ns#Individual",
    "https://schema.org/MusicRecording",
    "https://schema.org/ImageObject",
    "https://schema.org/Photograph",
    "https://schema.org/Event",
    "http://www.w3.org/2002/01/bookmark#Bookmark",
    "https://jeswr.org/ns/bookmark#Bookmark",
  ]) {
    const ds = await parse(
      `<#other> a <https://schema.org/Event>. <#it> a <${cls}>; <https://schema.org/name> "Existing name" .`,
    );
    const form = resolveForm(url, ds, subject, { formDataset: new Store() });
    expect(form.source).toBe("typed-view");
    expect(form.fields.find((f) => ["Name", "Title"].includes(f.label))?.predicate).toBe(
      "https://schema.org/name",
    );
  }
  expect(editFieldsFor("missing")).toBeUndefined();
  expect(Object.keys(EDIT_MAP)).toHaveLength(5);
});

it("parses partial/cyclic authored forms without hanging or inventing fields", async () => {
  const prefix =
    "@prefix ui: <http://www.w3.org/ns/ui#>. @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>. @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.";
  const ds = await parse(`${prefix}
    <#group> a ui:Group, ui:Group; ui:part <#group>, <#unknown>, <#choice>, <#emptyChoice>, <#noOptions>, <#noType>, <#literal>;
    ui:parts [ rdf:rest rdf:nil ].
    <#unknown> a <https://e.org/Unknown>.
    <#choice> a <https://e.org/Unknown>, ui:Choice; ui:property <https://e.org/value>;
      ui:choices ( <#a> <#b> ); ui:maxLength 12.
    <#a> rdfs:label "Option A".
    <#noOptions> a ui:Choice; ui:property <https://e.org/noOptions>.
    <#emptyChoice> a ui:Choice; ui:property <https://e.org/empty>; ui:values rdf:nil.
    <#literal> a ui:Choice; ui:property <https://e.org/literal>; ui:values "invalid".`);
  expect(findFormSubject(ds)).toBe(`${url}#group`);
  const fields = parseUiForm(ds);
  expect(fields[0]?.options?.map((o) => o.label)).toEqual(["Option A", "B"]);
  expect(fields[0]?.hint).toBe("Up to 12 characters");
  expect(fields[1]?.options).toBeUndefined();
  expect(fields[2]?.options).toBeUndefined();
  expect(
    parseUiForm(
      await parse(
        `${prefix}<#g> a ui:Group; ui:parts <#list>. <#list> rdf:first <#g>; rdf:rest <#list>.`,
      ),
    ),
  ).toEqual([]);
  expect(labelFromPredicate("")).toBe("");
  expect(labelFromPredicate("###")).toBe("###");
  expect(labelFromPredicate("https://e.org/___")).toBe("https://e.org/___");
});

it("maps every save failure and supports create-only and explicit no-validator saves", async () => {
  const ds = new Store();
  const f = field("text");
  expect(await saveFormEdits(url, ds, subject, [f], { f: "A" })).toMatchObject({ reason: "stale" });
  expect(await saveFieldEdit(url, ds, subject, f, "A")).toMatchObject({ reason: "stale" });
  for (const status of [401, 403, 412, 500]) {
    const fetchImpl = vi.fn(async () => new Response("", { status }));
    expect(
      await saveFormEdits(url, ds, subject, [f], { f: "A" }, { etag: '"1"', fetchImpl }),
    ).toMatchObject({ reason: status === 412 ? "stale" : status < 500 ? "forbidden" : "error" });
  }
  const failed = vi.fn(async () => {
    throw new Error("Network");
  });
  expect(
    await saveFormEdits(url, ds, subject, [f], { f: "A" }, { etag: '"1"', fetchImpl: failed }),
  ).toMatchObject({ reason: "error" });
  expect(
    await saveFormEdits(
      url,
      ds,
      subject,
      [field("number")],
      { f: "bad" },
      { etag: '"1"', fetchImpl: failed },
    ),
  ).toMatchObject({ reason: "validation", fieldId: "f" });
  const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
  expect(
    await saveFormEdits(
      url,
      ds,
      subject,
      [f],
      { f: "New" },
      { createOnly: true, fetchImpl, prefixes: {} },
    ),
  ).toEqual({ ok: true, etag: null });
  expect(fetchImpl).toHaveBeenCalledWith(url, expect.objectContaining({ method: "PUT" }));
  vi.stubGlobal("fetch", fetchImpl);
  expect(await saveFieldEdit(url, ds, subject, f, "Global", { allowUnconditional: true })).toEqual({
    ok: true,
    etag: null,
  });
});

it("reads nested vCard email/phone values and tolerates malformed percent escapes", async () => {
  const ds =
    await parse(`<#it> <https://example.org/value> [ <http://www.w3.org/2006/vcard/ns#hasValue> <mailto:ada@example.org> ], <#phone>, <#malformed>, "literal@example.org", <tel:+123>.
    <#phone> <http://www.w3.org/2006/vcard/ns#value> "+44123".
    <#malformed> <http://www.w3.org/2006/vcard/ns#hasValue> <https://unrelated.example/>.`);
  expect(readFieldValue(ds, subject, field("email", { mode: "mailto" }))).toBe("ada@example.org");
  expect(readFieldValues(ds, subject, field("tel", { mode: "tel" }))).toEqual([
    "ada@example.org",
    "+44123",
    "",
    "literal@example.org",
    "+123",
  ]);
  expect(stripScheme("mailto:bad%escape")).toBe("bad%escape");
});
