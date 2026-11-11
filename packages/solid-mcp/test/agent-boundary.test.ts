// AUTHORED-BY Codex GPT-6.1-Sol
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  RequiredAs,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROTECTED_AGENT_CONTAINERS, SHARED_CONTEXT_PATH } from "../src/agent-layout.js";
import { CARD_REDACTION } from "../src/context-tools.js";
import { PodOutput } from "../src/output.js";
import { PERSONAL_DATA_DENIED, requireGenericPodAccess } from "../src/personal-data.js";
import { containerCandidates, readRdf, search } from "../src/pod.js";
import { createFetchPodPort, type PodPort } from "../src/pod-port.js";
import { createSolidMcpServer } from "../src/server.js";
import { type FakeResource, makeFakePod } from "./fake-pod.js";

const ROOT = "https://example.org/pod/";
const PROFILE = `${ROOT}profile/card#me`;
const INDEX = `${ROOT}index.ttl`;
const SAFE = `${ROOT}ordinary.txt`;
const SECRET = "protected-member-secret";
const PAN = "4111111111111111";
const CONTEXT = `${ROOT}${SHARED_CONTEXT_PATH}`;
const clients: Client[] = [];
const encoder = new TextEncoder();
const AREAS = [...PROTECTED_AGENT_CONTAINERS, "private/pkg/"];

class FixtureResource extends TermWrapper {
  iris(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
  set title(value: string) {
    RequiredAs.object(this, "http://purl.org/dc/terms/title", value, LiteralFrom.string);
  }
}

function rdf(build: (dataset: Store) => void): FakeResource {
  const dataset = new Store();
  build(dataset);
  return { contentType: "text/turtle", body: new Writer().quadsToString([...dataset]) };
}

function aliases(area: string): string[] {
  const bare = area.slice(0, -1);
  const encoded = bare.replace(/[a-z]/gu, (char) => `%${char.charCodeAt(0).toString(16)}`);
  const spellings = [
    bare,
    bare.toUpperCase(),
    bare.replace("/", "/./"),
    bare.replace("/", "/x/../"),
    bare.replace("/", "\\"),
    bare.replaceAll("/", ";param/"),
    encoded,
    encoded.replaceAll("%", "%25"),
    bare.replace("/", "%2f"),
    bare.replace("/", "%252f"),
    bare.replace("/", "%5c"),
    bare.replace("/", "%255c"),
    bare.replace("/", "/x/%2e%2e/"),
    bare.replace("/", "/x/%252e%252e/"),
    bare.replace("/", "//"),
  ];
  return [
    ...new Set(
      spellings.flatMap((path) =>
        [
          "",
          "/",
          ".acl",
          ".meta",
          "/.acl",
          "/.meta",
          "/record.ttl",
          ";param/record.ttl",
          "%3Fraw/record.ttl",
          "%253Fraw/record.ttl",
          "%23part/record.ttl",
          "%2523part/record.ttl",
          "%3Bparam/record.ttl",
          "%253Bparam/record.ttl",
          "/health/record.ttl",
        ].map((suffix) => `${ROOT}${path}${suffix}`),
      ),
    ),
  ];
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

function text(result: { content: unknown }): string {
  return (result.content as { text: string }[]).map((part) => part.text).join("\n");
}

async function fixture(adapter: string) {
  const protectedUrls = AREAS.flatMap(aliases);
  const listings = new Map<string, string[]>();
  const resources: Record<string, FakeResource> = {};
  for (const url of protectedUrls) {
    const canonical = new URL(url).href;
    resources[canonical] = { contentType: "text/plain", body: SECRET };
  }
  resources[CONTEXT] = {
    contentType: "text/markdown",
    body: `Owner context. Card ${PAN}.`,
    etag: '"context-v1"',
  };
  for (const container of [ROOT, `${ROOT}agent/`, `${ROOT}private/`]) {
    const safe = container === ROOT ? SAFE : `${container}notes.txt`;
    resources[safe] = { contentType: "text/plain", body: "ordinary allowed content" };
    const members = [safe, ...protectedUrls.map((url) => new URL(url).href)];
    listings.set(container, members);
    resources[container] = rdf((dataset) => {
      const listing = new FixtureResource(container, dataset, DataFactory);
      listing
        .iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")
        .add("http://www.w3.org/ns/ldp#Container");
      // Hostile ancestor listings include every alias and metadata about it.
      listing.title = SECRET;
      for (const member of members) {
        listing.iris("http://www.w3.org/ns/ldp#contains").add(member);
        new FixtureResource(member, dataset, DataFactory).title =
          member === safe ? "ordinary" : SECRET;
      }
    });
  }
  resources[PROFILE.split("#")[0] as string] = rdf((dataset) => {
    const profile = new FixtureResource(PROFILE, dataset, DataFactory);
    for (const index of [
      INDEX,
      ...PROTECTED_AGENT_CONTAINERS.map((path) => `${ROOT}${path}index.ttl`),
    ])
      profile.iris("http://www.w3.org/ns/solid/terms#publicTypeIndex").add(index);
  });
  resources[INDEX] = rdf((dataset) => {
    for (const [i, url] of protectedUrls.entries()) {
      const registration = new FixtureResource(`urn:registration:${i}`, dataset, DataFactory);
      registration.iris("http://www.w3.org/ns/solid/terms#instance").add(new URL(url).href);
      registration
        .iris("http://www.w3.org/ns/solid/terms#instanceContainer")
        .add(new URL(url).href);
    }
  });
  const fake = makeFakePod(resources);
  const fetch = vi.fn(fake.fetch);
  const portable: PodPort = {
    root: ROOT,
    webId: PROFILE,
    read: vi.fn(async (url) => {
      const doc = new URL(url);
      doc.hash = "";
      const resource = resources[doc.href];
      if (!resource) throw Object.assign(new Error(SECRET), { status: 404 });
      return {
        body: encoder.encode(resource.body),
        contentType: resource.contentType,
        etag: resource.etag,
      };
    }),
    list: vi.fn(async (url) =>
      (listings.get(url) ?? []).map((member) => ({
        url: member,
        name: member.endsWith("notes.txt") || member === SAFE ? "ordinary" : SECRET,
        isContainer: member.endsWith("/"),
      })),
    ),
    head: vi.fn(async () => ({})),
    write: vi.fn(async () => ({ etag: '"tampered"' })),
    delete: vi.fn(async () => {}),
  };
  const pod =
    adapter === "fetch"
      ? createFetchPodPort({ podRoot: ROOT, webId: PROFILE, fetch, readOnly: false })
      : portable;
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "agent-boundary", version: "1" });
  clients.push(client);
  await Promise.all([client.connect(a), createSolidMcpServer({ pod, readOnly: false }).connect(b)]);
  return { pod, portable, client, fetch, protectedUrls, resources };
}

