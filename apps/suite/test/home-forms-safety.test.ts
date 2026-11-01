// AUTHORED-BY Claude Opus 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import type { DatasetCore, Quad } from "@rdfjs/types";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { autoFormFor } from "../src/apps/home/lib/forms/auto-form";
import { CONTACT_FIELDS, PHOTO_FIELDS } from "../src/apps/home/lib/forms/edit-map";
import { type FieldSpec, normaliseField } from "../src/apps/home/lib/forms/field-types";
import {
  itemEditFields,
  PROFILE_FIELD_NAMES,
  profileFields,
} from "../src/apps/home/lib/forms/profile-fields";
import {
  applyFieldEdits,
  FieldValidationError,
  fieldState,
  lockUneditableFields,
  MULTIPLE_VALUES_HINT,
  readFieldValue,
  STRUCTURED_VALUE_HINT,
  toMailto,
  valueToTerm,
} from "../src/apps/home/lib/forms/subject-edit";
import { saveFormEdits } from "../src/apps/home/lib/forms/write";

const { namedNode } = DataFactory;
const url = "https://pod.example/card";
const subject = `${url}#me`;
const VCARD = "http://www.w3.org/2006/vcard/ns#";
const parse = (body: string) => parseRdf(body, "text/turtle", { baseIRI: url });
const EMAIL = CONTACT_FIELDS.find((field) => field.label === "Email") as FieldSpec;
const NAME = CONTACT_FIELDS.find((field) => field.label === "Name") as FieldSpec;
const PHOTO = PHOTO_FIELDS.find((field) => field.label === "Image URL") as FieldSpec;
const quads = (dataset: DatasetCore) => [...(dataset as Iterable<Quad>)];

/** Save through the real write path and parse the document the server received. */
async function saveAndReadBack(
  dataset: DatasetCore,
  fields: readonly FieldSpec[],
  values: Record<string, string>,
) {
  let body = "";
  const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
    body = String(init?.body);
    return new Response(null, { status: 205, headers: { etag: '"2"' } });
  });
  const result = await saveFormEdits(url, dataset, subject, fields, values, {
    etag: '"1"',
    fetchImpl,
  });
  return { result, body, written: body ? await parse(body) : undefined };
}

