// AUTHORED-BY Codex GPT-6
import { NanopubStore } from "@jeswr/pkg-memory";
import { describe, expect, it, vi } from "vitest";
import { PodOutput } from "../src/output.js";
import { PERSONAL_DATA_DENIED } from "../src/personal-data.js";
import { createFetchPodPort } from "../src/pod-port.js";
import { createPodToolRegistry } from "../src/tools.js";
import { poisonedContainerTurtle } from "./fake-pod.js";
import { createWacMemoryPodPort } from "./wac-memory-pod.js";

const ROOT = "https://example.org/pod/";
const PROFILE = `${ROOT}profile/card`;
const OWNER = `${PROFILE}#me`;
const CLIENT = "urn:example:client";
const INDEX = `${ROOT}index.ttl`;
const HIDDEN = `${ROOT}documents/registered.ttl`;
const EMAIL = "profile-only-secret@example.org";
const PHONE = "+1234567";
const PURPOSE = "ServiceProvision";
const encoder = new TextEncoder();

function text(result: { content: unknown }): string {
  return (result.content as { text: string }[]).map((part) => part.text).join("\n");
}
function json(result: { content: unknown; isError?: unknown }) {
  expect(result.isError, text(result)).not.toBe(true);
  return JSON.parse(text(result));
}

async function fixture(adapter: string) {
  const memory = createWacMemoryPodPort({ root: ROOT, webId: OWNER });
  const store = new NanopubStore(memory);
  await store.writeDefaultPolicy();
  async function put(url: string, body: string) {
    await memory.write(url, encoder.encode(body), "text/turtle", {});
  }
  await put(
    PROFILE,
    `<${OWNER}> <http://www.w3.org/2006/vcard/ns#fn> "Avery";
      <http://www.w3.org/2006/vcard/ns#hasEmail> <mailto:${EMAIL}>;
      <http://www.w3.org/2006/vcard/ns#hasTelephone> <tel:${PHONE}>;
      <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${INDEX}>;
      <http://www.w3.org/ns/pim/space#storage> <${ROOT}>.`,
  );
  await put(ROOT, poisonedContainerTurtle(ROOT, [PROFILE, `${ROOT}ordinary.ttl`]));
  await put(`${ROOT}ordinary.ttl`, '<> <urn:text> "ordinary".');
  await put(
    INDEX,
    `<#profile> <http://www.w3.org/ns/solid/terms#instance> <${PROFILE}>.
     <#document> <http://www.w3.org/ns/solid/terms#instance> <${HIDDEN}>.`,
  );
  await put(HIDDEN, '<> <urn:text> "type-index-needle".');
  const profile = await memory.read(PROFILE);
  const originalRead = memory.read;
  memory.read = vi.fn(async (url, options) => {
    const doc = new URL(url);
    doc.hash = "";
    return originalRead(doc.href, options);
  });
  // The registered document is deliberately absent from crawl listings.
  memory.list = vi.fn(async () => [
    { url: PROFILE, isContainer: false, name: EMAIL },
    { url: `${ROOT}ordinary.ttl`, isContainer: false, name: "ordinary" },
  ]);
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const request = new Request(input, init);
    if (request.method !== "GET") throw new Error("Unexpected generic mutation");
    try {
      const read = await memory.read(request.url);
      return new Response(new Uint8Array(read.body), {
        headers: { "content-type": read.contentType },
      });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 404)
        return new Response(null, { status: 404 });
      throw error;
    }
  });
  const pod =
    adapter === "fetch"
      ? createFetchPodPort({ fetch, podRoot: ROOT, webId: OWNER, readOnly: false })
      : memory;
  const registry = createPodToolRegistry(pod, false, { clientId: CLIENT });
  const call = (name: string, args: unknown) => {
    const tool = registry.find((entry) => entry.name === name || entry.aliases.includes(name));
    if (!tool) throw new Error(`Missing tool ${name}`);
    return tool.handler(args);
  };
  async function permit(client: string) {
    await put(
      store.policyUrl,
      `@prefix odrl: <http://www.w3.org/ns/odrl/2/>.
       <> a odrl:Set; odrl:permission [odrl:action odrl:read;
         odrl:target <https://w3id.org/dpv/pd#Contact>; odrl:assignee <${client}>;
         odrl:constraint [odrl:leftOperand odrl:purpose; odrl:operator odrl:eq;
           odrl:rightOperand <https://w3id.org/dpv#${PURPOSE}>]].`,
    );
  }
  await permit("urn:example:another-client");
  vi.mocked(memory.read).mockClear();
  return { pod, memory, call, permit, profile, originalRead, fetch };
}