describe.each(["portable", "fetch"])("owner-only agent boundary: %s", (adapter) => {
  it.each(AREAS)("refuses generic access to every spelling of %s before I/O", async (area) => {
    const f = await fixture(adapter);
    const output = new PodOutput(f.pod);
    for (const url of aliases(area)) {
      for (const name of [
        "pod_read",
        "solid_read",
        "fetch",
        "pod_list",
        "solid_list",
        "pod_write",
        "solid_write",
        "solid_search",
      ]) {
        const result = await f.client.callTool({
          name,
          arguments: {
            url,
            id: url,
            container: url,
            content: "tamper",
            contentType: "text/plain",
            query: SECRET,
            scope: url,
          },
        });
        expect(result.isError, `${name} ${url}`).toBe(true);
        // Encoded delimiters may be refused by the earlier pod-scope guard.
        expect(text(result), `${name} ${url}`).toMatch(
          /^(Personal data requires a purpose-limited tool|pod-scope violation)$/u,
        );
      }
      const error = await f.client
        .readResource({ uri: url })
        .catch((error: Error) => error.message);
      expect(typeof error).toBe("string");
      expect(error).not.toContain(url);
      expect(error).not.toContain(SECRET);
      await expect(output.head(url)).rejects.toThrow(PERSONAL_DATA_DENIED);
      await expect(output.delete(url)).rejects.toThrow(PERSONAL_DATA_DENIED);
      await expect(readRdf(f.pod, url)).rejects.toThrow();
    }
    expect(f.portable.read).not.toHaveBeenCalled();
    expect(f.portable.list).not.toHaveBeenCalled();
    expect(f.portable.head).not.toHaveBeenCalled();
    expect(f.portable.write).not.toHaveBeenCalled();
    expect(f.portable.delete).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("filters ancestor members, containment and metadata across all generic outputs", async () => {
    const f = await fixture(adapter);
    for (const container of [ROOT, `${ROOT}agent/`, `${ROOT}private/`]) {
      const safe = container === ROOT ? SAFE : `${container}notes.txt`;
      for (const name of ["pod_list", "solid_list", "pod_read", "solid_read", "fetch"]) {
        const result = await f.client.callTool({
          name,
          arguments: { container, url: container, id: container },
        });
        expect(result.isError, text(result)).not.toBe(true);
        expect(text(result)).toContain(safe);
        expect(text(result)).not.toContain(SECRET);
        for (const url of f.protectedUrls) expect(text(result)).not.toContain(url);
      }
      expect((await containerCandidates(f.pod, container)).map(({ url }) => url)).toEqual([safe]);
      const result = await f.client.readResource({ uri: container });
      expect(JSON.stringify(result)).toContain(safe);
      expect(JSON.stringify(result)).not.toContain(SECRET);
      for (const url of f.protectedUrls) expect(JSON.stringify(result)).not.toContain(url);
    }
    const enumerated = JSON.stringify(await f.client.listResources());
    expect(enumerated).not.toContain(SECRET);
    for (const url of f.protectedUrls) expect(enumerated).not.toContain(url);
    for (const query of [SECRET, "context", "memory", "accounts", "pkg"]) {
      expect(await search(f.pod, query)).toEqual([]);
      for (const name of ["search", "solid_search"]) {
        const result = await f.client.callTool({ name, arguments: { query } });
        expect(result.isError, text(result)).not.toBe(true);
        expect(JSON.parse(text(result))).toEqual(name === "search" ? { results: [] } : []);
      }
    }
    // Discovery may read only the profile and ordinary index, never protected hints.
    for (const [url] of vi.mocked(f.portable.read).mock.calls) {
      if (url === PROFILE) continue;
      expect(() => requireGenericPodAccess(f.pod, url)).not.toThrow();
    }
    for (const [input] of f.fetch.mock.calls) {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === PROFILE || url === PROFILE.split("#")[0]) continue;
      expect(() => requireGenericPodAccess(f.pod, url)).not.toThrow();
    }
  });

  it("keeps context_read as the sole shared-context reader with card redaction", async () => {
    const f = await fixture(adapter);
    const result = await f.client.callTool({ name: "context_read", arguments: {} });
    expect(result.isError, text(result)).not.toBe(true);
    expect(JSON.parse(text(result))).toMatchObject({
      status: "ok",
      url: CONTEXT,
      etag: '"context-v1"',
      text: `Owner context. Card ${CARD_REDACTION}.`,
      redactedCardNumbers: 1,
    });
    expect(text(result)).not.toContain(PAN);
    const denied = await f.client.callTool({ name: "pod_read", arguments: { url: CONTEXT } });
    expect(text(denied)).toBe(PERSONAL_DATA_DENIED);
  });

  it("refuses ancestor mutations while keeping ordinary sibling writes available", async () => {
    const f = await fixture(adapter);
    for (const url of [`${ROOT}agent/`, `${ROOT}agent`, `${ROOT}AGENT;param/`, `${ROOT}private/`]) {
      for (const name of ["pod_write", "solid_write"]) {
        const result = await f.client.callTool({
          name,
          arguments: { url, content: "tamper", contentType: "text/plain" },
        });
        expect(text(result)).toBe(PERSONAL_DATA_DENIED);
      }
      await expect(new PodOutput(f.pod).delete(url)).rejects.toThrow(PERSONAL_DATA_DENIED);
    }
    expect(f.portable.write).not.toHaveBeenCalled();
    expect(f.portable.delete).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
    const result = await f.client.callTool({
      name: "pod_write",
      arguments: { url: `${ROOT}agent/notes.txt`, content: "ordinary", contentType: "text/plain" },
    });
    expect(result.isError, text(result)).not.toBe(true);
  });

  it("refuses writes to ancestor ACL, ACR and metadata resources that govern protected areas", async () => {
    const f = await fixture(adapter);
    const governing = [
      `${ROOT}.acl`,
      `${ROOT}.acr`,
      `${ROOT}.meta`,
      `${ROOT}agent/.acl`,
      `${ROOT}agent/.acr`,
      `${ROOT}agent/.meta`,
      `${ROOT}agent.acl`,
      `${ROOT}AGENT/.ACL`,
      `${ROOT}agent;p/.acl`,
      `${ROOT}agent/%2eacl`,
      `${ROOT}agent/x/../.acl`,
      `${ROOT}private/.acl`,
      `${ROOT}private.meta`,
    ];
    for (const url of governing) {
      const result = await f.client.callTool({
        name: "pod_write",
        arguments: { url, content: "tamper", contentType: "text/turtle" },
      });
      expect(text(result), url).toBe(PERSONAL_DATA_DENIED);
      await expect(new PodOutput(f.pod).delete(url), url).rejects.toThrow(PERSONAL_DATA_DENIED);
    }
    expect(f.portable.write).not.toHaveBeenCalled();
    expect(f.portable.delete).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
    // Auxiliary resources of unrelated siblings are not refused by the agent boundary.
    for (const url of [
      `${ROOT}agent/notes.txt.acl`,
      `${ROOT}agent/notes/.acl`,
      `${ROOT}public/.acl`,
      `${ROOT}agent-other.meta`,
    ]) {
      expect(() => requireGenericPodAccess(f.pod, url, true), url).not.toThrow();
    }
  });
});

describe.each(PROTECTED_AGENT_CONTAINERS)("aliases into %s", (area) => {
  it.each([
    "redirect",
    "response-url",
    "rdf-identity",
  ])("refuses a fetch %s before a second request", async (kind) => {
    const target = `${ROOT}${area}`;
    const identity = rdf((dataset) => {
      const container = new FixtureResource(target, dataset, DataFactory);
      container
        .iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")
        .add("http://www.w3.org/ns/ldp#Container");
      container.iris("http://www.w3.org/ns/ldp#contains").add(`${target}record.ttl`);
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      if (kind === "redirect")
        return new Response(null, { status: 302, headers: { location: target } });
      const response = new Response(kind === "rdf-identity" ? identity.body : SECRET, {
        headers: { "content-type": kind === "rdf-identity" ? identity.contentType : "text/plain" },
      });
      if (kind === "response-url") Object.defineProperty(response, "url", { value: target });
      return response;
    });
    const pod = createFetchPodPort({ podRoot: ROOT, fetch });
    await expect(new PodOutput(pod).read(SAFE)).rejects.toThrow(PERSONAL_DATA_DENIED);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a portable final URL before reading the alias target", async () => {
    const target = `${ROOT}${area}record.ttl`;
    const f = await fixture("portable");
    f.pod.read = vi.fn(async () => ({
      body: encoder.encode(SECRET),
      contentType: "text/plain",
      url: target,
    }));
    await expect(new PodOutput(f.pod).read(SAFE)).rejects.toThrow(PERSONAL_DATA_DENIED);
    expect(f.pod.read).toHaveBeenCalledExactlyOnceWith(SAFE, undefined);
  });
});

it("applies every decoding stage and the profile-discovery exception conservatively", () => {
  const pod = { root: ROOT, webId: PROFILE } as PodPort;
  for (const area of PROTECTED_AGENT_CONTAINERS) {
    for (const url of [...aliases(area), `${ROOT}${area}%252e%252e/ordinary.txt`]) {
      for (const mutation of [false, true])
        for (const profileDiscovery of [false, true])
          expect(() =>
            requireGenericPodAccess({ ...pod, webId: url }, url, mutation, profileDiscovery),
          ).toThrow(PERSONAL_DATA_DENIED);
    }
  }
  for (const url of [ROOT, ROOT.slice(0, -1), `${ROOT}agent/`, `${ROOT}agent`, `${ROOT}AGENT;x/`]) {
    expect(() => requireGenericPodAccess(pod, url)).not.toThrow();
    expect(() => requireGenericPodAccess(pod, url, true)).toThrow(PERSONAL_DATA_DENIED);
  }
  for (const path of [
    "agent/notes.md",
    "agent/context-other/record",
    "agent/memory-other/record",
    "agent/accounts-other/record",
  ])
    for (const mutation of [false, true])
      expect(() => requireGenericPodAccess(pod, `${ROOT}${path}`, mutation)).not.toThrow();
  for (const root of ["https://example.org/", `${ROOT}subcontainer/`])
    for (const area of PROTECTED_AGENT_CONTAINERS)
      expect(() => requireGenericPodAccess({ ...pod, root }, new URL(area, root).href)).toThrow(
        PERSONAL_DATA_DENIED,
      );
});
