// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** biome-ignore-all lint/style/noNonNullAssertion: fixtures guarantee these entries. */
import { readFile } from "node:fs/promises";
import { parseRdf } from "@jeswr/fetch-rdf";
import { policyToTurtle } from "@jeswr/solid-odrl";
import { Store } from "n3";
import { isomorphic } from "rdf-isomorphic";
import { expect, it, vi } from "vitest";
import {
  buildNanopublications,
  classifyNanopublications,
  createFactAssertion,
  type Fact,
  NanopubStore,
  type PodPort,
  parseNanopublications,
  pkgId,
  purposeFilter,
  serializeNanopublications,
} from "../src/index.js";
import { podStatus } from "../src/pod-port.js";
import { graph, NS, RdfNode } from "../src/rdf.js";
import { createMemoryPodPort, exampleBuildOptions } from "../src/testing.js";

const options = exampleBuildOptions();
const identity = { root: "https://example.org/pod/", webId: options.owner };
const encode = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder().decode(value);
const statusError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const build = (batch = "store", fact: Fact = { template: "email", value: "avery@example.org" }) =>
  buildNanopublications(
    {
      batch_id: batch,
      worker: { agent_id: "https://example.org/client", agent_label: "Test" },
      claims: [
        {
          id: "one",
          epistemic: "SelfReportedExplicit",
          categories: ["pd:EmailAddress"],
          assertion: createFactAssertion(identity.webId, fact),
        },
      ],
    },
    options,
  );
function setup(overrides: Partial<PodPort> = {}) {
  const memory = createMemoryPodPort(identity);
  const pod = { ...memory, ...overrides };
  const write = vi.spyOn(pod, "write");
  return { memory, pod, write, store: new NanopubStore(pod) };
}

it("writes owner-only ACLs before containers/data, splits nanopubs, and reloads every graph", async () => {
  const { store, pod, write } = setup();
  const source = await parseNanopublications(
    await readFile(new URL("./fixtures/synthetic.expected.trig", import.meta.url), "utf8"),
  );
  const urls = await store.put(source);
  expect(urls).toHaveLength(5);
  for (let index = 0; index < 6; index += 2) {
    const aclCall = write.mock.calls[index]!;
    const containerCall = write.mock.calls[index + 1]!;
    expect(aclCall[0]).toBe(`${containerCall[0]}.acl`);
    const dataset = await parseRdf(decode(aclCall[1]), "text/turtle");
    const acl = "http://www.w3.org/ns/auth/acl#";
    const auth = new RdfNode(`${aclCall[0]}#owner`, dataset);
    expect([...auth.terms(`${acl}agent`)].map((term) => term.value)).toEqual([identity.webId]);
    expect([...auth.terms(`${acl}accessTo`)].map((term) => term.value)).toEqual([containerCall[0]]);
    expect([...auth.terms(`${acl}default`)].map((term) => term.value)).toEqual([containerCall[0]]);
    expect([...auth.terms(`${acl}mode`)].map((term) => term.value).sort()).toEqual(
      ["Control", "Read", "Write"].map((mode) => acl + mode),
    );
    expect(auth.terms(`${acl}agentClass`).size).toBe(0);
  }
  for (const np of source.nanopubs) {
    const aclUrl = `${store.url(np.id)}.acl`;
    const resourceAcl = await parseRdf(decode((await pod.read(aclUrl)).body), "text/turtle");
    const authorization = new RdfNode(`${aclUrl}#owner`, resourceAcl);
    const acl = "http://www.w3.org/ns/auth/acl#";
    expect(resourceAcl.size).toBe(6);
    expect(authorization.oneIri(`${acl}agent`)).toBe(identity.webId);
    expect(authorization.oneIri(`${acl}accessTo`)).toBe(store.url(np.id));
    expect(authorization.terms(`${acl}default`).size).toBe(0);
    expect(write.mock.calls.findIndex((call) => call[0] === aclUrl)).toBeLessThan(
      write.mock.calls.findIndex((call) => call[0] === store.url(np.id)),
    );
    const resource = await pod.read(store.url(np.id));
    expect(resource.contentType).toBe("application/trig");
    expect((await parseNanopublications(decode(resource.body))).nanopubs).toEqual([np]);
    expect(resource.etag).toBeDefined();
    expect(write.mock.calls.find((call) => call[0] === store.url(np.id))![3]).toEqual({
      ifNoneMatch: "*",
    });
  }
  const loaded = await store.list();
  expect(isomorphic([...loaded.dataset], [...source.dataset])).toBe(true);
  expect(new Set(loaded.nanopubs.map((np) => np.id))).toEqual(
    new Set(source.nanopubs.map((np) => np.id)),
  );
  await expect(store.put(source)).rejects.toMatchObject({ status: 412 });
});

