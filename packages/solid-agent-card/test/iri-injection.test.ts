// AUTHORED-BY Claude Fable 5
//
// Regression tests for the n3.Writer IRI-injection class: an untrusted string
// reaching an IRI term must be sanitised so it cannot break out of `<…>` and
// inject arbitrary triples. Every assertion serialises through the PUBLIC API
// then re-parses with a real n3 Parser and inspects the resulting quads — i.e.
// it checks the actual RDF, not the string.

import { Parser, type Quad } from "n3";
import { describe, expect, it } from "vitest";
import { describeAgent } from "../src/describe.js";
import { buildAgentPointer } from "../src/pointer.js";
import type { AgentDescriptor } from "../src/types.js";
import { ANP_AD } from "../src/vocab.js";

// A classic break-out payload: a `>` closes the intended `<…>`, then `. <s> <p> <o>`
// tries to smuggle in a whole extra triple. The injected subject is unmistakable.
const INJECTION = "https://evil/x> . <https://evil/s2> <https://evil/p2> <https://evil/o2";
const INJECTED_SUBJECT = "https://evil/s2";

async function parseTurtle(ttl: string): Promise<Quad[]> {
  return new Parser().parse(ttl) as Quad[];
}

function hasSubject(quads: Quad[], iri: string): boolean {
  return quads.some((q) => q.subject.value === iri);
}

describe("IRI injection — describeAgent Agent Description (RDF write path)", () => {
  it("does not inject a triple via a hostile `url` field", async () => {
    const ttl = await describeAgent({
      id: "https://alice.pod.example/agent",
      name: "Alice's Agent",
      url: INJECTION,
    }).agentDescription.toTurtle();

    const quads = await parseTurtle(ttl);
    // The parse must succeed AND contain no smuggled `<https://evil/s2>` subject.
    expect(hasSubject(quads, INJECTED_SUBJECT)).toBe(false);
    expect(quads.some((q) => q.predicate.value === "https://evil/p2")).toBe(false);
  });

  it("does not inject a triple via a hostile `owner` field", async () => {
    const ttl = await describeAgent({
      id: "https://alice.pod.example/agent",
      name: "Alice's Agent",
      url: "https://alice.pod.example/agent",
      owner: INJECTION,
    }).agentDescription.toTurtle();

    const quads = await parseTurtle(ttl);
    expect(hasSubject(quads, INJECTED_SUBJECT)).toBe(false);
  });

  it("does not inject a triple via a hostile `id` (subject) field", async () => {
    const ttl = await describeAgent({
      id: INJECTION,
      name: "Alice's Agent",
    }).agentDescription.toTurtle();

    const quads = await parseTurtle(ttl);
    expect(hasSubject(quads, INJECTED_SUBJECT)).toBe(false);
    // The escaped subject must be a single percent-encoded IRI, not two terms.
    expect(quads.length).toBeGreaterThan(0);
    for (const q of quads) {
      expect(q.subject.value.includes("> ")).toBe(false);
    }
  });

  it("does not inject a triple via a hostile security-scheme `issuer`", async () => {
    const ttl = await describeAgent({
      id: "https://alice.pod.example/agent",
      name: "Alice's Agent",
      securitySchemes: [{ type: "solid-oidc", issuer: INJECTION }],
    }).agentDescription.toTurtle();

    const quads = await parseTurtle(ttl);
    expect(hasSubject(quads, INJECTED_SUBJECT)).toBe(false);
  });

  it("does not inject a triple via a hostile `protocolSource`", async () => {
    const ttl = await describeAgent({
      id: "https://alice.pod.example/agent",
      name: "Alice's Agent",
      protocolSources: [INJECTION],
    }).agentDescription.toTurtle();

    const quads = await parseTurtle(ttl);
    expect(hasSubject(quads, INJECTED_SUBJECT)).toBe(false);
  });

  // WHATWG `URL.href` percent-encodes space/`<`/`>`/`"` but leaves the other
  // IRIREF-forbidden chars `{ } | ^ \` \\` RAW in query/fragment text — n3.Writer
  // would then emit them verbatim between <…>, yielding invalid Turtle / a
  // break-out. safeHttpIri must run the FULL IRIREF-forbidden encode pass.
  it("percent-encodes `{}` and `\\` left raw by URL in a query", async () => {
    const ttl = await describeAgent({
      id: "https://alice.pod.example/agent",
      name: "Alice's Agent",
      url: "https://alice.pod.example/agent?a={b}&c=d\\e|f^g`h",
    }).agentDescription.toTurtle();

    // Parse must succeed (valid Turtle) …
    const quads = await parseTurtle(ttl);
    // … and no url object term may carry a raw IRIREF-forbidden char.
    const urls = quads
      .filter((q) => q.predicate.value === `${ANP_AD}url`)
      .map((q) => q.object.value);
    expect(urls.length).toBe(1);
    for (const forbidden of ["{", "}", "\\", "|", "^", "`", " ", "<", ">", '"']) {
      expect(urls[0].includes(forbidden)).toBe(false);
    }
  });

  it("percent-encodes `{}` and `\\` left raw by URL in a fragment", async () => {
    const ttl = await describeAgent({
      id: "https://alice.pod.example/agent",
      name: "Alice's Agent",
      owner: "https://alice.pod.example/profile#frag{x}\\y|z^w`",
    }).agentDescription.toTurtle();

    const quads = await parseTurtle(ttl);
    const owners = quads
      .filter((q) => q.predicate.value === `${ANP_AD}owner`)
      .map((q) => q.object.value);
    expect(owners.length).toBe(1);
    for (const forbidden of ["{", "}", "\\", "|", "^", "`"]) {
      expect(owners[0].includes(forbidden)).toBe(false);
    }
    // The `%XX` escapes URL itself produced must not be double-encoded.
    expect(owners[0].includes("%25")).toBe(false);
  });
});

