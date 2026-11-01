// AUTHORED-BY Codex GPT-6
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import {
  createManualItem,
  manualUrl,
  registerManualType,
} from "../src/apps/home/components/item/manual-data";
import { autoFormFor } from "../src/apps/home/lib/forms/auto-form";
import { discoverDomainItems } from "../src/apps/home/lib/model/discovery";
import { DOMAINS } from "../src/apps/home/lib/model/domains";
import { readResource } from "../src/apps/home/lib/model/rdf";
import { registrationsFrom } from "../src/apps/home/lib/model/type-index";
import { loadTemplate, TEMPLATE_URLS } from "../src/apps/home/lib/templates";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const root = "https://pod.example/alice/";
const webId = `${root}profile/card#me`;
const SOLID = "http://www.w3.org/ns/solid/terms#";
const fetchTemplate: typeof fetch = async (input) =>
  new Response(await readFile(input as URL, "utf8"));
const types = DOMAINS.flatMap((domain) => domain.dataTypes).filter((type) => type.manualForm);
it.each(
  types,
)("$label template parses, yields editable fields, and uses its documented folder", async (type) => {
  const url = manualUrl(root, type, "Café / Home", "abc123");
  expect(url).toBe(`${root}${type.container}cafe-home-abc123.ttl`);
  const template = await loadTemplate(type.manualForm as string, url, fetchTemplate);
  expect(autoFormFor(template, `${url}#it`).length).toBeGreaterThan(0);
  expect(TEMPLATE_URLS[type.manualForm as string]).toBeDefined();
});
it("creates an Address without overwriting an existing resource, registers it once, and discovers its card", async () => {
  const type = types.find((type) => type.id === "address") as (typeof types)[number];
  const pod = createDemoPod({
    root,
    seed: [
      {
        path: "profile/card",
        contentType: "text/turtle",
        body: `<#me> <${SOLID}privateTypeIndex> <${root}settings/privateTypeIndex.ttl>.`,
      },
    ],
  });
  const fetch = vi.fn(pod.fetch);
  const session = { storageUrl: root, webId, fetch };
  const url = manualUrl(root, type, "Home", "123abc");
  const template = await loadTemplate(type.manualForm as string, url, fetchTemplate);
  const fields = autoFormFor(template, `${url}#it`);
  await createManualItem(
    session,
    type,
    url,
    template,
    fields,
    Object.fromEntries(
      fields.map((field) => [field.id, field.label === "Fn" ? "Home" : "Street value"]),
    ),
  );
  const index = await readResource(pod.fetch, `${root}settings/privateTypeIndex.ttl`);
  expect(registrationsFrom(index.dataset)).toEqual([
    { forClass: type.manualForm, container: `${root}personal/` },
  ]);
  const writes = fetch.mock.calls.filter(([, init]) => init?.method === "PUT").length;
  await registerManualType(session, type.manualForm as string, `${root}personal/`);
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(writes);
  await expect(createManualItem(session, type, url, template, fields, {})).rejects.toThrow(
    "Couldn't save",
  );
  const discovered = await discoverDomainItems("personal", {
    fetch: pod.fetch,
    storage: root,
    webId,
    typeIndex: registrationsFrom(index.dataset),
  });
  expect(discovered.items.find((item) => item.url === url)?.title).toBe("Home");
  expect(fetch).toHaveBeenCalledWith(
    url,
    expect.objectContaining({ headers: { "content-type": "text/turtle", "if-none-match": "*" } }),
  );
});
it("bootstraps a private index through preferences and preserves unrelated profile values", async () => {
  const pod = createDemoPod({
    root,
    seed: [
      {
        path: "profile/card",
        contentType: "text/turtle",
        body: '<#me> <http://xmlns.com/foaf/0.1/name> "Alice".',
      },
    ],
  });
  const session = { storageUrl: root, webId, fetch: pod.fetch };
  await registerManualType(session, types[0]?.manualForm as string, `${root}personal/`);
  expect(await (await pod.fetch(`${root}profile/card`)).text()).toContain("Alice");
  expect(await (await pod.fetch(`${root}settings/prefs.ttl`)).text()).toContain("privateTypeIndex");
  const profile = await readResource(pod.fetch, `${root}profile/card`);
  expect(
    [...profile.dataset].some((quad) => quad.predicate.value.endsWith("preferencesFile")),
  ).toBe(true);
  await registerManualType(session, types[1]?.manualForm as string, `${root}notes/`);
  expect(
    registrationsFrom(
      (await readResource(pod.fetch, `${root}settings/privateTypeIndex.ttl`)).dataset,
    ),
  ).toHaveLength(2);
});
it("retries an index conflict by reading the new ETag and refuses foreign index links", async () => {
  const indexUrl = `${root}settings/privateTypeIndex.ttl`;
  const pod = createDemoPod({
    root,
    seed: [
      {
        path: "profile/card",
        contentType: "text/turtle",
        body: `<#me> <${SOLID}privateTypeIndex> <${indexUrl}>.`,
      },
    ],
  });
  let conflict = true;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (String(input) === indexUrl && init?.method === "PUT" && conflict) {
      conflict = false;
      await pod.fetch(indexUrl, {
        method: "PUT",
        headers: { "content-type": "text/turtle" },
        body: '<#other> <https://schema.org/name> "Keep this".',
      });
      return new Response(null, { status: 412 });
    }
    return pod.fetch(input, init);
  };
  await registerManualType(
    { storageUrl: root, webId, fetch },
    types[0]?.manualForm as string,
    `${root}personal/`,
  );
  expect(await (await pod.fetch(indexUrl)).text()).toContain("Keep this");
  await pod.fetch(`${root}profile/card`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: `<#me> <${SOLID}privateTypeIndex> <https://foreign.example/private.ttl>.`,
  });
  const guarded = vi.fn(pod.fetch);
  await expect(
    registerManualType(
      { storageUrl: root, webId, fetch: guarded },
      types[0]?.manualForm as string,
      `${root}personal/`,
    ),
  ).rejects.toThrow();
  expect(guarded.mock.calls.some(([input]) => String(input).includes("foreign.example"))).toBe(
    false,
  );
});
it("rejects invalid manual types/identifiers and never treats unreadable indexes as missing", async () => {
  const type = types[0] as (typeof types)[number];
  expect(() =>
    manualUrl(root, { ...type, manualForm: undefined } as never, "Name", "id"),
  ).toThrow();
  expect(() => manualUrl(root, type, "Name", "../oops")).toThrow();
  expect(manualUrl(root, type, "💡", "id")).toContain(`${type.id}-id.ttl`);
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
    String(input).endsWith("profile/card")
      ? new Response(`<#me> <${SOLID}privateTypeIndex> <${root}settings/privateTypeIndex.ttl>.`, {
          headers: { "content-type": "text/turtle" },
        })
      : new Response(null, { status: 403 }),
  );
  await expect(
    registerManualType(
      { storageUrl: root, webId, fetch },
      type.manualForm as string,
      `${root}personal/`,
    ),
  ).rejects.toThrow();
  expect(fetch.mock.calls.every(([, init]) => init?.method !== "PUT")).toBe(true);
});