it("replaces an orphan public resource ACL conditionally before writing private bytes", async () => {
  const { store, memory, write } = setup();
  const value = await build();
  const url = store.url(value.nanopubs[0]!.id);
  const aclUrl = `${url}.acl`;
  const publicAcl = `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
    <#public> a acl:Authorization; acl:agentClass <http://xmlns.com/foaf/0.1/Agent>;
      acl:accessTo <${url}>; acl:mode acl:Read .`;
  const before = await memory.write(aclUrl, encode(publicAcl), "text/turtle", {});
  write.mockImplementation(async (target, body, type, cond) => {
    if (target === url) {
      const dataset = await parseRdf(decode((await memory.read(aclUrl)).body), "text/turtle");
      expect(dataset.size).toBe(6);
      const authorization = new RdfNode(`${aclUrl}#owner`, dataset);
      expect(authorization.oneIri("http://www.w3.org/ns/auth/acl#agent")).toBe(identity.webId);
      expect(authorization.oneIri("http://www.w3.org/ns/auth/acl#accessTo")).toBe(url);
    }
    return memory.write(target, body, type, cond);
  });
  await store.put(value);
  expect(write.mock.calls.find((call) => call[0] === aclUrl)![3]).toEqual({
    ifMatch: before.etag,
  });
});

it.each([
  "read failure",
  "write failure",
  "create race",
  "replace race",
  "missing ETag",
  "weak ETag",
])("writes no private bytes after a destination ACL %s", async (failure) => {
  const { store, pod, memory, write } = setup();
  const value = await build();
  const url = store.url(value.nanopubs[0]!.id);
  const aclUrl = `${url}.acl`;
  const exists = ["replace race", "missing ETag", "weak ETag"].includes(failure);
  if (exists) await memory.write(aclUrl, encode("existing ACL"), "text/turtle", {});
  pod.read = async (target) => {
    if (target === aclUrl && failure === "read failure") throw statusError(403);
    const result = await memory.read(target);
    return target === aclUrl && failure.endsWith("ETag")
      ? { ...result, etag: failure === "weak ETag" ? 'W/"one"' : undefined }
      : result;
  };
  write.mockImplementation(async (target, body, type, cond) => {
    if (target === aclUrl) {
      if (failure === "write failure") throw statusError(403);
      if (failure.endsWith("race"))
        await memory.write(target, encode("concurrent ACL"), "text/turtle", {});
    }
    return memory.write(target, body, type, cond);
  });
  if (failure.endsWith("ETag")) await expect(store.put(value)).rejects.toThrow("strong ETag");
  else
    await expect(store.put(value)).rejects.toMatchObject({
      status: failure.endsWith("race") ? 412 : 403,
    });
  expect(write.mock.calls.some((call) => call[0] === url)).toBe(false);
  await expect(memory.read(url)).rejects.toMatchObject({ status: 404 });
  if (failure.endsWith("race"))
    expect(decode((await memory.read(aclUrl)).body)).toBe("concurrent ACL");
});

