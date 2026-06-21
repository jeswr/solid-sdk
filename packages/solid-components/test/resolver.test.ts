// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// resolveComponent + collectTypes tests: the priority + first-registered tie-break +
// undefined fallback (PM's selectTypedViewer rule, thinned over the static map), the
// mode filter, the direct-class lookup, and the rdf:type scan.

import { describe, expect, it } from "vitest";
import {
  collectTypes,
  RESOLVER_ENTRIES,
  resolveComponent,
  resolveComponentForClass,
} from "../src/index.js";
import { BOOKMARKS_TTL, CONTAINER_TTL, parseTurtle } from "./fixtures.js";

const TASK = "http://www.w3.org/2005/01/wf/flow#Task";
const INDIVIDUAL = "http://www.w3.org/2006/vcard/ns#Individual";
const ADDRESS_BOOK = "http://www.w3.org/2006/vcard/ns#AddressBook";
const BOOKMARK = "https://w3id.org/jeswr/bookmark#Bookmark";
const LDP_CONTAINER = "http://www.w3.org/ns/ldp#Container";

describe("resolveComponent", () => {
  it("resolves each bound RDF class to its element", () => {
    expect(resolveComponent([TASK])?.tagName).toBe("jeswr-task-list");
    expect(resolveComponent([INDIVIDUAL])?.tagName).toBe("jeswr-contact-list");
    expect(resolveComponent([ADDRESS_BOOK])?.tagName).toBe("jeswr-contact-list");
    expect(resolveComponent([BOOKMARK])?.tagName).toBe("jeswr-bookmark-list");
    expect(resolveComponent([LDP_CONTAINER])?.tagName).toBe("jeswr-collection");
  });

  it("returns undefined for an unbound class (the caller falls back)", () => {
    expect(resolveComponent(["http://schema.org/Recipe"])).toBeUndefined();
    expect(resolveComponent([])).toBeUndefined();
  });

  it("prefers the higher-priority entry when several types match", () => {
    // A bookmark container ALSO typed ldp:Container resolves to the bookmark element
    // (priority 70) over the generic collection (priority 10).
    const entry = resolveComponent([BOOKMARK, LDP_CONTAINER]);
    expect(entry?.tagName).toBe("jeswr-bookmark-list");

    // An AddressBook that ALSO types ldp:Container resolves to the contact list.
    expect(resolveComponent([ADDRESS_BOOK, LDP_CONTAINER])?.tagName).toBe("jeswr-contact-list");
  });

  it("breaks an equal-priority tie by earliest registration order", () => {
    // Task (idx 0, prio 70) and AddressBook (idx 1, prio 70) both match → the
    // earlier-registered (task) wins, matching PM's selectTypedViewer tie-break.
    const entry = resolveComponent([ADDRESS_BOOK, TASK]);
    expect(entry?.tagName).toBe("jeswr-task-list");
  });

  it("honours the mode filter (no edit elements in Phase-1)", () => {
    expect(resolveComponent([TASK], { mode: "view" })?.tagName).toBe("jeswr-task-list");
    expect(resolveComponent([TASK], { mode: "edit" })).toBeUndefined();
  });

  it("every entry in the static map is mode:view in Phase-1", () => {
    for (const e of RESOLVER_ENTRIES) expect(e.mode).toBe("view");
  });
});

describe("resolveComponentForClass", () => {
  it("looks up a single class directly", () => {
    expect(resolveComponentForClass(BOOKMARK)?.tagName).toBe("jeswr-bookmark-list");
    expect(resolveComponentForClass("urn:nope")).toBeUndefined();
  });

  it("honours the mode filter", () => {
    expect(resolveComponentForClass(TASK, { mode: "edit" })).toBeUndefined();
  });
});

describe("collectTypes", () => {
  it("collects every rdf:type NamedNode object (PM's collectTypes scan)", () => {
    const types = collectTypes(parseTurtle(CONTAINER_TTL));
    expect(types.has(LDP_CONTAINER)).toBe(true);
    expect(types.has("http://www.w3.org/ns/ldp#BasicContainer")).toBe(true);
  });

  it("scopes to a single subject when one is given", () => {
    const store = parseTurtle(BOOKMARKS_TTL);
    const types = collectTypes(store, "https://pod.example/bookmarks/1#it");
    expect(types.has(BOOKMARK)).toBe(true);
    expect(types.size).toBe(1);
  });

  it("end-to-end: a parsed container graph resolves to the collection element", () => {
    const types = collectTypes(parseTurtle(CONTAINER_TTL), "https://pod.example/data/");
    expect(resolveComponent(types)?.tagName).toBe("jeswr-collection");
  });
});