describe("IRI injection — buildAgentPointer (WebID profile write path)", () => {
  it("does not inject via a hostile `agent` object IRI", async () => {
    const ttl = await buildAgentPointer(
      "https://alice.pod.example/profile#me",
      INJECTION,
    ).toString();
    const quads = await parseTurtle(ttl);
    expect(hasSubject(quads, INJECTED_SUBJECT)).toBe(false);
  });

  it("does not inject via a hostile `webId` subject IRI", async () => {
    const ttl = await buildAgentPointer(INJECTION, "https://alice.pod.example/agent").toString();
    const quads = await parseTurtle(ttl);
    expect(hasSubject(quads, INJECTED_SUBJECT)).toBe(false);
  });
});

describe("buildAgentPointer — FAIL CLOSED (never a silent zero-quad pointer)", () => {
  it("THROWS for a non-http(s) agent rather than emitting an empty document", () => {
    expect(() => buildAgentPointer("https://alice.pod.example/profile#me", "not-a-url")).toThrow(
      /agent must be an absolute http\(s\) IRI/,
    );
  });

  it("THROWS for a did: agent (pointer target must be http(s))", () => {
    expect(() =>
      buildAgentPointer("https://alice.pod.example/profile#me", "did:web:agent"),
    ).toThrow(/agent must be an absolute http\(s\) IRI/);
  });

  it("THROWS for a non-http(s) webId", () => {
    expect(() => buildAgentPointer("did:web:alice", "https://alice.pod.example/agent")).toThrow(
      /webId must be an absolute http\(s\) IRI/,
    );
  });

  it("emits the single pointer triple for a valid webId + agent", async () => {
    const doc = buildAgentPointer(
      "https://alice.pod.example/profile#me",
      "https://alice.pod.example/agent",
    );
    expect(doc.quads.length).toBe(1);
    const quads = await parseTurtle(await doc.toString());
    expect(quads.length).toBe(1);
    expect(quads[0].object.value).toBe("https://alice.pod.example/agent");
  });
});

