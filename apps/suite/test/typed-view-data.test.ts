// AUTHORED-BY Codex GPT-6.1-Sol
import { TypedView } from "@jeswr/suite-ui";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { parseResource } from "../src/apps/home/lib/model/rdf";
import { typedViewData } from "../src/components/typed-view-data";
import { typedFixtureData } from "../src/components/typed-view-fixtures";

function visibleText(markup: string) {
  return markup.replace(/<[^>]*>/g, "");
}
test("all nine fixture datasets render as content without identifier text", async () => {
  const fixtures = await typedFixtureData();
  expect(fixtures).toHaveLength(9);
  const expected: Record<string, string[]> = {
    contact: ["Mira Osei", "mira@example.test", "Open Studio"],
    track: ["Paper planes", "The Quiet Hours", "3 min 42 sec", "Open in Spotify"],
    "track-no-artwork": ["A slower morning", "Open in Spotify"],
    event: ["Design review", "Oct 26, 2026", "Studio room"],
    task: ["Review the quarterly plan", "Open", "Oct 28, 2026"],
    document: ["A calmer workspace", "your documents, plans and ideas"],
    photograph: ["A quiet afternoon", "Light across the studio."],
    image: ["Album artwork", "A study in line and shape."],
    generic: ["Studio notes", "Other detail", "Linked item"],
  };
  for (const { id, data } of fixtures) {
    const html = renderToStaticMarkup(createElement(TypedView, { data }));
    expect(visibleText(html)).not.toContain("http");
    for (const text of expected[id] ?? []) expect(visibleText(html)).toContain(text);
    expect(html).not.toContain("<pre>");
    expect(data.rawData).toContain("http");
  }
  expect(fixtures.find((fixture) => fixture.id === "track")?.data.source?.label).toBe("Spotify");
  expect(fixtures.find((fixture) => fixture.id === "track")?.data.image).toBeDefined();
  expect(fixtures.find((fixture) => fixture.id === "track-no-artwork")?.data.image).toBeUndefined();
});
test("schema aliases and malformed terms retain valid siblings and safe fallbacks", async () => {
  const url = "https://pod.example/item";
  const dataset = await parseResource(
    `@prefix s: <http://schema.org/> . <#it> a s:Event, "malformed type"; s:name "Studio visit"; s:startDate "not a date"; s:location <https://pod.example/unknown>; s:url <javascript:alert> .`,
    "text/turtle",
    url,
  );
  const data = await typedViewData(dataset, `${url}#it`);
  expect(data.types).toContain("https://schema.org/Event");
  expect(data.title).toBe("Studio visit");
  expect(data.properties.find((property) => property.key === "start")?.values).toEqual([
    "Date unavailable",
  ]);
  expect(data.properties.find((property) => property.key === "location")?.values).toEqual([
    "Linked item",
  ]);
  expect(data.source).toBeUndefined();
  expect(visibleText(renderToStaticMarkup(createElement(TypedView, { data })))).not.toContain(
    "http",
  );
});
test("same-storage source links are not offered as external sources", async () => {
  const dataset = await parseResource(
    `<#it> <https://schema.org/url> <https://pod.example/source> .`,
    "text/turtle",
    "https://pod.example/item",
  );
  expect(
    (
      await typedViewData(dataset, "https://pod.example/item#it", {
        storage: "https://pod.example/",
      })
    ).source,
  ).toBeUndefined();
});
test("document body excerpts strip markup, preserve readable entities and merge duplicate fields", async () => {
  const dataset = await parseResource(
    `@prefix pd: <https://w3id.org/jeswr/pod-docs#> . @prefix dct: <http://purl.org/dc/terms/> . <#it> a pd:Document; dct:title "Plan"; <https://schema.org/name> "Plan"; pd:body "<p>Ideas &amp; plans</p><script>hidden()</script>" .`,
    "text/turtle",
    "https://pod.example/doc",
  );
  const data = await typedViewData(dataset, "https://pod.example/doc#it");
  expect(data.properties.filter((property) => property.key === "title")).toHaveLength(1);
  expect(data.properties.find((property) => property.key === "description")?.values).toEqual([
    "Ideas & plans",
  ]);
  expect(visibleText(renderToStaticMarkup(createElement(TypedView, { data })))).toContain(
    "Ideas &amp; plans",
  );
});

