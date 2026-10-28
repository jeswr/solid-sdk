// AUTHORED-BY Codex
import { DataFactory, Store } from "n3";
import { expect, it, vi } from "vitest";
import { accessControl, accessGains, type OwnAccess } from "../src/apps/drive/lib/client/access";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import {
  ACL,
  aclBody,
  DRIVE,
  EVERYONE,
  OWNER,
  PRIVATE,
  PUBLIC,
  ROOT,
  turtle,
  WacFields,
  wacPod,
} from "./drive-wac-pod";

function policy(rules: Record<string, string[]>[]): OwnAccess {
  const dataset = new Store();
  for (const fields of rules) {
    const rule = new WacFields(DataFactory.blankNode(), dataset, DataFactory);
    rule.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
    for (const [predicate, values] of Object.entries(fields))
      for (const value of values) rule.iris(`${ACL}${predicate}`).add(value);
  }
  return { url: `${PRIVATE}.policy`, dataset, etag: '"policy"' };
}
const read = [`${ACL}Read`];
it.each([
  ["agentClass", `${ACL}AuthenticatedAgent`, "Authenticated agents"],
  ["agent", "https://bob.test/#me", "https://bob.test/#me"],
  ["agentGroup", "https://group.test/#staff", "Group https://group.test/#staff"],
  ["agentClass", "https://classes.test/#staff", "https://classes.test/#staff"],
])("names new WAC %s grants (%s)", (predicate, agent, name) => {
  expect(accessGains(policy([]), policy([{ [predicate]: [agent], mode: read }]))).toEqual([name]);
});
it("compares modes, subjects and origins conservatively without conflating conditions", () => {
  const publicWrite = policy([{ agentClass: [EVERYONE], mode: [`${ACL}Write`] }]);
  expect(accessGains(publicWrite, policy([{ agent: [OWNER], mode: [`${ACL}Append`] }]))).toEqual(
    [],
  );
  expect(accessGains(publicWrite, policy([{ agent: [OWNER], mode: read }]))).toEqual([OWNER]);
  const authenticated = policy([{ agentClass: [`${ACL}AuthenticatedAgent`], mode: read }]);
  expect(accessGains(authenticated, policy([{ agent: [OWNER], mode: read }]))).toEqual([]);
  expect(accessGains(authenticated, policy([{ agentClass: [EVERYONE], mode: read }]))).toEqual([
    "Everyone (public)",
  ]);
  expect(
    accessGains(policy([{ agent: [OWNER], mode: read }]), policy([{ agent: [OWNER], mode: read }])),
  ).toEqual([]);
  const restricted = policy([
    { agent: [OWNER], mode: read, origin: ["https://app.test", "https://second.test"] },
  ]);
  expect(
    accessGains(restricted, policy([{ agent: [OWNER], mode: read, origin: ["https://app.test"] }])),
  ).toEqual([]);
  expect(
    accessGains(
      restricted,
      policy([{ agent: [OWNER], mode: read, origin: ["https://third.test"] }]),
    ),
  ).toEqual([`${OWNER} from https://third.test`]);
  expect(accessGains(restricted, policy([{ agent: [OWNER], mode: read }]))).toEqual([OWNER]);
  expect(accessGains(policy([]), policy([{ agent: [OWNER] }]))).toEqual([]);
});
it("resolves own accessTo, nearest default/defaultForNew and ignores unrelated authorizations", async () => {
  const f = await wacPod();
  const access = accessControl(f.fetch, ROOT);
  const top = policy([
    { accessTo: [PRIVATE], agent: [OWNER], mode: read },
    { accessTo: [`${DRIVE}unrelated`], agentClass: [EVERYONE], mode: read },
  ]);
  f.policies.set(`${PRIVATE}.policy`, await turtle(top.dataset));
  const own = await access.effective(PRIVATE);
  expect(accessGains(policy([]), own)).toEqual([OWNER]);
  // No applicable default here: the root's public default governs descendants.
  expect(accessGains(policy([]), await access.effective(`${PRIVATE}secret`))).toContain(
    "Everyone (public)",
  );
  const legacy = policy([{ defaultForNew: [PRIVATE], agent: [OWNER], mode: read }]);
  f.policies.set(`${PRIVATE}.policy`, await turtle(legacy.dataset));
  expect(accessGains(policy([]), await access.effective(`${PRIVATE}secret`))).toEqual([OWNER]);
  f.policies.clear();
  expect((await access.effective(ROOT)).dataset.size).toBe(0);
});
it.each([
  "unreadable",
  "acp",
  "unknown",
  "parent-denied",
])("unknown source access prompts and disables Keep: %s", async (mode) => {
  const f = await wacPod();
  f.intercept(async (url, init) => {
    if (mode === "unreadable" && url === `${PRIVATE}.policy`)
      return new Response(null, { status: 403 });
    if (url === `${PRIVATE}secret` && mode === "acp")
      return new Response("secret contents", {
        headers: {
          etag: '"secret"',
          link: `<${url}.acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"`,
        },
      });
    if (url === PRIVATE && init?.method === "HEAD" && mode === "unknown") return new Response(null);
    if (url === PRIVATE && init?.method === "HEAD" && mode === "parent-denied")
      return new Response(null, { status: 403 });
    return undefined;
  });
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  await expect(client.move(`${PRIVATE}secret`, `${PUBLIC}secret`)).rejects.toThrow("cancelled");
  expect(confirmAccess).toHaveBeenCalledWith(
    expect.objectContaining({
      canKeep: false,
      gains: [expect.stringContaining("could not be determined")],
    }),
  );
  expect(f.pod.has(`${PRIVATE}secret`)).toBe(true);
});
it("unknown source cannot be kept even if a caller requests Keep", async () => {
  const f = await wacPod();
  f.intercept(async (url) =>
    url === `${PRIVATE}.policy` ? new Response(null, { status: 403 }) : undefined,
  );
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    confirmAccess: async () => "keep",
  });
  await expect(client.move(`${PRIVATE}secret`, `${PUBLIC}secret`)).rejects.toThrow(
    "Private access",
  );
  expect(f.pod.has(`${PUBLIC}secret`)).toBe(false);
});
it("unknown destination can still keep the known source policy", async () => {
  const f = await wacPod();
  f.intercept(async (url, init) =>
    url === PUBLIC && init?.method === "HEAD" ? new Response(null, { status: 403 }) : undefined,
  );
  const confirmAccess = vi.fn(async () => "keep" as const);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  await client.move(`${PRIVATE}secret`, `${PUBLIC}secret`);
  expect(confirmAccess).toHaveBeenCalledWith(expect.objectContaining({ canKeep: true }));
  expect((await f.anonymous(`${PUBLIC}secret`)).status).toBe(403);
});
it("moves to equivalent or narrower inherited defaults without prompting; demo pods never prompt", async () => {
  const f = await wacPod();
  f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC));
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  await client.move(`${PRIVATE}secret`, `${PUBLIC}secret`);
  expect(confirmAccess).not.toHaveBeenCalled();
  const pod = createDemoPod({
    root: ROOT,
    seed: [{ path: "drive/a", body: "A", contentType: "text/plain" }],
  });
  await createSolidDriveClient({ storageUrl: ROOT, fetch: pod.fetch, confirmAccess }).move(
    `${DRIVE}a`,
    `${DRIVE}b`,
  );
  expect(confirmAccess).not.toHaveBeenCalled();
});
it("copy of an inherited private file keeps its source access before payloads", async () => {
  const f = await wacPod();
  f.audit();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await client.copy(`${PRIVATE}secret`, `${PUBLIC}secret`);
  expect((await f.anonymous(`${PUBLIC}secret`)).status).toBe(403);
  expect(f.exposures).toEqual([]);
});
it("no confirmation handler fails closed on widening", async () => {
  const f = await wacPod();
  await expect(
    createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch }).move(
      `${PRIVATE}secret`,
      `${PUBLIC}secret`,
    ),
  ).rejects.toThrow("cancelled");
  expect(f.pod.has(`${PUBLIC}secret`)).toBe(false);
});