describe("IRI injection — A2A Agent Card (third projection): sanitised + consistent", () => {
  const Hostile: AgentDescriptor = {
    id: "https://alice.pod.example/agent",
    name: "Alice",
    url: INJECTION,
    owner: INJECTION,
    protocolSources: [INJECTION],
    securitySchemes: [{ type: "solid-oidc", issuer: INJECTION }],
  };
  const Forbidden = ["<", ">", '"', "{", "}", "|", "^", "`", "\\", " "];

  it("carries no raw IRIREF-forbidden char in any card IRI field", () => {
    const { agentCard } = describeAgent(Hostile);
    const iriStrings = [
      agentCard.url,
      agentCard.securitySchemes?.["solid-oidc"]?.openIdConnectUrl,
      agentCard["x-solid"]?.owner,
      agentCard["x-solid"]?.agentDescription,
      ...(agentCard["x-solid"]?.protocolSources ?? []),
    ].filter((s): s is string => typeof s === "string");
    expect(iriStrings.length).toBeGreaterThan(0);
    for (const s of iriStrings) {
      for (const forbidden of Forbidden) {
        expect(s.includes(forbidden)).toBe(false);
      }
    }
  });

  it("card url + x-solid.owner match the RDF descriptor's ad:url / ad:owner", async () => {
    const { agentCard, agentDescription } = describeAgent(Hostile);
    const quads = await parseTurtle(await agentDescription.toTurtle());
    const rdfUrl = quads.find((q) => q.predicate.value === `${ANP_AD}url`)?.object.value;
    const rdfOwner = quads.find((q) => q.predicate.value === `${ANP_AD}owner`)?.object.value;
    expect(agentCard.url).toBe(rdfUrl);
    expect(agentCard["x-solid"]?.owner).toBe(rdfOwner);
  });

  it("drops a hostile non-http owner/issuer from the card (matches RDF drop)", () => {
    const { agentCard } = describeAgent({
      id: "https://alice.pod.example/agent",
      name: "Alice",
      owner: "urn:not-http",
      securitySchemes: [{ type: "solid-oidc", issuer: "javascript:alert(1)" }],
    });
    expect(agentCard["x-solid"]?.owner).toBeUndefined();
    expect(agentCard.securitySchemes?.["solid-oidc"]?.openIdConnectUrl).toBeUndefined();
  });
});

describe("IRI injection — legitimate non-http subjects still round-trip", () => {
  const DescriptorDid: AgentDescriptor = {
    id: "did:web:alice.pod.example",
    name: "Alice's DID Agent",
    url: "https://alice.pod.example/agent/endpoint",
  };

  it("preserves a `did:` descriptor id as the subject", async () => {
    const ttl = await describeAgent(DescriptorDid).agentDescription.toTurtle();
    const quads = await parseTurtle(ttl);
    expect(hasSubject(quads, "did:web:alice.pod.example")).toBe(true);
  });

  it("preserves a `urn:` descriptor id as the subject (with an explicit http url)", async () => {
    const ttl = await describeAgent({
      id: "urn:uuid:5f6e7d8c-1a2b-3c4d-5e6f-7a8b9c0d1e2f",
      name: "URN Agent",
      url: "https://alice.pod.example/agent/endpoint",
    }).agentDescription.toTurtle();
    const quads = await parseTurtle(ttl);
    expect(hasSubject(quads, "urn:uuid:5f6e7d8c-1a2b-3c4d-5e6f-7a8b9c0d1e2f")).toBe(true);
  });
});

describe("required `ad:url` — FAIL CLOSED (no silent drop)", () => {
  it("emits a valid ad:url for a non-http id WITH an explicit http url", async () => {
    const ttl = await describeAgent({
      id: "did:web:alice.pod.example",
      name: "DID Agent",
      url: "https://alice.pod.example/agent/endpoint",
    }).agentDescription.toTurtle();
    const quads = await parseTurtle(ttl);
    const urls = quads
      .filter((q) => q.predicate.value === `${ANP_AD}url`)
      .map((q) => q.object.value);
    expect(urls).toEqual(["https://alice.pod.example/agent/endpoint"]);
  });

  it("THROWS for a non-http id WITHOUT any url (would drop the required ad:url)", () => {
    expect(() => describeAgent({ id: "did:web:alice.pod.example", name: "DID Agent" })).toThrow(
      /resolvable http\(s\) `url` is required/,
    );
  });

  it("THROWS for a non-http(s) explicit url on a non-http id", () => {
    expect(() =>
      describeAgent({ id: "urn:uuid:abc", name: "URN Agent", url: "ftp://x/y" }),
    ).toThrow(/resolvable http\(s\) `url` is required/);
  });
});

