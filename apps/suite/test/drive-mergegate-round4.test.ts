// AUTHORED-BY Codex
import { expect, it } from "vitest";
import { accessControl, accessLabel, requireAccess } from "../src/apps/drive/lib/client/access";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { aclBody, OWNER, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

it.each([
  ["foreign origin", "https://alice.test/", `${PUBLIC}placeholder`, false],
  ["sibling storage", `${ROOT}alice/`, `${PUBLIC}placeholder`, false],
  ["inherited foreign root", "https://alice.test/", ROOT, true],
  ["parent outside storage", PRIVATE, PRIVATE, true],
])("skipped discovery reports unknown: %s", async (_name, storage, resource, inherit) => {
  const f = await wacPod();
  expect((await f.anonymous(resource)).status).toBe(resource === PRIVATE ? 403 : 200);
  const state = await accessControl(f.fetch, storage).effective(resource, inherit);
  expect(state).toMatchObject({ status: "unknown" });
  expect(accessLabel(state, resource, OWNER)).toBe("Access unknown");
  expect(() => requireAccess(state, resource)).toThrow("can't confirm who can access");
  expect(f.calls).toEqual([]);
});

it.each([
  "origin root exhausted",
  "storage boundary reached",
  "no applicable inherited grants",
])("an unresolved ACL chain stays unknown: %s", async (mode) => {
  const f = await wacPod();
  f.policies.clear();
  if (mode === "no applicable inherited grants")
    f.policies.set(`${PRIVATE}.policy`, await aclBody(`${PRIVATE}other`));
  const storage = mode === "storage boundary reached" ? PRIVATE : ROOT;
  const resource = `${PRIVATE}secret`;
  const state = await accessControl(f.fetch, storage).effective(resource);
  expect(state).toMatchObject({ status: "unknown" });
  expect(accessLabel(state, resource, OWNER)).toBe("Access unknown");
  expect(() => requireAccess(state, resource)).toThrow("can't confirm who can access");
  expect(f.calls).toContainEqual({ url: `${storage}.policy`, method: "GET" });
  expect(f.calls.some(({ url }) => !url.startsWith(storage))).toBe(false);
});

it.each([
  "missing-link",
  "foreign-acl-link",
  "acp-link",
  "head-denied",
  "head-network-error",
  "acl-denied",
  "acl-network-error",
  "invalid-rdf",
  "missing-validator",
])("an interrupted inherited ACL walk retains unknown: %s", async (mode) => {
  const f = await wacPod();
  const resource = `${PRIVATE}secret`;
  f.intercept(async (url, init) => {
    if (url === PRIVATE && init?.method === "HEAD") {
      if (mode === "head-network-error") throw new TypeError("Offline");
      if (mode === "head-denied") return new Response(null, { status: 403 });
      if (mode === "missing-link") return new Response(null);
      if (mode === "foreign-acl-link")
        return new Response(null, { headers: { link: "<https://foreign.test/acl>; rel=acl" } });
      if (mode === "acp-link")
        return new Response(null, {
          headers: { link: '<policy>; rel="http://www.w3.org/ns/solid/acp#accessControl"' },
        });
    }
    if (url === `${PRIVATE}.policy`) {
      if (mode === "acl-network-error") throw new TypeError("Offline");
      if (mode === "acl-denied") return new Response(null, { status: 403 });
      if (mode === "invalid-rdf" || mode === "missing-validator")
        return new Response(mode === "invalid-rdf" ? "invalid turtle" : await aclBody(PRIVATE), {
          headers: {
            "content-type": "text/turtle",
            ...(mode === "invalid-rdf" ? { etag: '"invalid"' } : {}),
          },
        });
    }
    return undefined;
  });
  const state = await accessControl(f.fetch, ROOT).effective(resource);
  expect(state).toMatchObject({ status: "unknown" });
  expect(accessLabel(state, resource, OWNER)).toBe("Access unknown");
  expect(() => requireAccess(state, resource)).toThrow("can't confirm who can access");
  // A readable public ancestor must never override the unreadable nearer policy.
  expect(f.calls).not.toContainEqual({ url: ROOT, method: "HEAD" });
});

it("a parsed empty own policy proves No one without consulting ancestors", async () => {
  const f = await wacPod();
  f.policies.set(`${PUBLIC}placeholder.policy`, "");
  const state = await accessControl(f.fetch, ROOT).effective(`${PUBLIC}placeholder`);
  expect(state).toMatchObject({ status: "known" });
  expect(accessLabel(state, `${PUBLIC}placeholder`, OWNER)).toBe("No one");
  expect(requireAccess(state, `${PUBLIC}placeholder`).dataset.size).toBe(0);
  expect(f.calls).toEqual([
    { url: `${PUBLIC}placeholder`, method: "HEAD" },
    { url: `${PUBLIC}placeholder.policy`, method: "GET" },
  ]);
});

it("an explicit demo declaration still establishes demo access", async () => {
  const pod = createDemoPod({ root: ROOT });
  const state = await accessControl(pod.fetch, ROOT).effective(ROOT);
  expect(state).toEqual({ status: "none", demo: true });
  expect(accessLabel(state, ROOT, OWNER)).toBe("Only you (demo pod)");
  expect(requireAccess(state, ROOT).dataset.size).toBe(0);
});
