// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { allCatalogEntries } from "@jeswr/pod-connectors";
import { Provenance as ItemProvenance } from "@jeswr/pod-connectors/core/provenance";
import { MusicRecording, PodThing } from "@jeswr/pod-connectors/core/vocab";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { DEMO_CONNECTOR } from "../../src/apps/home/lib/connect/catalogue";
import {
  CONNECTORS,
  connectorForUrl,
  createIdentityResolver,
  externalName,
  identitiesIn,
  type ProvenanceContext,
  provenanceOf,
  publicAgentUrl,
} from "../../src/apps/home/lib/model/provenance";
import * as permissions from "../../src/apps/home/lib/permissions";
import { CLIENT_RETRY_MS } from "../../src/apps/home/lib/permissions/client";
import { rdf, STORAGE, WEB_ID } from "./fixtures";

const SOFTWARE = "http://www.w3.org/ns/prov#SoftwareAgent";
const clientSubject = `${STORAGE}notes/note.ttl#it`;
function attributedClient(iri: string, type: string | undefined = SOFTWARE) {
  const dataset = new Store();
  new ItemProvenance(clientSubject, dataset, DataFactory).attributedTo.add(iri);
  if (type) new PodThing(iri, dataset, DataFactory).types.add(type);
  return dataset;
}

const unsafeAgents = [
  "https://10.0.0.1/client.jsonld",
  "https://172.16.0.1/client.jsonld",
  "https://192.168.1.1/client.jsonld",
  "https://169.254.169.254/client.jsonld",
  "https://127.0.0.1/client.jsonld",
  "https://127.1/client.jsonld",
  "https://0x7f000001/client.jsonld",
  "https://8.8.8.8/client.jsonld",
  "https://[::1]/client.jsonld",
  "https://[2001:4860:4860::8888]/client.jsonld",
  "https://localhost/client.jsonld",
  "https://host.localhost/client.jsonld",
  "https://host.local/client.jsonld",
  "https://host.internal/client.jsonld",
  "https://metadata.goog/client.jsonld",
  "https://host.INTERNAL./client.jsonld",
  "https://dotless/client.jsonld",
  "https://dotless./client.jsonld",
  "https://public.example:8443/client.jsonld",
  "https://user:password@public.example/client.jsonld",
  "http://insecure.example/client.jsonld",
  "urn:example:agent",
  "bad",
];

it.each(unsafeAgents)("refuses non-public Client ID destination %s without fetching", (iri) => {
  expect(publicAgentUrl(iri)).toBe(false);
  const publicFetch = vi.fn<typeof fetch>();
  expect(createIdentityResolver(publicFetch)(attributedClient(iri), clientSubject)).toBeUndefined();
  expect(publicFetch).not.toHaveBeenCalled();
});
it.each([
  "https://app.example/client",
  "https://app.example:443/client",
  "https://APP.EXAMPLE./client",
])("accepts public-looking HTTPS hosts on port 443: %s", (iri) =>
  expect(publicAgentUrl(iri)).toBe(true));

describe("external provenance names", () => {
  const controls = [
    ...Array.from({ length: 32 }, (_, n) => n),
    ...Array.from({ length: 33 }, (_, n) => n + 127),
    0x200e,
    0x200f,
    0x202a,
    0x202b,
    0x202c,
    0x202d,
    0x202e,
    0x2066,
    0x2067,
    0x2068,
    0x2069,
    // Invisible format characters (Cf): zero-width space/joiners, word joiner, soft hyphen,
    // Mongolian vowel separator, Arabic letter mark, byte-order mark.
    0x200b,
    0x200c,
    0x200d,
    0x2060,
    0x00ad,
    0x180e,
    0x061c,
    0xfeff,
  ];
  const cases: [string | undefined, string][] = [
    [undefined, "agent.example"],
    ["", "agent.example"],
    ["  ", "agent.example"],
    ["you", "agent.example"],
    ["You", "agent.example"],
    ["yOu", "agent.example"],
    ["ME", "agent.example"],
    [" me ", "agent.example"],
    ["y\u202eou", "agent.example"],
    ["y\u200bou", "agent.example"],
    ["Spot\u200dify", "agent.example"],
    ["Spot\u{e0041}ify", "agent.example"],
    ["\uff59\uff4f\uff55", "agent.example"],
    ["https://identifier.example/client.jsonld", "agent.example"],
    ["  Note   Nest\u00a0 app  ", "Note Nest app"],
    ["A".repeat(60), "A".repeat(60)],
    ["A".repeat(61), `${"A".repeat(59)}…`],
    ["🎵".repeat(61), `${"🎵".repeat(59)}…`],
    ...controls.map((code): [string, string] => [
      `Note${String.fromCharCode(code)}Nest`,
      "NoteNest",
    ]),
    ...[
      DEMO_CONNECTOR.label,
      ...CONNECTORS.map(({ label }) => label),
      ...allCatalogEntries().map(({ name }) => name),
    ].map((name): [string, string] => [name.toUpperCase(), "agent.example"]),
  ];
  it.each(cases)("sanitises graph and client names (%s)", async (name, expected) => {
    expect(externalName(name, "agent.example")).toBe(expected);
    const iri = `https://agent.example/client-${cases.findIndex((row) => row[0] === name)}.jsonld`;
    const dataset = attributedClient(iri);
    const publicFetch = vi.fn<typeof fetch>(async () => Response.json({ client_name: name }));
    const identities = await createIdentityResolver(publicFetch)(dataset, clientSubject);
    expect(identities?.get(iri)?.label).toBe(expected);
    if (name?.trim()) {
      new PodThing(iri, dataset, DataFactory).name = name;
      expect(identitiesIn(dataset, clientSubject).get(iri)?.label).toBe(expected);
      expect(
        provenanceOf(dataset, clientSubject, STORAGE, {
          identities: new Map([[iri, { kind: "app", label: name }]]),
        }).label,
      ).toBe(expected);
    }
  });
});