it("keeps writes private on ACL failure and retries initialization on a later call", async () => {
  const { store, write } = setup();
  const value = await build();
  write.mockRejectedValueOnce(statusError(403));
  await expect(store.put(value)).rejects.toMatchObject({ status: 403 });
  expect(write.mock.calls).toHaveLength(1);
  expect(write.mock.calls[0]![0]).toBe(`${identity.root}private/.acl`);
  await expect(store.put(value)).resolves.toHaveLength(1);
});

it("conditionally replaces only the store's ACL and retains existing containers", async () => {
  const { store, pod, write } = setup();
  await store.put(await build());
  write.mockClear();
  await new NanopubStore(pod).put(await build("second"));
  expect(write.mock.calls.filter((call) => call[0].endsWith(".acl"))).toHaveLength(2);
  expect(write.mock.calls[0]![0]).toBe(`${store.container}.acl`);
  expect(write.mock.calls[0]![3].ifMatch).toBeDefined();
  expect(write.mock.calls[1]![3]).toEqual({ ifNoneMatch: "*" });
  expect(write.mock.calls.some((call) => call[0].endsWith("/"))).toBe(false);
});

it.each([
  true,
  false,
])("preserves shared ancestor ACL bytes and ETags with existing containers: %s", async (containersExist) => {
  const { store, pod, memory, write } = setup();
  const ancestors = ["private/", "private/pkg/"].map((path) => identity.root + path);
  const before = [];
  for (const url of ancestors) {
    // An unrelated authorization, including inherited public access, belongs to the owner.
    const aclBody = `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
      <#other-app> a acl:Authorization; acl:agent <https://example.org/other-client>;
        acl:accessTo <${url}>; acl:default <${url}>; acl:mode acl:Read .`;
    await memory.write(`${url}.acl`, encode(aclBody), "text/turtle", {});
    if (containersExist) await memory.write(url, encode(""), "text/turtle", {});
    before.push(await pod.read(`${url}.acl`));
  }
  write.mockClear();
  const value = await build();
  await store.put(value);
  for (const [i, url] of ancestors.entries()) {
    expect(await pod.read(`${url}.acl`)).toEqual(before[i]);
    expect(write.mock.calls.some((call) => call[0] === `${url}.acl`)).toBe(false);
  }
  expect(
    write.mock.calls.filter((call) => call[0].endsWith(".acl")).map((call) => call[0]),
  ).toEqual([`${store.container}.acl`, `${store.url(value.nanopubs[0]!.id)}.acl`]);
  const aclCall = write.mock.calls.findIndex((call) => call[0] === `${store.container}.acl`);
  const dataCall = write.mock.calls.findIndex((call) => call[0].endsWith(".trig"));
  expect(aclCall).toBeLessThan(dataCall);
});

it("leaves existing shared ancestors without local ACLs untouched", async () => {
  const { store, memory, write } = setup();
  for (const path of ["private/", "private/pkg/"])
    await memory.write(identity.root + path, encode(""), "text/turtle", {});
  const value = await build();
  await store.put(value);
  expect(
    write.mock.calls.filter((call) => call[0].endsWith(".acl")).map((call) => call[0]),
  ).toEqual([`${store.container}.acl`, `${store.url(value.nanopubs[0]!.id)}.acl`]);
});

it("uses only octet-stream, preserving exact TriG bytes after a 415 rejection", async () => {
  const { store, memory, write } = setup();
  write.mockImplementation(async (url, body, type, cond) => {
    if (type === "application/trig")
      throw new Error("failed to write: HTTP 415 Unsupported Media Type");
    return memory.write(url, body, type, cond);
  });
  const value = await build();
  await store.put(value);
  const writes = write.mock.calls.filter((call) => call[0].endsWith(".trig"));
  expect(writes.map((call) => call[2])).toEqual(["application/trig", "application/octet-stream"]);
  expect(writes[0]![1]).toEqual(writes[1]![1]);
  expect((await store.get(value.nanopubs[0]!.id)).nanopubs).toEqual(value.nanopubs);
});

