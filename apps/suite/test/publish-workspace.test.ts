// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  type PageData,
  PublicationError,
  type PublishRepository,
  type SiteData,
  type StoredPage,
  type StoredSite,
} from "@jeswr/solid-publish";
import { describe, expect, it, vi } from "vitest";
import { createPublishWorkspace } from "../src/apps/publish/state/workspace";

const root = "https://pod.example/";
const at = new Date("2026-11-10T10:00:00Z");
const siteData: SiteData = {
  name: "Notes",
  description: "A sample",
  author: "Robin Fiction",
  theme: "paper",
  inLanguage: "en-GB",
  created: at,
  modified: at,
};
const pageData: PageData = {
  title: "Title",
  slug: "title",
  body: "",
  summary: "",
  kind: "page",
  status: "draft",
  position: 0,
  modified: at,
};
function fixture() {
  let revision = 0;
  const site: StoredSite = {
    url: `${root}publish/notes/site.ttl`,
    etag: '"site-0"',
    data: siteData,
  };
  const first: StoredPage = {
    url: `${root}publish/notes/pages/first.ttl`,
    etag: '"page-0"',
    data: pageData,
  };
  const second: StoredPage = {
    ...first,
    url: `${root}publish/notes/pages/second.ttl`,
    data: { ...pageData, title: "Second", slug: "second", position: 1 },
  };
  const sites = [site];
  const pages = [first, second];
  const repo: PublishRepository = {
    listSites: vi.fn(async () => ({ items: sites, invalid: [] })),
    listPages: vi.fn(async () => ({ items: pages, invalid: [] })),
    createSite: vi.fn(async (key, data) => ({
      url: `${root}publish/${key}/site.ttl`,
      data,
      etag: `"site-${++revision}"`,
    })),
    createPage: vi.fn(async (site, id, data) => ({
      url: new URL(`pages/${id}.ttl`, site.url).href,
      data,
      etag: `"page-${++revision}"`,
    })),
    saveSite: vi.fn(async (site, data) => ({
      ...site,
      data: { ...data, ...(site.data.publicUrl ? { publicUrl: site.data.publicUrl } : {}) },
      etag: `"site-${++revision}"`,
    })),
    savePage: vi.fn(async (_site, page, data) => ({ ...page, data, etag: `"page-${++revision}"` })),
    publish: vi.fn(async (site, page, data) => ({
      site: { ...site, data: { ...site.data, publicUrl: `${root}public/sites/notes/` } },
      page: {
        ...page,
        data: { ...data, status: "published", published: at },
        etag: `"page-${++revision}"`,
      },
    })),
    unpublish: vi.fn(async (site, page) => ({
      site,
      page: { ...page, data: { ...page.data, status: "draft" }, etag: `"page-${++revision}"` },
    })),
    refreshPublic: vi.fn(async (site) => ({ ...site, etag: `"site-${++revision}"` })),
    publicUrl: () => `${root}public/sites/notes/`,
  };
  const failure = vi.fn();
  const workspace = createPublishWorkspace(repo, root, failure);
  return { repo, workspace, site, first, second, failure };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe("Publish optimistic workspace", () => {
  it("loads sites and pages, creates them optimistically, and keeps returned validators", async () => {
    const { repo, workspace, site } = fixture();
    const listener = vi.fn();
    const off = workspace.subscribe(listener);
    expect(workspace.getSnapshot().status).toBe("loading");
    await workspace.load();
    expect(workspace.getSnapshot().sites).toHaveLength(1);
    const created = workspace.createSite("new", { ...siteData, name: "New" });
    expect(workspace.getSnapshot().sites).toHaveLength(2);
    expect(workspace.getSnapshot().pending).toBe(1);
    await created.saved;
    const page = workspace.createPage(created.url, "new-page", pageData);
    expect(workspace.getSnapshot().pages[created.url]?.[0]?.url).toBe(page.url);
    await page.saved;
    expect(workspace.getSnapshot().pages[created.url]?.[0]?.etag).toMatch(/^"page/);
    expect(repo.createPage).toHaveBeenCalled();
    expect(listener).toHaveBeenCalled();
    off();
    const count = listener.mock.calls.length;
    await workspace.settings(site.url, { ...siteData, name: "Renamed" });
    expect(listener).toHaveBeenCalledTimes(count);
    expect(workspace.getSnapshot().sites.find((s) => s.url === site.url)?.data.name).toBe(
      "Renamed",
    );
    expect(repo.refreshPublic).not.toHaveBeenCalled();
  });
  it("serialises writes and rolls back an old failure while retaining newer intent", async () => {
    const { workspace, repo, first, site, failure } = fixture();
    await workspace.load();
    const slow = deferred<StoredPage>();
    vi.mocked(repo.savePage).mockImplementationOnce(() => slow.promise);
    const old = workspace.savePage(site.url, first.url, { ...pageData, title: "Older" }, "draft");
    const latest = workspace.savePage(
      site.url,
      first.url,
      { ...pageData, title: "Newer" },
      "draft",
    );
    expect(
      workspace.getSnapshot().pages[site.url]?.find((p) => p.url === first.url)?.data.title,
    ).toBe("Newer");
    await Promise.resolve();
    expect(repo.savePage).toHaveBeenCalledTimes(1);
    slow.reject(new Error("network"));
    expect(await old).toBe(false);
    expect(await latest).toBe(true);
    expect(workspace.getSnapshot().pending).toBe(0);
    expect(
      workspace.getSnapshot().pages[site.url]?.find((p) => p.url === first.url)?.data.title,
    ).toBe("Newer");
    expect(failure).toHaveBeenCalledOnce();
    expect(vi.mocked(repo.savePage).mock.calls[1]?.[1].etag).toBe(first.etag);
    vi.mocked(repo.savePage).mockRejectedValueOnce(new TypeError("Invalid slug"));
    expect(await workspace.savePage(site.url, first.url, pageData, "draft")).toBe(false);
    expect(failure).toHaveBeenLastCalledWith("Invalid slug");
    vi.mocked(repo.savePage).mockRejectedValueOnce(
      new PublicationError("Publication needs repair"),
    );
    await workspace.savePage(site.url, first.url, pageData, "draft");
    expect(failure).toHaveBeenLastCalledWith("Publication needs repair");
  });
  it("publishes, updates settings, reorders, and unpublishes with current records", async () => {
    const { workspace, repo, site, first, second } = fixture();
    await workspace.load();
    await workspace.reorder(site.url, [first.url]);
    expect(repo.refreshPublic).not.toHaveBeenCalled();
    expect(await workspace.reorder("missing-site", [])).toBe(false);
    const publishing = workspace.savePage(site.url, first.url, pageData, "publish", true);
    expect(
      workspace.getSnapshot().pages[site.url]?.find((p) => p.url === first.url)?.data.status,
    ).toBe("published");
    await publishing;
    expect(repo.publish).toHaveBeenCalledWith(site, first, pageData, true);
    const savingSettings = workspace.settings(site.url, { ...siteData, name: "Settings" });
    expect(
      workspace.getSnapshot().sites.find((s) => s.url === site.url)?.data.publicUrl,
    ).toBeDefined();
    await savingSettings;
    expect(repo.refreshPublic).toHaveBeenCalledOnce();
    await workspace.reorder(site.url, [second.url, first.url]);
    expect(workspace.getSnapshot().pages[site.url]?.map((p) => p.url)).toEqual([
      second.url,
      first.url,
    ]);
    const count = vi.mocked(repo.savePage).mock.calls.length;
    await workspace.reorder(site.url, [second.url, first.url]);
    expect(repo.savePage).toHaveBeenCalledTimes(count);
    await workspace.savePage(site.url, first.url, pageData, "unpublish");
    expect(repo.unpublish).toHaveBeenCalledOnce();
    expect(
      workspace.getSnapshot().pages[site.url]?.find((p) => p.url === first.url)?.data.status,
    ).toBe("draft");
  });
  it("does not notify an account about a late failed write after disposal", async () => {
    const { workspace, repo, first, site, failure } = fixture();
    await workspace.load();
    const slow = deferred<StoredPage>();
    vi.mocked(repo.savePage).mockImplementationOnce(() => slow.promise);
    const saving = workspace.savePage(site.url, first.url, pageData, "draft");
    await Promise.resolve();
    workspace.dispose();
    slow.reject(new Error("late failure"));
    expect(await saving).toBe(false);
    expect(failure).not.toHaveBeenCalled();
  });
  it("finishes queued dependent writes after disposal without notifying unmounted listeners", async () => {
    const { repo, workspace } = fixture();
    await workspace.load();
    const slow = deferred<StoredSite>();
    vi.mocked(repo.createSite).mockImplementationOnce(() => slow.promise);
    const created = workspace.createSite("new", siteData);
    const child = workspace.createPage(created.url, "child", pageData);
    const listener = vi.fn();
    workspace.subscribe(listener);
    await Promise.resolve();
    workspace.dispose();
    slow.resolve({ url: created.url, etag: '"created"', data: siteData });
    expect(await created.saved).toBe(true);
    expect(await child.saved).toBe(true);
    expect(repo.createPage).toHaveBeenCalledWith(
      expect.objectContaining({ url: created.url, etag: '"created"' }),
      "child",
      pageData,
    );
    expect(listener).not.toHaveBeenCalled();
  });
  it("keeps unreadable-item diagnostics and specific unsupported-access errors", async () => {
    const { workspace, repo } = fixture();
    vi.mocked(repo.listSites).mockResolvedValueOnce({ items: [], invalid: [{ url: "bad-site" }] });
    await workspace.load();
    expect(workspace.getSnapshot().invalid).toEqual([{ url: "bad-site" }]);
    vi.mocked(repo.listSites).mockRejectedValueOnce(
      new PublicationError("This pod's access control isn't supported by Publish yet."),
    );
    await workspace.load();
    expect(workspace.getSnapshot().error).toContain("isn't supported");
  });
  it("never changes post positions when asked to reorder mixed content", async () => {
    const { workspace, repo, first, second, site } = fixture();
    const post = {
      ...first,
      url: new URL("pages/post.ttl", site.url).href,
      data: { ...pageData, kind: "post" as const, position: 1 },
    };
    vi.mocked(repo.listPages).mockResolvedValueOnce({
      items: [first, post, second],
      invalid: [{ url: "bad-page" }],
    });
    await workspace.load();
    expect(workspace.getSnapshot().invalid).toEqual([{ url: "bad-page" }]);
    await workspace.reorder(site.url, [second.url, post.url, first.url]);
    expect(vi.mocked(repo.savePage).mock.calls.map((call) => call[1].url)).toEqual([
      second.url,
      first.url,
    ]);
    expect(
      workspace.getSnapshot().pages[site.url]?.find((p) => p.url === post.url)?.data.position,
    ).toBe(1);
  });
  it("rejects dependant operations after failed creates without leaving false UI state", async () => {
    const { repo, workspace, site, failure } = fixture();
    await workspace.load();
    vi.mocked(repo.createSite).mockRejectedValueOnce(new Error("offline"));
    const created = workspace.createSite("bad", siteData);
    const child = workspace.createPage(created.url, "child", pageData);
    await created.saved;
    await child.saved;
    expect(workspace.getSnapshot().sites.some((s) => s.url === created.url)).toBe(false);
    expect(workspace.getSnapshot().pages[created.url]).toBeUndefined();
    expect(failure).toHaveBeenCalledTimes(2);
    expect(
      await workspace.savePage(site.url, "https://pod.example/missing", pageData, "draft"),
    ).toBe(false);
    expect(await workspace.savePage("missing-site", "missing", pageData, "publish")).toBe(false);
    expect(await workspace.settings("missing-site", siteData)).toBe(false);
  });
  it("fences stale loads, retains loaded data on reconnect failures, and disposes safely", async () => {
    const { repo, workspace, site } = fixture();
    const slow = deferred<{ items: StoredSite[]; invalid: { url: string }[] }>();
    vi.mocked(repo.listSites).mockImplementationOnce(() => slow.promise);
    const older = workspace.load();
    await workspace.load();
    const mutation = workspace.settings(site.url, { ...siteData, name: "New" });
    await workspace.load();
    slow.resolve({ items: [{ ...site, data: { ...siteData, name: "Stale" } }], invalid: [] });
    await older;
    await mutation;
    expect(workspace.getSnapshot().sites[0]?.data.name).toBe("New");
    vi.mocked(repo.listSites).mockRejectedValueOnce(new Error("offline"));
    await workspace.load();
    expect(workspace.getSnapshot().status).toBe("ready");
    expect(workspace.getSnapshot().error).toContain("Couldn't open");
    const listener = vi.fn();
    workspace.subscribe(listener);
    workspace.dispose();
    await workspace.settings(site.url, siteData);
    expect(listener).not.toHaveBeenCalled();
    await workspace.load();
    expect(workspace.getSnapshot().status).toBe("ready");
    const fresh = fixture();
    vi.mocked(fresh.repo.listSites).mockRejectedValueOnce(new Error("offline"));
    await fresh.workspace.load();
    expect(fresh.workspace.getSnapshot().status).toBe("error");
    const pending = deferred<{ items: StoredSite[]; invalid: { url: string }[] }>();
    vi.mocked(fresh.repo.listSites).mockImplementationOnce(() => pending.promise);
    const reading = fresh.workspace.load();
    fresh.workspace.dispose();
    pending.reject(new Error("late"));
    await reading;
    expect(fresh.workspace.getSnapshot().status).toBe("error");
  });
});