describe("finding 1: injection-safe IRIs", () => {
  const payload =
    "a>.<https://pod/card#me><http://www.w3.org/ns/solid/terms#oidcIssuer><https://evil@x.y";

  it("refuses an email that could break out of its mailto: IRI, and writes nothing", async () => {
    const dataset = await parse(`<#me> <${VCARD}fn> "Ada".`);
    expect(() => valueToTerm(EMAIL, payload)).toThrow(FieldValidationError);
    for (const unsafe of [
      "a b@x.y",
      'a"b@x.y',
      "a{b@x.y",
      "a|b@x.y",
      "a^b@x.y",
      "a`b@x.y",
      "a\\b@x.y",
      "a\uD800@x.y",
    ])
      expect(toMailto(unsafe)).toBeUndefined();
    const { result, body } = await saveAndReadBack(dataset, [EMAIL], { [EMAIL.id]: payload });
    expect(result).toMatchObject({ ok: false, reason: "validation", fieldId: EMAIL.id });
    expect(body).toBe("");
  });

  // AUTHORED-BY Claude Opus 5.5 — fix round 5 (finding 4)
  it("refuses typed literal control characters (NUL, SOH, DEL) in an email", async () => {
    for (const control of ["\u0000", "\u0001", "\u001F", "\u007F"]) {
      const unsafe = `a${control}b@x.y`;
      expect(toMailto(unsafe)).toBeUndefined();
      expect(() => valueToTerm(EMAIL, unsafe)).toThrow(FieldValidationError);
    }
    const dataset = await parse(`<#me> <${VCARD}fn> "Ada".`);
    const { result, body } = await saveAndReadBack(dataset, [EMAIL], {
      [EMAIL.id]: "ada\u0001@example.org",
    });
    expect(result).toMatchObject({ ok: false, reason: "validation", fieldId: EMAIL.id });
    expect(body).toBe("");
  });

  it("encodes a valid address and reads it back unchanged", async () => {
    const dataset = await parse(`<#me> <${VCARD}fn> "Ada".`);
    expect(toMailto("ada?cc=x#y@example.org")).toBe("mailto:ada%3Fcc=x%23y@example.org");
    const { result, written } = await saveAndReadBack(dataset, [EMAIL], {
      [EMAIL.id]: "ada+home@example.org",
    });
    expect(result.ok).toBe(true);
    const doc = written as DatasetCore;
    expect(quads(doc)).toHaveLength(2);
    expect(readFieldValue(doc, subject, EMAIL)).toBe("ada+home@example.org");
    expect(
      quads(doc).some((q) => q.predicate.value === "http://www.w3.org/ns/solid/terms#oidcIssuer"),
    ).toBe(false);
  });

  it("round-trips a photo URL with a space as a valid, re-parseable document", async () => {
    const dataset = await parse(`<#me> <${VCARD}fn> "Ada".`);
    const photo = { ...PHOTO, predicate: `${VCARD}hasPhoto` };
    const { result, written } = await saveAndReadBack(dataset, [photo], {
      [photo.id]: "https://pod.example/photos/my photo.jpg",
    });
    expect(result.ok).toBe(true);
    const doc = written as DatasetCore;
    expect(quads(doc)).toHaveLength(2);
    expect(readFieldValue(doc, subject, photo)).toBe("https://pod.example/photos/my%20photo.jpg");
    // An IRI field can't smuggle statements either.
    expect(() =>
      valueToTerm(photo, `https://x.example/>.<${subject}><${VCARD}fn>"x`),
    ).not.toThrow();
    const injected = await saveAndReadBack(dataset, [photo], {
      [photo.id]: `https://x.example/a>.<${subject}><${VCARD}note>"x`,
    });
    expect(quads(injected.written as DatasetCore)).toHaveLength(2);
  });
});