it("sanitises named opaque agents without exposing their identifiers", () => {
  const iri = "urn:example:named-agent";
  const dataset = attributedClient(iri);
  new PodThing(iri, dataset, DataFactory).name = "You";
  const identities = identitiesIn(dataset, clientSubject);
  expect(identities.get(iri)).toEqual({ kind: "app", label: "someone else" });
  expect(provenanceOf(dataset, clientSubject, STORAGE, { identities })).toEqual({
    kind: "app",
    label: "someone else",
  });
});

describe("Home Client ID Document attribution", () => {
  it("uses the Permissions resolver and its credential-free request for client_name", async () => {
    const iri = "https://notenest.example/client.jsonld";
    const dataset = attributedClient(iri);
    const publicFetch = vi.fn<typeof fetch>(async () => Response.json({ client_name: "NoteNest" }));
    const identities = await createIdentityResolver(publicFetch)(dataset, clientSubject);
    expect(
      provenanceOf(dataset, clientSubject, STORAGE, { identities: identities ?? new Map() }),
    ).toEqual({ kind: "app", label: "NoteNest" });
    expect(publicFetch).toHaveBeenCalledExactlyOnceWith(iri, {
      headers: { accept: "application/ld+json, application/json" },
      credentials: "omit",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    SOFTWARE,
    "https://schema.org/SoftwareApplication",
    "http://schema.org/SoftwareApplication",
    "https://www.w3.org/ns/activitystreams#Application",
  ])("fetches graph-typed software (%s)", async (type) => {
    const iri = `https://typed.example/client.jsonld?type=${encodeURIComponent(type)}`;
    const publicFetch = vi.fn<typeof fetch>(async () =>
      Response.json({ client_name: "Typed app" }),
    );
    expect(
      (await createIdentityResolver(publicFetch)(attributedClient(iri, type), clientSubject))?.get(
        iri,
      )?.label,
    ).toBe("Typed app");
    expect(publicFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "https://id.inrupt.com/alice",
    "https://unknown.example/client.jsonld",
    "https://unknown.example/card#me",
  ])("never fetches or calls an untyped agent an app (%s)", (iri) => {
    const publicFetch = vi.fn<typeof fetch>();
    const dataset = attributedClient(iri, "");
    expect(createIdentityResolver(publicFetch)(dataset, clientSubject)).toBeUndefined();
    expect(provenanceOf(dataset, clientSubject, STORAGE)).toEqual({
      kind: "other",
      label: "someone else",
    });
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it("resolves the agent associated with the generating activity, never the activity", async () => {
    const dataset = new Store();
    const activity = "https://runs.example/run/1";
    const iri = "https://activity-agent.example/client.jsonld";
    new ItemProvenance(clientSubject, dataset, DataFactory).generatedBy.add(activity);
    new ItemProvenance(activity, dataset, DataFactory).associatedWith = iri;
    const publicFetch = vi.fn<typeof fetch>(async () =>
      Response.json({ client_name: "Import app" }),
    );
    const identities = await createIdentityResolver(publicFetch)(dataset, clientSubject);
    expect(publicFetch).toHaveBeenCalledExactlyOnceWith(iri, expect.anything());
    expect(
      provenanceOf(dataset, clientSubject, STORAGE, { identities: identities ?? new Map() }),
    ).toEqual({ kind: "app", label: "Import app" });
    new PodThing(iri, dataset, DataFactory).name = "Graph app";
    expect(identitiesIn(dataset, clientSubject).get(iri)?.label).toBe("Graph app");
  });

  it.each([
    "https://origin-only.example/",
    "https://software.example/client#app",
  ])("keeps a host fallback without fetching origins or fragment identifiers: %s", (iri) => {
    const dataset = attributedClient(iri);
    const publicFetch = vi.fn<typeof fetch>();
    expect(createIdentityResolver(publicFetch)(dataset, clientSubject)).toBeUndefined();
    expect(provenanceOf(dataset, clientSubject, STORAGE)).toEqual({
      kind: "app",
      label: new URL(iri).hostname,
    });
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it("keeps only in-flight work and delegates subsequent cache decisions to Permissions", async () => {
    const iri = "https://cached-notenest.example/client.jsonld";
    const publicFetch = vi.fn<typeof fetch>(async () => Response.json({ client_name: "NoteNest" }));
    const sharedResolver = vi.spyOn(permissions, "resolveClientName");
    try {
      const resolve = createIdentityResolver(publicFetch);
      const dataset = attributedClient(iri);
      new ItemProvenance(clientSubject, dataset, DataFactory).generatedBy.add(iri);
      const another = `${STORAGE}notes/another.ttl#it`;
      new ItemProvenance(another, dataset, DataFactory).attributedTo.add(iri);
      const results = await Promise.all([
        resolve(dataset, clientSubject),
        resolve(dataset, another),
      ]);
      expect(sharedResolver).toHaveBeenCalledTimes(1);
      results.push(await resolve(dataset, another));
      expect(results.every((identities) => identities?.get(iri)?.label === "NoteNest")).toBe(true);
      expect(sharedResolver).toHaveBeenCalledTimes(2);
      expect(publicFetch).toHaveBeenCalledTimes(1);
    } finally {
      sharedResolver.mockRestore();
    }
  });

  it("retries failed lookups after Permissions' retry window", async () => {
    const iri = "https://retry-name.example/client.jsonld";
    const dataset = attributedClient(iri);
    const publicFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue(Response.json({ client_name: "Recovered app" }));
    const resolve = createIdentityResolver(publicFetch);
    const now = Date.now();
    const time = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      expect((await resolve(dataset, clientSubject))?.get(iri)?.label).toBe("retry-name.example");
      expect((await resolve(dataset, clientSubject))?.get(iri)?.label).toBe("retry-name.example");
      expect(publicFetch).toHaveBeenCalledTimes(1);
      time.mockReturnValue(now + CLIENT_RETRY_MS + 1);
      expect((await resolve(dataset, clientSubject))?.get(iri)?.label).toBe("Recovered app");
      expect(publicFetch).toHaveBeenCalledTimes(2);
    } finally {
      time.mockRestore();
    }
  });

  it("fetches at most one distinct agent for an item", async () => {
    const dataset = attributedClient("https://first-agent.example/client.jsonld");
    const second = "https://second-agent.example/client.jsonld";
    new ItemProvenance(clientSubject, dataset, DataFactory).attributedTo.add(second);
    new PodThing(second, dataset, DataFactory).types.add(SOFTWARE);
    const publicFetch = vi.fn<typeof fetch>(async () =>
      Response.json({ client_name: "First app" }),
    );
    const resolve = createIdentityResolver(publicFetch);
    await resolve(dataset, clientSubject);
    await resolve(dataset, clientSubject);
    expect(publicFetch).toHaveBeenCalledTimes(1);
    expect(publicFetch.mock.calls[0]?.[0]).toBe("https://first-agent.example/client.jsonld");
  });

  it("caps a Home session at 20 distinct agents, with host fallbacks thereafter", async () => {
    const publicFetch = vi.fn<typeof fetch>(async () =>
      Response.json({ client_name: "Counted app" }),
    );
    const resolve = createIdentityResolver(publicFetch);
    for (let n = 0; n < 20; n++) {
      const iri = `https://budget-${n}.example/client.jsonld`;
      await resolve(attributedClient(iri), clientSubject);
    }
    const iri = "https://over-budget.example/client.jsonld";
    const dataset = attributedClient(iri);
    expect(resolve(dataset, clientSubject)).toBeUndefined();
    expect(provenanceOf(dataset, clientSubject, STORAGE)).toEqual({
      kind: "app",
      label: "over-budget.example",
    });
    expect(publicFetch).toHaveBeenCalledTimes(20);
    expect(
      (await resolve(attributedClient("https://budget-0.example/client.jsonld"), clientSubject))
        ?.size,
    ).toBe(1);
    expect(publicFetch).toHaveBeenCalledTimes(20);
    // A new Home session has a fresh budget.
    await createIdentityResolver(publicFetch)(dataset, clientSubject);
    expect(publicFetch).toHaveBeenCalledTimes(21);
  });

  it("preserves graph names without resolving self, demo, people, services or opaque agents", () => {
    const dataset = new Store();
    const item = new ItemProvenance(clientSubject, dataset, DataFactory);
    for (const iri of [
      WEB_ID,
      DEMO_CONNECTOR.iri,
      "urn:example:agent",
      "https://people.example/person",
      "https://service.example/client",
      "https://named.example/client.jsonld",
    ]) {
      item.attributedTo.add(iri);
      new PodThing(iri, dataset, DataFactory).types.add(SOFTWARE);
    }
    new PodThing("https://people.example/person", dataset, DataFactory).types.add(
      "https://schema.org/Person",
    );
    const service = new PodThing("https://service.example/client", dataset, DataFactory);
    service.types.delete(SOFTWARE);
    service.types.add("https://www.w3.org/ns/activitystreams#Service");
    new PodThing("https://named.example/client.jsonld", dataset, DataFactory).name = "Named app";
    const publicFetch = vi.fn<typeof fetch>();
    expect(createIdentityResolver(publicFetch)(dataset, clientSubject, WEB_ID)).toBeUndefined();
    expect(
      identitiesIn(dataset, clientSubject).get("https://named.example/client.jsonld")?.label,
    ).toBe("Named app");
    expect(publicFetch).not.toHaveBeenCalled();
    expect(createIdentityResolver()(new Store(), clientSubject)).toBeUndefined();
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
        new URL(DEMO_CONNECTOR.iri).hostname,
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
      [identifier, { kind: "app", label: "identifier.example" }],
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

  it("rule 3: uses only a connector import root when attribution is self or unresolved", () => {
    const dataset = new Store();
    const item = new ItemProvenance(subject, dataset, DataFactory);
    item.attributedTo.add(WEB_ID);
    item.attributedTo.add("https://unknown.example/");
    item.sourceUrl = "https://unlisted.example/";
    expect(
      provenanceOf(dataset, subject, `${STORAGE}integrations/netflix/collection.ttl`, context),
    ).toEqual({ kind: "source", label: "Netflix", logoId: "netflix" });
    expect(
      provenanceOf(dataset, subject, `${STORAGE}integrations/github/`, { storage: STORAGE }),
    ).toMatchObject({
      label: "GitHub",
    });
    expect(provenanceOf(dataset, subject, `${STORAGE}integrations/unknown/`, context)).toEqual({
      kind: "other",
      label: "someone else",
    });
    expect(
      provenanceOf(dataset, subject, `${STORAGE}notes/integrations/spotify/x/`, context),
    ).toEqual({
      kind: "other",
      label: "someone else",
    });
  });

  it("rule 4: hand-added notes have Added by you; ignores forged or invalid folders", async () => {
    const dataset = await rdf("<#it> a schema:TextDigitalDocument .");
    for (const container of [
      `${STORAGE}notes/`,
      "bad",
      "https://foreign.example/integrations/spotify/",
      `${STORAGE}integrations/spotify`,
      `${STORAGE}notes/integrations/spotify/x/`,
      `${STORAGE}integrations/spotify-evil/`,
      `${STORAGE}integrations/spotify/%2e%2e/notes/`,
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
    ).toEqual({ kind: "app", label: "app.example" });
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
        label: "agents.example",
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

  it("keeps typed software on its host fallback and unnamed generating activities as apps", () => {
    for (const iri of [app, "https://app.example/id#app"]) {
      const dataset = new Store();
      new ItemProvenance(subject, dataset, DataFactory).attributedTo.add(iri);
      new PodThing(iri, dataset, DataFactory).types.add(SOFTWARE);
      expect(provenanceOf(dataset, subject, STORAGE, { userWebId: WEB_ID })).toEqual({
        kind: "app",
        label: "app.example",
      });
    }
    const activity = new Store();
    new ItemProvenance(subject, activity, DataFactory).generatedBy.add(
      "https://app.example/runs#1",
    );
    expect(provenanceOf(activity, subject, STORAGE)).toEqual({ kind: "app", label: "another app" });
    const appWebId = "https://app.example/id#app";
    const nameless = new Store();
    new ItemProvenance(subject, nameless, DataFactory).attributedTo.add(appWebId);
    expect(
      provenanceOf(nameless, subject, STORAGE, {
        identities: new Map([[appWebId, { kind: "app", label: "" }]]),
      }),
    ).toEqual({ kind: "app", label: "app.example" });
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