it.each([
  false,
  true,
])("unreadable own ACL in a moved tree prompts before writes (folder: %s)", async (folder) => {
  const f = await wacPod();
  f.intercept(async (url) =>
    url === `${PRIVATE}secret.policy` ? new Response(null, { status: 403 }) : undefined,
  );
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  await expect(
    client.move(
      folder ? PRIVATE : `${PRIVATE}secret`,
      folder ? `${PUBLIC}private/` : `${PUBLIC}secret`,
    ),
  ).rejects.toThrow("cancelled");
  expect(confirmAccess).toHaveBeenCalledWith(expect.objectContaining({ canKeep: false }));
  expect(f.calls.some((call) => call.method === "PUT")).toBe(false);
});
it("explicit Move acknowledges unknown source policies; Keep remains unavailable", async () => {
  const f = await wacPod();
  f.intercept(async (url) =>
    url === `${PRIVATE}secret.policy` ? new Response(null, { status: 403 }) : undefined,
  );
  const confirmAccess = vi.fn(async () => "move" as const);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  await client.move(`${PRIVATE}secret`, `${PUBLIC}secret`);
  expect(confirmAccess).toHaveBeenCalledWith(expect.objectContaining({ canKeep: false }));
  expect((await f.anonymous(`${PUBLIC}secret`)).status).toBe(200);
});
it("Keep on a folder materializes accessTo and defaults before any child bytes", async () => {
  const f = await wacPod();
  // This folder has no own ACL and inherits the private ancestor's defaults.
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    confirmAccess: async () => "keep",
  });
  await client.createFolder(`${PRIVATE}nested/`);
  await client.write(`${PRIVATE}nested/secret`, "secret contents", { contentType: "text/plain" });
  f.audit();
  await client.move(`${PRIVATE}nested/`, `${PUBLIC}nested/`);
  expect((await f.anonymous(`${PUBLIC}nested/secret`)).status).toBe(403);
  expect((await f.anonymous(`${PUBLIC}nested/`)).status).toBe(403);
  expect(f.exposures).toEqual([]);
});

