// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { describe, expect, it, vi } from "vitest";
import { PublicationError, publishRepository } from "../src/index.js";
import { owner, pageData, podFixture, root, siteData } from "./fixtures.js";

async function prepared() {
  const pod = await podFixture();
  const warning = vi.fn();
  const repo = publishRepository(pod.storage, pod.fetch, owner, warning);
  const site = await repo.createSite("field", siteData);
  const first = await repo.createPage(site, "first", pageData);
  const second = await repo.createPage(site, "second", { ...pageData, slug: "second" });
  const one = await repo.publish(site, first, first.data, true);
  const two = await repo.publish(one.site, second, second.data, false);
  return { ...pod, warning, repo, site: two.site, first: one.page, second: two.page };
}
/** A readable Turtle document that is not a Publish page goes into `listing.invalid`. */
async function corrupt(pod: Awaited<ReturnType<typeof prepared>>, url: string) {
  const current = await pod.storage.head(url);
  await pod.storage.write(url, "<#x> <#y> <#z>.", {
    ifMatch: current.etag as string,
    contentType: "text/turtle",
  });
}
const warnings = (pod: { warning: ReturnType<typeof vi.fn> }) =>
  pod.warning.mock.calls.map(([message]) => String(message));

describe("Publish third review regressions", () => {
  it("keeps an unreadable page's live folder during an unrelated rebuild and warns", async () => {
    const pod = await prepared();
    const folder = `${pod.repo.publicUrl(pod.site)}second/`;
    await corrupt(pod, pod.second.url);
    expect((await pod.repo.listPages(pod.site)).invalid).toEqual([{ url: pod.second.url }]);
    pod.warning.mockClear();
    const refreshed = await pod.repo.refreshPublic(pod.site);
    expect(refreshed.data.publicUrl).toBe(pod.repo.publicUrl(pod.site));
    expect(await (await pod.storage.read(`${folder}index.html`)).text()).toContain("<html");
    expect(warnings(pod)).toEqual([expect.stringContaining(pod.second.url)]);
    expect(warnings(pod)[0]).toMatch(/left existing public page folders in place/);
  });
  it("refuses to unpublish a renamed page while its old public path cannot be verified", async () => {
    const pod = await prepared();
    const root = pod.repo.publicUrl(pod.site);
    pod.intercept((url, init) =>
      url === pod.second.url && init.method === "GET"
        ? new Response(null, { status: 403 })
        : undefined,
    );
    const renamed = await pod.repo.publish(
      pod.site,
      pod.first,
      { ...pod.first.data, slug: "moved" },
      false,
    );
    const oldUrl = `${root}${pageData.slug}/index.html`;
    const newUrl = `${root}moved/index.html`;
    const oldVersion = (await pod.storage.head(oldUrl)).etag;
    const newVersion = (await pod.storage.head(newUrl)).etag;
    await expect(pod.repo.unpublish(renamed.site, renamed.page)).rejects.toThrow(
      /couldn't verify all public URLs/,
    );
    expect((await pod.storage.head(oldUrl)).etag).toBe(oldVersion);
    expect((await pod.storage.head(newUrl)).etag).toBe(newVersion);
    expect((await pod.repo.listPages(renamed.site)).items).toEqual([renamed.page]);

    pod.intercept(undefined);
    const result = await pod.repo.unpublish(renamed.site, renamed.page);
    expect(result.page.data.status).toBe("draft");
    await expect(pod.storage.head(oldUrl)).rejects.toMatchObject({ code: "not-found" });
    await expect(pod.storage.head(newUrl)).rejects.toMatchObject({ code: "not-found" });
    expect(await (await pod.storage.read(`${root}second/index.html`)).text()).toContain("<html");
  });
  it("preserves the published site if its only live source has a weak ETag", async () => {
    const pod = await prepared();
    const { site } = await pod.repo.unpublish(pod.site, pod.first);
    const url = pod.repo.publicUrl(site);
    const outputs = ["index.html", "feed.xml", ".acl", "second/index.html"];
    const versions = () =>
      Promise.all(outputs.map(async (name) => (await pod.storage.head(`${url}${name}`)).etag));
    const before = await versions();
    const repo = publishRepository(
      pod.wrap({
        readRdf: async (url, options) => {
          const read = await pod.storage.readRdf(url, options);
          return url === pod.second.url ? { ...read, etag: 'W/"weak"' } : read;
        },
      }),
      pod.fetch,
      owner,
      pod.warning,
    );
    await expect(repo.refreshPublic(site)).resolves.toEqual(site);
    expect(await versions()).toEqual(before);
    expect((await repo.listSites()).items).toEqual([site]);
    expect(warnings(pod)).toEqual([expect.stringContaining(pod.second.url)]);
  });
  it("refuses a slug occupied by an unreadable source's retained HTML before saving", async () => {
    const pod = await prepared();
    const url = `${pod.repo.publicUrl(pod.site)}second/index.html`;
    const before = (await pod.storage.head(url)).etag;
    await corrupt(pod, pod.second.url);
    await expect(
      pod.repo.publish(pod.site, pod.first, { ...pod.first.data, slug: "second" }, false),
    ).rejects.toThrow(/public URL already has a page/);
    expect((await pod.storage.head(url)).etag).toBe(before);
    expect((await pod.repo.listPages(pod.site)).items).toEqual([pod.first]);
  });
  it("preserves a target slug occupied between the source save and the rebuild", async () => {
    const pod = await prepared();
    await corrupt(pod, pod.second.url);
    const siteUrl = pod.repo.publicUrl(pod.site);
    const url = `${siteUrl}moved/index.html`;
    const repo = publishRepository(
      pod.wrap({
        write: async (target, body, options) => {
          const written = await pod.storage.write(target, body, options);
          if (target === pod.first.url) {
            const directory = await pod.storage.create(siteUrl, null, {
              name: "moved",
              kind: "container",
            });
            await pod.storage.create(directory.url, "Another page", {
              name: "index.html",
              contentType: "text/html",
            });
          }
          return written;
        },
      }),
      pod.fetch,
      owner,
      pod.warning,
    );
    await expect(
      repo.publish(pod.site, pod.first, { ...pod.first.data, slug: "moved" }, false),
    ).rejects.toMatchObject({ cause: { message: expect.stringContaining("already has a page") } });
    expect(await (await pod.storage.read(url)).text()).toBe("Another page");
  });
  it("maps an unreadable slug-folder ACL to a PublicationError naming the folder", async () => {
    const pod = await prepared();
    const folder = `${pod.repo.publicUrl(pod.site)}second/`;
    pod.intercept((url) =>
      url === `${folder}.acl` ? new Response(null, { status: 503 }) : undefined,
    );
    const failure = pod.repo.refreshPublic(pod.site);
    await expect(failure).rejects.toBeInstanceOf(PublicationError);
    await expect(failure).rejects.toThrow(`Couldn't read permissions for ${folder}`);
  });
  it("warns when reusing a private slug folder makes its retained files public again", async () => {
    const pod = await prepared();
    const folder = `${pod.repo.publicUrl(pod.site)}second/`;
    await pod.storage.create(folder, "keep this", { name: "extra.txt", contentType: "text/plain" });
    const renamed = await pod.repo.publish(
      pod.site,
      pod.second,
      { ...pod.second.data, slug: "moved" },
      false,
    );
    expect(warnings(pod).some((message) => message.includes("now owner-only"))).toBe(true);
    pod.warning.mockClear();
    const reused = await pod.repo.publish(
      renamed.site,
      renamed.page,
      { ...renamed.page.data, slug: "second" },
      false,
    );
    expect(warnings(pod)).toEqual([
      `Publish reused ${folder}. Files left in this folder by an earlier unpublish are public again.`,
    ]);
    // Once the folder is public again, later rebuilds do not repeat the notice.
    pod.warning.mockClear();
    await pod.repo.refreshPublic(reused.site);
    expect(pod.warning).not.toHaveBeenCalled();
  });
  it("keeps retained files private when their folder listing fails and warns on retry", async () => {
    const pod = await prepared();
    const folder = `${pod.repo.publicUrl(pod.site)}second/`;
    await pod.storage.create(folder, "keep this", { name: "extra.txt", contentType: "text/plain" });
    const renamed = await pod.repo.publish(
      pod.site,
      pod.second,
      { ...pod.second.data, slug: "moved" },
      false,
    );
    const acl = `${folder}.acl`;
    const privateVersion = (await pod.storage.head(acl)).etag;
    const { listAll } = createSolidBackend({ root, fetch: pod.fetch });
    const repo = publishRepository(
      pod.wrap({
        listAll: (url, options) => (url === folder ? listAll : pod.storage.listAll)(url, options),
      }),
      pod.fetch,
      owner,
      pod.warning,
    );
    pod.intercept((url, init) =>
      url === folder && init.method === "GET" ? new Response(null, { status: 503 }) : undefined,
    );
    pod.warning.mockClear();
    await expect(
      repo.publish(renamed.site, renamed.page, { ...renamed.page.data, slug: "second" }, false),
    ).rejects.toMatchObject({ cause: { status: 503 } });
    expect((await pod.storage.head(acl)).etag).toBe(privateVersion);
    expect(pod.warning).not.toHaveBeenCalled();

    pod.intercept(undefined);
    const saved = (await repo.listPages(renamed.site)).items.find(
      (p) => p.url === renamed.page.url,
    );
    if (!saved) throw new Error("Missing source after failed publish");
    await repo.publish(renamed.site, saved, saved.data, false);
    expect(warnings(pod)).toEqual([expect.stringContaining("are public again")]);
  });
  it("does not warn when a private slug folder is reused after its extra files were removed", async () => {
    const pod = await prepared();
    const folder = `${pod.repo.publicUrl(pod.site)}second/`;
    await pod.storage.create(folder, "keep this", { name: "extra.txt", contentType: "text/plain" });
    const renamed = await pod.repo.publish(
      pod.site,
      pod.second,
      { ...pod.second.data, slug: "moved" },
      false,
    );
    const extra = await pod.storage.head(`${folder}extra.txt`);
    await pod.storage.delete(extra.url, { ifMatch: extra.etag as string });
    pod.warning.mockClear();
    await pod.repo.publish(
      renamed.site,
      renamed.page,
      { ...renamed.page.data, slug: "second" },
      false,
    );
    expect(pod.warning).not.toHaveBeenCalled();
  });
  it("warns about an unreadable Type Index once per repository instance", async () => {
    const pod = await prepared();
    pod.intercept((url, init) =>
      url.includes("privateTypeIndex") && init.method === "GET"
        ? new Response(null, { status: 403 })
        : undefined,
    );
    pod.warning.mockClear();
    for (let attempt = 0; attempt < 3; attempt++)
      expect((await pod.repo.listSites()).items.map((s) => s.url)).toEqual([pod.site.url]);
    expect(warnings(pod)).toEqual([expect.stringContaining("private Type Index")]);
    const fresh = vi.fn();
    await publishRepository(pod.storage, pod.fetch, owner, fresh).listSites();
    expect(fresh).toHaveBeenCalledOnce();
  });
});
