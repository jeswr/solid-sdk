// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseRdf } from "@jeswr/fetch-rdf";
import type { StorageClient } from "@jeswr/storage-client";
import { StorageError } from "@jeswr/storage-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishRepository } from "../src/index.js";
import { owner, pageData, podFixture, root, siteData } from "./fixtures.js";

const seam = vi.hoisted(() => ({
  storage: undefined as StorageClient | undefined,
  locations: [] as string[],
}));
vi.mock("@jeswr/pod-type-index", () => ({
  createTypeIndex: (options: { storage: StorageClient }) => {
    seam.storage = options.storage;
    return { find: async () => seam.locations, register: async () => {} };
  },
}));
beforeEach(() => {
  seam.storage = undefined;
  seam.locations = [];
});
describe("storage boundary and private Type Index adapter", () => {
  it("rejects unsupported Type Index bodies and seals supported private documents", async () => {
    const pod = await podFixture();
    const repo = publishRepository(pod.storage, pod.fetch, owner);
    const adapter = seam.storage;
    if (!adapter) throw new Error("Missing adapter");
    await expect(adapter.create(root, "", {})).rejects.toThrow(/Unsupported Type Index/);
    await expect(adapter.create(root, null, { name: "index.ttl" })).rejects.toThrow(
      /Unsupported Type Index/,
    );
    await expect(adapter.create(root, null, { kind: "container" })).rejects.toThrow(
      /Unsupported Type Index/,
    );
    const made = await adapter.create(root, null, { kind: "container", name: "settings" });
    expect(made.url).toBe(`${root}settings/`);
    expect(made.etagSource).toBe("follow-up");
    const body = await parseRdf(
      '<https://pod.example/x> <https://example.org/name> "test".',
      "text/turtle",
    );
    await adapter.create(`${root}settings/`, "", { name: "index.ttl" });
    const old = await pod.storage.head(`${root}settings/index.ttl`);
    await adapter.writeRdf(`${root}settings/index.ttl`, body, { ifMatch: old.etag as string });
    const card = await pod.storage.readRdf(owner.split("#")[0] as string);
    await adapter.writeRdf(card.url, card.dataset, { ifMatch: card.etag as string });
    // Profile audience is deliberately unchanged.
    await expect(pod.storage.head(`${card.url}.acl`)).rejects.toMatchObject({ code: "not-found" });
    seam.locations = [
      "https://elsewhere.example/site.ttl",
      `${root}outside.ttl`,
      `${root}publish/ghost/site.ttl`,
    ];
    expect((await repo.listSites()).items).toEqual([]);
  });
  it("handles a concurrent container creator and refuses unexpected returned locations", async () => {
    const pod = await podFixture();
    let racing = true;
    const raced = publishRepository(
      pod.wrap({
        create: async (parent, body, options) => {
          const created = await pod.storage.create(parent, body, options);
          if (racing && options?.name === "publish") {
            racing = false;
            throw new StorageError("conflict", { url: created.url, method: "PUT", status: 409 });
          }
          return created;
        },
      }),
      pod.fetch,
      owner,
    );
    expect((await raced.listSites()).items).toEqual([]);
    const wrongContainer = publishRepository(
      pod.wrap({
        create: async (parent, body, options) => ({
          ...(await pod.storage.create(parent, body, options)),
          url: `${root}unexpected/`,
        }),
      }),
      pod.fetch,
      owner,
    );
    await expect(wrongContainer.createSite("wrong", siteData)).rejects.toThrow(
      /different file path/,
    );
    const wrongSource = publishRepository(
      pod.wrap({
        create: async (parent, body, options) => {
          const created = await pod.storage.create(parent, body, options);
          return options?.name === "site.ttl" ? { ...created, url: `${root}foreign.ttl` } : created;
        },
      }),
      pod.fetch,
      owner,
    );
    await expect(wrongSource.createSite("wrong-source", siteData)).rejects.toThrow(
      /different source path/,
    );
    await expect(pod.storage.head(`${root}foreign.ttl`)).rejects.toMatchObject({
      code: "not-found",
    });
  });
  it("refuses a changed empty placeholder and a missing write validator", async () => {
    const pod = await podFixture();
    const racing = publishRepository(
      pod.wrap({
        read: async (url, options) => {
          const result = await pod.storage.read(url, options);
          return url.endsWith("/site.ttl")
            ? { ...result, text: async () => "another writer" }
            : result;
        },
      }),
      pod.fetch,
      owner,
    );
    await expect(racing.createSite("raced", siteData)).rejects.toThrow(/changed while/);
    const missingVersion = publishRepository(
      pod.wrap({
        write: async (url, body, options) => ({
          ...(await pod.storage.write(url, body, options)),
          etag: null,
        }),
      }),
      pod.fetch,
      owner,
    );
    await expect(missingVersion.createSite("no-version", siteData)).rejects.toThrow(/safe version/);
  });
  it("surfaces malformed pages and non-missing public-output errors", async () => {
    const pod = await podFixture();
    const repo = publishRepository(pod.storage, pod.fetch, owner);
    const site = await repo.createSite("field", siteData);
    const page = await repo.createPage(site, "page", pageData);
    await pod.storage.create(new URL("./", page.url).href, "ignored", {
      name: "ignored.txt",
      contentType: "text/plain",
    });
    const brokenOutput = publishRepository(
      pod.wrap({
        head: async (url, options) => {
          if (url.includes("/public/") && url.endsWith("index.html")) throw new Error("offline");
          return pod.storage.head(url, options);
        },
      }),
      pod.fetch,
      owner,
    );
    await expect(brokenOutput.publish(site, page, pageData, true)).rejects.toThrow(
      /source was saved/,
    );
    const current = await pod.storage.head(page.url);
    await pod.storage.write(page.url, "", {
      ifMatch: current.etag as string,
      contentType: "text/turtle",
    });
    expect(await repo.listPages(site)).toEqual({ items: [], invalid: [{ url: page.url }] });
  });
  it.each([
    undefined,
    "follow-up",
  ] as const)("refuses an uncertain write validator from %s", async (etagSource) => {
    const pod = await podFixture();
    const repo = publishRepository(
      pod.wrap({
        write: async (url, body, options) => ({
          ...(await pod.storage.write(url, body, options)),
          etagSource,
        }),
      }),
      pod.fetch,
      owner,
    );
    await expect(repo.createSite("uncertain", siteData)).rejects.toThrow(/own version/);
  });
});
