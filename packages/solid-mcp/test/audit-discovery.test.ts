// AUTHORED-BY Codex GPT-6
import { createMemoryPodPort } from "@jeswr/pkg-memory/testing";
import { DataFactory as df, Parser, Store } from "n3";
import { expect, it, vi } from "vitest";
import { auditSpecialRead } from "../src/audit.js";
import { createFetchPodPort, type PodConditions } from "../src/pod-port.js";

const ROOT = "https://example.org/pod/";
const OWNER = `${ROOT}profile/card#me`;
const ACL = "http://www.w3.org/ns/auth/acl#";
const LOG = () => `${ROOT}private/pkg/audit/${new Date().toISOString().slice(0, 7)}.ttl`;
const targets = () => [
  `${ROOT}private/`,
  `${ROOT}private/pkg/`,
  `${ROOT}private/pkg/audit/`,
  LOG(),
];
const policy = (target: string) =>
  `${ROOT}permissions/${target.slice(ROOT.length).replaceAll("/", "_")}`;

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
      return new Response(request.method === "HEAD" ? null : new Uint8Array(read.body), {
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
