// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { LiteralFrom, NamedNodeAs, NamedNodeFrom, OptionalAs, SetFrom } from "@rdfjs/wrapper";
import { Authorization, Container, Resource } from "@solid/object";
import { DataFactory, Store, Writer } from "n3";
import { describe, expect, it, vi } from "vitest";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "../testing.js";
import { PodThing } from "../vocab.js";
import { createFetchSyncPodWriter } from "./fetch-writer.js";
import { createLinkStore } from "./link-store.js";

class OwnerRule extends Authorization {
  get agents(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${NS.ACL}agent`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}
class ListingMetadata extends Resource {
  set etag(value: string) {
    OptionalAs.object(this, `${NS.SOLID}etag`, value, LiteralFrom.string);
  }
}
async function listingWriter(page: boolean) {
  const url = `${TEST_POD_ROOT}integrations/sync-test/account/items/`;
  const dataset = new Store();
  const member = `${url}one.ttl`;
  const container = new Container(url, dataset, DataFactory);
  container.contains.add(new Resource(member, dataset, DataFactory));
  new ListingMetadata(member, dataset, DataFactory).etag = '"item-v1"';
  if (page) new PodThing(url, dataset, DataFactory).types.add(`${NS.LDP}Page`);
  const serializer = new Writer();
  for (const quad of dataset) serializer.addQuad(quad);
  const body = await new Promise<string>((resolve, reject) =>
    serializer.end((error, text) => (error ? reject(error) : resolve(text))),
  );
  const writer = createFetchSyncPodWriter({
    adapterId: "sync-test",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: async () => new Response(body, { headers: { "content-type": "text/turtle" } }),
  });
  return { writer, member };
}
function fixture(link?: (url: string) => string) {
  const pod = createMemoryPod();
  const calls: { url: string; method: string }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? "GET" });
    const response = await pod.fetch(input, init);
    if (init?.method === "HEAD" && link) response.headers.set("link", link(url));
    return response;
  };
  const writer = createFetchSyncPodWriter({
    adapterId: "sync-test",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: transport,
  });
  return { pod, writer, calls };
}

describe("fetch sync host security", () => {
  it("reads complete listings and their advertised resource ETags", async () => {
    const { writer, member } = await listingWriter(false);
    const entries = [];
    for await (const entry of writer.list("account/items/")) entries.push(entry);
    expect(entries).toEqual([{ url: member, etag: '"item-v1"' }]);
  });
  it("refuses RDF that identifies the listing as an LDP page", async () => {
    const { writer } = await listingWriter(true);
    await expect(writer.list("account/items/")[Symbol.asyncIterator]().next()).rejects.toThrow(
      "complete container listing",
    );
  });
  it.each([
    { status: 206, extra: {} },
    { status: 200, extra: { "content-range": "items 0-9/20" } },
    { status: 200, extra: { link: '<next.ttl>; rel="next"' } },
    { status: 200, extra: { link: '<next.ttl>; REL="prev next"' } },
    { status: 200, extra: { link: "<first.ttl>; rel=first" } },
  ])("refuses an incomplete listing ($status, $extra)", async ({ status, extra }) => {
    const writer = createFetchSyncPodWriter({
      adapterId: "sync-test",
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch: async () =>
        new Response("", { status, headers: { "content-type": "text/turtle", ...extra } }),
    });
    const scan = async () => {
      for await (const _entry of writer.list("account/items/")) {
        throw new Error("Incomplete listing yielded an item.");
      }
    };
    await expect(scan()).rejects.toThrow("complete container listing");
  });
  it("installs exact owner-only WAC grants before reading shard bodies", async () => {
    const f = fixture((url) => `<${url}.acl>; rel="acl"`);
    await createLinkStore(f.writer, "account").load();
    expect(f.calls[0]?.method).toBe("HEAD");
    expect(f.calls[1]?.method).toBe("PUT");
    expect(f.calls[2]?.method).toBe("GET");
    const aclUrl = f.calls[1]?.url;
    expect(aclUrl).toBeDefined();
    const dataset = f.pod.dataset(aclUrl as string);
    const rule = new OwnerRule(`${aclUrl}#owner`, dataset, DataFactory);
    expect([...rule.agents]).toEqual([TEST_WEBID]);
    expect(rule.canRead).toBe(true);
    expect(rule.canWrite).toBe(true);
    expect(rule.canReadWriteAcl).toBe(true);
    expect(
      [...dataset].some(
        (q) =>
          q.predicate.value === `${NS.ACL}agentClass` || q.predicate.value === `${NS.ACL}default`,
      ),
    ).toBe(false);
  });
  it.each([
    undefined,
    () => '<https://evil.test/document.acl>; rel="acl"',
    () => '<elsewhere.acl>; rel="acl"',
    () => '<other.ttl>; rel="acl"',
    (url: string) => `<${url}.acl>; rel="acl", <${url}.acl>; rel="acl"`,
    (url: string) => `<${url}.acl#fragment>; rel="acl"`,
  ])("refuses unsupported or malicious ACL discovery without writing", async (link) => {
    const f = fixture(link);
    await expect(f.writer.ensureOwnerOnly("account/links/00.ttl")).rejects.toThrow();
    expect(f.calls).toHaveLength(1);
    expect(f.pod.putCount).toBe(0);
  });
  it("does not read or write after abort", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const transport = vi.fn<typeof fetch>();
    const writer = createFetchSyncPodWriter({
      adapterId: "sync-test",
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch: transport,
      signal: controller.signal,
    });
    await expect(writer.ensureOwnerOnly("account/links/00.ttl")).rejects.toThrow("cancelled");
    expect(transport).not.toHaveBeenCalled();
  });
  it("blocks the ACL PUT when cancellation arrives during discovery HEAD", async () => {
    const controller = new AbortController();
    const transport = vi.fn<typeof fetch>(async (input) => {
      controller.abort(new Error("cancelled after HEAD"));
      return new Response(null, {
        status: 404,
        headers: { link: `<${String(input)}.acl>; rel="acl"` },
      });
    });
    const writer = createFetchSyncPodWriter({
      adapterId: "sync-test",
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch: transport,
      signal: controller.signal,
    });
    await expect(writer.ensureOwnerOnly("account/links/00.ttl")).rejects.toThrow(
      "cancelled after HEAD",
    );
    expect(transport).toHaveBeenCalledOnce();
  });
});
