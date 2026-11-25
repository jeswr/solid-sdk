// AUTHORED-BY Claude Sonnet 5.5
import type { StorageClient } from "@jeswr/storage-client";
import { describe, expect, it, vi } from "vitest";
import { PublicationError, publishRepository, RetainedFilesError } from "../src/index.js";
import { editSourceDirectly, owner, pageData, podFixture, siteData } from "./fixtures.js";

/** Counts every write path of the storage client plus raw non-read requests (ACL changes). */
function counted(pod: Awaited<ReturnType<typeof podFixture>>, base: StorageClient = pod.storage) {
  const writes: string[] = [];
  const note = (kind: string) => (url: string) => writes.push(`${kind} ${url}`);
  const storage: StorageClient = {
    ...base,
    write: async (url, body, options) => {
      note("write")(url);
      return base.write(url, body, options);
    },
    create: async (parent, body, options) => {
      note("create")(`${parent}${options?.name ?? ""}`);
      return base.create(parent, body, options);
    },
    delete: async (url, options) => {
      note("delete")(url);
      return base.delete(url, options);
    },
  };
  const start = pod.calls.length;
  return {
    storage,
    /** Every mutation since this helper was created, including ACL writes made via fetch. */
    mutations: () => [
      ...writes,
      ...pod.calls
        .slice(start)
        .filter(({ method }) => !["GET", "HEAD"].includes(method))
        .map(({ method, url }) => `${method} ${url}`),
    ],
  };
}
async function prepared() {
  const pod = await podFixture();
  const warning = vi.fn();
  const repo = publishRepository(pod.storage, pod.fetch, owner, warning);
  const site = await repo.createSite("field", siteData);
  const first = await repo.createPage(site, "first", pageData);
  const second = await repo.createPage(site, "second", {
    ...pageData,
    slug: "second",
    title: "Second",
    position: 1,
  });
  return { ...pod, warning, repo, site, first, second };
}
const html = async (storage: StorageClient, url: string) => (await storage.read(url)).text();

describe("nothing becomes public without an explicit publish", () => {
  it("refuses savePage on a published page and keeps the public copy and source unchanged", async () => {
    const pod = await prepared();
    const published = await pod.repo.publish(pod.site, pod.first, pod.first.data, true);
    const page = `${pod.repo.publicUrl(pod.site)}${pageData.slug}/index.html`;
    const before = await html(pod.storage, page);
    const edit = { ...published.page.data, body: "Not yet for the world" };
    const counter = counted(pod);
    const refused = publishRepository(counter.storage, pod.fetch, owner).savePage(
      published.site,
      published.page,
      edit,
    );
    await expect(refused).rejects.toBeInstanceOf(PublicationError);
    await expect(refused).rejects.toThrow(/published.*publish/);
    expect(counter.mutations()).toEqual([]);
    // A later site-wide refresh publishes only what was explicitly published.
    const refreshed = await pod.repo.refreshPublic(published.site);
    expect(await html(pod.storage, page)).toBe(before);
    expect(await html(pod.storage, page)).not.toContain("Not yet for the world");
    // The explicit step does publish it.
    await pod.repo.publish(refreshed, published.page, edit, false);
    expect(await html(pod.storage, page)).toContain("Not yet for the world");
  });
  it("createPage always creates a draft: a published status is refused and nothing is written", async () => {
    const pod = await prepared();
    const before = pod.calls.length;
    const attempt = pod.repo.createPage(pod.site, "sneaky", {
      ...pageData,
      slug: "sneaky",
      status: "published",
      published: new Date("2026-01-01T00:00:00Z"),
    });
    await expect(attempt).rejects.toBeInstanceOf(PublicationError);
    await expect(attempt).rejects.toThrow(/private draft/);
    expect(
      pod.calls.slice(before).filter((call) => call.method !== "GET" && call.method !== "HEAD"),
    ).toEqual([]);
    // A rebuild triggered by publishing another page does not publish it either.
    await pod.repo.publish(pod.site, pod.first, pod.first.data, true);
    const page = `${pod.repo.publicUrl(pod.site)}sneaky/index.html`;
    await expect(pod.storage.head(page)).rejects.toMatchObject({ code: "not-found" });
  });
  it("judges the stored page, not the caller's copy, and every status transition", async () => {
    const pod = await prepared();
    const published = await pod.repo.publish(pod.site, pod.first, pod.first.data, true);
    const forged = {
      ...published.page,
      data: { ...published.page.data, status: "draft" as const },
    };
    await expect(
      pod.repo.savePage(published.site, forged, { ...forged.data, body: "sneaky" }),
    ).rejects.toThrow(/published/);
    // Unpublishing or publishing through savePage would skip the public side of the change.
    await expect(
      pod.repo.savePage(published.site, published.page, {
        ...published.page.data,
        status: "draft",
      }),
    ).rejects.toThrow(/Use publish/);
    await expect(
      pod.repo.savePage(pod.site, pod.second, {
        ...pod.second.data,
        status: "published",
        published: new Date(),
      }),
    ).rejects.toThrow(/Use publish/);
    const stored = (await pod.repo.listPages(published.site)).items.find(
      (p) => p.url === published.page.url,
    );
    expect(stored?.data.body).toBe(pageData.body);
    expect(stored?.data.status).toBe("published");
    // Drafts keep saving freely.
    const draft = await pod.repo.savePage(pod.site, pod.second, {
      ...pod.second.data,
      body: "Draft edit",
    });
    expect(draft.data.body).toBe("Draft edit");
  });
  it("still lets a published page be re-ordered, which changes no content", async () => {
    const pod = await prepared();
    const one = await pod.repo.publish(pod.site, pod.first, pod.first.data, true);
    const two = await pod.repo.publish(one.site, pod.second, pod.second.data, false);
    const moved = await pod.repo.savePage(two.site, one.page, { ...one.page.data, position: 5 });
    expect(moved.data.position).toBe(5);
    const refreshed = await pod.repo.refreshPublic(two.site);
    const index = await html(pod.storage, `${pod.repo.publicUrl(refreshed)}index.html`);
    expect(index.indexOf("Second")).toBeLessThan(index.indexOf("A good beginning"));
    // A position change bundled with a content change is still refused.
    await expect(
      pod.repo.savePage(refreshed, moved, { ...moved.data, position: 9, body: "also edited" }),
    ).rejects.toThrow(/Use publish/);
  });
});

