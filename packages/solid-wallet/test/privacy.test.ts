// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { checkOwnerOnly } from "@jeswr/pod-access";
import type { TypeIndex } from "@jeswr/pod-type-index";
import type { StorageClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { expect, it, vi } from "vitest";
import { createWalletRepository, WalletPrivacyError } from "../src/index.js";

const owner = "https://pod.example/profile#me";
async function fixture(selector: string, modes: string, memberDefault = false) {
  const memory = createMemoryStorage({ root: "https://pod.example/" });
  const folder = (await memory.create(memory.root, null, { name: "wallet", kind: "container" }))
    .url;
  for (const name of ["files", "credentials"])
    await memory.create(folder, null, { name, kind: "container" });
  const acl = `${folder}.acl`;
  const policy = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
    @prefix foaf: <http://xmlns.com/foaf/0.1/>.
    [] a acl:Authorization; acl:accessTo <${folder}>; acl:default <${folder}>;
       acl:agent <${owner}>; acl:mode acl:Read, acl:Write, acl:Control.
    [] a acl:Authorization; ${memberDefault ? "acl:default" : "acl:accessTo"} <${folder}>; ${selector}; acl:mode ${modes}.`;
  await memory.create(folder, policy, { name: ".acl", contentType: "text/turtle" });
  const storage: StorageClient = {
    ...memory,
    features: {
      ...memory.features,
      accessControl: { state: "available", detail: { model: "wac" }, evidence: "fixture" },
    },
    head: vi.fn(async (url, options) => ({
      ...(await memory.head(url, options)),
      links: new Map([
        ["acl", [{ target: url === folder || url === acl ? acl : `${url}.acl`, params: {} }]],
      ]),
    })),
  };
  const transport = vi.fn(async (input, init) => {
    const url = String(input);
    return new Response(init?.method === "HEAD" ? null : url === acl ? policy : "", {
      headers: { "content-type": "text/turtle", etag: '"acl-v1"', link: `<${acl}>; rel="acl"` },
    });
  }) as unknown as typeof fetch;
  const repository = createWalletRepository({
    storage,
    fetch: transport,
    webId: owner,
    typeIndex: {} as TypeIndex,
  });
  return { repository, storage };
}
it.each([
  ["public Read+Append", "acl:agentClass foaf:Agent", "acl:Read, acl:Append"],
  ["public Control-only", "acl:agentClass foaf:Agent", "acl:Control"],
  ["public Write-only", "acl:agentClass foaf:Agent", "acl:Write"],
  ["agentGroup", "acl:agentGroup <https://group.example/team>", "acl:Read"],
  ["origin scoped", "acl:agentClass foaf:Agent; acl:origin <https://app.example>", "acl:Read"],
  [
    "client scoped",
    "acl:agentClass foaf:Agent; acl:origin <https://client.example>",
    "acl:Control",
  ],
])("refuses %s before any private write", async (_name, selector, modes) => {
  for (const defaults of [false, true]) {
    const { repository, storage } = await fixture(selector, modes, defaults);
    const create = vi.spyOn(storage, "create");
    const write = vi.spyOn(storage, "write");
    await expect(
      repository.save({
        name: "Private",
        kind: "passport",
        created: new Date(),
        modified: new Date(),
      }),
    ).rejects.toBeInstanceOf(WalletPrivacyError);
    await expect(
      repository.upload(new Blob(["scan"], { type: "image/png" })),
    ).rejects.toBeInstanceOf(WalletPrivacyError);
    expect(create).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  }
});
it("accepts only owner access using the real shared checker", async () => {
  const { repository } = await fixture(`acl:agent <${owner}>`, "acl:Read");
  await repository.assertPrivate();
});

it("refuses a non-owner ACP client-scoped policy with a trusted dialect", async () => {
  const memory = createMemoryStorage({ root: "https://pod.example/" });
  const folder = (await memory.create(memory.root, null, { name: "wallet", kind: "container" }))
    .url;
  const acl = `${folder}.acr`;
  await memory.create(
    folder,
    `@prefix acp: <http://www.w3.org/ns/solid/acp#>.
    @prefix acl: <http://www.w3.org/ns/auth/acl#>.
    <> a acp:AccessControlResource; acp:resource <${folder}>; acp:accessControl <#control>.
    <#control> acp:apply <#owner>, <#shared>.
    <#owner> acp:allow acl:Read, acl:Write, acl:Control; acp:allOf <#owner-matcher>.
    <#owner-matcher> acp:agent <${owner}>.
    <#shared> acp:allow acl:Read; acp:allOf <#client>.
    <#client> acp:agent acp:PublicAgent; acp:client <https://client.example/>.`,
    { name: ".acr", contentType: "text/turtle" },
  );
  const storage: StorageClient = {
    ...memory,
    features: {
      ...memory.features,
      accessControl: { state: "available", detail: { model: "acp" }, evidence: "fixture" },
    },
    head: async (url, options) => ({
      ...(await memory.head(url, options)),
      links: new Map([["acl", [{ target: acl, params: {} }]]]),
    }),
  };
  const repository = createWalletRepository({
    storage,
    webId: owner,
    fetch: vi.fn(),
    acpDialect: "css",
  });
  const create = vi.spyOn(storage, "create");
  expect(
    await checkOwnerOnly({ storage, url: folder, ownerWebId: owner, acpDialect: "css" }),
  ).toMatchObject({
    private: false,
    reasons: [{ subject: "origin/client-scoped", reason: "non-owner" }],
  });
  await expect(
    repository.save({
      name: "Private",
      kind: "passport",
      created: new Date(),
      modified: new Date(),
    }),
  ).rejects.toBeInstanceOf(WalletPrivacyError);
  expect(create).not.toHaveBeenCalled();
});
