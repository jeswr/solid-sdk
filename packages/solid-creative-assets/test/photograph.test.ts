// AUTHORED-BY Claude Sonnet 5.5
/**
 * Property-level compatibility with the pod-photos reader. WARNING: the accessors below are a
 * MIRROR of apps/pod-photos/src/photos/photograph.ts (PhotographDoc: name, description,
 * contentUrl, keywords, width, height, dateCreated), because a package cannot import from an
 * app. It does not run the real `parsePhoto`, so it can drift from it (the exact-type gate,
 * `name ?? ''`, keyword and EXIF normalisation). The real check belongs in apps/pod-photos
 * with this package as a devDependency; see the README.
 */
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, type Store } from "n3";
import { describe, expect, it } from "vitest";
import { buildAssetDocument } from "../src/assets.js";
import { RDF_TYPE, SCHEMA } from "../src/vocab.js";
import { DOC, fullImage, mesh } from "./fixtures.js";

const PHOTOGRAPH = `${SCHEMA}Photograph`;
const { namedNode } = DataFactory;

class PhotographDoc extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get name() {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}name`, LiteralAs.string);
  }
  get description() {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}description`, LiteralAs.string);
  }
  get contentUrl() {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}contentUrl`, NamedNodeAs.string);
  }
  get keywords(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SCHEMA}keywords`,
      LiteralAs.string,
      LiteralFrom.string,
    );
  }
  get width() {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}width`, LiteralAs.number);
  }
  get height() {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}height`, LiteralAs.number);
  }
  get dateCreated() {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}dateCreated`, LiteralAs.date);
  }
}

/** Re-type the asset node as schema:Photograph, as a photo app would find it. */
function asPhotograph(store: Store): Store {
  const subject = namedNode(`${DOC}#it`);
  store.removeQuads([...store.match(subject, namedNode(RDF_TYPE), null)]);
  store.addQuad(subject, namedNode(RDF_TYPE), namedNode(PHOTOGRAPH));
  return store;
}

describe("an image re-typed schema:Photograph satisfies the pod-photos reader", () => {
  const store = asPhotograph(buildAssetDocument(DOC, fullImage));
  const doc = new PhotographDoc(`${DOC}#it`, store, DataFactory);

  it("is recognised as a photograph", () => {
    expect(doc.types.has(PHOTOGRAPH)).toBe(true);
  });

  it("reads name, description and the contentUrl IRI", () => {
    expect(doc.name).toBe("Sunset fox");
    expect(doc.description).toBe("A red fox at sunset.");
    expect(doc.contentUrl).toBe("https://pod.example/creative/files/sunset.png");
  });

  it("reads keywords, integer dimensions and the creation date", () => {
    expect([...doc.keywords].sort()).toEqual(["ai", "sunset"]);
    expect(doc.width).toBe(1024);
    expect(doc.height).toBe(768);
    expect(doc.dateCreated?.toISOString()).toBe("2026-06-15T09:41:07.000Z");
  });

  it("writes dimensions as integers and the date as xsd:dateTime, not xsd:date", () => {
    const literals = ["width", "height", "dateCreated"].map((p) => {
      const o = [...store.match(namedNode(`${DOC}#it`), namedNode(`${SCHEMA}${p}`), null)][0]
        ?.object;
      return o?.termType === "Literal" ? o.datatype.value : undefined;
    });
    expect(literals).toEqual([
      "http://www.w3.org/2001/XMLSchema#integer",
      "http://www.w3.org/2001/XMLSchema#integer",
      "http://www.w3.org/2001/XMLSchema#dateTime",
    ]);
  });

  it("a 3D model has no dimensions for the reader to misread", () => {
    const m = new PhotographDoc(`${DOC}#it`, buildAssetDocument(DOC, mesh), DataFactory);
    expect(m.width).toBeUndefined();
    expect(m.types.has(PHOTOGRAPH)).toBe(false);
  });
});