describe.each(["portable", "fetch"])("in-pod profile boundary: %s", (adapter) => {
  it("denies generic reads, listings and writes with a fixed diagnostic before I/O", async () => {
    const f = await fixture(adapter);
    expect(text(await f.call("profile_get", { purpose: PURPOSE }))).toBe("purpose denied: Contact");
    vi.mocked(f.memory.read).mockClear();
    const write = vi.spyOn(f.pod, "write");
    const remove = vi.spyOn(f.pod, "delete");
    for (const url of [
      PROFILE,
      OWNER,
      `${PROFILE}?raw=1`,
      PROFILE.replace("profile/card", "PROFILE/Card"),
      PROFILE.replace("profile/card", "%2570rofile/%2563ard"),
      `${PROFILE}.acl`,
    ]) {
      for (const name of [
        "pod_read",
        "solid_read",
        "fetch",
        "pod_list",
        "solid_list",
        "pod_write",
        "solid_write",
      ]) {
        const result = await f.call(name, {
          url,
          id: url,
          container: url,
          content: "tamper",
          contentType: "text/turtle",
        });
        expect(result.isError, name).toBe(true);
        expect(text(result)).toBe(PERSONAL_DATA_DENIED);
      }
      await expect(new PodOutput(f.pod).delete(url)).rejects.toThrow(PERSONAL_DATA_DENIED);
    }
    const scoped = await f.call("solid_search", { query: EMAIL, scope: PROFILE });
    expect(text(scoped)).toBe(PERSONAL_DATA_DENIED);
    expect(f.memory.read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(await f.originalRead(PROFILE)).toEqual(f.profile);
  });

  it("omits the profile from generic listings, projections and search while retaining Type Index discovery", async () => {
    const f = await fixture(adapter);
    for (const name of ["pod_list", "solid_list", "pod_read", "solid_read", "fetch"]) {
      const result = await f.call(name, { url: ROOT, id: ROOT, container: ROOT });
      expect(result.isError, text(result)).not.toBe(true);
      expect(text(result)).toContain("ordinary");
      expect(text(result)).not.toContain(PROFILE);
      expect(text(result)).not.toContain(EMAIL);
    }
    for (const query of [EMAIL, PHONE, "card"]) {
      expect(json(await f.call("search", { query }))).toEqual({ results: [] });
      expect(json(await f.call("solid_search", { query }))).toEqual([]);
    }
    const matches = json(await f.call("search", { query: "type-index-needle" })).results;
    expect(matches.map((match: { url: string }) => match.url)).toContain(HIDDEN);
    expect(matches.map((match: { url: string }) => match.url)).not.toContain(PROFILE);
    expect(vi.mocked(f.memory.read).mock.calls.some(([url]) => url === OWNER)).toBe(true);
  });

  it("retains profile_get with a Contact permit while generic reads stay denied", async () => {
    const f = await fixture(adapter);
    await f.permit(CLIENT);
    expect(json(await f.call("profile_get", { purpose: PURPOSE }))).toEqual({
      name: "Avery",
      emails: [EMAIL],
      phones: [PHONE],
    });
    expect(text(await f.call("pod_read", { url: PROFILE }))).toBe(PERSONAL_DATA_DENIED);
  });
});

it("leaves generic in-pod profile documents accessible when the configured WebID is off-pod", async () => {
  const { memory } = await fixture("portable");
  memory.webId = "https://identity.example/avery#me";
  expect((await new PodOutput(memory).read(PROFILE)).body.byteLength).toBeGreaterThan(0);
});
