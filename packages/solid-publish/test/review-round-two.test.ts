// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { readWac } from "@jeswr/pod-access";
import { StorageError } from "@jeswr/storage-client";
import { describe, expect, it, vi } from "vitest";
import { openPublishRepository, PublicationError, publishRepository } from "../src/index.js";
import { owner, pageData, podFixture, root, siteData } from "./fixtures.js";

async function prepared() {
  const pod = await podFixture();
  const warning = vi.fn();
  const repo = publishRepository(pod.storage, pod.fetch, owner, warning);
  const site = await repo.createSite("field", siteData);
  const page = await repo.createPage(site, "first", pageData);
  return { ...pod, warning, repo, site, page };
}
const acl = "http://www.w3.org/ns/auth/acl#";
async function share(pod: Awaited<ReturnType<typeof prepared>>, url: string, typed = true) {
  const policy = await pod.storage.read(`${url}.acl`);
  await pod.storage.write(
    `${url}.acl`,
    `${await policy.text()}\n<#public> ${typed ? `a <${acl}Authorization>;` : ""} <${acl}accessTo> <${url}>; <${acl}agentClass> <http://xmlns.com/foaf/0.1/Agent>; <${acl}mode> <${acl}Read>.`,
    {
      ifMatch: policy.etag as string,
      contentType: "text/turtle",
    },
  );
}
describe("Publish second review regressions", () => {
  it.each([
    true,
    false,
  ])("registers with an inherited index/prefs ACL (existing pointer: %s)", async (linked) => {
    const pod = await podFixture();
    await pod.storage.create(root, null, { name: "settings", kind: "container" });
    await pod.storage.create(
      `${root}settings/`,
      linked
        ? `<${owner}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${root}settings/privateTypeIndex.ttl>.`
        : "",
      { name: "prefs.ttl", contentType: "text/turtle" },
    );
    await pod.storage.create(
      `${root}settings/`,
      `<${root}settings/privateTypeIndex.ttl> a <http://www.w3.org/ns/solid/terms#TypeIndex>.`,
      {
        name: "privateTypeIndex.ttl",
        contentType: "text/turtle",
      },
    );
    const profile = await pod.storage.read(`${root}profile/card`);
    await pod.storage.write(
      profile.url,
      `${await profile.text()}\n<${owner}> <http://www.w3.org/ns/pim/space#preferencesFile> <${root}settings/prefs.ttl>.`,
      { ifMatch: profile.etag as string, contentType: "text/turtle" },
    );
    const warning = vi.fn();
    const repo = publishRepository(pod.storage, pod.fetch, owner, warning);
    const site = await repo.createSite("inherited", siteData);
    expect(await (await pod.storage.read(`${root}settings/privateTypeIndex.ttl`)).text()).toContain(
      site.url,
    );
    expect(warning).not.toHaveBeenCalled();
    expect(await (await pod.storage.read(`${root}settings/prefs.ttl`)).text()).toContain(
      "privateTypeIndex",
    );
    await expect(pod.storage.head(`${root}settings/prefs.ttl.acl`)).rejects.toMatchObject({
      code: "not-found",
    });
  });
  it("returns the saved site and warns when Type Index registration fails", async () => {
    const pod = await prepared();
    pod.intercept((url, init) =>
      url.includes("privateTypeIndex") && init.method === "GET"
        ? new Response(null, { status: 403 })
        : undefined,
    );
    const site = await pod.repo.createSite("second", siteData);
    expect(site.etag).not.toBe("");
    expect(pod.warning).toHaveBeenCalledWith(expect.stringContaining("Type Index"));
    expect((await pod.repo.listSites()).items.map((s) => s.url)).toContain(site.url);
  });
  it("keeps Type Index authentication failures actionable", async () => {
    const pod = await prepared();
    pod.intercept((url, init) =>
      url.includes("privateTypeIndex") && init.method === "GET"
        ? new Response(null, { status: 401 })
        : undefined,
    );
    await expect(pod.repo.listSites()).rejects.toThrow(/Reconnect/);
  });
  it("diagnoses unsupported and unreadable access when opening an explicit Solid connection", async () => {
    const pod = await podFixture();
    const warning = vi.fn();
    const discovered = await openPublishRepository(pod.fetch, root, owner, { onWarning: warning });
    expect((await discovered.listSites()).items).toEqual([]);
    pod.intercept((url, init) =>
      url === root && init.method === "HEAD" ? new Response(null) : undefined,
    );
    await expect(
      openPublishRepository(pod.fetch, root, owner, { protocol: "solid" }),
    ).rejects.toThrow(/isn't supported/);
    pod.intercept((url, init) =>
      url === root && init.method === "HEAD" ? new Response(null, { status: 503 }) : undefined,
    );
    await expect(
      openPublishRepository(pod.fetch, root, owner, { protocol: "solid" }),
    ).rejects.toThrow(/permissions.*connection/);
  });
  it("uses revalidated ACL HEADs and refuses changed read validators", async () => {
    const pod = await prepared();
    const observed: boolean[] = [];
    const repo = publishRepository(
      pod.wrap({
        head: async (url, options) => {
          if (url.endsWith(".acl")) observed.push(options?.revalidate === true);
          return pod.storage.head(url, options);
        },
        read: async (url, options) => ({
          ...(await pod.storage.read(url, options)),
          etag: '"stale"',
        }),
      }),
      pod.fetch,
      owner,
    );
    await expect(repo.publish(pod.site, pod.page, pageData, true)).rejects.toThrow(/owner-only/);
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every(Boolean)).toBe(true);
  });
  it("refuses an untyped public rule with the resource and reason in the error", async () => {
    const pod = await prepared();
    await share(pod, pod.page.url, false);
    await expect(pod.repo.publish(pod.site, pod.page, pageData, true)).rejects.toThrow(
      pod.page.url,
    );
    await expect(pod.repo.publish(pod.site, pod.page, pageData, true)).rejects.toThrow(
      "unrepresentable",
    );
  });
  it("reports a missing source ACL as a PublicationError with the resource", async () => {
    const pod = await prepared();
    // A GET 404 after a successful HEAD cannot be treated as inherited access.
    pod.intercept((url, init) =>
      url === `${pod.page.url}.acl` && init.method === "GET"
        ? new Response(null, { status: 404 })
        : undefined,
    );
    await expect(pod.repo.publish(pod.site, pod.page, pageData, true)).rejects.toBeInstanceOf(
      PublicationError,
    );
    await expect(pod.repo.publish(pod.site, pod.page, pageData, true)).rejects.toThrow(
      pod.page.url,
    );
  });
  it("diagnoses access transport TypeErrors separately from unsupported models", async () => {
    const pod = await prepared();
    pod.intercept((url) => {
      if (url.includes("offline") && url.endsWith(".acl")) throw new TypeError("Failed to fetch");
      return undefined;
    });
    await expect(pod.repo.createSite("offline", siteData)).rejects.toThrow(
      /permissions.*connection/i,
    );
  });
  it.each([
    null,
    'W/"weak"',
  ])("quarantines one bad validator (%s) and retains good sites and pages", async (etag) => {
    const pod = await prepared();
    const other = await pod.repo.createSite("other", siteData);
    const otherPage = await pod.repo.createPage(pod.site, "other", { ...pageData, slug: "other" });
    const repo = publishRepository(
      pod.wrap({
        readRdf: async (url, options) => ({
          ...(await pod.storage.readRdf(url, options)),
          ...(url === pod.site.url || url === pod.page.url ? { etag } : {}),
        }),
      }),
      pod.fetch,
      owner,
    );
    expect(await repo.listSites()).toMatchObject({
      items: [other],
      invalid: [{ url: pod.site.url }],
    });
    expect(await repo.listPages(pod.site)).toMatchObject({
      items: [otherPage],
      invalid: [{ url: pod.page.url }],
    });
  });
  it("surfaces expired authentication as a reconnect error for site and page reads", async () => {
    const pod = await prepared();
    const repo = publishRepository(
      pod.wrap({
        readRdf: async (url, options) => {
          if (url === pod.site.url || url === pod.page.url)
            throw new StorageError("unauthenticated", { url, method: "GET" });
          return pod.storage.readRdf(url, options);
        },
      }),
      pod.fetch,
      owner,
    );
    await expect(repo.listSites()).rejects.toThrow(/reconnect/i);
    await expect(repo.listPages(pod.site)).rejects.toThrow(/reconnect/i);
  });
  it("leaves extra stale files private, warns with the folder, and continues every rebuild", async () => {
    const pod = await prepared();
    const published = await pod.repo.publish(pod.site, pod.page, pageData, true);
    const directory = `${pod.repo.publicUrl(pod.site)}${pageData.slug}/`;
    await pod.storage.create(directory, "keep this", {
      name: "extra.txt",
      contentType: "text/plain",
    });
    const renamed = await pod.repo.publish(
      published.site,
      published.page,
      { ...published.page.data, slug: "renamed" },
      false,
    );
    expect(await (await pod.storage.read(`${directory}extra.txt`)).text()).toBe("keep this");
    await expect(pod.storage.head(`${directory}index.html`)).rejects.toMatchObject({
      code: "not-found",
    });
    const policy = readWac(
      (await pod.storage.readRdf(`${directory}.acl`)).dataset,
      directory,
      `${directory}.acl`,
    );
    expect(policy.grants.flatMap((g) => g.who.flat())).toEqual([{ kind: "agent", webId: owner }]);
    expect(pod.warning).toHaveBeenCalledWith(expect.stringContaining(directory));
    const refreshed = await pod.repo.refreshPublic(renamed.site);
    expect(refreshed.data.publicUrl).toBeDefined();
    const reused = await pod.repo.publish(
      refreshed,
      renamed.page,
      { ...renamed.page.data, slug: pageData.slug },
      false,
    );
    expect(reused.page.data.slug).toBe(pageData.slug);
    expect(
      readWac(
        (await pod.storage.readRdf(`${directory}.acl`)).dataset,
        directory,
        `${directory}.acl`,
      ).grants.some((g) => g.who.flat().some((w) => w.kind === "public")),
    ).toBe(true);
  });
  it("surfaces a forbidden stale-folder delete instead of claiming it was made private", async () => {
    const pod = await prepared();
    const published = await pod.repo.publish(pod.site, pod.page, pageData, true);
    const directory = `${pod.repo.publicUrl(pod.site)}${pageData.slug}/`;
    const repo = publishRepository(
      pod.wrap({
        delete: async (url, options) => {
          if (url === directory)
            throw new StorageError("forbidden", { url, method: "DELETE", status: 403 });
          return pod.storage.delete(url, options);
        },
      }),
      pod.fetch,
      owner,
    );
    await expect(repo.unpublish(published.site, published.page)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect((await pod.repo.listPages(published.site)).items[0]?.data.status).toBe("published");
    expect(pod.warning).not.toHaveBeenCalled();
  });
  it("ignores shared unrelated drafts but checks a draft selected for publication", async () => {
    const pod = await prepared();
    const draft = await pod.repo.createPage(pod.site, "shared", { ...pageData, slug: "shared" });
    await share(pod, draft.url);
    const published = await pod.repo.publish(pod.site, pod.page, pageData, true);
    const refreshed = await pod.repo.refreshPublic(published.site);
    await expect(pod.repo.publish(refreshed, draft, draft.data, false)).rejects.toThrow(draft.url);
    await share(pod, published.page.url);
    await expect(pod.repo.refreshPublic(refreshed)).rejects.toThrow(published.page.url);
  });
});
