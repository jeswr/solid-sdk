// AUTHORED-BY Codex GPT-6.1-Sol
import type { SearchResult } from "@jeswr/suite-sdk/search";
import { describe, expect, it } from "vitest";
import { encodeRef } from "../src/lib/refs";
import { podSearchResponse, podSearchResult } from "../src/shell/search/pod-results";

const document = "https://pod.example/alice/item.ttl";
const subject = `${document}#it`;
const ref = encodeRef(document);
const row: SearchResult = {
  url: subject,
  title: "An item",
  parent: "https://pod.example/alice/",
  modified: new Date(123),
};

describe("pod search result routes", () => {
  it.each([
    [
      "http://www.w3.org/2005/01/wf/flow#Task",
      "task",
      "tasks",
      `/tasks/inbox?task=${encodeRef(subject)}`,
    ],
    ["https://jeswr.org/ns/pod-docs#Document", "document", "docs", `/docs/d/${ref}`],
    ["http://schema.org/DigitalDocument", "document", "docs", `/docs/d/${ref}`],
    ["https://schema.org/TextDigitalDocument", "document", "notes", `/notes/n/${ref}`],
    ["http://www.w3.org/2006/vcard/ns#Individual", "person", "contacts", "/contacts"],
    ["http://xmlns.com/foaf/0.1/Person", "person", "contacts", "/contacts"],
    ["http://schema.org/Person", "person", "contacts", "/contacts"],
    ["http://www.w3.org/2002/12/cal/ical#Vevent", "data", "calendar", `/calendar/e/${ref}`],
    ["https://schema.org/Event", "data", "calendar", `/calendar/e/${ref}`],
    ["http://www.w3.org/ns/ldp#Container", "file", "drive", `/drive/f/${ref}`],
    ["http://www.w3.org/ns/ldp#BasicContainer", "file", "drive", `/drive/f/${ref}`],
    ["http://www.w3.org/ns/ldp#Resource", "file", "drive", `/drive/p/${ref}`],
    ["http://www.w3.org/ns/ldp#NonRDFSource", "file", "drive", `/drive/p/${ref}`],
    [
      "http://www.w3.org/ns/iana/media-types/image/jpeg#Resource",
      "file",
      "drive",
      `/drive/p/${ref}`,
    ],
    ["https://example.org/Unknown", "data", "drive", `/drive/p/${ref}`],
    [undefined, "file", "drive", `/drive/p/${ref}`],
  ])("maps %s to %s in %s", (type, group, app, href) => {
    expect(podSearchResult({ ...row, ...(type ? { type } : {}) })).toEqual({
      id: subject,
      title: row.title,
      parent: row.parent,
      modified: row.modified,
      type: group,
      app,
      href,
    });
  });

  it("recognises Notes documents even when the SDK returns the shared Document type", () => {
    const url = "https://pod.example/alice/notes/shopping.ttl#it";
    expect(
      podSearchResult({ ...row, url, type: "https://jeswr.org/ns/pod-docs#Document" }),
    ).toMatchObject({
      id: url,
      app: "notes",
      href: `/notes/n/${encodeRef(url.split("#")[0] ?? "")}`,
    });
  });

  it("opens an untyped Solid container in the Drive folder view", () => {
    const url = "https://pod.example/alice/folder/";
    expect(podSearchResult({ ...row, url })).toMatchObject({
      type: "file",
      app: "drive",
      href: `/drive/f/${encodeRef(url)}`,
    });
  });

  it("classifies untyped RDF as data, preserves metadata and omits absent modification time", () => {
    const { modified: _, ...withoutDate } = row;
    expect(podSearchResult({ ...withoutDate, contentType: "text/turtle; charset=utf-8" })).toEqual({
      id: subject,
      title: row.title,
      parent: row.parent,
      type: "data",
      app: "drive",
      href: `/drive/p/${ref}`,
    });
  });

  it.each([
    ["contacts/people/alice.ttl", "contacts/people/", "people/alice.ttl"],
    ["contacts/alice.ttl", "contacts/", "alice.ttl"],
  ])("uses Contacts' relative document reference for %s", (path, parent, relative) => {
    expect(
      podSearchResult({
        ...row,
        url: `https://pod.example/alice/${path}#this`,
        parent: `https://pod.example/alice/${parent}`,
        type: "http://www.w3.org/2006/vcard/ns#Individual",
      }).href,
    ).toBe(`/contacts/c/${btoa(relative).replace(/=+$/u, "")}`);
  });

  it("retains the Contacts app link for a document its router cannot represent", () => {
    expect(
      podSearchResult({
        ...row,
        url: "https://pod.example/alice/contacts/person%2Ettl",
        type: "http://www.w3.org/2006/vcard/ns#Individual",
        parent: "https://pod.example/alice/contacts/",
      }).href,
    ).toBe("/contacts");
  });

  it("filters app scope after mapping, preserving order and facade authority", () => {
    const rows = [
      row,
      { ...row, url: `${document}#task`, type: "http://www.w3.org/2005/01/wf/flow#Task" },
    ];
    expect(podSearchResponse({ source: "server", results: rows }, "tasks")).toEqual({
      source: "server",
      serverSearch: true,
      results: [podSearchResult(rows[1] as SearchResult)],
    });
    expect(podSearchResponse({ source: "local", results: rows }).results).toHaveLength(2);
    expect(podSearchResponse({ source: "local", results: rows }, "docs")).toEqual({
      source: "local",
      serverSearch: false,
      results: [],
    });
  });
});