it.each([
  "bytes",
  "type",
])("falls back with the read-back ETag when the server rewrites %s", async (mode) => {
  const { store, memory, write } = setup();
  write.mockImplementation((url, body, type, cond) =>
    memory.write(
      url,
      type === "application/trig" && mode === "bytes" ? encode("flattened RDF") : body,
      type === "application/trig" && mode === "type" ? "text/turtle" : type,
      cond,
    ),
  );
  const value = await build();
  await store.put(value);
  const calls = write.mock.calls.filter((call) => call[0].endsWith(".trig"));
  expect(calls[1]![3].ifMatch).toBeDefined();
  expect(calls[1]![1]).toEqual(calls[0]![1]);
  expect((await store.get(value.nanopubs[0]!.id)).nanopubs).toEqual(value.nanopubs);
});

it.each([401, 403, 412, 500])("does not treat HTTP %i as TriG rejection", async (status) => {
  const { store, memory, write } = setup();
  write.mockImplementation((url, body, type, cond) => {
    if (type === "application/trig") return Promise.reject(statusError(status));
    return memory.write(url, body, type, cond);
  });
  await expect(store.put(await build())).rejects.toMatchObject({ status });
  expect(write.mock.calls.some((call) => call[2] === "application/octet-stream")).toBe(false);
});

it.each(["missing", "weak"])("refuses a rewritten representation with a %s ETag", async (kind) => {
  const { store, pod, memory } = setup();
  pod.read = async (url) => {
    const result = await memory.read(url);
    return url.endsWith(".trig")
      ? { ...result, body: encode("rewritten"), etag: kind === "weak" ? 'W/"one"' : undefined }
      : result;
  };
  await expect(store.put(await build())).rejects.toThrow("strong ETag");
});

it.each(["bytes", "type"])("fails if octet-stream fallback does not preserve %s", async (kind) => {
  const { store, memory, write } = setup();
  write.mockImplementation((url, body, type, cond) => {
    if (type === "application/trig") return Promise.reject(statusError(415));
    return memory.write(
      url,
      type === "application/octet-stream" && kind === "bytes" ? new Uint8Array() : body,
      type === "application/octet-stream" && kind === "type" ? "text/plain" : type,
      cond,
    );
  });
  await expect(store.put(await build())).rejects.toThrow("did not preserve");
});

it("propagates a fallback write failure without another representation", async () => {
  const { store, memory, write } = setup();
  write.mockImplementation((url, body, type, cond) => {
    if (type === "application/trig") return Promise.reject(statusError(415));
    if (type === "application/octet-stream") return Promise.reject(statusError(403));
    return memory.write(url, body, type, cond);
  });
  await expect(store.put(await build())).rejects.toMatchObject({ status: 403 });
});

it("never follows poisoned or nested listing URLs and deduplicates entries", async () => {
  const { store, pod } = setup();
  const value = await build();
  await store.put(value);
  const valid = { url: store.url(value.nanopubs[0]!.id), isContainer: false };
  pod.list = async () => [
    valid,
    valid,
    { url: `${store.container}nested/`, isContainer: true },
    { url: "https://evil.example/one.trig", isContainer: false },
    { url: `${store.container}unknown.trig`, isContainer: false },
    { url: valid.url.slice(0, -5), isContainer: false },
    { url: `${valid.url}/nested.trig`, isContainer: false },
    { url: `${valid.url}?query`, isContainer: false },
  ];
  expect((await store.list()).nanopubs).toHaveLength(1);
});

it("returns an empty view for an empty container", async () => {
  const { store } = setup();
  expect((await store.list()).dataset.size).toBe(0);
});

