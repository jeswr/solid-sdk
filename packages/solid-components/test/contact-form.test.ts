// AUTHORED-BY Codex GPT-6.1-Sol
import "../src/components/contact-form.js";
import { parseRdf } from "@jeswr/fetch-rdf";
import {
  Contact,
  parsePerson,
  personSubject,
  serializePerson,
} from "@jeswr/solid-task-model/contacts";
import { DataFactory, Store } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JeswrContactForm } from "../src/components/contact-form.js";

const URL = "https://pod.example/contacts/alice.ttl";
const HOSTILE_ORGANIZATION = '<img src=x onerror=alert(1)><script>alert(2)</script> & "Corp"';

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function mountContactForm(organization: string | undefined) {
  const original = {
    name: "Alice",
    organization,
    note: "Keep this note",
    emails: ["mailto:alice@example.com"],
    phones: ["tel:+15550001"],
    webId: "https://alice.example/profile/card#me",
  };
  let persisted = await serializePerson(URL, original);
  const puts: { url: string; headers: Headers }[] = [];
  const fetch = vi.fn(async (url: RequestInfo | globalThis.URL, init?: RequestInit) => {
    expect(String(url)).toBe(URL);
    if ((init?.method ?? "GET") === "GET") {
      return new Response(persisted, {
        headers: { "Content-Type": "text/turtle", ETag: '"v1"' },
      });
    }
    expect(init?.method).toBe("PUT");
    puts.push({ url: String(url), headers: new Headers(init?.headers) });
    persisted = String(init?.body);
    return new Response(null, { status: 204, headers: { ETag: '"v2"' } });
  });
  const el = document.createElement("jeswr-contact-form") as JeswrContactForm;
  el.fetch = fetch as typeof globalThis.fetch;
  el.src = URL;
  document.body.appendChild(el);
  await vi.waitFor(() => expect(el.querySelector("shacl-form")).not.toBeNull());
  const form = el.querySelector("shacl-form") as HTMLElement & {
    toRDF(): Store;
    validate(): Promise<{ conforms: boolean; results: unknown[] }>;
  };
  return {
    el,
    form,
    puts,
    original,
    graph: () => parseRdf(persisted, "text/turtle", { baseIRI: URL }),
  };
}

describe("<jeswr-contact-form> organization", () => {
  it.each([
    "Example Corp",
    HOSTILE_ORGANIZATION,
    undefined,
  ])("binds the Organisation field and reads the existing value: %s", async (organization) => {
    const { form } = await mountContactForm(organization);
    expect(form.getAttribute("data-shapes")).toContain("Organisation");
    expect(form.getAttribute("data-shapes")).toContain("organization-name");
    expect(form.hasAttribute("data-view")).toBe(false);
    const graph = await parseRdf(form.getAttribute("data-values") ?? "", "text/turtle", {
      baseIRI: URL,
    });
    expect(parsePerson(URL, graph)?.organization).toBe(organization);
    expect(form.querySelector("img, script")).toBeNull();
  });

  it.each([
    { before: "Old Corp", after: "New Corp" },
    { before: undefined, after: "New Corp" },
    { before: "Old Corp", after: undefined },
    { before: undefined, after: undefined },
    { before: "Old Corp", after: HOSTILE_ORGANIZATION },
  ])("saves organization $before → $after through a conditional merge", async ({
    before,
    after,
  }) => {
    const { el, form, puts, original, graph } = await mountContactForm(before);
    const loaded = await graph();
    const oldContact = new Contact(personSubject(URL), loaded, DataFactory);
    const untouched = [...loaded].filter(
      (q) =>
        q.subject.termType === "NamedNode" &&
        q.object.termType !== "BlankNode" &&
        q.predicate.value !== "http://www.w3.org/2006/vcard/ns#organization-name",
    );

    // Model the widget's toRDF delta on its minted subject. The real wrapper,
    // merge callback, DataWriter and serialization remain under test.
    const delta = new Store();
    const edited = new Contact("urn:form:alice", delta, DataFactory).mark();
    edited.name = original.name;
    edited.organization = after;
    edited.note = original.note;
    vi.spyOn(form, "toRDF").mockReturnValue(delta);
    vi.spyOn(form, "validate").mockResolvedValue({ conforms: true, results: [] });

    expect(await el.save()).toBe(true);
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe(URL);
    expect(puts[0].headers.get("If-Match")).toBe('"v1"');
    const saved = await graph();
    const result = parsePerson(URL, saved);
    expect(result?.organization).toBe(after);
    expect(result).toMatchObject({
      name: original.name,
      note: original.note,
      emails: original.emails,
      phones: original.phones,
      webId: original.webId,
    });
    for (const quad of untouched) expect(saved.has(quad)).toBe(true);
    const contact = new Contact(personSubject(URL), saved, DataFactory);
    expect(contact.uid).toBe(oldContact.uid);
    expect(contact.created).toEqual(oldContact.created);
    expect([...saved].some((q) => q.subject.value === "urn:form:alice")).toBe(false);
    if (after === undefined) {
      expect([...saved].some((q) => q.predicate.value.endsWith("organization-name"))).toBe(false);
    }
  });
});