describe("finding 2: multi-valued and structured values", () => {
  it("makes a field with two emails read-only and never deletes either one", async () => {
    const dataset = await parse(
      `<#me> <${VCARD}fn> "Ada"; <${VCARD}hasEmail> <mailto:a@example.org>, <mailto:b@example.org>.`,
    );
    expect(fieldState(dataset, subject, EMAIL)).toEqual({
      values: ["a@example.org", "b@example.org"],
      lockedReason: MULTIPLE_VALUES_HINT,
    });
    const [name, email] = lockUneditableFields([NAME, EMAIL], dataset, subject);
    expect(name?.readOnly).toBeUndefined();
    expect(email).toMatchObject({
      readOnly: true,
      hint: "Edit these in the app that created them.",
    });
    // The writer refuses too, so a stale form (the 412 "Keep my changes" path) can't drop one.
    expect(() =>
      applyFieldEdits(dataset, subject, [EMAIL], { [EMAIL.id]: "c@example.org" }),
    ).toThrow(MULTIPLE_VALUES_HINT);
    const { result, body } = await saveAndReadBack(dataset, [NAME, EMAIL], {
      [NAME.id]: "Ada L",
      [EMAIL.id]: "c@example.org",
    });
    expect(result).toMatchObject({ ok: false, reason: "validation", fieldId: EMAIL.id });
    expect(body).toBe("");
    // A locked field is skipped, so other fields still save.
    const saved = await saveAndReadBack(dataset, [NAME, { ...EMAIL, readOnly: true }], {
      [NAME.id]: "Ada L",
      [EMAIL.id]: "c@example.org",
    });
    expect(saved.result.ok).toBe(true);
    expect(fieldState(saved.written as DatasetCore, subject, EMAIL).values).toEqual([
      "a@example.org",
      "b@example.org",
    ]);
  });

  it.each([
    [
      "blank node",
      `<#me> <${VCARD}hasEmail> [ a <${VCARD}Work>; <${VCARD}value> <mailto:w@example.org> ].`,
    ],
    [
      "named node",
      `<#me> <${VCARD}hasEmail> <#id1>. <#id1> a <${VCARD}Work>; <${VCARD}value> <mailto:w@example.org>.`,
    ],
  ])("edits a SolidOS %s email's inner value and keeps its vcard:Work type", async (_, body) => {
    const dataset = await parse(`<#me> <${VCARD}fn> "Ada". ${body}`);
    expect(readFieldValue(dataset, subject, EMAIL)).toBe("w@example.org");
    expect(lockUneditableFields([EMAIL], dataset, subject)[0]?.readOnly).toBeUndefined();
    const { result, written } = await saveAndReadBack(dataset, [EMAIL], {
      [EMAIL.id]: "new@example.org",
    });
    expect(result.ok).toBe(true);
    const doc = written as DatasetCore;
    const links = quads(doc).filter((q) => q.predicate.value === `${VCARD}hasEmail`);
    expect(links).toHaveLength(1);
    const node = links[0]?.object as Quad["object"];
    // The link to the structured value is kept; only its inner value changed.
    expect(node.value.startsWith("mailto:")).toBe(false);
    expect(
      doc.match(node as never, namedNode(`${NS.RDF}type`), namedNode(`${VCARD}Work`)).size,
    ).toBe(1);
    expect(
      [...doc.match(node as never, namedNode(`${VCARD}value`), null)].map((q) => q.object.value),
    ).toEqual(["mailto:new@example.org"]);
    expect(readFieldValue(doc, subject, EMAIL)).toBe("new@example.org");
    // Clearing removes the link and the value node, leaving nothing dangling.
    const cleared = applyFieldEdits(dataset, subject, [EMAIL], { [EMAIL.id]: "" });
    expect(quads(cleared).map((q) => q.predicate.value)).toEqual([`${VCARD}fn`]);
  });

  it("locks a nested structure with no single value instead of showing its label", async () => {
    const dataset = await parse(
      `<#me> <${VCARD}hasEmail> [ <${VCARD}value> <mailto:a@x.org>, <mailto:b@x.org> ]; <${VCARD}note> [ <${VCARD}fn> "x" ].`,
    );
    expect(fieldState(dataset, subject, EMAIL).lockedReason).toBe(MULTIPLE_VALUES_HINT);
    const note = normaliseField({
      label: "Note",
      predicate: `${VCARD}note`,
      kind: "text",
      mode: "literal",
    });
    expect(fieldState(dataset, subject, note)).toEqual({
      values: [],
      lockedReason: STRUCTURED_VALUE_HINT,
    });
    expect(readFieldValue(dataset, subject, note)).toBe("");
    expect(() => applyFieldEdits(dataset, subject, [note], { [note.id]: "y" })).toThrow(
      STRUCTURED_VALUE_HINT,
    );
  });
});

describe("finding 8: auto forms over nested values", () => {
  it("gives blank-node objects no field and reads structured vCard values through", async () => {
    const dataset = await parse(
      `<#me> <${VCARD}fn> "Ada"; <${VCARD}hasAddress> [ <${VCARD}locality> "London" ];
        <${VCARD}hasEmail> <#id1>. <#id1> a <${VCARD}Work>; <${VCARD}value> <mailto:w@example.org>.`,
    );
    const fields = autoFormFor(dataset, subject);
    expect(fields.map((field) => [field.predicate, field.kind])).toEqual([
      [`${VCARD}fn`, "text"],
      [`${VCARD}hasEmail`, "email"],
    ]);
    expect(readFieldValue(dataset, subject, fields[1] as FieldSpec)).toBe("w@example.org");
  });
});