describe("IRI injection — JSON-LD encoding (RDF-parseable @id / IRI fields)", () => {
  // Collect every IRI-valued string in the JSON-LD doc: any `@id` key (top-level
  // and every nested `{ "@id": … }` node), plus the bare-string `url` term.
  function collectIds(value: unknown, out: string[]): void {
    if (Array.isArray(value)) {
      for (const item of value) collectIds(item, out);
    } else if (value && typeof value === "object") {
      const id = (value as Record<string, unknown>)["@id"];
      if (typeof id === "string") out.push(id);
      for (const v of Object.values(value)) collectIds(v, out);
    }
  }

  function iriValues(doc: Record<string, unknown>): string[] {
    const out: string[] = [];
    collectIds(doc, out);
    // `url` is IRI-valued (context `@type:@id`) but emitted as a bare string.
    if (typeof doc.url === "string") out.push(doc.url);
    return out;
  }

  const Forbidden = ["<", ">", '"', "{", "}", "|", "^", "`", "\\", " "];

  it("carries no raw IRIREF-forbidden char in any @id / IRI field", async () => {
    const doc = await describeAgent({
      id: INJECTION,
      name: "Hostile",
      url: INJECTION,
      owner: INJECTION,
      protocolSources: [INJECTION],
      securitySchemes: [{ type: "solid-oidc", issuer: INJECTION }],
    }).agentDescription.toJsonLd();

    const iris = iriValues(doc as Record<string, unknown>);
    expect(iris.length).toBeGreaterThan(0);
    for (const iri of iris) {
      for (const forbidden of Forbidden) {
        expect(iri.includes(forbidden)).toBe(false);
      }
    }
  });

  it("drops a hostile non-http owner/issuer/protocolSource rather than emitting it raw", async () => {
    const doc = (await describeAgent({
      id: "https://alice.pod.example/agent",
      name: "Alice",
      owner: "javascript:alert(1)",
      protocolSources: ["not-a-url", "https://alice.pod.example/p#v1"],
      securitySchemes: [{ type: "solid-oidc", issuer: "urn:bad" }],
    }).agentDescription.toJsonLd()) as Record<string, unknown>;

    expect(doc.owner).toBeUndefined();
    // Only the one valid http(s) protocolSource survives.
    expect(doc.protocolSource).toEqual([{ "@id": "https://alice.pod.example/p#v1" }]);
    const schemes = doc.securityScheme as Array<Record<string, unknown>>;
    expect(schemes[0].url).toBeUndefined();
  });

  it("preserves a legitimate `did:` @id in the JSON-LD", async () => {
    const doc = (await describeAgent({
      id: "did:web:alice.pod.example",
      name: "DID Agent",
      url: "https://alice.pod.example/agent",
    }).agentDescription.toJsonLd()) as Record<string, unknown>;
    expect(doc["@id"]).toBe("did:web:alice.pod.example");
  });
});

describe("safeHttpIri — escape-FIRST (URL parser normalises before it validates)", () => {
  // Read the single ad:url object value out of the serialised RDF.
  async function rdfUrl(descriptor: AgentDescriptor): Promise<string | undefined> {
    const quads = await parseTurtle(await describeAgent(descriptor).agentDescription.toTurtle());
    return quads.find((q) => q.predicate.value === `${ANP_AD}url`)?.object.value;
  }
  const base = { id: "https://alice.pod.example/agent", name: "Alice" } as const;

  it("REJECTS a leading-space url (parser would trim it) → fail-closed throw", () => {
    expect(() => describeAgent({ ...base, url: " https://evil.example" })).toThrow(
      /resolvable http\(s\) `url` is required/,
    );
  });

  it("REJECTS a trailing-space url → fail-closed throw", () => {
    expect(() => describeAgent({ ...base, url: "https://evil.example " })).toThrow(
      /resolvable http\(s\) `url` is required/,
    );
  });

  it("REJECTS leading/trailing C0-control url → fail-closed throw", () => {
    const Nul = String.fromCharCode(0);
    const Soh = String.fromCharCode(1);
    expect(() => describeAgent({ ...base, url: `https://evil.example${Nul}` })).toThrow(
      /resolvable http\(s\) `url` is required/,
    );
    expect(() => describeAgent({ ...base, url: `${Soh}https://evil.example` })).toThrow(
      /resolvable http\(s\) `url` is required/,
    );
  });

  it("emits a path backslash as %5C (never reinterpreted as `/`)", async () => {
    const Bs = String.fromCharCode(92);
    const url = await rdfUrl({ ...base, url: `https://evil.example/a${Bs}b` });
    expect(url).toBe("https://evil.example/a%5Cb");
    expect(url?.includes(Bs)).toBe(false);
    // The `\` must NOT have become a path separator (`/a/b`) — no host/path confusion.
    expect(url).not.toBe("https://evil.example/a/b");
  });

  it("REJECTS an authority backslash (would otherwise pick a DIFFERENT host)", () => {
    const Bs = String.fromCharCode(92);
    // `https:\\evil.example\x` — the parser would read `evil.example` as the host.
    expect(() => describeAgent({ ...base, url: `https:${Bs}${Bs}evil.example${Bs}x` })).toThrow(
      /resolvable http\(s\) `url` is required/,
    );
  });

  it("round-trips a valid IRI byte-identical (uppercase host, explicit :443, kept)", async () => {
    const lexical = "https://Example.COM:443/Path?Q=1#F";
    const url = await rdfUrl({ ...base, url: lexical });
    // No `.href` canonicalisation (no host-lowercase / default-port drop): RDF
    // identity is lexical, so the caller's exact IRI survives.
    expect(url).toBe(lexical);
  });

  it("still neutralises injection across RDF + JSON-LD + the A2A card", async () => {
    const descriptor: AgentDescriptor = { ...base, url: INJECTION, owner: INJECTION };
    const docs = describeAgent(descriptor);
    // RDF
    const quads = await parseTurtle(await docs.agentDescription.toTurtle());
    expect(hasSubject(quads, INJECTED_SUBJECT)).toBe(false);
    // JSON-LD
    const jsonld = (await docs.agentDescription.toJsonLd()) as Record<string, unknown>;
    expect(JSON.stringify(jsonld)).not.toContain("evil/s2>");
    // A2A card
    expect(docs.agentCard.url.includes(">")).toBe(false);
    expect(docs.agentCard.url.includes(" ")).toBe(false);
  });
});

