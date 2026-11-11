// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { Provenance as ItemProvenance } from "@jeswr/pod-connectors/core/provenance";
import { MusicRecording, PodThing } from "@jeswr/pod-connectors/core/vocab";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { DEMO_CONNECTOR } from "../../src/apps/home/lib/connect/catalogue";
import {
  CONNECTORS,
  connectorForUrl,
  createIdentityResolver,
  identitiesIn,
  type ProvenanceContext,
  provenanceOf,
} from "../../src/apps/home/lib/model/provenance";
import * as permissions from "../../src/apps/home/lib/permissions";
import { rdf, STORAGE, WEB_ID } from "./fixtures";

describe("Home Client ID Document attribution", () => {
  const subject = `${STORAGE}notes/note.ttl#it`;
  function attributedTo(iri: string) {
    const dataset = new Store();
    new ItemProvenance(subject, dataset, DataFactory).attributedTo.add(iri);
    return dataset;
  }

  it("uses the Permissions resolver and its credential-free request for client_name", async () => {
    const iri = "https://notenest.example/client.jsonld";
    const dataset = attributedTo(iri);
    const publicFetch = vi.fn<typeof fetch>(async () => Response.json({ client_name: "NoteNest" }));
    const identities = await createIdentityResolver(publicFetch)(dataset, subject);
    expect(provenanceOf(dataset, subject, STORAGE, { identities })).toEqual({
      kind: "app",
      label: "NoteNest",
    });
    expect(publicFetch).toHaveBeenCalledExactlyOnceWith(iri, {
      headers: { accept: "application/ld+json, application/json" },
      credentials: "omit",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    undefined,
    "",
    "  ",
    "https://identifier.example/client.jsonld",
  ])("falls back to the host for a missing or unusable name (%s)", async (clientName) => {
    const iri = `https://nameless-${String(clientName).length}.example/client.jsonld`;
    const publicFetch = vi.fn<typeof fetch>(async () => Response.json({ client_name: clientName }));
    const identities = await createIdentityResolver(publicFetch)(attributedTo(iri), subject);
    expect(identities.get(iri)).toEqual({ kind: "app", label: new URL(iri).hostname });
  });

  it("falls back to the host when the client document cannot be read", async () => {
    const iri = "https://unreadable.example/client.jsonld";
    const publicFetch = vi.fn<typeof fetch>(async () => {
      throw new Error("Offline");
    });
    expect(
      (await createIdentityResolver(publicFetch)(attributedTo(iri), subject)).get(iri),
    ).toEqual({ kind: "app", label: "unreadable.example" });
  });

  it.each([
    "https://origin-only.example/",
    "http://insecure.example/client.jsonld",
  ])("uses the host without fetching an IRI rejected by isClientIdDocument: %s", async (iri) => {
    const publicFetch = vi.fn<typeof fetch>();
    expect(permissions.isClientIdDocument(iri)).toBe(false);
    expect(
      (await createIdentityResolver(publicFetch)(attributedTo(iri), subject)).get(iri),
    ).toEqual({ kind: "app", label: new URL(iri).hostname });
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it("reuses the per-agent resolver result across concurrent and subsequent items", async () => {
    const iri = "https://cached-notenest.example/client.jsonld";
    const publicFetch = vi.fn<typeof fetch>(async () => Response.json({ client_name: "NoteNest" }));
    const sharedResolver = vi.spyOn(permissions, "resolveClientName");
    try {
      const resolve = createIdentityResolver(publicFetch);
      const dataset = attributedTo(iri);
      new ItemProvenance(subject, dataset, DataFactory).generatedBy.add(iri);
      const another = `${STORAGE}notes/another.ttl#it`;
      new ItemProvenance(another, dataset, DataFactory).attributedTo.add(iri);
      const results = await Promise.all([resolve(dataset, subject), resolve(dataset, another)]);
      results.push(await resolve(dataset, another));
      expect(results.every((identities) => identities.get(iri)?.label === "NoteNest")).toBe(true);
      expect(sharedResolver).toHaveBeenCalledExactlyOnceWith(iri, publicFetch);
      expect(publicFetch).toHaveBeenCalledTimes(1);
    } finally {
      sharedResolver.mockRestore();
    }
  });

  it("preserves loaded names and never resolves self, demo agents, people or opaque identifiers", async () => {
    const dataset = new Store();
    const item = new ItemProvenance(subject, dataset, DataFactory);
    for (const iri of [
      WEB_ID,
      DEMO_CONNECTOR.iri,
      "urn:example:agent",
      "https://people.example/person",
      "https://people.example/card#me",
      "https://named.example/client.jsonld",
    ])
      item.attributedTo.add(iri);
    new PodThing("https://people.example/person", dataset, DataFactory).types.add(
      "https://schema.org/Person",
    );
    new PodThing("https://named.example/client.jsonld", dataset, DataFactory).name = "Named app";
    const publicFetch = vi.fn<typeof fetch>();
    const identities = await createIdentityResolver(publicFetch)(dataset, subject, WEB_ID);
    expect([...identities]).toEqual([
      ["https://named.example/client.jsonld", { kind: "app", label: "Named app" }],
    ]);
    expect(publicFetch).not.toHaveBeenCalled();
    expect(await createIdentityResolver()(new Store(), subject)).toEqual(new Map());
  });

  it("keeps a fragment agent typed as software as an app with a host fallback", async () => {
    const iri = "https://software.example/#app";
    const dataset = attributedTo(iri);
    new PodThing(iri, dataset, DataFactory).types.add("http://www.w3.org/ns/prov#SoftwareAgent");
    const publicFetch = vi.fn<typeof fetch>();
    expect((await createIdentityResolver(publicFetch)(dataset, subject)).get(iri)).toEqual({
      kind: "app",
      label: "software.example",
    });
    expect(publicFetch).not.toHaveBeenCalled();
  });
});

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
    const subject = `${STORAGE}integrations/spotify/item.ttl#it`;
    const dataset = new Store();
    new ItemProvenance(subject, dataset, DataFactory).attributedTo.add(DEMO_CONNECTOR.iri);
    expect(provenanceOf(dataset, subject, STORAGE, { ...context, documentUrl: subject })).toEqual({
      kind: "source",
      label: DEMO_CONNECTOR.label,
      demo: true,
    });
  });

  it("keeps live connector items without a demo marker unflagged", () => {
    const subject = `${STORAGE}integrations/spotify/item.ttl#it`;
    const dataset = new Store();
    new MusicRecording(subject, dataset, DataFactory).mark().sourceUrl =
      "https://open.spotify.com/track/live";
    expect(provenanceOf(dataset, subject, STORAGE, { ...context, documentUrl: subject })).toEqual({
      kind: "source",
      label: "Spotify",
      logoId: "spotify",
    });
  });

  it("keeps real source and agent provenance alongside the demo flag", () => {
    const subject = `${STORAGE}integrations/spotify/item.ttl#it`;
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
      expect(provenanceOf(dataset, subject, STORAGE, { ...context, documentUrl: subject })).toEqual(
        { ...expected, demo: true },
      );
      expect(identitiesIn(dataset, subject).get(DEMO_CONNECTOR.iri)?.label).toBe(
        DEMO_CONNECTOR.label,
      );
    }
  });

  it("keeps container provenance and scopes demo attribution to the item subject", () => {
    const subject = `${STORAGE}integrations/spotify/item.ttl#it`;
    const dataset = new Store();
    new ItemProvenance(subject, dataset, DataFactory).attributedTo.add(DEMO_CONNECTOR.iri);
    new MusicRecording(`${STORAGE}item.ttl#other`, dataset, DataFactory).mark();
    expect(
      provenanceOf(dataset, subject, `${STORAGE}integrations/spotify/`, {
        ...context,
        documentUrl: subject,
      }),
    ).toEqual({
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

  it("requires the loaded document and storage for named-node demo subjects", () => {
    const documentUrl = `${STORAGE}integrations/spotify/item.ttl`;
    const subject = DataFactory.namedNode(`${documentUrl}#song`);
    const dataset = new Store();
    new ItemProvenance(subject, dataset, DataFactory).attributedTo.add(DEMO_CONNECTOR.iri);
    expect(provenanceOf(dataset, subject, STORAGE, { ...context, documentUrl }).demo).toBe(true);
    for (const incomplete of [
      {},
      { documentUrl },
      { storage: STORAGE },
      { documentUrl: "invalid", storage: STORAGE },
    ])
      expect(provenanceOf(dataset, subject, STORAGE, incomplete)).toEqual({
        kind: "other",
        label: "someone else",
      });
  });

  it.each([
    ["notes/x.ttl", "integrations/spotify/items.ttl", false],
    ["integrations/spotify/items.ttl", "notes/x.ttl", false],
    ["integrations/spotify/items.ttl", "integrations/spotify/items.ttl", true],
    ["integrations/unknown/items.ttl", "integrations/unknown/items.ttl", false],
    ["integrations/spotify/items.ttl", "integrations/spotify/other.ttl", false],
    ["integrations/spotify/a/%2e%2e/items.ttl", "integrations/spotify/items.ttl", false],
    ["integrations/spotify/items.ttl", "integrations/spotify/a/%2e%2e/items.ttl", false],
    [
      "integrations/spotify/nested/integrations/unknown/items.ttl",
      "integrations/spotify/nested/integrations/unknown/items.ttl",
      true,
    ],
  ])("checks document %s and subject %s against known import roots", (path, subjectPath, demo) => {
    const documentUrl = STORAGE + path;
    const subject = `${STORAGE}${subjectPath}#song`;
    const dataset = new Store();
    new ItemProvenance(subject, dataset, DataFactory).attributedTo.add(DEMO_CONNECTOR.iri);
    expect(provenanceOf(dataset, subject, STORAGE, { ...context, documentUrl }).demo === true).toBe(
      demo,
    );
  });

  it("treats forged demo markers as foreign attribution outside the connector import root", () => {
    for (const subject of [
      `${STORAGE}notes/mine.ttl#it`,
      `${STORAGE}notes/integrations/spotify/mine.ttl#it`,
      `${STORAGE}integrations/spotify`,
      `${STORAGE}integrations/spotify-elsewhere.ttl#it`,
      `${STORAGE}integrations/spotify/%2e%2e/notes/mine.ttl#it`,
      `${STORAGE}integrations/spotify/mine.ttl?elsewhere`,
      "https://foreign.example/integrations/spotify/mine.ttl#it",
      DataFactory.blankNode("forged-demo"),
      DataFactory.blankNode(`${STORAGE}integrations/spotify/item.ttl#it`),
    ]) {
      const dataset = new Store();
      const term = typeof subject === "string" ? DataFactory.namedNode(subject) : subject;
      new ItemProvenance(term, dataset, DataFactory).attributedTo.add(DEMO_CONNECTOR.iri);
      const scope = { ...context, documentUrl: term.value };
      expect(provenanceOf(dataset, term, STORAGE, scope)).toEqual({
        kind: "other",
        label: "someone else",
      });
      new PodThing(DEMO_CONNECTOR.iri, dataset, DataFactory).name = "Sample author";
      expect(
        provenanceOf(dataset, term, STORAGE, {
          ...scope,
          identities: identitiesIn(dataset, term),
        }),
      ).toEqual({ kind: "app", label: "Sample author" });
    }
  });

  it("ignores identifier-shaped identity labels without hiding named apps", () => {
    const dataset = new Store();
    const item = new ItemProvenance(subject, dataset, DataFactory);
    const identifier = "https://identifier.example/agent";
    item.attributedTo.add(identifier);
    item.generatedBy.add(app);
    new PodThing(identifier, dataset, DataFactory).name = "https://identifier.example/agent";
    new PodThing(app, dataset, DataFactory).name = "MyHealth";
    expect([...identitiesIn(dataset, subject)]).toEqual([
      [app, { kind: "app", label: "MyHealth" }],
    ]);
  });

  it("ignores demo markers with an invalid storage context", () => {
    const subject = `${STORAGE}integrations/spotify/item.ttl#it`;
    const dataset = new Store();
    new ItemProvenance(subject, dataset, DataFactory).attributedTo.add(DEMO_CONNECTOR.iri);
    expect(
      provenanceOf(dataset, subject, STORAGE, { storage: "invalid", documentUrl: subject }).demo,
    ).toBeUndefined();
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
      expect(
        provenanceOf(dataset, subject, `${STORAGE}integrations/spotify/`, {
          ...context,
          documentUrl: subject,
        }),
      ).toEqual({
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
