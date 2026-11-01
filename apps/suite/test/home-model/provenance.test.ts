// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  CONNECTORS,
  connectorForUrl,
  identitiesIn,
  type ProvenanceContext,
  provenanceOf,
} from "../../src/apps/home/lib/model/provenance";
import { rdf, STORAGE, WEB_ID } from "./fixtures";

describe("Home §5.3 provenance", () => {
  const subject = `${STORAGE}item.ttl#it`;
  const app = "https://app.example/client.jsonld";
  const person = "https://bob.example/profile#me";
  const context: ProvenanceContext = {
    userWebId: WEB_ID,
    storage: STORAGE,
    identities: new Map([
      [app, { kind: "app", label: "MyHealth" }],
      [person, { kind: "person", label: "Bob" }],
      ["https://blank.example/", { kind: "app", label: " " }],
    ]),
  };

  it("rule 1: recognises connector sources ahead of attributed agents and folders", async () => {
    const dataset = await rdf(
      `<#it> old:url "broken", <https://unknown.example/>, <https://open.spotify.com/track/1> ; prov:wasAttributedTo <${app}> .`,
    );
    expect(provenanceOf(dataset, subject, `${STORAGE}integrations/github/`, context)).toEqual({
      kind: "source",
      label: "Spotify",
      logoId: "spotify",
    });
  });

  it.each([
    "wasAttributedTo",
    "wasGeneratedBy",
  ])("rule 2: resolves %s app and person names", async (predicate) => {
    for (const [iri, kind, label] of [
      [app, "app", "MyHealth"],
      [person, "person", "Bob"],
    ]) {
      const dataset = await rdf(`<#it> prov:${predicate} <${iri}> .`);
      expect(provenanceOf(dataset, subject, `${STORAGE}integrations/spotify/`, context)).toEqual({
        kind,
        label,
      });
    }
  });

  it("rule 3: uses the connector folder when attribution is self, unresolved or nameless", async () => {
    const dataset = await rdf(
      `<#it> schema:url <https://unlisted.example/> ; prov:wasAttributedTo <${WEB_ID}>, <https://unknown.example/>, <https://blank.example/> .`,
    );
    expect(
      provenanceOf(dataset, subject, `${STORAGE}integrations/netflix/collection.ttl`, context),
    ).toEqual({ kind: "source", label: "Netflix", logoId: "netflix" });
    expect(provenanceOf(dataset, subject, `${STORAGE}integrations/github/`)).toMatchObject({
      label: "GitHub",
    });
    expect(provenanceOf(dataset, subject, `${STORAGE}integrations/unknown/`, context)).toEqual({
      kind: "app",
      label: "another app",
    });
  });

  it("rule 4: hand-added notes have Added by you; ignores forged or invalid folders", async () => {
    const dataset = await rdf("<#it> a schema:TextDigitalDocument .");
    for (const container of [
      `${STORAGE}notes/`,
      "bad",
      "https://foreign.example/integrations/spotify/",
      `${STORAGE}integrations/spotify`,
    ]) {
      expect(provenanceOf(dataset, subject, container, context)).toEqual({
        kind: "you",
        label: "Added by you",
      });
    }
    expect(provenanceOf(dataset, subject, STORAGE)).toEqual({ kind: "you", label: "Added by you" });
  });

  it("keeps self attribution while refusing identifier-shaped identity names", async () => {
    const self = await rdf(`<#it> prov:wasAttributedTo <${WEB_ID}> .`);
    expect(provenanceOf(self, subject, STORAGE, context)).toEqual({
      kind: "you",
      label: "Added by you",
    });
    const other = await rdf(`<#it> prov:wasAttributedTo <${app}> .`);
    expect(
      provenanceOf(other, subject, STORAGE, {
        ...context,
        identities: new Map([[app, { kind: "app", label: "https://app.example/client.jsonld" }]]),
      }),
    ).toEqual({ kind: "app", label: "another app" });
  });

  // AUTHORED-BY Claude Opus 5.5 — finding 7
  it("labels a person's WebID with that profile's name, never as another app", async () => {
    const named = await rdf(
      `<#it> prov:wasAttributedTo <${person}> . <${person}> a <http://xmlns.com/foaf/0.1/Person>; <http://xmlns.com/foaf/0.1/name> "Bob Jones" .`,
    );
    const identities = identitiesIn(named, subject);
    expect(identities.get(person)).toEqual({ kind: "person", label: "Bob Jones" });
    expect(provenanceOf(named, subject, STORAGE, { ...context, identities })).toEqual({
      kind: "person",
      label: "Bob Jones",
    });
    // Without identities (the item page before this fix) the same item read as an app.
    const unnamed = await rdf(
      `<#it> prov:wasAttributedTo <${person}> . <${person}> a <http://xmlns.com/foaf/0.1/Person> .`,
    );
    expect(provenanceOf(unnamed, subject, STORAGE, { userWebId: WEB_ID })).toEqual({
      kind: "person",
      label: "another person",
    });
  });

  // AUTHORED-BY Claude Opus 5.5 — fix round 3 (finding 7)
  it("labels a bare WebID-shaped agent as another person without fetching its profile", async () => {
    const bare = await rdf(`<#it> prov:wasAttributedTo <${person}> .`);
    expect(provenanceOf(bare, subject, STORAGE, { userWebId: WEB_ID })).toEqual({
      kind: "person",
      label: "another person",
    });
    // A known name still wins.
    expect(provenanceOf(bare, subject, STORAGE, context)).toEqual({ kind: "person", label: "Bob" });
    // Typed as a person in the loaded data, even without a fragment.
    const typed = await rdf(
      `<#it> prov:wasAttributedTo <https://bob.example/profile> . <https://bob.example/profile> a <http://xmlns.com/foaf/0.1/Person> .`,
    );
    expect(provenanceOf(typed, subject, STORAGE, { userWebId: WEB_ID }).label).toBe(
      "another person",
    );
  });

  it("keeps apps, software agents and generating activities as another app", async () => {
    for (const triples of [
      `<#it> prov:wasAttributedTo <${app}> .`,
      `<#it> prov:wasAttributedTo <https://app.example/id#app> . <https://app.example/id#app> a prov:SoftwareAgent .`,
      `<#it> prov:wasGeneratedBy <https://app.example/runs#1> .`,
    ]) {
      const dataset = await rdf(triples);
      expect(provenanceOf(dataset, subject, STORAGE, { userWebId: WEB_ID })).toEqual({
        kind: "app",
        label: "another app",
      });
    }
    // An identity resolved as an app but nameless is not relabelled as a person.
    const appWebId = "https://app.example/id#app";
    const nameless = await rdf(`<#it> prov:wasAttributedTo <${appWebId}> .`);
    expect(
      provenanceOf(nameless, subject, STORAGE, {
        identities: new Map([[appWebId, { kind: "app", label: "" }]]),
      }),
    ).toEqual({ kind: "app", label: "another app" });
  });

  it("ports all connector host patterns and protects host boundaries", () => {
    expect(CONNECTORS).toHaveLength(30);
    for (const connector of CONNECTORS) {
      for (const host of connector.hosts) {
        expect(connectorForUrl(`https://${host}/item`)?.id).toBe(connector.id);
        expect(connectorForUrl(`https://sub.${host}/item`)?.id).toBe(connector.id);
        expect(connectorForUrl(`https://${host}.evil.example/item`)).toBeUndefined();
      }
    }
    expect(connectorForUrl("https://www.google.com/calendar/event?eid=1")?.id).toBe(
      "google-calendar",
    );
    expect(connectorForUrl("https://google.com/calendar")?.id).toBe("google-calendar");
    expect(connectorForUrl("https://google.com/calendar-evil")).toBeUndefined();
    expect(connectorForUrl("https://google.com/search")).toBeUndefined();
    expect(connectorForUrl("https://OPEN.SPOTIFY.COM:443/track/1")?.id).toBe("spotify");
    expect(connectorForUrl("javascript:alert(1)")).toBeUndefined();
    expect(connectorForUrl("bad")).toBeUndefined();
  });
});
