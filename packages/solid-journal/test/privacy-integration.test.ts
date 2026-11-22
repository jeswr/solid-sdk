// AUTHORED-BY Codex (GPT-6.1 Sol)
import { type EffectivePolicy, readWac, writeWac } from "@jeswr/pod-access";
import { readGrants } from "@jeswr/pod-access/roles";
import type { TypeIndex } from "@jeswr/pod-type-index";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { expect, it, vi } from "vitest";
import { isOwnerOnly, isOwnerOnlyPolicy, protectJournal } from "../src/privacy.js";
import { createJournalStore } from "../src/store.js";

const root = "https://pod.example/";
const container = `${root}journal/`;
const acl = `${container}.acl`;
const owner = `${root}profile#me`;
const other = "https://other.example/profile#me";
async function fixture(partial = false) {
  const policy: EffectivePolicy = {
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
  let body = await writeWac(policy, container, acl);
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
      return new Response(init.method === "HEAD" ? null : body, {
        headers: { "content-type": "text/turtle", etag: `"${version}"` },
      });
    },
  ) as typeof globalThis.fetch;
  const storage = createSolidBackend({ root, fetch });
  const store = createJournalStore(storage, {} as TypeIndex, owner, fetch);
  return { store, storage, fetch, writes, body: () => body, initial };
}
it("makes an existing shared own ACL private using the real conditional ownOnly path", async () => {
  const { store, storage, fetch, writes } = await fixture();
  const options = { fetch, root, kind: "folder" as const, webId: owner, model: "wac" as const };
  expect(isOwnerOnly((await readGrants(container, options)).grants, owner)).toBe(false);
  await store.makePrivate(); // Includes the real post-seal readGrants and full-policy verification.
  expect(writes).toHaveLength(1);
  expect(writes[0]?.get("if-match")).toBe('"1"');
  const grants = (await readGrants(container, options)).grants;
  expect(isOwnerOnly(grants, owner)).toBe(true);
  expect(grants.every((grant) => grant.agent.type === "webid" && grant.agent.id === owner)).toBe(
    true,
  );
  const read = await storage.readRdf(acl);
  const policy = readWac(read.dataset, container, acl, "css", true);
  expect(isOwnerOnlyPolicy(policy, owner)).toBe(true);
  expect(policy.grants.every((grant) => grant.appliesTo === "both")).toBe(true);
  await protectJournal(storage, container, owner, fetch);
  expect(writes).toHaveLength(1);
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
