// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it, vi } from "vitest";
import { PublicationError, publishRepository } from "../src/index.js";
import { owner, pageData, podFixture, siteData } from "./fixtures.js";

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
  it("unpublishes only its own folder while another page is unreadable", async () => {
    const pod = await prepared();
    const root = pod.repo.publicUrl(pod.site);
    await corrupt(pod, pod.second.url);
    pod.warning.mockClear();
    const result = await pod.repo.unpublish(pod.site, pod.first);
    expect(result.page.data.status).toBe("draft");
    await expect(pod.storage.head(`${root}${pageData.slug}/`)).rejects.toMatchObject({
      code: "not-found",
    });
    expect(await (await pod.storage.read(`${root}second/index.html`)).text()).toContain("<html");
    // The rebuild after unpublishing reports the skipped cleanup once.
    expect(warnings(pod)).toEqual([expect.stringContaining(pod.second.url)]);
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