describe("finding 11: the profile editor's field allowlist", () => {
  const profile = `@prefix foaf: <http://xmlns.com/foaf/0.1/>. @prefix solid: <http://www.w3.org/ns/solid/terms#>.
    <#me> a foaf:Person; foaf:name "Ada"; <https://schema.org/pronouns> "she/her";
      solid:oidcIssuer <https://issuer.example/>; <http://www.w3.org/ns/pim/space#storage> </>;
      <http://www.w3.org/ns/ldp#inbox> </inbox/>; foaf:knows <https://bob.example/#me>;
      solid:privateTypeIndex </settings/index.ttl>; <${VCARD}note> "private note";
      <${VCARD}hasTelephone> <tel:+441234>.`;

  it("offers only name, photo, pronouns, email and phone on the WebID document", async () => {
    const dataset = await parse(profile);
    const fields = itemEditFields({ url, dataset, subject: namedNode(subject) }, subject);
    expect(fields.map((field) => field.label)).toEqual([
      "Name",
      "Pronouns",
      "Phone",
      "Photo",
      "Email",
    ]);
    for (const field of fields)
      expect(PROFILE_FIELD_NAMES).toContain(field.predicate.split(/[#/]/).at(-1));
    expect(fields.find((field) => field.label === "Pronouns")).toMatchObject({
      predicate: "https://schema.org/pronouns",
      kind: "text",
      mode: "literal",
    });
    expect(readFieldValue(dataset, subject, fields[1] as FieldSpec)).toBe("she/her");
    expect(fields.find((field) => field.label === "Phone")).toMatchObject({
      kind: "tel",
      mode: "tel",
    });
    expect(fields.find((field) => field.label === "Photo")).toMatchObject({
      kind: "url",
      mode: "iri",
    });
    expect(fields.find((field) => field.label === "Email")).toMatchObject({
      predicate: `${VCARD}hasEmail`,
      kind: "email",
      mode: "mailto",
    });
    // Account plumbing never becomes a field.
    for (const local of ["oidcIssuer", "storage", "inbox", "knows", "privateTypeIndex", "note"])
      expect(fields.some((field) => field.predicate.endsWith(local))).toBe(false);
  });

  it("adds a missing pronouns field and relabels existing allowlisted ones", () => {
    const fields = profileFields([
      normaliseField({ label: "Fn", predicate: `${VCARD}fn`, kind: "text", mode: "literal" }),
      normaliseField({
        label: "Img",
        predicate: "http://xmlns.com/foaf/0.1/img",
        kind: "text",
        mode: "literal",
      }),
      normaliseField({
        label: "Has email",
        predicate: `${VCARD}hasEmail`,
        kind: "url",
        mode: "iri",
      }),
      normaliseField({
        label: "Storage",
        predicate: "http://www.w3.org/ns/pim/space#storage",
        kind: "url",
        mode: "iri",
      }),
    ]);
    expect(fields.map((field) => [field.label, field.kind, field.mode])).toEqual([
      ["Name", "text", "literal"],
      ["Photo", "url", "iri"],
      ["Email", "email", "mailto"],
      ["Pronouns", "text", "literal"],
      ["Phone", "tel", "tel"],
    ]);
  });

  it("uses the resolved form, not the allowlist, for any other document", async () => {
    const dataset = await parse(
      `<#me> <${VCARD}note> "kept"; <${VCARD}hasEmail> <mailto:a@x.org>, <mailto:b@x.org>.`,
    );
    const fields = itemEditFields(
      { url, dataset, subject: namedNode(subject) },
      "https://elsewhere.example/profile#me",
    );
    expect(fields.map((field) => [field.label, field.readOnly ?? false])).toEqual([
      ["Note", false],
      ["Has Email", true],
    ]);
  });
});

// AUTHORED-BY Claude Opus 5.5 — fix round 3 (findings 3, 5)
describe("fix round 3: stored addresses and nested inner values", () => {
  const emailIri = (dataset: DatasetCore) =>
    quads(dataset).find((q) => q.predicate.value === `${VCARD}hasEmail`)?.object.value;

  it.each([
    ["non-ASCII characters", "mailto:j%C3%B6rg@example.de", "jörg@example.de"],
    ["? and #", "mailto:ada%3Fcc=x%23y@example.org", "ada?cc=x#y@example.org"],
    ["a literal %", "mailto:50%25off@example.org", "50%off@example.org"],
    ["an escaped escape", "mailto:a%2541@example.org", "a%2541@example.org"],
    ["an undecodable escape", "mailto:j%F6rg@example.de", "j%F6rg@example.de"],
  ])("shows a stored address with %s decoded and keeps its IRI through edits", async (_, iri, shown) => {
    const dataset = await parse(`<#me> <${VCARD}fn> "Ada"; <${VCARD}hasEmail> <${iri}>.`);
    expect(readFieldValue(dataset, subject, EMAIL)).toBe(shown);
    // Saving the shown value (and saving again) writes the very same IRI.
    const { result, written } = await saveAndReadBack(dataset, [EMAIL], { [EMAIL.id]: shown });
    expect(result.ok).toBe(true);
    expect(emailIri(written as DatasetCore)).toBe(iri);
    const again = applyFieldEdits(written as DatasetCore, subject, [EMAIL], {
      [EMAIL.id]: readFieldValue(written as DatasetCore, subject, EMAIL),
    });
    expect(emailIri(again)).toBe(iri);
  });

  it("keeps valid escapes in a typed address and encodes any other %", () => {
    expect(toMailto("j%C3%B6rg@example.de")).toBe("mailto:j%C3%B6rg@example.de");
    expect(toMailto("jörg@example.de")).toBe("mailto:j%C3%B6rg@example.de");
    expect(toMailto("50%off@example.org")).toBe("mailto:50%25off@example.org");
    expect(toMailto("a%3F?b@example.org")).toBe("mailto:a%3F%3Fb@example.org");
  });

  // AUTHORED-BY Claude Opus 5.5 — fix round 4 (finding 5)
  it("never keeps an escape for a control character, so it can't add a line break", () => {
    expect(toMailto("a%0D%0Ab@x.org")).toBe("mailto:a%250D%250Ab@x.org");
    expect(toMailto("%00@x.org")).toBe("mailto:%2500@x.org");
    expect(toMailto("a%7f%1Fb@x.org")).toBe("mailto:a%257f%251Fb@x.org");
    // Escapes just outside the control ranges are still kept.
    expect(toMailto("a%20%7E%80b@x.org")).toBe("mailto:a%20%7E%80b@x.org");
    for (const typed of ["a%0D%0Ab@x.org", "%00@x.org"])
      expect(decodeURIComponent(toMailto(typed) as string)).not.toMatch(/[\r\n\0]/);
  });

  it("locks a structured value whose single inner value is a nested node and shows no label", async () => {
    const dataset = await parse(
      `<#me> <${VCARD}hasEmail> [ a <${VCARD}Work>; <${VCARD}value> [ <${VCARD}fn> "x" ] ].`,
    );
    const state = fieldState(dataset, subject, EMAIL);
    expect(state).toEqual({ values: [], lockedReason: STRUCTURED_VALUE_HINT });
    expect(readFieldValue(dataset, subject, EMAIL)).toBe("");
    expect(() => applyFieldEdits(dataset, subject, [EMAIL], { [EMAIL.id]: "a@x.org" })).toThrow(
      STRUCTURED_VALUE_HINT,
    );
    const text = normaliseField({
      label: "Note",
      predicate: `${VCARD}note`,
      kind: "text",
      mode: "literal",
    });
    const note = await parse(`<#me> <${VCARD}note> [ <${VCARD}value> [ <${VCARD}fn> "x" ] ].`);
    expect(fieldState(note, subject, text)).toEqual({
      values: [],
      lockedReason: STRUCTURED_VALUE_HINT,
    });
  });

  it("locks a field with a second, nested value an edit would drop", async () => {
    const dataset = await parse(
      `<#me> <${VCARD}hasEmail> [ <${VCARD}value> <mailto:a@x.org> ], [ a <${VCARD}Home> ].`,
    );
    expect(fieldState(dataset, subject, EMAIL)).toEqual({
      values: ["a@x.org"],
      lockedReason: MULTIPLE_VALUES_HINT,
    });
  });
});

// AUTHORED-BY Claude Opus 5.5 — coverage round (Home forms)
describe("coverage round: nested inner values, plain profile fields, locked fields", () => {
  it.each([
    [
      "blank node with a nested inner value",
      `<#me> <${VCARD}note> [ <${VCARD}value> [ <${VCARD}fn> "x" ] ].`,
    ],
    [
      "named node with a nested inner value",
      `<#me> <${VCARD}note> <#n>. <#n> <${VCARD}value> [ <${VCARD}fn> "x" ].`,
    ],
    [
      "named node with two inner values",
      `<#me> <${VCARD}hasEmail> <#e>. <#e> <${VCARD}value> <mailto:a@x.org>, <mailto:b@x.org>.`,
    ],
  ])("gives a %s no auto field (nothing single and plain to show)", async (_, body) => {
    const dataset = await parse(`<#me> <${VCARD}fn> "Ada". ${body}`);
    expect(autoFormFor(dataset, subject).map((field) => field.predicate)).toEqual([`${VCARD}fn`]);
  });

  it("labels plain email and telephone profile fields without adding vCard duplicates", async () => {
    const dataset = await parse(
      `<#me> <http://xmlns.com/foaf/0.1/name> "Ada"; <https://schema.org/email> "ada@example.org";
        <https://schema.org/telephone> "+44 1234"; <http://www.w3.org/ns/pim/space#storage> </>.`,
    );
    const fields = itemEditFields({ url, dataset, subject: namedNode(subject) }, subject);
    expect(fields.map((field) => [field.label, field.predicate, field.mode])).toEqual([
      ["Name", "http://xmlns.com/foaf/0.1/name", "literal"],
      // The document's literal form is kept, so a save writes the same kind of value back.
      ["Email", "https://schema.org/email", "literal"],
      ["Phone", "https://schema.org/telephone", "literal"],
      ["Photo", `${VCARD}hasPhoto`, "iri"],
      ["Pronouns", "https://schema.org/pronouns", "literal"],
    ]);
    const email = fields[1] as FieldSpec;
    expect(readFieldValue(dataset, subject, email)).toBe("ada@example.org");
    const saved = applyFieldEdits(dataset, subject, [email], { [email.id]: "ada@new.example" });
    expect(
      quads(saved)
        .filter((q) => q.predicate.value === "https://schema.org/email")
        .map((q) => [q.object.termType, q.object.value]),
    ).toEqual([["Literal", "ada@new.example"]]);
  });

  it("leaves a field that is already read-only, and its own hint, untouched", async () => {
    const dataset = await parse(
      `<#me> <${VCARD}hasEmail> <mailto:a@example.org>, <mailto:b@example.org>.`,
    );
    const authored = { ...EMAIL, readOnly: true, hint: "Managed by your provider." };
    const [locked] = lockUneditableFields([authored], dataset, subject);
    expect(locked).toBe(authored);
    expect(locked?.hint).toBe("Managed by your provider.");
  });

  it("keeps a shared structured value node when one subject clears its link to it", async () => {
    const dataset = await parse(
      `<#me> <${VCARD}fn> "Ada"; <${VCARD}hasEmail> <#work>.
       <#colleague> <${VCARD}hasEmail> <#work>.
       <#work> a <${VCARD}Work>; <${VCARD}value> <mailto:team@example.org>.`,
    );
    const cleared = applyFieldEdits(dataset, subject, [EMAIL], { [EMAIL.id]: "" });
    expect(readFieldValue(cleared, subject, EMAIL)).toBe("");
    // The colleague still links the node, so its type and value stay.
    expect(readFieldValue(cleared, `${url}#colleague`, EMAIL)).toBe("team@example.org");
    expect(
      cleared.match(namedNode(`${url}#work`), namedNode(`${NS.RDF}type`), namedNode(`${VCARD}Work`))
        .size,
    ).toBe(1);
  });
});