it.each([
  { root: "not a URL" },
  { root: "file:///pod/" },
  { root: "https://example.org/pod" },
  { root: "https://example.org/pod/?x=/" },
  { root: "https://example.org/pod/#x" },
  { root: "https://user@example.org/pod/" },
  { root: "https://:pass@example.org/pod/" },
  { root: "https://example.org/pod/unsafe>" },
  { webId: "" },
  { webId: "https://example.org/unsafe>" },
])("rejects an unsafe storage identity %j", (overrides) => {
  expect(() => setup({ ...identity, ...overrides })).toThrow();
});

it("validates UUID inputs, RDF and stored identity before using data", async () => {
  const { store, memory, write } = setup();
  for (const id of ["../secret", "https://evil.example/a", "urn:uuid:not-a-uuid"])
    await expect(store.get(id)).rejects.toThrow("UUID");
  await expect(store.put({ dataset: new Store(), nanopubs: [] })).rejects.toThrow(
    "No nanopublications",
  );
  expect(write).not.toHaveBeenCalled();
  const value = await build();
  const id = value.nanopubs[0]!.id;
  expect(() => store.url(`${id}\n`)).toThrow("UUID");
  const url = store.url(id);
  await memory.write(url, encode(await serializeNanopublications(value)), "text/plain", {});
  await expect(store.get(id)).rejects.toThrow("media type");
  await memory.write(
    url,
    encode(await serializeNanopublications(await build("other"))),
    "application/trig",
    {},
  );
  await expect(store.get(id)).rejects.toThrow("identity mismatch");
  const multiple = await buildNanopublications(
    {
      batch_id: "multiple",
      worker: { agent_id: "https://example.org/client", agent_label: "Test" },
      claims: [
        {
          id: "one",
          assertion: createFactAssertion(identity.webId, {
            template: "email",
            value: "one@example.org",
          }),
          epistemic: "Mentioned",
        },
        {
          id: "two",
          assertion: createFactAssertion(identity.webId, {
            template: "email",
            value: "two@example.org",
          }),
          epistemic: "Mentioned",
        },
      ],
    },
    options,
  );
  await memory.write(
    url,
    encode(await serializeNanopublications(multiple)),
    "application/trig",
    {},
  );
  await expect(store.get(id)).rejects.toThrow("identity mismatch");
  await memory.write(url, new Uint8Array([255]), "application/trig", {});
  await expect(store.get(id)).rejects.toThrow();
});