it("folder own accessTo without defaults still prompts for widening inherited child access", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    confirmAccess: async () => "keep",
  });
  await client.createFolder(`${PRIVATE}nested/`);
  await client.write(`${PRIVATE}nested/secret`, "secret contents", { contentType: "text/plain" });
  const accessToOnly = policy([{ accessTo: [`${PRIVATE}nested/`], agent: [OWNER], mode: read }]);
  f.policies.set(`${PRIVATE}nested/.policy`, await turtle(accessToOnly.dataset));
  f.audit();
  await client.move(`${PRIVATE}nested/`, `${PUBLIC}nested/`);
  expect((await f.anonymous(`${PUBLIC}nested/secret`)).status).toBe(403);
  expect(f.exposures).toEqual([]);
});

it("Undo of a narrowing move prompts before widening access again; Cancel keeps it private", async () => {
  const f = await wacPod();
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const options = { storageUrl: ROOT, fetch: f.fetch, confirmAccess };
  const client = createSolidDriveClient(options);
  const moved = await client.move(`${PUBLIC}placeholder`, `${PRIVATE}placeholder`);
  expect(confirmAccess).not.toHaveBeenCalled();
  const { moveWithValidator } = await import("../src/apps/drive/state/undo");
  await expect(
    moveWithValidator(options, moved.url, `${PUBLIC}placeholder`, moved.etag as string),
  ).rejects.toThrow("cancelled");
  expect(confirmAccess).toHaveBeenCalledWith(
    expect.objectContaining({ gains: ["Everyone (public)"] }),
  );
  expect(f.pod.has(`${PRIVATE}placeholder`)).toBe(true);
  expect(f.pod.has(`${PUBLIC}placeholder`)).toBe(false);
});
it("Keep rolls back its placeholder if ACL installation fails, without exposing bytes", async () => {
  const f = await wacPod();
  f.intercept(async (url, init) =>
    url === `${PUBLIC}secret.policy` && init?.method === "PUT"
      ? new Response(null, { status: 403 })
      : undefined,
  );
  f.audit();
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    confirmAccess: async () => "keep",
  });
  await expect(client.move(`${PRIVATE}secret`, `${PUBLIC}secret`)).rejects.toThrow();
  expect(f.exposures).toEqual([]);
  expect(f.pod.has(`${PUBLIC}secret`)).toBe(false);
  expect(f.pod.has(`${PRIVATE}secret`)).toBe(true);
});

it("copy refuses an unreadable own ACL before any destination writes", async () => {
  const f = await wacPod();
  f.intercept(async (url) =>
    url === `${PRIVATE}secret.policy` ? new Response(null, { status: 403 }) : undefined,
  );
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await expect(client.copy(`${PRIVATE}secret`, `${PUBLIC}secret`)).rejects.toThrow(
    "Private access",
  );
  expect(f.calls.some((call) => call.method === "PUT")).toBe(false);
  expect(f.pod.has(`${PRIVATE}secret`)).toBe(true);
});

it.each([
  "copy",
  "keep",
])("%s preserves private children when their folder has public own accessTo but no defaults", async (mode) => {
  const f = await wacPod();
  const confirmAccess = vi.fn(async () => "keep" as const);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  const from = `${PRIVATE}nested/`,
    to = `${PUBLIC}nested/`;
  await client.createFolder(from);
  await client.write(`${from}secret`, "secret contents", { contentType: "text/plain" });
  const own = policy([{ accessTo: [from], agentClass: [EVERYONE], mode: read }]);
  f.policies.set(`${from}.policy`, await turtle(own.dataset));
  f.audit();
  if (mode === "copy") await client.copy(from, to);
  else await client.move(from, to);
  expect((await f.anonymous(`${to}secret`)).status).toBe(403);
  expect(f.exposures).toEqual([]);
  expect(confirmAccess).toHaveBeenCalledTimes(mode === "copy" ? 0 : 1);
});

it("folder Undo asks about unknown ACP instead of rejecting policy discovery during tree verification", async () => {
  const f = await wacPod();
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const options = { storageUrl: ROOT, fetch: f.fetch, confirmAccess };
  const client = createSolidDriveClient(options);
  const moved = await client.move(PUBLIC, `${PRIVATE}moved/`);
  expect(confirmAccess).not.toHaveBeenCalled();
  f.after(async (url, method, response) => {
    if (url !== moved.url || !["GET", "HEAD"].includes(method)) return response;
    const headers = new Headers(response.headers);
    headers.set("link", `<${url}.acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"`);
    return new Response(response.body, { status: response.status, headers });
  });
  const { moveWithValidator } = await import("../src/apps/drive/state/undo");
  await expect(
    moveWithValidator(options, moved.url, PUBLIC, moved.etag as string, moved.tree),
  ).rejects.toThrow("cancelled");
  expect(confirmAccess).toHaveBeenCalledWith(expect.objectContaining({ canKeep: false }));
  expect(f.pod.has(moved.url)).toBe(true);
});
