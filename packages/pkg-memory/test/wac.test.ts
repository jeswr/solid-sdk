// AUTHORED-BY Codex GPT-6
/** biome-ignore-all lint/style/noNonNullAssertion: fixtures guarantee nanopubs and enumerated targets. */
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { Store } from "n3";
import { expect, it, vi } from "vitest";
import {
  buildNanopublications,
  createFactAssertion,
  NanopubStore,
  type PodPort,
} from "../src/index.js";
import { NS, RdfNode } from "../src/rdf.js";
import { createMemoryPodPort, exampleBuildOptions } from "../src/testing.js";

const options = exampleBuildOptions();
const ROOT = "https://example.org/pod/";
const FIRST = `${ROOT}private/`;
const ACL = "http://www.w3.org/ns/auth/acl#";
const encode = (body: string) => new TextEncoder().encode(body);
const decode = (body: Uint8Array) => new TextDecoder().decode(body);
const policy = (target: string) =>
  `${ROOT}permissions/${target.slice(ROOT.length).replaceAll("/", "_")}`;

function fixture() {
  const memory = createMemoryPodPort({ root: ROOT, webId: options.owner });
  const pod: PodPort = {
    ...memory,
    async head(target) {
      return { acl: policy(target) };
    },
  };
  const write = vi.spyOn(pod, "write");
  return { pod, memory, write, store: new NanopubStore(pod) };
}
async function seedAncestors(memory: PodPort) {
  for (const target of [FIRST, `${ROOT}private/pkg/`])
    await memory.write(target, encode(""), "text/turtle", {});
}
function medicalFact(batch = "medical") {
  return buildNanopublications(
    {
      batch_id: batch,
      worker: { agent_id: "urn:example:client", agent_label: "Test" },
      claims: [
        {
          id: "one",
          epistemic: "SelfReportedExplicit",
          categories: ["pd:MedicalHealth"],
          assertion: createFactAssertion(options.owner, {
            template: "condition",
            value: { id: "https://example.org/condition", name: "Fictional condition" },
          }),
        },
      ],
    },
    options,
  );
}
async function aclBody(target: string, mutate?: (rule: RdfNode) => void) {
  const dataset = new Store();
  const rule = new RdfNode("urn:example:owner", dataset)
    .link(`${NS.rdf}type`, `${ACL}Authorization`)
    .link(`${ACL}agent`, options.owner)
    .link(`${ACL}accessTo`, target)
    .link(`${ACL}mode`, `${ACL}Control`);
  mutate?.(rule);
  return encode(await serialize([...dataset]));
}

it.each([
  "nanopub",
  "policy",
])("refuses %s writes when WAC discovery is unavailable", async (operation) => {
  for (const head of [
    undefined,
    async () => {
      throw new Error("PRIVATE backend diagnostic");
    },
    async () => ({}),
    ...[
      "https://outside.example/PRIVATE",
      "https://example.org/elsewhere/PRIVATE",
      ROOT,
      FIRST,
      `${ROOT}permissions/one?PRIVATE`,
      `${ROOT}permissions/one#PRIVATE`,
      `${ROOT}permissions%2f..%2foutside`,
      `${ROOT}permissions/one.acr`,
    ].map((acl) => async () => ({ acl })),
  ]) {
    const { pod, store, write } = fixture();
    pod.head = head;
    await expect(
      operation === "nanopub" ? store.put(await medicalFact()) : store.writeDefaultPolicy(),
    ).rejects.toThrow(/^Memory protection unavailable$/);
    expect(write).not.toHaveBeenCalled();
  }
});

it("uses advertised non-default ACLs for every container, mutex, policy and nanopub", async () => {
  const { pod, store, write } = fixture();
  await store.writeDefaultPolicy();
  const first = await medicalFact();
  await store.put(first);
  // Replacements must also use discovery, and retain conditional ETags.
  await new NanopubStore(pod).put(await medicalFact("second"));
  for (const target of [
    FIRST,
    `${ROOT}private/pkg/`,
    store.container,
    store.policyUrl,
    `${store.container}.write-lock`,
    store.url(first.nanopubs[0]!.id),
  ]) {
    const body = await pod.read(policy(target));
    const dataset = await parseRdf(decode(body.body), "text/turtle", { baseIRI: policy(target) });
    const rule = new RdfNode(`${policy(target)}#owner`, dataset);
    expect(rule.oneIri(`${ACL}accessTo`)).toBe(target);
    expect(rule.oneIri(`${ACL}agent`)).toBe(options.owner);
    expect(write.mock.calls.findIndex(([url]) => url === policy(target))).toBeLessThan(
      write.mock.calls.findIndex(([url]) => url === target),
    );
  }
  expect(write.mock.calls.some(([url]) => url.endsWith(".acl"))).toBe(false);
  expect(
    write.mock.calls.some(([url, , , cond]) => url === policy(store.container) && !!cond.ifMatch),
  ).toBe(true);
});