describe("safeHttpIri — REQUIRES an explicit `//` authority (new URL repairs authority-less forms)", () => {
  const base = { id: "https://alice.pod.example/agent", name: "Alice" } as const;
  // `new URL("https:example.com")` REPAIRS to a host — but it is not a lexical
  // absolute http(s) IRI, so every safeHttpIri-fed field must reject it. Includes
  // the EMPTY-authority triple-slash forms (`https:///foo`, `http:////foo`) that
  // `new URL` ALSO repairs to a synthesised host (`foo`) by consuming a path
  // segment — so `u.host === ""` alone would not catch them.
  const Authorityless = [
    "https:example.com",
    "https:/foo",
    "http:bar",
    "https:///foo",
    "http:////foo",
  ];

  it("REJECTS authority-less url as the descriptor url → fail-closed throw", () => {
    for (const url of Authorityless) {
      expect(() => describeAgent({ ...base, url })).toThrow(
        /resolvable http\(s\) `url` is required/,
      );
    }
  });

  it("DROPS authority-less owner / issuer / protocolSource from RDF + JSON-LD + card", async () => {
    for (const bad of Authorityless) {
      const docs = describeAgent({
        ...base,
        owner: bad,
        protocolSources: [bad, "https://alice.pod.example/p#v1"],
        securitySchemes: [{ type: "solid-oidc", issuer: bad }],
      });
      // RDF: no ad:owner, only the one valid protocolSource, no scheme url.
      const quads = await parseTurtle(await docs.agentDescription.toTurtle());
      expect(quads.some((q) => q.predicate.value === `${ANP_AD}owner`)).toBe(false);
      const protoObjs = quads
        .filter((q) => q.predicate.value === `${ANP_AD}protocolSource`)
        .map((q) => q.object.value);
      expect(protoObjs).toEqual(["https://alice.pod.example/p#v1"]);
      // JSON-LD
      const jsonld = (await docs.agentDescription.toJsonLd()) as Record<string, unknown>;
      expect(jsonld.owner).toBeUndefined();
      expect(jsonld.protocolSource).toEqual([{ "@id": "https://alice.pod.example/p#v1" }]);
      // A2A card
      expect(docs.agentCard["x-solid"]?.owner).toBeUndefined();
      expect(docs.agentCard["x-solid"]?.protocolSources).toEqual([
        "https://alice.pod.example/p#v1",
      ]);
      expect(docs.agentCard.securitySchemes?.["solid-oidc"]?.openIdConnectUrl).toBeUndefined();
    }
  });

  it("REJECTS an authority-less pointer target / webId → fail-closed throw", () => {
    for (const bad of Authorityless) {
      expect(() => buildAgentPointer("https://alice.pod.example/profile#me", bad)).toThrow(
        /agent must be an absolute http\(s\) IRI/,
      );
      expect(() => buildAgentPointer(bad, "https://alice.pod.example/agent")).toThrow(
        /webId must be an absolute http\(s\) IRI/,
      );
    }
  });

  it("a normal `//`-authority IRI still passes byte-identical", async () => {
    const lexical = "https://alice.pod.example/agent";
    const quads = await parseTurtle(
      await describeAgent({ ...base, url: lexical }).agentDescription.toTurtle(),
    );
    expect(quads.find((q) => q.predicate.value === `${ANP_AD}url`)?.object.value).toBe(lexical);
  });
});
