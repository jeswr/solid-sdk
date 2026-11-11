// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { Provenance as ItemProvenance } from "@jeswr/pod-connectors/core/provenance";
import { MusicRecording, PodThing } from "@jeswr/pod-connectors/core/vocab";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { DEMO_CONNECTOR } from "../../src/apps/home/lib/connect/catalogue";
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

  it("recognises demo attribution without saved connections or an agent description", () => {
    const dataset = new Store();
    new ItemProvenance(subject, dataset, DataFactory).attributedTo.add(DEMO_CONNECTOR.iri);
    expect(provenanceOf(dataset, subject, STORAGE, context)).toEqual({
      kind: "source",
      label: DEMO_CONNECTOR.label,
      demo: true,
    });
  });

  it("keeps real source and agent provenance alongside the demo flag", () => {
    for (const [source, expected] of [
      [true, { kind: "source", label: "Spotify", logoId: "spotify" }],
      [false, { kind: "app", label: "MyHealth" }],
    ] as const) {
      const dataset = new Store();
      const item = new ItemProvenance(subject, dataset, DataFactory);
      item.attributedTo.add(DEMO_CONNECTOR.iri);
      if (source) item.sourceUrl = "https://open.spotify.com/track/1";
      else item.attributedTo.add(app);
      new PodThing(DEMO_CONNECTOR.iri, dataset, DataFactory).name = DEMO_CONNECTOR.label;
      expect(provenanceOf(dataset, subject, STORAGE, context)).toEqual({ ...expected, demo: true });
      expect(identitiesIn(dataset, subject).has(DEMO_CONNECTOR.iri)).toBe(false);
    }
  });

  it("keeps container provenance and scopes demo attribution to the item subject", () => {
    const dataset = new Store();
    new ItemProvenance(subject, dataset, DataFactory).attributedTo.add(DEMO_CONNECTOR.iri);
    new MusicRecording(`${STORAGE}item.ttl#other`, dataset, DataFactory).mark();
    expect(provenanceOf(dataset, subject, `${STORAGE}integrations/spotify/`, context)).toEqual({
      kind: "source",
      label: "Spotify",
      logoId: "spotify",
      demo: true,
    });
    expect(provenanceOf(dataset, `${STORAGE}item.ttl#other`, STORAGE, context)).toEqual({
      kind: "you",
      label: "Added by you",
    });
  });

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

  // AUTHORED-BY Claude Opus 5.5 — fix round 4 (finding 6)
  it("calls an unnamed, untyped WebID someone else: its shape doesn't prove a person", async () => {
    for (const agent of [person, "https://agents.example/a#me"]) {
      const bare = await rdf(`<#it> prov:wasAttributedTo <${agent}> .`);
      expect(provenanceOf(bare, subject, STORAGE, { userWebId: WEB_ID })).toEqual({
        kind: "other",
        label: "someone else",
      });
    }
    // A fragment on a non-web identifier (no WebID can be dereferenced) is not a WebID.
    for (const agent of ["urn:example:agent#me", "did:example:123#key-1"]) {
      const opaque = await rdf(`<#it> prov:wasAttributedTo <${agent}> .`);
      expect(provenanceOf(opaque, subject, STORAGE, { userWebId: WEB_ID })).toEqual({
        kind: "app",
        label: "another app",
      });
    }
    // A known name still wins.
    const bare = await rdf(`<#it> prov:wasAttributedTo <${person}> .`);
    expect(provenanceOf(bare, subject, STORAGE, context)).toEqual({ kind: "person", label: "Bob" });
    // Typed as a person in the loaded data, with or without a fragment.
    for (const [agent, type] of [
      ["https://bob.example/profile", "http://xmlns.com/foaf/0.1/Person"],
      ["https://bob.example/profile#me", "https://schema.org/Person"],
    ]) {
      const typed = await rdf(`<#it> prov:wasAttributedTo <${agent}> . <${agent}> a <${type}> .`);
      expect(provenanceOf(typed, subject, STORAGE, { userWebId: WEB_ID })).toEqual({
        kind: "person",
        label: "another person",
      });
    }
  });

  it("labels a WebID typed as software or an AI agent as another app", async () => {
    const agent = "https://agents.example/a#me";
    for (const type of [
      "http://www.w3.org/ns/prov#SoftwareAgent",
      "https://schema.org/SoftwareApplication",
      "http://schema.org/SoftwareApplication",
      "https://www.w3.org/ns/activitystreams#Application",
      "https://www.w3.org/ns/activitystreams#Service",
    ]) {
      const dataset = await rdf(`<#it> prov:wasAttributedTo <${agent}> . <${agent}> a <${type}> .`);
      expect(provenanceOf(dataset, subject, STORAGE, { userWebId: WEB_ID })).toEqual({
        kind: "app",
        label: "another app",
      });
    }
    // A typed person among the attributions still reads as a person.
    const mixed = await rdf(
      `<#it> prov:wasAttributedTo <${agent}>, <${person}> . <${person}> a <http://xmlns.com/foaf/0.1/Person> .`,
    );
    expect(provenanceOf(mixed, subject, STORAGE, { userWebId: WEB_ID }).label).toBe(
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
