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
