// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// gen-catalog.test.mjs — pins the DCAT catalog serializer: (1) the graph carries the
// expected DCAT/schema shape for the catalog + each app, and (2) the Turtle and the
// JSON-LD serializations parse back to an ISOMORPHIC dataset (they cannot drift,
// because they are produced from the SAME quad array). A `.test.mjs` so it stays out
// of tsc (the script is plain `.mjs`).
import jsonld from "jsonld";
import n3 from "n3";
import { describe, expect, it } from "vitest";
import { buildCatalogQuads, quadsToJsonLd, quadsToTurtle } from "./gen-catalog.mjs";

const { Parser } = n3;
const ORIGIN = "https://apps.solid-test.jeswr.org";

const APPS = [
  {
    id: "pod-drive",
    name: "Pod Drive",
    description: "File browser.",
    category: "Documents",
    deployedUrl: "https://drive.solid-test.jeswr.org",
    status: "live",
    repo: "https://github.com/jeswr/pod-drive",
    launch: "autologin",
  },
  {
    id: "accessradar",
    name: "AccessRadar",
    description: "Accessibility SaaS.",
    category: "Finance",
    deployedUrl: null,
    status: "wip",
    repo: "https://github.com/jeswr/accessradar",
    launch: "none",
  },
  {
    // An externally-hosted LIVE app (a fork on Vercel) — deployed, but launch "none":
    // it publishes NO /clientid.jsonld, so it must get schema:url but NOT schema:identifier.
    id: "elk",
    name: "Elk for Solid",
    description: "Mastodon client.",
    category: "Comms",
    deployedUrl: "https://elk-solid.vercel.app",
    status: "live",
    repo: "https://github.com/jeswr/elk",
    launch: "none",
  },
];

/** A stable, order-independent N-Triples signature of a quad array. */
function signature(quads) {
  return quads
    .map(
      (q) =>
        `${q.subject.value}|${q.predicate.value}|${q.object.termType}:${q.object.value}:${q.object.datatype?.value ?? ""}`,
    )
    .sort();
}

describe("buildCatalogQuads — the DCAT/schema shape", () => {
  const quads = buildCatalogQuads(ORIGIN, APPS);
  const has = (s, p, o) =>
    quads.some((q) => q.subject.value === s && q.predicate.value === p && q.object.value === o);

  it("declares the catalog as a dcat:Catalog with title + publisher", () => {
    const cat = `${ORIGIN}/catalog#it`;
    expect(
      has(
        cat,
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        "http://www.w3.org/ns/dcat#Catalog",
      ),
    ).toBe(true);
    expect(has(cat, "http://purl.org/dc/terms/title", "Solid App Store")).toBe(true);
    expect(has(cat, "http://purl.org/dc/terms/publisher", "https://id.jeswr.org/me")).toBe(true);
  });

  it("emits a dcat:CatalogRecord per app linked to a schema:SoftwareApplication", () => {
    const cat = `${ORIGIN}/catalog#it`;
    const rec = `${ORIGIN}/catalog#rec-pod-drive`;
    const app = `${ORIGIN}/catalog#app-pod-drive`;
    expect(has(cat, "http://www.w3.org/ns/dcat#record", rec)).toBe(true);
    expect(
      has(
        rec,
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        "http://www.w3.org/ns/dcat#CatalogRecord",
      ),
    ).toBe(true);
    expect(has(rec, "http://www.w3.org/ns/dcat#resource", app)).toBe(true);
    expect(
      has(
        app,
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        "https://schema.org/SoftwareApplication",
      ),
    ).toBe(true);
    expect(has(app, "https://schema.org/name", "Pod Drive")).toBe(true);
  });

  it("emits schema:url + schema:identifier (→ clientid.jsonld) ONLY for deployed apps", () => {
    const live = `${ORIGIN}/catalog#app-pod-drive`;
    const notLive = `${ORIGIN}/catalog#app-accessradar`;
    expect(has(live, "https://schema.org/url", "https://drive.solid-test.jeswr.org")).toBe(true);
    expect(
      has(
        live,
        "https://schema.org/identifier",
        "https://drive.solid-test.jeswr.org/clientid.jsonld",
      ),
    ).toBe(true);
    // The not-deployed app has NO schema:url (never a launch to a non-existent deploy).
    expect(
      quads.some(
        (q) => q.subject.value === notLive && q.predicate.value === "https://schema.org/url",
      ),
    ).toBe(false);
  });

  it("an externally-hosted live app gets schema:url but NO schema:identifier (it has no clientid.jsonld)", () => {
    const ext = `${ORIGIN}/catalog#app-elk`;
    expect(has(ext, "https://schema.org/url", "https://elk-solid.vercel.app")).toBe(true);
    // No misleading/broken clientid.jsonld link for an app that doesn't serve one.
    expect(
      quads.some(
        (q) => q.subject.value === ext && q.predicate.value === "https://schema.org/identifier",
      ),
    ).toBe(false);
  });

  it("carries the lifecycle status as a curation fact on the record", () => {
    expect(
      has(
        `${ORIGIN}/catalog#rec-pod-drive`,
        "http://www.w3.org/ns/dcat#status",
        `${ORIGIN}/catalog#status-live`,
      ),
    ).toBe(true);
    expect(
      has(
        `${ORIGIN}/catalog#rec-accessradar`,
        "http://www.w3.org/ns/dcat#status",
        `${ORIGIN}/catalog#status-wip`,
      ),
    ).toBe(true);
  });
});

describe("Turtle ⇄ JSON-LD isomorphism", () => {
  it("the two serializations parse to the same set of triples", async () => {
    const quads = buildCatalogQuads(ORIGIN, APPS);

    const turtle = await quadsToTurtle(quads);
    const ttlQuads = new Parser({ format: "text/turtle" }).parse(turtle);

    const jsonldDoc = await quadsToJsonLd(quads);
    const nquads = await jsonld.toRDF(jsonldDoc, { format: "application/n-quads" });
    const jsonldQuads = new Parser({ format: "N-Quads" }).parse(nquads);

    // Same number of triples and the same signature (order-independent).
    expect(ttlQuads.length).toBe(quads.length);
    expect(jsonldQuads.length).toBe(quads.length);
    expect(signature(ttlQuads)).toEqual(signature(jsonldQuads));
  });
});