describe("retained files are refused before any public write", () => {
  async function withRetained() {
    const pod = await prepared();
    const one = await pod.repo.publish(pod.site, pod.first, pod.first.data, true);
    const two = await pod.repo.publish(one.site, pod.second, pod.second.data, false);
    const folder = `${pod.repo.publicUrl(pod.site)}second/`;
    await pod.storage.create(folder, "keep this", { name: "extra.txt", contentType: "text/plain" });
    // Unpublish keeps the folder (owner-only) because it holds an unrelated file.
    const draft = await pod.repo.unpublish(two.site, two.page);
    return { ...pod, one, folder, draft };
  }
  it("refuses a whole-site refresh when any rewritten page's folder holds retained files", async () => {
    const pod = await withRetained();
    // The second page's source is published again out of band; its folder is still retained.
    await editSourceDirectly(pod.storage, pod.draft.page, {
      ...pod.draft.page.data,
      status: "published",
      published: pod.draft.page.data.modified,
    });
    const counter = counted(pod);
    const repo = publishRepository(counter.storage, pod.fetch, owner, pod.warning);
    const refused = repo.refreshPublic(pod.draft.site);
    await expect(refused).rejects.toBeInstanceOf(RetainedFilesError);
    await expect(refused).rejects.toMatchObject({ directory: pod.folder });
    // The first page, which is not retained, was not rewritten either.
    expect(counter.mutations()).toEqual([]);
    expect(pod.warning).not.toHaveBeenCalledWith(expect.stringContaining("public again"));
  });
  it("refuses publish before saving the source, and succeeds once the files are gone", async () => {
    const pod = await withRetained();
    const counter = counted(pod);
    const repo = publishRepository(counter.storage, pod.fetch, owner, pod.warning);
    await expect(
      repo.publish(pod.draft.site, pod.draft.page, pod.draft.page.data, false),
    ).rejects.toBeInstanceOf(RetainedFilesError);
    expect(counter.mutations()).toEqual([]);
    const extra = await pod.storage.head(`${pod.folder}extra.txt`);
    await pod.storage.delete(extra.url, { ifMatch: extra.etag as string });
    const done = await repo.publish(pod.draft.site, pod.draft.page, pod.draft.page.data, false);
    expect(done.page.data.status).toBe("published");
    expect(await html(pod.storage, `${pod.folder}index.html`)).toContain("Second");
    // The folder is public again, so later rebuilds neither refuse nor re-widen it.
    await repo.refreshPublic(done.site);
  });
  it("rechecks immediately before widening a folder in case files appear in between", async () => {
    const pod = await withRetained();
    const real = pod.storage.listAll.bind(pod.storage);
    let listings = 0;
    const racing = pod.wrap({
      listAll: (url, options) => {
        if (url !== pod.folder) return real(url, options);
        // The two read-only pre-checks see an empty folder; the look right before widening finds a file that arrived since.
        return listings++ < 2 ? (async function* () {})() : real(url, options);
      },
    });
    const counter = counted(pod, racing);
    const repo = publishRepository(counter.storage, pod.fetch, owner, pod.warning);
    await expect(
      repo.publish(pod.draft.site, pod.draft.page, pod.draft.page.data, false),
    ).rejects.toMatchObject({ cause: expect.any(RetainedFilesError) });
    expect(listings).toBe(3);
    // The folder's ACL was never widened.
    expect(counter.mutations().filter((entry) => entry.includes(`${pod.folder}.acl`))).toEqual([]);
  });
  it("does not check pages whose public HTML is kept because a source is unreadable", async () => {
    const pod = await withRetained();
    const corrupt = await pod.storage.head(pod.draft.page.url);
    await pod.storage.write(pod.draft.page.url, "<#x> <#y> <#z>.", {
      ifMatch: corrupt.etag as string,
      contentType: "text/turtle",
    });
    // Page two's source is unreadable and its folder holds a retained file; page one rebuilds.
    await pod.storage.create(`${pod.folder}`, "<html>", {
      name: "index.html",
      contentType: "text/html",
    });
    await pod.repo.refreshPublic(pod.draft.site);
  });
});

describe("a WebID outside the storage", () => {
  const external = "https://id.example/card#me";
  it("opens Publish, lists and saves without a Type Index, and says registration was skipped", async () => {
    const pod = await podFixture(external);
    const warning = vi.fn();
    const repo = publishRepository(pod.storage, pod.fetch, external, warning);
    expect((await repo.listSites()).items).toEqual([]);
    const site = await repo.createSite("field", siteData);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("private Type Index registration failed"),
    );
    expect((await repo.listSites()).items.map((s) => s.url)).toEqual([site.url]);
    const page = await repo.createPage(site, "first", pageData);
    const result = await repo.publish(site, page, page.data, true);
    expect(result.site.data.publicUrl).toBe(repo.publicUrl(site));
    expect(await html(pod.storage, `${repo.publicUrl(site)}${pageData.slug}/index.html`)).toContain(
      "Welcome",
    );
  });
});