it("uses a credential-free external WebID profile with a private index inside storage", async () => {
  const externalWebId = "https://identity.example/card#me";
  const prefs = `${root}settings/external-prefs.ttl`;
  const index = `${root}settings/external-index.ttl`;
  const pod = createDemoPod({
    root,
    seed: [
      {
        path: "settings/external-prefs.ttl",
        contentType: "text/turtle",
        body: `<${externalWebId}> <${SOLID}privateTypeIndex> <${index}>.`,
      },
    ],
  });
  const fetch = vi.fn(pod.fetch);
  const publicFetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(`<#me> <http://www.w3.org/ns/pim/space#preferencesFile> <${prefs}>.`, {
        headers: { "content-type": "text/turtle" },
      }),
  );
  await registerManualType(
    { storageUrl: root, webId: externalWebId, fetch, publicFetch },
    types[0]?.manualForm as string,
    `${root}personal/`,
  );
  expect(publicFetch).toHaveBeenCalledExactlyOnceWith(
    "https://identity.example/card",
    expect.objectContaining({ credentials: "omit", redirect: "error" }),
  );
  expect(fetch.mock.calls.every(([input]) => String(input).startsWith(root))).toBe(true);
  expect(registrationsFrom((await readResource(pod.fetch, index)).dataset)).toHaveLength(1);
  publicFetch.mockResolvedValueOnce(
    new Response(
      "<#me> <http://www.w3.org/ns/pim/space#preferencesFile> <https://evil.example/prefs>.",
      { headers: { "content-type": "text/turtle" } },
    ),
  );
  fetch.mockClear();
  await expect(
    registerManualType(
      { storageUrl: root, webId: externalWebId, fetch, publicFetch },
      types[0]?.manualForm as string,
      `${root}personal/`,
    ),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it("protects new private settings before population under a publicly readable parent", async () => {
  const { readWacPolicy } = await import("../src/apps/home/lib/permissions/walk");
  const { RdfFetchError } = await import("@jeswr/fetch-rdf");
  const pod = createDemoPod({
    root,
    seed: [
      {
        path: "profile/card",
        contentType: "text/turtle",
        body: '<#me> <http://xmlns.com/foaf/0.1/name> "Alice".',
      },
    ],
  });
  const anonymous: typeof globalThis.fetch = async (input) => {
    const target = String(input);
    try {
      const read = await readResource(pod.fetch, `${target}.acl`);
      const policy = readWacPolicy(read.dataset, target, `${target}.acl`);
      const publicRead = policy.grants.some(
        (grant) =>
          grant.modes.has("read") &&
          grant.who.some((clause) => clause.some((subject) => subject.kind === "public")),
      );
      return publicRead ? pod.fetch(input) : new Response(null, { status: 403 });
    } catch (error) {
      if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
      return pod.fetch(input); // parent defaults are public
    }
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const target = String(input);
    if (init?.method === "PUT" && /settings\/.*\.ttl$/.test(target))
      expect((await anonymous(target)).status).toBe(403);
    if (init?.method === "PUT" && target.endsWith(".acl"))
      expect(new Headers(init.headers).get("if-none-match")).toBe("*");
    return pod.fetch(input, init);
  });
  await registerManualType(
    { storageUrl: root, webId, fetch },
    types[0]?.manualForm as string,
    `${root}personal/`,
  );
  for (const target of [`${root}settings/privateTypeIndex.ttl`, `${root}settings/prefs.ttl`]) {
    expect((await pod.fetch(target)).status).toBe(200);
    expect((await anonymous(target)).status).toBe(403);
  }
  expect((await anonymous(`${root}profile/card`)).status).toBe(200);
});

it.each([
  "denied",
  "unverified",
  "public-existing",
])("stops private bootstrap without linking when ACL protection is %s", async (failure) => {
  const index = `${root}settings/privateTypeIndex.ttl`;
  const pod = createDemoPod({
    root,
    seed: [
      {
        path: "profile/card",
        contentType: "text/turtle",
        body: '<#me> <http://xmlns.com/foaf/0.1/name> "Alice".',
      },
    ],
  });
  if (failure === "public-existing")
    await pod.fetch(`${index}.acl`, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: `@prefix acl: <http://www.w3.org/ns/auth/acl#>. <#public> a acl:Authorization; acl:accessTo <${index}>; acl:agentClass <http://xmlns.com/foaf/0.1/Agent>; acl:mode acl:Read.`,
    });
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    if (String(input).endsWith(".acl") && init?.method === "PUT")
      return new Response(null, { status: failure === "denied" ? 403 : 201 });
    return pod.fetch(input, init);
  });
  await expect(
    registerManualType(
      { storageUrl: root, webId, fetch },
      types[0]?.manualForm as string,
      `${root}personal/`,
    ),
  ).rejects.toThrow();
  expect(pod.has(index)).toBe(false);
  expect(pod.has(`${root}settings/prefs.ttl`)).toBe(false);
  expect(await (await pod.fetch(`${root}profile/card`)).text()).not.toContain("preferencesFile");
});

