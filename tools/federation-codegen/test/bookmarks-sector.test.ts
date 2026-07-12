// AUTHORED-BY Codex GPT-5

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import env from "@zazuko/env-node";
import { DataFactory, Parser, Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { describe, expect, it } from "vitest";
import { Bookmark } from "../generated/bookmarks-sector/src/model.ts";
import {
  BOOKMARK_ARCHIVED,
  BOOKMARK_CLASS,
  RDF_TYPE,
  SKOS_CONCEPT,
} from "../generated/bookmarks-sector/src/vocab.ts";

const SHAPES = resolve(import.meta.dirname, "../generated/bookmarks-sector/shapes.ttl");
const SUBJECT = "https://alice.example/bookmarks/1#it";

class TypedResource extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
}

function toDataset(quads: Iterable<Parameters<ReturnType<typeof env.dataset>["add"]>[0]>) {
  const dataset = env.dataset();
  for (const quad of quads) dataset.add(quad);
  return dataset;
}

async function validate(store: Store) {
  const shapes = toDataset(new Parser().parse(await readFile(SHAPES, "utf8")));
  const data = toDataset(store);
  return new SHACLValidator(shapes, { factory: env }).validate(data);
}

describe("generated bookmarks-sector model", () => {
  it("writes every sector shape property through @rdfjs/wrapper and conforms to SHACL", async () => {
    const store = new Store();
    const bookmark = new Bookmark(SUBJECT, store, DataFactory).mark();
    bookmark.url = "https://example.org/article";
    bookmark.title = "Generated model";
    bookmark.description = "Structural projection";
    bookmark.notes = "No handwritten policy";
    bookmark.archived = true;
    bookmark.hasTag.add("https://alice.example/tags/solid");

    const tag = new TypedResource("https://alice.example/tags/solid", store, DataFactory);
    tag.types.add(SKOS_CONCEPT);

    expect(bookmark.isBookmark).toBe(true);
    expect(bookmark.types).toContain(BOOKMARK_CLASS);
    expect(store.getQuads(SUBJECT, BOOKMARK_ARCHIVED, null, null)[0]?.object.value).toBe("true");
    expect((await validate(store)).conforms).toBe(true);
  });

  it("fails on read when the required URL is absent", () => {
    const bookmark = new Bookmark(SUBJECT, new Store(), DataFactory).mark();
    expect(() => bookmark.url).toThrow(/No value found/);
  });

  it("demonstrates that structural generation does not infer the handwritten http(s) policy", async () => {
    const store = new Store();
    const bookmark = new Bookmark(SUBJECT, store, DataFactory).mark();
    bookmark.url = "javascript:alert(1)";

    expect(bookmark.url).toBe("javascript:alert(1)");
    expect((await validate(store)).conforms).toBe(true);
  });
});