it.each([
  { template: "email", value: "avery@example.org" },
  { template: "preference", value: { propertyID: "drink", value: "tea" } },
  {
    template: "medication",
    value: {
      id: "https://example.org/intake",
      medication: { id: "https://example.org/medicine", name: "Example medicine" },
      dose: { value: "1", unit: "tablet", frequency: "daily" },
    },
  },
] satisfies Fact[])("retracts $template without changing its assertion identity or original bytes", async (fact) => {
  const { store, pod } = setup();
  const value = await build("store", fact);
  await store.put(value);
  const previous = value.nanopubs[0]!;
  const before = await pod.read(store.url(previous.id));
  const now = "2026-10-26T12:00:00Z";
  const revision = await store.retract(previous.id, {
    batchId: "retraction",
    clientId: "https://example.org/client",
    generatedAt: now,
  });
  const np = revision.nanopubs[0]!;
  expect(np.id).not.toBe(previous.id);
  expect(np.assertionId).toBe(previous.assertionId);
  const originalAssertion = graph(value.dataset, previous.assertionId);
  const withdrawnAssertion = graph(revision.dataset, np.assertionId);
  expect([...withdrawnAssertion].every((q) => originalAssertion.has(q))).toBe(true);
  expect(withdrawnAssertion.size).toBe(originalAssertion.size);
  expect(isomorphic([...revision.dataset], [...(await store.get(np.id)).dataset])).toBe(true);
  expect(new Set([...revision.dataset].map((q) => q.graph.value))).toEqual(
    new Set([
      np.id,
      previous.assertionId,
      np.provenanceId,
      np.pubinfoId,
      pkgId("batch", "retraction", "sources"),
    ]),
  );
  expect(np.supersedes).toEqual([previous.assertionId]);
  expect(np.validity).toBe("Retracted");
  expect(np.attributedTo).toEqual([identity.webId]);
  expect(np.agent).toBe("https://example.org/client");
  expect(
    new RdfNode(np.assertionId, graph(revision.dataset, np.provenanceId)).oneDateTime(
      `${NS.prov}invalidatedAtTime`,
    ),
  ).toBe("2026-10-26T12:00:00+00:00");
  expect(await pod.read(store.url(previous.id))).toEqual(before);
  const classified = classifyNanopublications(await store.list());
  expect(classified.map((item) => item.belief)).toEqual(["past", "past"]);
  expect(classified.map((item) => item.corroboration)).toEqual([2, 2]);
  expect(classified.find((item) => item.id === previous.id)!.replacedBy).toEqual([np.id]);
  const simultaneous = await store.retract(previous.id, {
    batchId: "same-clock",
    clientId: np.agent,
    generatedAt: previous.generatedAt,
  });
  expect(simultaneous.nanopubs[0]!.validity).toBe("Retracted");
  await expect(
    store.retract(previous.id, {
      batchId: "too-early",
      clientId: np.agent,
      generatedAt: "2025-01-01T00:00:00Z",
    }),
  ).rejects.toThrow("predates");
  const clock = vi.useFakeTimers().setSystemTime(new Date("2026-10-27T12:00:00Z"));
  try {
    await store.retract(previous.id, { batchId: "default-clock", clientId: np.agent });
  } finally {
    clock.useRealTimers();
  }
});

it("writes a default policy once behind the ACL, preserving owner edits", async () => {
  const { store, pod, memory, write } = setup();
  const policy = await store.writeDefaultPolicy();
  expect(write.mock.calls.at(-1)![0]).toBe(store.policyUrl);
  const aclCall = write.mock.calls.at(-2)!;
  expect(aclCall[0]).toBe(`${store.policyUrl}.acl`);
  const policyAcl = await parseRdf(decode(aclCall[1]), "text/turtle");
  const authorization = new RdfNode(`${store.policyUrl}.acl#owner`, policyAcl);
  expect(authorization.oneIri("http://www.w3.org/ns/auth/acl#agent")).toBe(identity.webId);
  expect(authorization.oneIri("http://www.w3.org/ns/auth/acl#accessTo")).toBe(store.policyUrl);
  expect(authorization.terms("http://www.w3.org/ns/auth/acl#default").size).toBe(0);
  expect(
    purposeFilter(
      policy,
      "ServiceProvision",
      "https://example.org/client",
    )({ categories: ["pd:MedicalHealth"] }),
  ).toBe(false);
  const edited = { ...policy, permissions: [] };
  await memory.write(store.policyUrl, encode(await policyToTurtle(edited)), "text/turtle", {});
  write.mockClear();
  const read = await new NanopubStore(pod).writeDefaultPolicy();
  expect(
    purposeFilter(
      read,
      "ServiceProvision",
      "https://example.org/client",
    )({ categories: ["pd:Contact"] }),
  ).toBe(false);
  expect(write).not.toHaveBeenCalled();
});

it("does not write a policy if its dedicated ACL fails", async () => {
  const { store, memory, write } = setup();
  write.mockImplementation((url, body, type, cond) =>
    url === `${store.policyUrl}.acl`
      ? Promise.reject(statusError(403))
      : memory.write(url, body, type, cond),
  );
  await expect(store.writeDefaultPolicy()).rejects.toMatchObject({ status: 403 });
  expect(write.mock.calls.some((call) => call[0] === store.policyUrl)).toBe(false);
});