it("never writes an ACL for settings that already exist", async () => {
  const index = `${root}settings/privateTypeIndex.ttl`;
  const pod = createDemoPod({
    root,
    seed: [
      {
        path: "profile/card",
        contentType: "text/turtle",
        body: `<#me> <${SOLID}privateTypeIndex> <${index}>.`,
      },
      {
        path: "settings/privateTypeIndex.ttl",
        contentType: "text/turtle",
        body: `<> a <${SOLID}TypeIndex>.`,
      },
    ],
  });
  const fetch = vi.fn(pod.fetch);
  await registerManualType(
    { storageUrl: root, webId, fetch },
    types[0]?.manualForm as string,
    `${root}personal/`,
  );
  expect(registrationsFrom((await readResource(pod.fetch, index)).dataset)).toHaveLength(1);
  expect(fetch.mock.calls.some(([input]) => String(input).endsWith(".acl"))).toBe(false);
});

it("fails closed when a missing document's ACL location can't be established", async () => {
  const pod = createDemoPod({
    root,
    seed: [
      {
        path: "profile/card",
        contentType: "text/turtle",
        body: '<#me> <http://xmlns.com/foaf/0.1/name> "Alice".',
      },
    ],
  });
  // The storage root advertises an ACL that does not follow the `.acl` suffix convention.
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const response = await pod.fetch(input, init);
    if (String(input) !== root) return response;
    const headers = new Headers(response.headers);
    headers.set("link", `<${root}acl-store/root>; rel="acl"`);
    return new Response(response.body, { status: response.status, headers });
  });
  await expect(
    registerManualType(
      { storageUrl: root, webId, fetch },
      types[0]?.manualForm as string,
      `${root}personal/`,
    ),
  ).rejects.toThrow("Couldn't find where to protect your settings.");
  expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
});

