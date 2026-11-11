// AUTHORED-BY Codex GPT-6
import { createMemoryPodPort } from "@jeswr/pkg-memory/testing";
import { DataFactory as df, Parser, Store } from "n3";
import { expect, it, vi } from "vitest";
import { auditSpecialRead } from "../src/audit.js";
import { serializeBoundedTurtle } from "../src/bounded-rdf.js";
import { MemoryNode } from "../src/memory-context.js";
import { PERSONAL_DATA_DENIED, personalDataRoot } from "../src/personal-data.js";
import { createFetchPodPort, type PodConditions } from "../src/pod-port.js";
import { createPodToolRegistry } from "../src/tools.js";
import { containerTurtle } from "./fake-pod.js";

const ROOT = "https://example.org/pod/";
const OWNER = `${ROOT}profile/card#me`;
const ACL = "http://www.w3.org/ns/auth/acl#";
const FIRST = `${ROOT}private/`;
const LOG = () => `${ROOT}private/pkg/audit/${new Date().toISOString().slice(0, 7)}.ttl`;
const targets = () => [
  `${ROOT}private/`,
  `${ROOT}private/pkg/`,
  `${ROOT}private/pkg/audit/`,
  LOG(),
];
const policy = (target: string) =>
  `${ROOT}private/pkg/permissions/${target.slice(ROOT.length).replaceAll("/", "_")}`;

/** A WAC server seam that advertises its real ACL even before a resource exists. */
function fixture(link: (target: string) => string = (target) => `<${policy(target)}>; rel="acl"`) {
  const memory = createMemoryPodPort({ root: ROOT, webId: OWNER });
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const request = new Request(input, init);
    const target = request.url;
    try {
      if (request.method === "PUT") {
        const cond: PodConditions = {};
        const ifMatch = request.headers.get("if-match");
        if (ifMatch) cond.ifMatch = ifMatch;
        if (request.headers.get("if-none-match") === "*") cond.ifNoneMatch = "*";
        const receipt = await memory.write(
          target,
          new Uint8Array(await request.arrayBuffer()),
          request.headers.get("content-type") ?? "text/turtle",
          cond,
        );
        return new Response(null, { status: 201, headers: { etag: receipt.etag ?? "" } });
      }
      const read = await memory.read(target);
      const body = target.endsWith("/")
        ? containerTurtle(
            target,
            (await memory.list(target)).map(({ url, isContainer }) => ({
              name: url.slice(target.length),
              container: isContainer,
            })),
          )
        : new Uint8Array(read.body);
      return new Response(request.method === "HEAD" ? null : body, {
        headers: { link: link(target), "content-type": read.contentType, etag: read.etag ?? "" },
      });
    } catch (error) {
      if (!(error instanceof Error) || !("status" in error)) throw error;
      return new Response(null, { status: Number(error.status), headers: { link: link(target) } });
    }
  });
  const pod = createFetchPodPort({ fetch, podRoot: ROOT, webId: OWNER, readOnly: false });
  const audit = () =>
    auditSpecialRead(pod, false, "urn:client", "Personalisation", [
      "https://w3id.org/dpv/pd#MedicalHealth",
    ]);
  const writes = () =>
    fetch.mock.calls.filter(([, init]) => init?.method === "PUT").map(([url]) => String(url));
  return { pod, memory, fetch, audit, writes };
}

