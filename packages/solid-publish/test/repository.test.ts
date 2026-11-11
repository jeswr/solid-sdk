// AUTHORED-BY Codex GPT-6
import { readWac } from "@jeswr/pod-access";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it } from "vitest";
import { openPublishRepository, parsePage, publishRepository } from "../src/index.js";
import { at, owner, pageData, podFixture, root, siteData } from "./fixtures.js";

async function prepared() {
  const pod = await podFixture();
  const repo = publishRepository(pod.storage, pod.fetch, owner);
  const site = await repo.createSite("field", siteData);
  const page = await repo.createPage(site, "first", pageData);
  return { ...pod, repo, site, page };
}
describe("pod source, Type Index and public artifacts", () => {
  it("opens through shared capability discovery and storage APIs", async () => {
    const pod = await podFixture();
    const repo = await openPublishRepository(pod.fetch, root, owner);
    expect((await repo.listSites()).items).toEqual([]);
    const known = await openPublishRepository(pod.fetch, root, owner, { protocol: "solid" });
    expect((await known.listSites()).items).toEqual([]);
  });
  it("keeps RDF owner-only, registers WebSite privately and publishes only rendered resources", async () => {
    const { storage, repo, site, page, calls } = await prepared();
    expect((await repo.listSites()).items.map((s) => s.url)).toEqual([site.url]);
    expect((await repo.listPages(site)).items.map((p) => p.url)).toEqual([page.url]);
    const indexBody = await (await storage.read(`${root}settings/privateTypeIndex.ttl`)).text();
    expect(indexBody).toContain("https://schema.org/WebSite");
    expect(indexBody).toContain(site.url);
    for (const url of [
      `${root}publish/`,
      `${root}publish/field/`,
      site.url,
      page.url,
      `${root}settings/privateTypeIndex.ttl`,
      `${root}settings/prefs.ttl`,
    ]) {
      const policy = readWac(
        await storage.readRdf(`${url}.acl`).then((r) => r.dataset),
        url,
        `${url}.acl`,
      );
      expect(policy.grants).toHaveLength(1);
      expect(policy.grants[0]?.who).toEqual([[{ kind: "agent", webId: owner }]]);
      expect(policy.grants[0]?.modes).toContain("control");
    }
    const before = calls.length;
    await expect(repo.publish(site, page, pageData, false)).rejects.toThrow(/Confirm/);
    expect(calls).toHaveLength(before);
    await expect(storage.head(repo.publicUrl(site))).rejects.toMatchObject({ code: "not-found" });
    const result = await repo.publish(site, page, { ...pageData, published: at }, true);
    const publicRoot = repo.publicUrl(site);
    expect(result.site.data.publicUrl).toBe(publicRoot);
    expect(result.page.data.status).toBe("published");
    const html = await storage.read(`${publicRoot}${pageData.slug}/index.html`);
    expect(html.contentType).toBe("text/html; charset=utf-8");
    expect(await html.text()).toContain("<strong>Hello</strong>");
    expect(await (await storage.read(`${publicRoot}index.html`)).text()).toContain(pageData.title);
    expect((await storage.read(`${publicRoot}feed.xml`)).contentType).toBe(
      "application/rss+xml; charset=utf-8",
    );
    const publicPolicy = readWac(
      (await storage.readRdf(`${publicRoot}.acl`)).dataset,
      publicRoot,
      `${publicRoot}.acl`,
    );
    const publicGrant = publicPolicy.grants.find((g) => g.who[0]?.[0]?.kind === "public");
    expect(publicGrant?.modes).toEqual(new Set(["read"]));
    expect(publicGrant?.appliesTo).toBe("both");
    expect(
      calls
        .filter((c) => c.method === "PUT" && String(c.body).includes("foaf/0.1/Agent"))
        .map((c) => c.url),
    ).toEqual([`${publicRoot}.acl`]);
    expect(parsePage(page.url, (await storage.readRdf(page.url)).dataset)?.status).toBe(
      "published",
    );
    expect(await storage.head(`${root}publish/.acl`)).toBeDefined();
    await expect(storage.head(`${root}public/.acl`)).rejects.toMatchObject({ code: "not-found" });
    await expect(storage.head(`${root}public/sites/.acl`)).rejects.toMatchObject({
      code: "not-found",
    });
    const update = await repo.publish(
      result.site,
      result.page,
      { ...result.page.data, body: "Updated **words**", slug: "a-new-title" },
      false,
    );
    await expect(storage.head(`${publicRoot}${pageData.slug}/index.html`)).rejects.toMatchObject({
      code: "not-found",
    });
    expect(await (await storage.read(`${publicRoot}a-new-title/index.html`)).text()).toContain(
      "Updated <strong>words</strong>",
    );
    const unpublished = await repo.unpublish(update.site, update.page);
    expect(unpublished.site.data.publicUrl).toBeUndefined();
    expect(unpublished.page.data.status).toBe("draft");
    for (const path of ["index.html", "feed.xml", "a-new-title/", "a-new-title/index.html"])
      await expect(storage.head(`${publicRoot}${path}`)).rejects.toMatchObject({
        code: "not-found",
      });
    await expect(
      repo.publish(unpublished.site, unpublished.page, unpublished.page.data, false),
    ).rejects.toThrow(/Confirm/);
    // Unpublishing again is idempotent for absent output bytes.
    const again = await repo.unpublish(unpublished.site, unpublished.page);
    expect(again.page.data.status).toBe("draft");
  });
  it("includes only published pages in navigation and only posts in RSS; refreshes settings", async () => {
    const { repo, storage, site, page } = await prepared();
    let result = await repo.publish(site, page, { ...pageData, published: at }, true);
    const about = await repo.createPage(result.site, "about", {
      ...pageData,
      slug: "about",
      title: "About",
      kind: "page",
      position: 1,
    });
    result = await repo.publish(result.site, about, { ...about.data, published: at }, false);
    await repo.createPage(result.site, "secret", {
      ...pageData,
      slug: "secret",
      title: "Hidden",
      position: 2,
    });
    const savedSite = await repo.saveSite(result.site, {
      ...siteData,
      name: "Renamed",
      theme: "garden",
      publicUrl: "https://evil.example/",
    });
    expect(savedSite.data.publicUrl).toBe(repo.publicUrl(site));
    const refreshed = await repo.refreshPublic(savedSite);
    expect(refreshed.data.name).toBe("Renamed");
    const index = await (await storage.read(`${repo.publicUrl(site)}index.html`)).text();
    expect(index).toContain('class="garden"');
    expect(index).toContain(">About</a>");
    expect(index).not.toContain("Hidden");
    const feed = await (await storage.read(`${repo.publicUrl(site)}feed.xml`)).text();
    expect(feed).not.toContain("<title>About</title>");
    const unpublished = await repo.unpublish(refreshed, result.page);
    expect(unpublished.site.data.publicUrl).toBeDefined();
    expect(await (await storage.read(`${repo.publicUrl(site)}index.html`)).text()).not.toContain(
      ">About</a>",
    );
  });
  it("lists multiple websites in name order", async () => {
    const { repo } = await prepared();
    await repo.createSite("another", { ...siteData, name: "A new site" });
    expect((await repo.listSites()).items.map((site) => site.data.name)).toEqual([
      "A new site",
      "Field notes",
    ]);
  });
  it("validates duplicate slugs, invalid ids and all site/page scope boundaries before writes", async () => {
    const { repo, site, page, storage, calls } = await prepared();
    await expect(repo.createPage(site, "second", pageData)).rejects.toThrow(/already uses/);
    const second = await repo.createPage(site, "second", { ...pageData, slug: "second" });
    await expect(repo.savePage(site, second, pageData)).rejects.toThrow(/already uses/);
    const count = calls.length;
    const foreignSite = { ...site, url: "https://evil.example/publish/field/site.ttl" };
    expect(() => repo.publicUrl(foreignSite)).toThrow();
    await expect(repo.saveSite(foreignSite, siteData)).rejects.toThrow();
    await expect(repo.listPages(foreignSite)).rejects.toThrow();
    await expect(repo.createSite("../x", siteData)).rejects.toThrow();
    await expect(repo.createPage(site, "bad/id", pageData)).rejects.toThrow();
    await expect(
      repo.savePage(site, { ...page, url: `${root}private.ttl` }, pageData),
    ).rejects.toThrow();
    await expect(repo.unpublish(site, { ...page, url: `${root}private.ttl` })).rejects.toThrow();
    await expect(
      repo.publish(site, { ...page, url: `${root}private.ttl` }, pageData, true),
    ).rejects.toThrow();
    expect(calls).toHaveLength(count);
    await expect(repo.refreshPublic(site)).rejects.toThrow(/Confirm/);
    const edited = await repo.savePage(site, page, { ...pageData, body: "A private edit" });
    expect(edited.data.body).toBe("A private edit");
    await expect(repo.savePage(site, page, pageData)).rejects.toMatchObject({
      code: "precondition-failed",
    });
    const version = await storage.head(site.url);
    await storage.write(site.url, "", {
      ifMatch: version.etag as string,
      contentType: "text/turtle",
    });
    expect(await repo.listSites()).toEqual({ items: [], invalid: [{ url: site.url }] });
  });
  it("refuses unsupported protocols and unavailable/changed access controls without source content", async () => {
    expect(() =>
      publishRepository(createMemoryStorage({ protocol: "lws", root }), globalThis.fetch, owner),
    ).toThrow(/stable/);
    const pod = await podFixture();
    const repo = publishRepository(pod.storage, pod.fetch, owner);
    pod.intercept((url, init) =>
      init.method === "PUT" && url.endsWith(".acl")
        ? new Response(null, { status: 412 })
        : undefined,
    );
    await expect(repo.createSite("refused", siteData)).rejects.toThrow(/permissions/);
    await expect(pod.storage.head(`${root}publish/refused/site.ttl`)).rejects.toMatchObject({
      code: "not-found",
    });
    pod.intercept((url, init) =>
      init.method === "HEAD" && url === `${root}publish/` ? new Response(null) : undefined,
    );
    await expect(repo.listSites()).resolves.toMatchObject({ items: [] });
  });
  it("propagates permission and listing errors, refuses missing/weak validators and ignores foreign members", async () => {
    const pod = await podFixture();
    const noVersions = publishRepository(
      pod.wrap({
        readRdf: async (url, options) => ({
          ...(await pod.storage.readRdf(url, options)),
          etag: null,
        }),
      }),
      pod.fetch,
      owner,
    );
    const repo = publishRepository(pod.storage, pod.fetch, owner);
    const site = await repo.createSite("field", siteData);
    await expect(noVersions.listSites()).rejects.toThrow(/safe version/);
    const weakVersions = publishRepository(
      pod.wrap({
        readRdf: async (url, options) => ({
          ...(await pod.storage.readRdf(url, options)),
          etag: 'W/"1"',
        }),
      }),
      pod.fetch,
      owner,
    );
    await expect(weakVersions.listSites()).rejects.toThrow(/safe version/);
    await expect(repo.listPages(site)).resolves.toEqual({ items: [], invalid: [] });
    await pod.storage.create(`${root}publish/`, "ignored", {
      name: "not-a-site.txt",
      contentType: "text/plain",
    });
    await pod.storage.create(`${root}publish/`, null, { name: "BadKey", kind: "container" });
    await pod.storage.create(`${root}publish/`, null, { name: "empty", kind: "container" });
    expect((await repo.listSites()).items).toHaveLength(1);
    const broken = publishRepository(
      pod.wrap({
        head: async () => {
          throw new StorageError("forbidden", { url: root, method: "HEAD", status: 403 });
        },
      }),
      pod.fetch,
      owner,
    );
    await expect(broken.listSites()).rejects.toMatchObject({ code: "forbidden" });
    const deniedPages = publishRepository(
      pod.wrap({
        head: async (url) => {
          if (url.endsWith("pages/")) throw new Error("offline");
          return pod.storage.head(url);
        },
      }),
      pod.fetch,
      owner,
    );
    await expect(deniedPages.listPages(site)).rejects.toThrow("offline");
  });
  it("reports partial publication failures and can recover from the authoritative source", async () => {
    const { storage, fetch, site, page } = await prepared();
    const broken = publishRepository(
      {
        ...storage,
        write: async (url, body, options) => {
          if (url.includes("/public/")) throw new Error("offline");
          return storage.write(url, body, options);
        },
        create: async (parent, body, options) => {
          if (options?.name === "index.html") throw new Error("offline");
          return storage.create(parent, body, options);
        },
      },
      fetch,
      owner,
    );
    await expect(broken.publish(site, page, pageData, true)).rejects.toThrow(/source was saved/);
    const repo = publishRepository(storage, fetch, owner);
    const recoveredSite = (await repo.listSites()).items[0];
    const recoveredPage = (await repo.listPages(site)).items[0];
    expect(recoveredSite).toBeDefined();
    expect(recoveredPage?.data.status).toBe("published");
    const published = await repo.publish(
      recoveredSite as typeof site,
      recoveredPage as typeof page,
      pageData,
      true,
    );
    const noDelete = publishRepository(
      {
        ...storage,
        delete: async () => {
          throw new Error("offline");
        },
      },
      fetch,
      owner,
    );
    await expect(noDelete.unpublish(published.site, published.page)).rejects.toThrow("offline");
    expect(parsePage(page.url, (await storage.readRdf(page.url)).dataset)?.status).toBe(
      "published",
    );
    const done = await repo.unpublish(published.site, published.page);
    expect(done.page.data.status).toBe("draft");
  });
  it("requires current site/page versions before publication side effects", async () => {
    const { repo, storage, site, page } = await prepared();
    const result = await repo.publish(site, page, pageData, true);
    const next = await repo.savePage(result.site, result.page, {
      ...result.page.data,
      body: "newer",
    });
    await expect(repo.unpublish(result.site, result.page)).rejects.toThrow();
    expect((await storage.read(`${repo.publicUrl(site)}${pageData.slug}/index.html`)).status).toBe(
      200,
    );
    expect(next.etag).not.toBe(result.page.etag);
  });
});
