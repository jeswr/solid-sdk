// AUTHORED-BY Claude Opus 4.8
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { TypeIndexDataset } from "../src/model/typeIndex.js";
import { Classes, SOLID } from "../src/model/vocab.js";

const INDEX = "https://pod.example/settings/publicTypeIndex.ttl";
const MAIL_CONTAINER = "https://pod.example/mail/messages/";

function emptyIndex(): TypeIndexDataset {
  return new TypeIndexDataset(new Store(), DataFactory);
}

describe("TypeIndexDataset", () => {
  it("registers the mail class against the mail container", () => {
    const idx = emptyIndex();
    const reg = idx.registerMail(INDEX, MAIL_CONTAINER);
    expect(reg.forClass).toBe(Classes.EmailMessage);
    expect(reg.instanceContainer).toBe(MAIL_CONTAINER);
    expect([...reg.types]).toContain(`${SOLID}TypeRegistration`);
    expect(idx.hasRegistrationFor(Classes.EmailMessage)).toBe(true);
  });

  it("registerMail is idempotent on the SAME container — returns the existing entry", () => {
    const idx = emptyIndex();
    const a = idx.registerMail(INDEX, MAIL_CONTAINER);
    const b = idx.registerMail(INDEX, MAIL_CONTAINER);
    expect(b.value).toBe(a.value);
    expect([...idx.registrations].filter((r) => r.forClass === Classes.EmailMessage)).toHaveLength(
      1,
    );
    expect(b.instanceContainer).toBe(MAIL_CONTAINER);
  });

  it("registerMail adds a NEW entry for a different container (distinct subjects)", () => {
    const idx = emptyIndex();
    const a = idx.registerMail(INDEX, MAIL_CONTAINER);
    const b = idx.registerMail(INDEX, "https://pod.example/other-mail/");
    // a class registration that points elsewhere must NOT suppress our own
    expect(b.value).not.toBe(a.value);
    expect([...idx.registrations].filter((r) => r.forClass === Classes.EmailMessage)).toHaveLength(
      2,
    );
    expect(a.instanceContainer).toBe(MAIL_CONTAINER);
    expect(b.instanceContainer).toBe("https://pod.example/other-mail/");
  });

  it("locate returns container entries for a registered class", () => {
    const idx = emptyIndex();
    idx.registerMail(INDEX, MAIL_CONTAINER);
    const where = idx.locate(Classes.EmailMessage);
    expect(where).toEqual([{ container: MAIL_CONTAINER }]);
  });

  it("locate returns instance entries when registered as a single instance", () => {
    const idx = emptyIndex();
    idx.register(INDEX, "#reg-single", Classes.EmailMessage, {
      instance: "https://pod.example/mail/single.ttl",
    });
    expect(idx.locate(Classes.EmailMessage)).toEqual([
      { instance: "https://pod.example/mail/single.ttl" },
    ]);
  });

  it("locate returns an empty list for an unregistered class", () => {
    const idx = emptyIndex();
    expect(idx.locate("https://schema.org/Thing")).toEqual([]);
    expect(idx.hasRegistrationFor("https://schema.org/Thing")).toBe(false);
  });

  it("skips non-matching registrations in locate / hasRegistrationFor / registerMail", () => {
    const idx = emptyIndex();
    // a registration for a DIFFERENT class is present and must be skipped
    idx.register(INDEX, "#reg-other", "https://schema.org/Thing", {
      container: "https://pod.example/other/",
    });
    expect(idx.locate(Classes.EmailMessage)).toEqual([]);
    expect(idx.hasRegistrationFor(Classes.EmailMessage)).toBe(false);
    // registerMail must skip the non-matching entry and create a new one
    const reg = idx.registerMail(INDEX, MAIL_CONTAINER);
    expect(reg.forClass).toBe(Classes.EmailMessage);
    expect(idx.hasRegistrationFor(Classes.EmailMessage)).toBe(true);
    // the unrelated registration survived
    expect(idx.locate("https://schema.org/Thing")).toEqual([
      { container: "https://pod.example/other/" },
    ]);
  });

  it("locate yields an empty entry object for a registration with neither instance nor container", async () => {
    // A malformed-but-present registration (forClass only) — locate must still
    // return an entry, exercising both inner negative branches.
    const turtle = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix schema: <http://schema.org/> .
      <#reg-bare> a solid:TypeRegistration ;
        solid:forClass schema:EmailMessage .
    `;
    const store = await parseRdf(turtle, "text/turtle", { baseIRI: INDEX });
    const idx = new TypeIndexDataset(store, DataFactory);
    expect(idx.locate(Classes.EmailMessage)).toEqual([{}]);
  });

  it("register rejects neither/both of instance and container", () => {
    const idx = emptyIndex();
    expect(() => idx.register(INDEX, "#x", Classes.EmailMessage, {})).toThrow(/exactly one/);
    expect(() =>
      idx.register(INDEX, "#x", Classes.EmailMessage, {
        instance: "https://pod.example/a.ttl",
        container: "https://pod.example/b/",
      }),
    ).toThrow(/exactly one/);
  });

  it("clears forClass/instance/instanceContainer via undefined", () => {
    const idx = emptyIndex();
    const reg = idx.register(INDEX, "#reg-c", Classes.EmailMessage, {
      container: MAIL_CONTAINER,
    });
    reg.instanceContainer = undefined;
    reg.forClass = undefined;
    expect(reg.instanceContainer).toBeUndefined();
    expect(reg.forClass).toBeUndefined();
    // and a single-instance entry's instance can be cleared too
    const reg2 = idx.register(INDEX, "#reg-i", "https://schema.org/Thing", {
      instance: "https://pod.example/a.ttl",
    });
    reg2.instance = undefined;
    expect(reg2.instance).toBeUndefined();
  });

  it("reads registrations from a parsed type-index document", async () => {
    const turtle = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix schema: <http://schema.org/> .
      <> a solid:TypeIndex, solid:ListedDocument .
      <#registration-pod-mail> a solid:TypeRegistration ;
        solid:forClass schema:EmailMessage ;
        solid:instanceContainer <${MAIL_CONTAINER}> .
    `;
    const store = await parseRdf(turtle, "text/turtle", { baseIRI: INDEX });
    const idx = new TypeIndexDataset(store, DataFactory);
    expect(idx.locate(Classes.EmailMessage)).toEqual([{ container: MAIL_CONTAINER }]);
  });
});