const medical = {
  text: "Fictional medical fact",
  fact: {
    template: "condition",
    value: { id: "https://example.org/condition", name: "Fictional condition" },
  },
  quote: "I have a fictional condition",
};
function remember(pod: Parameters<typeof createPodToolRegistry>[0]) {
  const tool = createPodToolRegistry(pod, false, { clientId: "urn:client" }).find(
    (entry) => entry.name === "memory_remember",
  );
  if (!tool) throw new Error("Missing memory_remember");
  return tool.handler(medical);
}
async function sharedAcl(
  memory: ReturnType<typeof createMemoryPodPort>,
  target: string,
  kind: string,
) {
  const dataset = new Store();
  const node = new MemoryNode("urn:example:owner", dataset, df);
  for (const [predicate, value] of [
    ["http://www.w3.org/1999/02/22-rdf-syntax-ns#type", `${ACL}Authorization`],
    [`${ACL}agent`, OWNER],
    [`${ACL}accessTo`, target],
    [`${ACL}mode`, `${ACL}Control`],
  ])
    node.terms(predicate).add(df.namedNode(value));
  if (kind === "unscoped") node.terms(`${ACL}accessTo`).clear();
  else if (kind === "ACP")
    node.terms("http://www.w3.org/ns/solid/acp#accessControl").add(df.namedNode(target));
  else if (kind !== "dedicated") node.terms(ACL + kind).add(df.namedNode(`${ROOT}PRIVATE-other/`));
  await memory.write(
    policy(target),
    new TextEncoder().encode(serializeBoundedTurtle(dataset)),
    "text/turtle",
    {},
  );
}

it("remembers medical facts using non-default WAC URLs through the projected port", async () => {
  const { pod, writes } = fixture();
  expect((await remember(pod)).isError).not.toBe(true);
  const urls = writes();
  for (const target of urls.filter((url) => !url.startsWith(`${ROOT}private/pkg/permissions/`))) {
    expect(urls).toContain(policy(target));
    expect(urls.indexOf(policy(target))).toBeLessThan(urls.indexOf(target));
  }
  expect(urls.some((url) => url.endsWith(".trig"))).toBe(true);
  expect(urls.some((url) => url.endsWith(".acl"))).toBe(false);
});

it("refuses memory and audit ACLs advertised outside the protected personal area", async () => {
  for (const operation of ["memory", "audit"]) {
    const { pod, audit, writes, fetch } = fixture(
      (target) => `<${ROOT}permissions/${target.slice(ROOT.length)}>; rel="acl"`,
    );
    if (operation === "audit")
      await expect(audit()).rejects.toThrow(/^Audit protection unavailable$/);
    else {
      const result = await remember(pod);
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("Memory protection unavailable");
      expect(JSON.stringify(result)).not.toContain("permissions/");
    }
    expect(writes()).toEqual([]);
    expect(fetch.mock.calls.some(([url]) => String(url).startsWith(`${ROOT}permissions/`))).toBe(
      false,
    );
  }
});

