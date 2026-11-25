// AUTHORED-BY Codex (GPT-6.1 Sol)
import { checkOwnerOnly, type EffectivePolicy, readWac, writeWac } from "@jeswr/pod-access";
import { readGrants } from "@jeswr/pod-access/roles";
import type { TypeIndex } from "@jeswr/pod-type-index";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { expect, it, vi } from "vitest";
import { protectJournal } from "../src/privacy.js";
import { createJournalStore } from "../src/store.js";

const root = "https://pod.example/";
const container = `${root}journal/`;
const acl = `${container}.acl`;
const owner = `${root}profile#me`;
const other = "https://other.example/profile#me";
function policyFor(partial: boolean): EffectivePolicy {
  return {
    grants: [owner, other].map((webId) => ({
      modes: new Set(
        webId === owner ? (["read", "write", "control"] as const) : (["read"] as const),
      ),
      who: [[{ kind: "agent" as const, webId }]],
      except: [],
      appliesTo: partial && webId === other ? ("resource" as const) : ("both" as const),
      source: { url: acl, node: `#${webId === owner ? "owner" : "other"}` },
    })),
    denials: [],
  };
}
// One authorisation naming both principals: sealing removes the other agent cleanly.
const sharedSingleRule = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#shared> a acl:Authorization; acl:agent <${owner}>, <${other}>; acl:accessTo <${container}>;
  acl:default <${container}>; acl:mode acl:Read, acl:Write, acl:Control.`;
async function fixture(partial = false, divergeDuringSeal = false, singleRule = false) {
  let body = singleRule ? sharedSingleRule : await writeWac(policyFor(partial), container, acl);
  let divergentBody = divergeDuringSeal ? await writeWac(policyFor(true), container, acl) : null;
  const initial = body;
  let version = 1;
  const writes: Headers[] = [];
  const fetch = vi.fn(
    async (input: Parameters<typeof globalThis.fetch>[0], init: RequestInit = {}) => {
      const url = String(input);
      if (init.method === "HEAD" && url === container)
        return new Response(null, {
          headers: { link: `<${acl}>; rel="acl"`, "wac-allow": 'user="read write control"' },
        });
      if (url !== acl) throw new Error(`Unexpected ${init.method ?? "GET"} ${url}`);
      if (init.method === "PUT") {
        const headers = new Headers(init.headers);
        expect(headers.get("if-match")).toBe(`"${version}"`);
        writes.push(headers);
        body = String(init.body);
        version++;
        return new Response(null, { status: 204, headers: { etag: `"${version}"` } });
      }
      const response = new Response(init.method === "HEAD" ? null : body, {
        headers: { "content-type": "text/turtle", etag: `"${version}"` },
      });
      if (init.method !== "HEAD" && divergentBody !== null) {
        // Simulate a server changing the policy between reads while reusing its validator.
        body = divergentBody;
        divergentBody = null;
      }
      return response;
    },
  ) as typeof globalThis.fetch;
  const backend = createSolidBackend({ root, fetch });
  // The demo backend has no discovery document; state the access model the fake server speaks.
  const storage = {
    ...backend,
    features: {
      ...backend.features,
      accessControl: {
        state: "available" as const,
        evidence: "fixture",
        detail: { model: "wac" as const },
      },
    },
  };
  const store = createJournalStore(storage, {} as TypeIndex, owner, fetch);
  return { store, storage, fetch, writes, body: () => body, initial };
}
it("makes an existing shared own ACL private using the real conditional ownOnly path", async () => {
  const { store, storage, fetch, writes } = await fixture(false, false, true);
  const options = { fetch, root, kind: "folder" as const, webId: owner };
  const onlyOwner = (grants: Awaited<ReturnType<typeof readGrants>>["grants"]) =>
    grants.length > 0 &&
    grants.every((g) => g.agent.type === "webid" && g.agent.id === owner && g.role === "manager");
  expect(onlyOwner((await readGrants(container, options)).grants)).toBe(false);
  // The shared verifier sees the same pod as shared before sealing, and never writes.
  expect(await checkOwnerOnly({ storage, url: container, ownerWebId: owner })).toMatchObject({
    private: false,
  });
  await expect(protectJournal(storage, container, owner, fetch)).rejects.toMatchObject({
    canMakePrivate: true,
  });
  expect(writes).toHaveLength(0);
  await store.makePrivate(); // Ends with the shared verifier's independent verdict.
  expect(writes).toHaveLength(1);
  expect(writes[0]?.get("if-match")).toBe('"1"');
  expect(onlyOwner((await readGrants(container, options)).grants)).toBe(true);
  const read = await storage.readRdf(acl);
  const policy = readWac(read.dataset, container, acl, "css", true);
  expect(policy.grants.every((grant) => grant.appliesTo === "both")).toBe(true);
  expect(await checkOwnerOnly({ storage, url: container, ownerWebId: owner })).toEqual({
    private: true,
  });
  await protectJournal(storage, container, owner, fetch);
  expect(writes).toHaveLength(1);
});
it("seals separate owner and other-agent authorisations to a document the shared verifier accepts", async () => {
  // The two-rule shape pod-access share writes: sealing detaches the other agent's rule, and
  // must also drop what it leaves behind so the strict verifier accepts the result.
  const { store, storage, writes } = await fixture();
  expect(await checkOwnerOnly({ storage, url: container, ownerWebId: owner })).toMatchObject({
    private: false,
  });
  await store.makePrivate();
  expect(writes).toHaveLength(1);
  expect(await checkOwnerOnly({ storage, url: container, ownerWebId: owner })).toEqual({
    private: true,
  });
  const read = await storage.readRdf(acl);
  const policy = readWac(read.dataset, container, acl, "css", true);
  expect(policy.grants.length).toBeGreaterThan(0);
  for (const grant of policy.grants) expect(grant.who).toEqual([[{ kind: "agent", webId: owner }]]);
});
it("explains partial folder/member scopes and leaves the ACL unchanged", async () => {
  const { store, writes, body, initial } = await fixture(true);
  await expect(store.makePrivate()).rejects.toMatchObject({
    message: expect.stringContaining("Review both in Drive"),
    cause: { code: "partial-scope" },
    canMakePrivate: false,
  });
  expect(writes).toEqual([]);
  expect(body()).toBe(initial);
});

it("refuses mismatched scopes found by the sealing preflight even if the ETag was reused", async () => {
  const { store, writes, body } = await fixture(false, true);
  await expect(store.makePrivate()).rejects.toMatchObject({
    message: expect.stringContaining("Review both in Drive"),
    cause: { code: "partial-scope" },
    canMakePrivate: false,
  });
  expect(writes).toEqual([]);
  expect(body()).toBe(await writeWac(policyFor(true), container, acl));
});