it("preserves a nanopub ACL with a separate unrelated owner authorization", async () => {
  const { pod, memory, store, write } = fixture();
  await store.writeDefaultPolicy();
  const value = await medicalFact();
  const target = store.url(value.nanopubs[0]!.id);
  const dataset = await parseRdf(decode(await aclBody(target)), "text/turtle");
  new RdfNode("urn:example:other-owner-rule", dataset)
    .link(`${NS.rdf}type`, `${ACL}Authorization`)
    .link(`${ACL}agent`, options.owner)
    .link(`${ACL}accessTo`, `${ROOT}PRIVATE-other`)
    .link(`${ACL}mode`, `${ACL}Control`);
  await memory.write(policy(target), encode(await serialize([...dataset])), "text/turtle", {});
  const before = await memory.read(policy(target));
  write.mockClear();
  await expect(store.put(value)).rejects.toThrow(/^Memory protection unavailable$/);
  expect(write.mock.calls.some(([url]) => url === policy(target) || url === target)).toBe(false);
  expect(await pod.read(policy(target))).toEqual(before);
});

it.each([
  "container",
  "mutex",
  "policy",
  "nanopub",
])("refuses missing WAC metadata on the %s before its write", async (kind) => {
  const { pod, store, write } = fixture();
  const value = await medicalFact();
  const target = {
    container: store.container,
    mutex: `${store.container}.write-lock`,
    policy: store.policyUrl,
    nanopub: store.url(value.nanopubs[0]!.id),
  }[kind]!;
  pod.head = async (url) => (url === target ? {} : { acl: policy(url) });
  await expect(kind === "policy" ? store.writeDefaultPolicy() : store.put(value)).rejects.toThrow(
    /^Memory protection unavailable$/,
  );
  expect(write.mock.calls.some(([url]) => url === target)).toBe(false);
  expect(write.mock.calls.some(([, , type]) => type === "application/trig")).toBe(false);
});

it.each([
  "accessTo",
  "default",
  "defaultForNew",
  "unscoped",
  "unknown",
  "literal",
  "ACP",
  "empty",
  "malformed",
  "media type",
  "missing type",
  "missing modes",
  "missing audience",
  "invalid mode",
  "literal type",
  "extra type",
])("refuses an existing %s ACL without any write", async (kind) => {
  const { store, memory, write } = fixture();
  await seedAncestors(memory);
  const target = store.container;
  let body = await aclBody(target, (rule) => {
    if (["accessTo", "default", "defaultForNew"].includes(kind))
      rule.link(ACL + kind, `${ROOT}PRIVATE-other/`);
    if (kind === "unscoped") rule.terms(`${ACL}accessTo`).clear();
    if (kind === "unknown") rule.link("urn:example:unknown", target);
    if (kind === "literal") rule.text(`${ACL}default`, target);
    if (kind === "ACP") rule.link("http://www.w3.org/ns/solid/acp#accessControl", target);
    if (kind === "missing type") rule.terms(`${NS.rdf}type`).clear();
    if (kind === "missing modes") rule.terms(`${ACL}mode`).clear();
    if (kind === "missing audience") rule.terms(`${ACL}agent`).clear();
    if (kind === "invalid mode") rule.link(`${ACL}mode`, "urn:example:Read");
    if (kind === "literal type") {
      rule.terms(`${NS.rdf}type`).clear();
      rule.text(`${NS.rdf}type`, `${ACL}Authorization`);
    }
    if (kind === "extra type") rule.link(`${NS.rdf}type`, "urn:example:Other");
  });
  if (kind === "empty") body = encode("");
  if (kind === "malformed") body = encode("PRIVATE invalid Turtle");
  await memory.write(
    policy(target),
    body,
    kind === "media type" ? "text/plain" : "text/turtle",
    {},
  );
  const before = await memory.read(policy(target));
  await expect(store.put(await medicalFact())).rejects.toThrow(/^Memory protection unavailable$/);
  expect(write).not.toHaveBeenCalled();
  expect(await memory.read(policy(target))).toEqual(before);
});

it.each([
  undefined,
  'W/"one"',
  "invalid",
  '"bad\r\nheader"',
  '"one"\n',
])("requires a strong ETag for an existing ACL: %s", async (etag) => {
  const { pod, memory, store, write } = fixture();
  await seedAncestors(memory);
  await memory.write(policy(store.container), await aclBody(store.container), "text/turtle", {});
  pod.read = async (url) => ({ ...(await memory.read(url)), etag });
  await expect(store.put(await medicalFact())).rejects.toThrow("strong ETag");
  expect(write).not.toHaveBeenCalled();
});
