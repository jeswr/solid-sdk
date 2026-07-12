// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { parseRdf } from "@jeswr/fetch-rdf";
import type { Quad } from "@rdfjs/types";
import { describe, expect, it } from "vitest";
import { buildClientIdDocument, clientIdJson, Federation } from "../src/clientid.js";
import { FinClass } from "../src/vocab.js";

const CLIENT_ID = "https://money.solid.example/clientid.jsonld";

function opts() {
  return {
    clientId: CLIENT_ID,
    redirectUris: ["https://money.solid.example/callback"],
    clientUri: "https://money.solid.example/",
    logoUri: "https://money.solid.example/logo.svg",
  };
}

describe("buildClientIdDocument", () => {
  it("carries the canonical Solid-OIDC client metadata", () => {
    const doc = buildClientIdDocument(opts());
    expect(doc.client_id).toBe(CLIENT_ID);
    expect(doc.client_name).toBe("Pod Money");
    expect(doc.redirect_uris).toEqual(["https://money.solid.example/callback"]);
    expect(doc.token_endpoint_auth_method).toBe("none");
    expect(doc.grant_types).toContain("refresh_token");
    expect(doc.client_uri).toBe("https://money.solid.example/");
    expect(doc.logo_uri).toBe("https://money.solid.example/logo.svg");
  });

  it("declares the fedapp:App federation block", () => {
    const doc = buildClientIdDocument(opts());
    expect(doc["@type"]).toContain("fedapp:App");
    expect(doc["fedapp:sector"]).toBe(Federation.sectorFinance);
    expect(doc["fedapp:produces"]).toContain(FinClass.Balance);
    expect(doc["fedapp:consumes"]).toContain(FinClass.Transaction);
  });

  it("omits client_uri/logo_uri when not provided and defaults the name", () => {
    const doc = buildClientIdDocument({
      clientId: CLIENT_ID,
      redirectUris: ["https://x.example/cb"],
    });
    expect(doc.client_uri).toBeUndefined();
    expect(doc.logo_uri).toBeUndefined();
    expect(doc.client_name).toBe("Pod Money");
  });

  it("honours a custom client name", () => {
    const doc = buildClientIdDocument({
      clientId: CLIENT_ID,
      clientName: "Pod Money (beta)",
      redirectUris: ["https://x.example/cb"],
    });
    expect(doc.client_name).toBe("Pod Money (beta)");
  });
});

describe("clientIdJson", () => {
  it("serialises to pretty JSON with a trailing newline", () => {
    const json = clientIdJson(opts());
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json).client_id).toBe(CLIENT_ID);
  });
});

describe("clientid fedapp block round-trips as RDF", () => {
  it("parses the JSON-LD fedapp block into the canonical fedapp triples", async () => {
    // The @context references a remote Solid-OIDC context; strip it for an
    // offline parse so only the fedapp/acl terms (which carry inline @context
    // mappings) need resolving. The fedapp block is what we assert on.
    const doc = buildClientIdDocument(opts());
    const ctx = doc["@context"] as unknown[];
    doc["@context"] = ctx.filter((c) => typeof c === "object");
    doc["@id"] = CLIENT_ID;

    const store = await parseRdf(JSON.stringify(doc), "application/ld+json", {
      baseIRI: CLIENT_ID,
    });
    const quads = [...store] as Quad[];

    const has = (p: string, o: string) =>
      quads.some(
        (q) => q.subject.value === CLIENT_ID && q.predicate.value === p && q.object.value === o,
      );

    expect(has(Federation.sectorProperty, Federation.sectorFinance)).toBe(true);
    expect(has(Federation.accessProperty, Federation.aclRead)).toBe(true);
    expect(has(Federation.accessProperty, Federation.aclWrite)).toBe(true);
    expect(has(Federation.accessProperty, Federation.aclAppend)).toBe(true);
    expect(has(Federation.consumesProperty, FinClass.Transaction)).toBe(true);
    expect(has(Federation.producesProperty, FinClass.Balance)).toBe(true);
    // the App type itself
    expect(
      quads.some(
        (q) =>
          q.subject.value === CLIENT_ID &&
          q.predicate.value.endsWith("type") &&
          q.object.value === Federation.app,
      ),
    ).toBe(true);
  });
});
