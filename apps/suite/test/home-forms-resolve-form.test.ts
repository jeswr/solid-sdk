// AUTHORED-BY Codex GPT-6
// Tests ported with the Pod Manager forms engine.
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md

import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { describe, expect, it } from "vitest";
import { resolveForm } from "../src/apps/home/lib/forms/resolve-form";

const URL = "https://alice.example/data/x.ttl";
const SUBJECT = `${URL}#it`;

async function ds(turtle: string): Promise<DatasetCore> {
  return parseRdf(turtle, "text/turtle", { baseIRI: URL });
}

describe("resolveForm — precedence", () => {
  it("uses an authored ui: form when one is provided", async () => {
    const data = await ds(
      `<${SUBJECT}> a <http://www.w3.org/2006/vcard/ns#Individual> ; <http://www.w3.org/2006/vcard/ns#fn> "Ada" .`,
    );
    const form = await ds(`
      @prefix ui: <http://www.w3.org/ns/ui#>.
      <#form> a ui:Form ; ui:parts ( <#n> ) .
      <#n> a ui:SingleLineTextField ; ui:property <http://www.w3.org/2006/vcard/ns#fn> ; ui:label "Name" .`);
    const resolved = resolveForm(URL, data, SUBJECT, { formDataset: form });
    expect(resolved.source).toBe("ui-form");
    expect(resolved.fields.map((f) => f.label)).toEqual(["Name"]);
  });

  it("falls back to a typed-view edit map when a viewer matches", async () => {
    const data = await ds(`
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#>.
      <${SUBJECT}> a vcard:Individual ; vcard:fn "Ada" .`);
    const resolved = resolveForm(URL, data, SUBJECT);
    expect(resolved.source).toBe("typed-view");
    expect(resolved.viewerId).toBe("contacts");
    expect(resolved.fields.map((f) => f.label)).toContain("Name");
  });

  it("auto-generates a form for an unknown shape", async () => {
    const data = await ds(
      `<${SUBJECT}> a <https://example.org/Widget> ; <https://example.org/colour> "blue" .`,
    );
    const resolved = resolveForm(URL, data, SUBJECT);
    expect(resolved.source).toBe("auto");
    expect(resolved.fields.map((f) => f.predicate)).toEqual(["https://example.org/colour"]);
  });
});

it("binds legacy schema predicates for event reads and writes without parallel HTTPS fields", async () => {
  const { applyFieldEdits, readFieldValue } = await import(
    "../src/apps/home/lib/forms/subject-edit"
  );
  const data = await ds(
    `<#it> a <http://schema.org/Event>; <http://schema.org/name> "Legacy"; <http://schema.org/startDate> "2026-11-01T12:00:00Z".`,
  );
  const form = resolveForm(URL, data, SUBJECT);
  const title = form.fields.find(
    (field) => field.label === "Title",
  ) as (typeof form.fields)[number];
  const start = form.fields.find((field) =>
    field.predicate.endsWith("startDate"),
  ) as (typeof form.fields)[number];
  expect(title.predicate).toBe("http://schema.org/name");
  expect(start.predicate).toBe("http://schema.org/startDate");
  expect(readFieldValue(data, SUBJECT, title)).toBe("Legacy");
  expect(readFieldValue(data, SUBJECT, start)).toBe("2026-11-01T12:00:00Z");
  const next = applyFieldEdits(data, SUBJECT, form.fields, {
    [title.id]: "Updated",
    [start.id]: "2026-11-01T12:01:00Z",
  });
  expect(readFieldValue(next, SUBJECT, title)).toBe("Updated");
  expect([...next].some((quad) => quad.predicate.value.startsWith("https://schema.org/"))).toBe(
    false,
  );
});