it.each([
  "public",
  "elsewhere",
])("removes a new private document and links nothing when the server reports %s access after writing", async (kind) => {
  const index = `${root}settings/privateTypeIndex.ttl`;
  const pod = createDemoPod({
    root,
    seed: [
      {
        path: "profile/card",
        contentType: "text/turtle",
        body: '<#me> <http://xmlns.com/foaf/0.1/name> "Alice".',
      },
    ],
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const response = await pod.fetch(input, init);
    if (String(input) !== index || init?.method !== "HEAD" || !response.ok) return response;
    const headers = new Headers(response.headers);
    if (kind === "public") headers.set("wac-allow", 'user="read write control",public="read"');
    else headers.set("link", `<${root}other.acl>; rel="acl"`);
    return new Response(null, { status: response.status, headers });
  });
  await expect(
    registerManualType(
      { storageUrl: root, webId, fetch },
      types[0]?.manualForm as string,
      `${root}personal/`,
    ),
  ).rejects.toThrow("Couldn't verify private access to your settings.");
  expect(pod.has(index)).toBe(false);
  expect(pod.has(`${root}settings/prefs.ttl`)).toBe(false);
  expect(await (await pod.fetch(`${root}profile/card`)).text()).not.toContain("preferencesFile");
});

it("keeps an external profile out of authenticated I/O and explains when it links no settings", async () => {
  const externalWebId = "https://identity.example/card#me";
  const pod = createDemoPod({ root });
  const fetch = vi.fn(pod.fetch);
  const publicFetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response('<#me> <http://xmlns.com/foaf/0.1/name> "Alice".', {
        headers: { "content-type": "text/turtle" },
      }),
  );
  await expect(
    registerManualType(
      { storageUrl: root, webId: externalWebId, fetch, publicFetch },
      types[0]?.manualForm as string,
      `${root}personal/`,
    ),
  ).rejects.toThrow("Skip registration to keep the item.");
  expect(fetch).not.toHaveBeenCalled();
  // A preferences file that points its index at another host is refused before any write.
  publicFetch.mockResolvedValueOnce(
    new Response(
      `<#me> <http://www.w3.org/ns/pim/space#preferencesFile> <${root}settings/p.ttl>.`,
      { headers: { "content-type": "text/turtle" } },
    ),
  );
  await pod.fetch(`${root}settings/p.ttl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: `<${externalWebId}> <${SOLID}privateTypeIndex> <https://elsewhere.example/index>.`,
  });
  fetch.mockClear();
  await expect(
    registerManualType(
      { storageUrl: root, webId: externalWebId, fetch, publicFetch },
      types[0]?.manualForm as string,
      `${root}personal/`,
    ),
  ).rejects.toThrow("Skip registration to keep the item.");
  expect(fetch.mock.calls.every(([, init]) => init?.method !== "PUT")).toBe(true);
});

it.each([
  ["access control resources", "set up private access"],
  ["an unreadable existing ACL", "verify private access"],
])("fails closed before writing private settings with %s", async (kind, message) => {
  const index = `${root}settings/privateTypeIndex.ttl`;
  const pod = createDemoPod({
    root,
    seed: [
      {
        path: "profile/card",
        contentType: "text/turtle",
        body: '<#me> <http://xmlns.com/foaf/0.1/name> "Alice".',
      },
    ],
  });
  if (kind === "an unreadable existing ACL")
    await pod.fetch(`${index}.acl`, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: `@prefix acl: <http://www.w3.org/ns/auth/acl#>. <#owner> a acl:Authorization; acl:accessTo <${index}>; acl:agent <${webId}>; acl:mode acl:Read, acl:Write, acl:Control; acl:unknownCondition <#x>.`,
    });
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const response = await pod.fetch(input, init);
    if (kind !== "access control resources" || String(input) !== index) return response;
    const headers = new Headers(response.headers);
    headers.set("link", `<${index}.acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"`);
    return new Response(null, { status: response.status, headers });
  });
  await expect(
    registerManualType(
      { storageUrl: root, webId, fetch },
      types[0]?.manualForm as string,
      `${root}personal/`,
    ),
  ).rejects.toThrow(message);
  expect(pod.has(index)).toBe(false);
  expect(
    fetch.mock.calls.some(([input, init]) => init?.method === "PUT" && String(input) === index),
  ).toBe(false);
});
