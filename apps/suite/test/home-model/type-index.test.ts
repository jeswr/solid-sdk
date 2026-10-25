// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { describe, expect, it } from "vitest";
import { readTypeIndexes, registrationsFrom } from "../../src/apps/home/lib/model/type-index";
import { fixtureFetch, rdf, STORAGE, WEB_ID } from "./fixtures";

describe("Type Index read model", () => {
  it("ports typed registrations, including legacy classes and both location forms", async () => {
    const dataset = await rdf(
      `
      <#a> a solid:TypeRegistration ; solid:forClass old:Book, "bad" ; solid:instance <book.ttl>, "bad" ; solid:instanceContainer <books/> .
      <#b> a solid:TypeRegistration ; solid:forClass schema:Event .
      <#c> a solid:TypeRegistration ; solid:instance <orphan.ttl> .
      <#notRegistration> solid:forClass schema:Book ; solid:instance <ignore.ttl> .
    `,
      `${STORAGE}index.ttl`,
    );
    expect(registrationsFrom(dataset)).toEqual([
      { forClass: `${NS.SCHEMA}Book`, instance: `${STORAGE}book.ttl` },
      { forClass: `${NS.SCHEMA}Book`, container: `${STORAGE}books/` },
    ]);
  });

  it("merges public and private indexes and reads a shared link just once", async () => {
    const profile = await rdf(
      "<#me> solid:publicTypeIndex <../public.ttl> ; solid:privateTypeIndex <../private.ttl>, <../public.ttl> .",
      WEB_ID,
    );
    const fetch = fixtureFetch({
      [`${STORAGE}public.ttl`]:
        "<#r> a solid:TypeRegistration ; solid:forClass schema:Book ; solid:instance <books/one.ttl> .",
      [`${STORAGE}private.ttl`]:
        "<#r> a solid:TypeRegistration ; solid:forClass <https://custom.example/Unknown> ; solid:instanceContainer <custom/> .",
    });
    const result = await readTypeIndexes(fetch, WEB_ID, profile, STORAGE);
    expect(result.locations).toHaveLength(2);
    expect(result.failures).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await readTypeIndexes(fetch, WEB_ID, await rdf(""), STORAGE)).toEqual({
      locations: [],
      failures: [],
    });
  });

  it("returns explicit absent, unreadable and out-of-scope failures without leaking credentials", async () => {
    const profile = await rdf(
      "<#me> solid:publicTypeIndex <../missing.ttl>, <https://foreign.example/index.ttl> ; solid:privateTypeIndex <../private.ttl> .",
      WEB_ID,
    );
    const fetch = fixtureFetch({ [`${STORAGE}private.ttl`]: 403 });
    const result = await readTypeIndexes(fetch, WEB_ID, profile, STORAGE);
    expect(result.locations).toEqual([]);
    expect(result.failures).toHaveLength(3);
    expect(result.failures.map((failure) => failure.url)).toContain(
      "https://foreign.example/index.ttl",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