it("rejects a retraction earlier by one microsecond", async () => {
  const { store } = setup();
  const original = await buildNanopublications(
    {
      batch_id: "microseconds",
      worker: { agent_id: "https://example.org/client", agent_label: "Test" },
      claims: [
        {
          id: "one",
          epistemic: "SelfReportedExplicit",
          assertion: createFactAssertion(identity.webId, {
            template: "email",
            value: "avery@example.org",
          }),
        },
      ],
    },
    { ...options, generatedAt: "2026-10-25T12:00:00.000501Z" },
  );
  await store.put(original);
  await expect(
    store.retract(original.nanopubs[0]!.id, {
      batchId: "microseconds-retract",
      clientId: "https://example.org/client",
      generatedAt: "2026-10-25T12:00:00.000500Z",
    }),
  ).rejects.toThrow("predates");
});

it("preserves a concurrent first-run policy writer", async () => {
  const { store, memory, write } = setup();
  write.mockImplementation(async (url, body, type, cond) => {
    if (url === store.policyUrl) {
      await memory.write(
        url,
        encode(await policyToTurtle({ id: url, permissions: [] })),
        type,
        cond,
      );
      throw statusError(412);
    }
    return memory.write(url, body, type, cond);
  });
  expect(
    purposeFilter(
      await store.writeDefaultPolicy(),
      "ServiceProvision",
      "https://example.org/client",
    )({ categories: ["pd:Contact"] }),
  ).toBe(false);
});

it("fails on unreadable, invalid or failed policy documents", async () => {
  const { store, pod, memory, write } = setup();
  pod.read = async () => {
    throw statusError(403);
  };
  await expect(store.writeDefaultPolicy()).rejects.toMatchObject({ status: 403 });
  expect(write).not.toHaveBeenCalled();
  pod.read = memory.read;
  await memory.write(store.policyUrl, encode(""), "text/turtle", {});
  await expect(store.writeDefaultPolicy()).rejects.toThrow("No memory policy");
  await memory.delete(store.policyUrl);
  write.mockImplementation((url, body, type, cond) =>
    url === store.policyUrl
      ? Promise.reject(statusError(500))
      : memory.write(url, body, type, cond),
  );
  await expect(store.writeDefaultPolicy()).rejects.toMatchObject({ status: 500 });
});

it("the memory PodPort enforces conditions and copies bytes", async () => {
  const pod = createMemoryPodPort(identity);
  const url = `${identity.root}data`;
  const body = encode("original");
  const result = await pod.write(url, body, "text/plain", { ifNoneMatch: "*" });
  body[0] = 0;
  const read = await pod.read(url);
  expect(decode(read.body)).toBe("original");
  read.body[0] = 0;
  expect(decode((await pod.read(url)).body)).toBe("original");
  await expect(pod.write(url, body, "text/plain", { ifNoneMatch: "*" })).rejects.toMatchObject({
    status: 412,
  });
  await expect(pod.delete(url, { ifMatch: '"wrong"' })).rejects.toMatchObject({ status: 412 });
  await pod.write(url, encode("updated"), "text/plain", { ifMatch: result.etag });
  await pod.write(`${identity.root}nested/`, body, "text/turtle", {});
  await pod.write(`${identity.root}nested/deep/data`, body, "text/plain", {});
  expect(await pod.list(identity.root)).toEqual([
    { url, isContainer: false },
    { url: `${identity.root}nested/`, isContainer: true },
  ]);
  await pod.delete(url);
  await expect(pod.delete(url)).rejects.toMatchObject({ status: 404 });
});

it("recognizes PodPort status errors without interpreting arbitrary messages", () => {
  expect(podStatus(statusError(404))).toBe(404);
  expect(podStatus(new Error("failed to read: HTTP 404 Not Found"))).toBe(404);
  for (const value of [
    null,
    undefined,
    "404",
    404,
    {},
    { status: "404" },
    new Error("network failure"),
  ])
    expect(podStatus(value)).not.toBe(404);
});