it("denies generic pod_write on the advertised memory and audit ACLs", async () => {
  const { pod, memory, audit, writes } = fixture();
  expect((await remember(pod)).isError).not.toBe(true);
  await audit();
  const registry = createPodToolRegistry(pod, false, { clientId: "urn:client" });
  const recall = registry.find((entry) => entry.name === "memory_recall");
  if (!recall) throw new Error("Missing memory_recall");
  const denied = await recall.handler({ purpose: "ServiceProvision" });
  expect(denied.isError).toBe(true);
  expect(JSON.stringify(denied)).toContain("purpose denied: MedicalHealth");
  const aclUrls = writes().filter((url) => url.startsWith(`${personalDataRoot(pod)}permissions/`));
  expect(aclUrls.some((url) => url.endsWith(".trig"))).toBe(true);
  const tool = registry.find((entry) => entry.name === "pod_write");
  if (!tool) throw new Error("Missing pod_write");
  for (const url of aclUrls) {
    const before = await memory.read(url);
    const count = writes().length;
    const result = await tool.handler({
      url,
      content: `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
        <#public> a acl:Authorization; acl:agentClass <http://xmlns.com/foaf/0.1/Agent>;
          acl:mode acl:Read; acl:accessTo <${ROOT}private/pkg/mcp/>.`,
      contentType: "text/turtle",
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain(PERSONAL_DATA_DENIED);
    expect(writes()).toHaveLength(count);
    expect(await memory.read(url)).toEqual(before);
  }
});

it.each([
  "",
  '<a>; rel="http://www.w3.org/ns/solid/acp#accessControl"',
  '<https://outside.example/PRIVATE>; rel="acl"',
  '<https://example.org/outside/PRIVATE>; rel="acl"',
  `<${ROOT}permissions/PRIVATE>; rel="acl"`,
  '<a>; rel="acl", <b>; rel="acl"',
])("refuses medical memory writes with unusable advertised access control: %s", async (link) => {
  const { pod, writes, fetch } = fixture(() => link);
  const result = await remember(pod);
  expect(result.isError).toBe(true);
  expect(writes()).toEqual([]);
  expect(fetch.mock.calls.every(([target]) => String(target).startsWith(ROOT))).toBe(true);
});

it("refuses memory writes through a custom port without HEAD metadata", async () => {
  const pod = createMemoryPodPort({ root: ROOT, webId: OWNER });
  const write = vi.spyOn(pod, "write");
  expect((await remember(pod)).isError).toBe(true);
  expect(write).not.toHaveBeenCalled();
});

it.each([
  "accessTo",
  "default",
  "defaultForNew",
  "unscoped",
  "ACP",
])("refuses a shared or unproven %s ACL without any write", async (kind) => {
  for (const operation of ["audit", "memory"]) {
    const { memory, audit, writes, pod } = fixture();
    const target = operation === "audit" ? FIRST : `${ROOT}private/pkg/mcp/`;
    if (operation === "memory")
      for (const ancestor of [FIRST, `${ROOT}private/pkg/`])
        await memory.write(ancestor, new Uint8Array(), "text/turtle", {});
    await sharedAcl(memory, target, kind);
    const before = await memory.read(policy(target));
    if (operation === "audit")
      await expect(audit()).rejects.toThrow(/^Audit protection unavailable$/);
    else expect((await remember(pod)).isError).toBe(true);
    expect(writes()).toEqual([]);
    expect(await memory.read(policy(target))).toEqual(before);
  }
});

it.each([
  "accessTo",
  "default",
  "defaultForNew",
])("preserves shared %s grants on the monthly ACL", async (kind) => {
  const { memory, audit, writes } = fixture();
  await audit();
  await sharedAcl(memory, LOG(), kind);
  const before = await memory.read(policy(LOG()));
  const log = await memory.read(LOG());
  const count = writes().filter((url) => url === policy(LOG())).length;
  await expect(audit()).rejects.toThrow(/^Audit protection unavailable$/);
  expect(writes().filter((url) => url === policy(LOG()))).toHaveLength(count);
  expect(await memory.read(policy(LOG()))).toEqual(before);
  expect(await memory.read(LOG())).toEqual(log);
});

it("conditionally replaces dedicated audit ACLs and creates missing ACLs only once", async () => {
  const { memory, pod, audit, fetch } = fixture();
  await sharedAcl(memory, FIRST, "dedicated");
  const previous = await memory.read(policy(FIRST));
  await audit();
  const first = fetch.mock.calls.find(
    ([url, init]) => String(url) === policy(FIRST) && init?.method === "PUT",
  );
  expect(new Headers(first?.[1]?.headers).get("if-match")).toBe(previous.etag);
  const created = fetch.mock.calls.find(
    ([url, init]) => String(url) === policy(LOG()) && init?.method === "PUT",
  );
  expect(new Headers(created?.[1]?.headers).get("if-none-match")).toBe("*");
  expect((await pod.read(LOG())).body.length).toBeGreaterThan(0);
});

it.each([
  undefined,
  'W/"acl"',
  "invalid",
  '"bad\r\nheader"',
])("requires a strong read ETag on an existing audit ACL: %s", async (etag) => {
  const { memory, pod, audit, writes } = fixture();
  await sharedAcl(memory, FIRST, "dedicated");
  const read = pod.read;
  pod.read = async (target, options) => ({
    ...(await read(target, options)),
    ...(target === policy(FIRST) ? { etag } : {}),
  });
  await expect(audit()).rejects.toThrow("Strong ETag");
  expect(writes()).toEqual([]);
});

it("rechecks ACL scope after a conditional conflict and preserves the concurrent owner's grants", async () => {
  const { memory, pod, audit, writes } = fixture();
  await sharedAcl(memory, FIRST, "dedicated");
  const write = pod.write;
  let raced = false;
  pod.write = async (target, ...rest) => {
    if (target === policy(FIRST) && !raced) {
      raced = true;
      await sharedAcl(memory, FIRST, "accessTo");
    }
    return write(target, ...rest);
  };
  await expect(audit()).rejects.toThrow(/^Audit protection unavailable$/);
  expect(writes()).toEqual([policy(FIRST)]);
  const dataset = new Store(
    new Parser().parse(new TextDecoder().decode((await memory.read(policy(FIRST))).body)),
  );
  expect(
    dataset.getObjects(null, df.namedNode(`${ACL}accessTo`), null).map((term) => term.value),
  ).toContain(`${ROOT}PRIVATE-other/`);
});

it("protects new and existing audit targets at server-advertised non-default ACL URLs", async () => {
  const { pod, audit, writes } = fixture();
  await audit();
  await audit();
  for (const target of targets()) {
    expect(writes()).toContain(policy(target));
    expect(writes()).not.toContain(`${target}.acl`);
    const dataset = new Store(
      new Parser().parse(new TextDecoder().decode((await pod.read(policy(target))).body)),
    );
    expect(
      dataset.getObjects(null, df.namedNode(`${ACL}agent`), null).map((term) => term.value),
    ).toEqual([OWNER]);
    expect(
      dataset.getObjects(null, df.namedNode(`${ACL}accessTo`), null).map((term) => term.value),
    ).toEqual([target]);
    expect(dataset.getObjects(null, df.namedNode(`${ACL}agentClass`), null)).toEqual([]);
    expect(writes().indexOf(policy(target))).toBeLessThan(writes().indexOf(target));
  }
  const entries = new Store(
    new Parser().parse(new TextDecoder().decode((await pod.read(LOG())).body)),
  );
  expect(
    entries.getSubjects(null, df.namedNode("http://www.w3.org/ns/prov#Activity"), null),
  ).toHaveLength(2);
});

it.each([
  "",
  '<policy>; rel="http://www.w3.org/ns/solid/acp#accessControl"',
  '<https://outside.example/PRIVATE>; rel="acl"',
  '<https://example.org/elsewhere/PRIVATE>; rel="acl"',
  `<${ROOT}permissions/PRIVATE>; rel="acl"`,
  '<https://example.org/pod/>; rel="acl"',
  '<policy?PRIVATE>; rel="acl"',
  '<policy#PRIVATE>; rel="acl"',
  '<a>; rel="acl", <b>; rel="acl"',
])("refuses an audit when any target advertises unusable access control: %s", async (invalid) => {
  for (const rejected of targets()) {
    const { audit, writes, fetch } = fixture((target) =>
      target === rejected ? invalid : `<${policy(target)}>; rel="acl"`,
    );
    await expect(audit()).rejects.toThrow(/^Audit protection unavailable$/);
    expect(writes()).not.toContain(LOG());
    expect(writes().some((target) => target.endsWith(".acl"))).toBe(false);
    expect(fetch.mock.calls.every(([target]) => String(target).startsWith(ROOT))).toBe(true);
  }
});

it("refuses an ACL link back to its protected target", async () => {
  const { audit, writes } = fixture((target) => `<${target}>; rel="acl"`);
  await expect(audit()).rejects.toThrow(/^Audit protection unavailable$/);
  expect(writes()).toEqual([]);
});

it("refuses custom ports that do not expose WAC discovery", async () => {
  const pod = createMemoryPodPort({ root: ROOT, webId: OWNER });
  const write = vi.spyOn(pod, "write");
  await expect(
    auditSpecialRead(pod, false, "urn:client", "Personalisation", [
      "https://w3id.org/dpv/pd#MedicalHealth",
    ]),
  ).rejects.toThrow(/^Audit protection unavailable$/);
  expect(write).not.toHaveBeenCalled();
});