test.each([
  ["Open", "Open"],
  ["Closed", "Completed"],
])("tasks read wf:%s type, dateDue and description", async (type, status) => {
  const url = "https://pod.example/task";
  const dataset = await parseResource(
    `@prefix wf: <http://www.w3.org/2005/01/wf/flow#> . <#it> a wf:Task, wf:${type}; wf:dateDue "2026-10-28"; wf:description "Read the plan" .`,
    "text/turtle",
    url,
  );
  const data = await typedViewData(dataset, `${url}#it`, {
    locale: "en-US",
    timeZone: "America/Los_Angeles",
  });
  expect(data.properties.find((property) => property.key === "status")?.values).toEqual([status]);
  expect(data.properties.find((property) => property.key === "due")?.values).toEqual([
    "Oct 28, 2026",
  ]);
  expect(data.properties.find((property) => property.key === "description")?.values).toEqual([
    "Read the plan",
  ]);
});

test.each([
  "value",
  "hasValue",
])("contacts read vcard:%s from wrapped emails and telephone numbers", async (predicate) => {
  const url = "https://pod.example/contact";
  const dataset = await parseResource(
    `@prefix v: <http://www.w3.org/2006/vcard/ns#> . <#it> a v:Individual; v:fn "Mira"; v:hasEmail [ v:${predicate} <mailto:mira@example.test> ]; v:hasTelephone [ v:${predicate} <tel:+441234567890> ] .`,
    "text/turtle",
    url,
  );
  const data = await typedViewData(dataset, `${url}#it`);
  expect(data.properties.find((property) => property.key === "email")?.values).toEqual([
    "mira@example.test",
  ]);
  expect(data.properties.find((property) => property.key === "telephone")?.values).toEqual([
    "+441234567890",
  ]);
});

test.each([
  '"2026-10-28"',
  '"2026-10-28"^^xsd:date',
  '"2026-10-28+14:00"^^xsd:date',
])("date-only %s retains its calendar day in every display time zone", async (literal) => {
  const url = "https://pod.example/event";
  const dataset = await parseResource(
    `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> . <#it> <https://schema.org/startDate> ${literal} .`,
    "text/turtle",
    url,
  );
  for (const timeZone of ["America/Los_Angeles", "Pacific/Kiritimati"]) {
    const data = await typedViewData(dataset, `${url}#it`, { locale: "en-US", timeZone });
    expect(data.properties.find((property) => property.key === "start")?.values).toEqual([
      "Oct 28, 2026",
    ]);
  }
});

test("date-time instants still format in the requested time zone", async () => {
  const url = "https://pod.example/event";
  const dataset = await parseResource(
    '<#it> <https://schema.org/startDate> "2026-10-28T01:00:00Z" .',
    "text/turtle",
    url,
  );
  const data = await typedViewData(dataset, `${url}#it`, {
    locale: "en-US",
    timeZone: "America/Los_Angeles",
  });
  expect(data.properties.find((property) => property.key === "start")?.values[0]).toContain(
    "Oct 27, 2026",
  );
});

test.each([
  false,
  true,
])("task xsd:date companions take precedence over timestamps regardless of predicate order (date first: %s)", async (dateFirst) => {
  const url = "https://pod.example/task";
  const timestampPredicates = [
    'wf:dateDue "2026-10-28T00:00:00Z"',
    'wf:due "2026-10-28T00:00:00Z"^^xsd:dateTime',
  ];
  const date = 'sched:dueTime "2026-10-28"^^xsd:date';
  const predicates = dateFirst ? [date, ...timestampPredicates] : [...timestampPredicates, date];
  const dataset = await parseResource(
    `@prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
       @prefix sched: <https://jeswr.org/ns/sectors/scheduling#> .
       @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
       <#it> a wf:Task; ${predicates.join("; ")} .`,
    "text/turtle",
    url,
  );
  for (const timeZone of ["America/Los_Angeles", "Pacific/Kiritimati", "UTC"]) {
    const data = await typedViewData(dataset, `${url}#it`, { locale: "en-US", timeZone });
    expect(data.properties.find((property) => property.key === "due")?.values).toEqual([
      "Oct 28, 2026",
    ]);
    const text = visibleText(renderToStaticMarkup(createElement(TypedView, { data })));
    expect(text).toContain("Oct 28, 2026");
    expect(text).not.toMatch(/Oct 27|AM|PM/);
  }
});
