// AUTHORED-BY Codex GPT-6

import { readWac } from "@jeswr/pod-access";
import { StorageError } from "@jeswr/storage-client";
import { describe, expect, it } from "vitest";
import { publishRepository } from "../src/index.js";
import { owner, pageData, podFixture, root, siteData } from "./fixtures.js";

async function prepared() {
  const pod = await podFixture();
  const repo = publishRepository(pod.storage, pod.fetch, owner);
  const site = await repo.createSite("field", siteData);
  const page = await repo.createPage(site, "first", pageData);
  return { ...pod, repo, site, page };
}
const acl = "http://www.w3.org/ns/auth/acl#";
describe("Publish review regressions", () => {
  it("isolates failed body writes and malformed documents without blocking good sites or slug checks", async () => {
    const pod = await prepared();
    const broken = publishRepository(
      pod.wrap({
        write: async (url, body, options) => {
          if (url.includes("abandoned")) throw new Error("body write failed");
          return pod.storage.write(url, body, options);
        },
      }),
      pod.fetch,
      owner,
    );
    await expect(broken.createSite("abandoned", siteData)).rejects.toThrow("body write failed");
    await expect(
      broken.createPage(pod.site, "abandoned", { ...pageData, slug: "abandoned" }),
    ).rejects.toThrow("body write failed");
    const pagesRoot = new URL("pages/", pod.site.url).href;
    await pod.storage.create(pagesRoot, "not valid Turtle {", {
      name: "malformed.ttl",
      contentType: "text/turtle",
    });
    await pod.storage.create(
      pagesRoot,
      '<https://example.org/x> <https://example.org/p> "foreign".',
      { name: "foreign.ttl", contentType: "text/turtle" },
    );
    expect(await pod.repo.listSites()).toMatchObject({
      items: [pod.site],
      invalid: [{ url: `${root}publish/abandoned/site.ttl` }],
    });
    expect(await pod.repo.listPages(pod.site)).toMatchObject({
      items: [pod.page],
      invalid: [
        { url: `${pagesRoot}abandoned.ttl` },
        { url: `${pagesRoot}foreign.ttl` },
        { url: `${pagesRoot}malformed.ttl` },
      ],
    });
    await expect(
      pod.repo.savePage(pod.site, pod.page, { ...pageData, title: "Still editable" }),
    ).resolves.toMatchObject({ data: { title: "Still editable" } });
  });
  it("reads and saves without ACL writes or acl:Control, preserving owner-added sharing", async () => {
    const pod = await prepared();
    const aclUrl = `${pod.page.url}.acl`;
    const current = await pod.storage.read(aclUrl);
    const shared = `${await current.text()}\n<#append> a <${acl}Authorization>; <${acl}accessTo> <${pod.page.url}>; <${acl}agentClass> <http://xmlns.com/foaf/0.1/Agent>; <${acl}mode> <${acl}Append>.`;
    await pod.storage.write(aclUrl, shared, {
      ifMatch: current.etag as string,
      contentType: "text/turtle",
    });
    const before = pod.calls.length;
    pod.intercept((url) =>
      url.endsWith(".acl") ? new Response(null, { status: 403 }) : undefined,
    );
    expect((await pod.repo.listSites()).items).toHaveLength(1);
    expect((await pod.repo.listPages(pod.site)).items).toHaveLength(1);
    await pod.repo.savePage(pod.site, pod.page, { ...pageData, body: "Private edit" });
    await pod.repo.saveSite(pod.site, { ...siteData, name: "Edited" });
    expect(pod.calls.slice(before).filter((call) => call.url.endsWith(".acl"))).toEqual([]);
    pod.intercept(undefined);
    expect(await (await pod.storage.read(aclUrl)).text()).toBe(shared);
  });
  it.each([
    "Read",
    "Append",
    "Control",
  ])("refuses publication for unmapped public %s grants without modifying ACLs or output", async (mode) => {
    const pod = await prepared();
    const url = `${pod.page.url}.acl`;
    const current = await pod.storage.read(url);
    await pod.storage.write(
      url,
      `${await current.text()}\n<#partial> a <${acl}Authorization>; <${acl}accessTo> <${pod.page.url}>; <${acl}agentClass> <http://xmlns.com/foaf/0.1/Agent>; <${acl}mode> <${acl}${mode}>.`,
      { ifMatch: current.etag as string, contentType: "text/turtle" },
    );
    const before = pod.calls.length;
    await expect(pod.repo.publish(pod.site, pod.page, pageData, true)).rejects.toThrow(
      /owner-only/,
    );
    expect(pod.calls.slice(before).filter((c) => c.method === "PUT")).toEqual([]);
    await expect(pod.storage.head(pod.repo.publicUrl(pod.site))).rejects.toMatchObject({
      code: "not-found",
    });
  });
  it.each([
    "publish/",
    "publish/field/",
    "publish/field/site.ttl",
    "publish/field/pages/",
  ])("accepts verified inherited source access for %s", async (path) => {
    const pod = await prepared();
    const url = `${root}${path}.acl`;
    await pod.storage.delete(url, { ifMatch: (await pod.storage.head(url)).etag as string });
    await expect(pod.repo.publish(pod.site, pod.page, pageData, true)).resolves.toBeDefined();
  });
  it("reports unsupported ACP clearly and refuses it before writes", async () => {
    const pod = await prepared();
    const features = {
      ...pod.storage.features,
      accessControl: {
        state: "available" as const,
        evidence: "fixture",
        detail: { model: "acp" as const },
      },
    };
    expect(() => publishRepository(pod.wrap({ features }), pod.fetch, owner)).toThrow(
      /access control isn't supported/,
    );
    pod.intercept((url, init) =>
      url.endsWith(".acl") && init.method !== "PUT"
        ? new Response(
            `@prefix acp: <http://www.w3.org/ns/solid/acp#>. <> a acp:AccessControlResource; acp:resource <${url.slice(0, -4)}> .`,
            { headers: { "content-type": "text/turtle", etag: '"acp-1"' } },
          )
        : undefined,
    );
    await expect(pod.repo.createSite("acp", siteData)).rejects.toThrow(
      /access control isn't supported/,
    );
  });
  it("repairs an interrupted slug rename, deleting only validated direct folders in this site", async () => {
    const pod = await prepared();
    const published = await pod.repo.publish(pod.site, pod.page, pageData, true);
    const publicRoot = pod.repo.publicUrl(pod.site);
    const oldDirectory = `${publicRoot}${pageData.slug}/`;
    const broken = publishRepository(
      pod.wrap({
        delete: async (url, options) => {
          if (url.startsWith(oldDirectory)) throw new Error("delete failed");
          return pod.storage.delete(url, options);
        },
      }),
      pod.fetch,
      owner,
    );
    await expect(
      broken.publish(
        published.site,
        published.page,
        { ...published.page.data, slug: "new-slug" },
        false,
      ),
    ).rejects.toThrow(/source was saved/);
    expect(await pod.storage.head(`${oldDirectory}index.html`)).toBeDefined();
    const other = await pod.storage.create(`${root}public/sites/`, null, {
      name: "other",
      kind: "container",
    });
    const untouched = await pod.storage.create(other.url, "other site", {
      name: "index.html",
      contentType: "text/html",
    });
    const bad = await pod.storage.create(publicRoot, null, { name: "Bad", kind: "container" });
    await pod.storage.create(bad.url, "unrelated", {
      name: "index.html",
      contentType: "text/html",
    });
    const refreshed = await pod.repo.refreshPublic(published.site);
    await expect(pod.storage.head(oldDirectory)).rejects.toMatchObject({ code: "not-found" });
    expect(await pod.storage.head(untouched.url)).toBeDefined();
    expect(await pod.storage.head(bad.url)).toBeDefined();
    expect(await pod.storage.head(`${publicRoot}new-slug/index.html`)).toBeDefined();
    const page = (await pod.repo.listPages(refreshed)).items[0];
    if (!page) throw new Error("Missing page");
    const done = await pod.repo.unpublish(refreshed, page);
    expect(done.site.data.publicUrl).toBeUndefined();
    const policy = readWac(
      (await pod.storage.readRdf(`${publicRoot}.acl`)).dataset,
      publicRoot,
      `${publicRoot}.acl`,
    );
    expect(policy.grants.flatMap((g) => g.who.flat())).toEqual([{ kind: "agent", webId: owner }]);
    await expect(pod.storage.head(`${publicRoot}new-slug/`)).rejects.toMatchObject({
      code: "not-found",
    });
  });
  it("does not claim a private draft while an old public slug cannot be deleted", async () => {
    const pod = await prepared();
    const published = await pod.repo.publish(pod.site, pod.page, pageData, true);
    const renamed = await pod.repo.savePage(published.site, published.page, {
      ...published.page.data,
      slug: "renamed",
    });
    const broken = publishRepository(
      pod.wrap({
        delete: async () => {
          throw new Error("delete failed");
        },
      }),
      pod.fetch,
      owner,
    );
    await expect(broken.unpublish(published.site, renamed)).rejects.toThrow("delete failed");
    expect((await pod.repo.listPages(published.site)).items[0]?.data.status).toBe("published");
    const done = await pod.repo.unpublish(published.site, renamed);
    expect(done.page.data.status).toBe("draft");
    await expect(
      pod.storage.head(`${pod.repo.publicUrl(pod.site)}${pageData.slug}/`),
    ).rejects.toMatchObject({ code: "not-found" });
  });
  it("revokes public Read after the last page is unpublished", async () => {
    const pod = await prepared();
    const published = await pod.repo.publish(pod.site, pod.page, pageData, true);
    await pod.repo.unpublish(published.site, published.page);
    const url = pod.repo.publicUrl(pod.site);
    const policy = readWac((await pod.storage.readRdf(`${url}.acl`)).dataset, url, `${url}.acl`);
    expect(
      policy.grants.some((g) =>
        g.who.some((clause) => clause.some((who) => who.kind === "public")),
      ),
    ).toBe(false);
  });
  it("refuses unexpected public output locations", async () => {
    const pod = await prepared();
    const broken = publishRepository(
      pod.wrap({
        create: async (parent, body, options) => {
          const created = await pod.storage.create(parent, body, options);
          return options?.name === "index.html"
            ? { ...created, url: `${root}elsewhere.html` }
            : created;
        },
      }),
      pod.fetch,
      owner,
    );
    await expect(broken.publish(pod.site, pod.page, pageData, true)).rejects.toMatchObject({
      cause: { message: "The pod returned a different output path." },
    });
    expect((await pod.repo.listSites()).items[0]?.data.publicUrl).toBeUndefined();
  });
});

describe("fail-closed source and repair error branches", () => {
  it.each([
    "no-link",
    "foreign-link",
    "empty-policy",
  ])("refuses unverifiable source access: %s", async (variant) => {
    const pod = await prepared();
    if (variant === "no-link" || variant === "foreign-link") {
      pod.intercept((url, init) =>
        url === pod.page.url && init.method === "HEAD"
          ? new Response(null, {
              headers:
                variant === "foreign-link"
                  ? { link: '<https://elsewhere.example/private.acl>; rel="acl"' }
                  : {},
            })
          : undefined,
      );
    } else {
      const target = variant === "missing-members" ? `${root}publish/field/pages/` : pod.page.url;
      const url = `${target}.acl`;
      const body =
        variant === "empty-policy"
          ? ""
          : `<#owner> a <${acl}Authorization>; <${acl}accessTo> <${target}>; <${acl}agent> <${owner}>; <${acl}mode> <${acl}Read>, <${acl}Write>.`;
      await pod.storage.write(url, body, {
        ifMatch: (await pod.storage.head(url)).etag as string,
        contentType: "text/turtle",
      });
    }
    await expect(pod.repo.publish(pod.site, pod.page, pageData, true)).rejects.toThrow(
      /owner-only/,
    );
  });
  it("skips facade-invalid and unreadable members while propagating transient resource failures", async () => {
    const pod = await prepared();
    const body = await (await pod.storage.read(pod.page.url)).text();
    const current = await pod.storage.head(pod.page.url);
    await pod.storage.write(pod.page.url, body.replace('"a-good-beginning"', '"Bad slug"'), {
      ifMatch: current.etag as string,
      contentType: "text/turtle",
    });
    expect((await pod.repo.listPages(pod.site)).invalid).toEqual([{ url: pod.page.url }]);
    for (const code of ["forbidden", "unauthenticated", "not-found", "network"] as const) {
      const repo = publishRepository(
        pod.wrap({
          readRdf: async (url, options) => {
            if (url === pod.page.url || url === pod.site.url)
              throw new StorageError(code, { url, method: "GET" });
            return pod.storage.readRdf(url, options);
          },
        }),
        pod.fetch,
        owner,
      );
      if (code === "unauthenticated") {
        await expect(repo.listPages(pod.site)).rejects.toThrow(/Reconnect/);
        await expect(repo.listSites()).rejects.toThrow(/Reconnect/);
      } else if (code === "network") {
        await expect(repo.listPages(pod.site)).rejects.toMatchObject({ code });
        await expect(repo.listSites()).rejects.toMatchObject({ code });
      } else {
        expect((await repo.listPages(pod.site)).invalid).toHaveLength(code !== "not-found" ? 1 : 0);
        expect((await repo.listSites()).invalid).toHaveLength(code !== "not-found" ? 1 : 0);
      }
    }
  });
  it("propagates access transport errors and reports missing ACL discovery clearly", async () => {
    const pod = await prepared();
    pod.intercept((url, init) =>
      init.method === "HEAD" && url.endsWith("broken/") ? new Response(null) : undefined,
    );
    await expect(pod.repo.createSite("broken", siteData)).rejects.toThrow(/owner-only.*broken/);
    pod.intercept((url, init) =>
      init.method === "HEAD" && url.endsWith("offline/")
        ? new Response(null, { status: 503 })
        : undefined,
    );
    await expect(pod.repo.createSite("offline", siteData)).rejects.toThrow(/503/);
  });
  it("propagates output listing failures and grant revocation failures without claiming privacy", async () => {
    const pod = await prepared();
    const published = await pod.repo.publish(pod.site, pod.page, pageData, true);
    const publicRoot = pod.repo.publicUrl(pod.site);
    const broken = publishRepository(
      pod.wrap({
        head: async (url, options) => {
          if (url === publicRoot) throw new Error("offline listing");
          return pod.storage.head(url, options);
        },
      }),
      pod.fetch,
      owner,
    );
    await expect(broken.unpublish(published.site, published.page)).rejects.toThrow(
      "offline listing",
    );
    pod.intercept((url, init) =>
      url === `${publicRoot}.acl` && init.method === "PUT"
        ? new Response(null, { status: 412 })
        : undefined,
    );
    await expect(pod.repo.unpublish(published.site, published.page)).rejects.toThrow(/permissions/);
    // A saved draft is not reported as private after a later cleanup failure.
    expect((await pod.repo.listSites()).items[0]?.data.publicUrl).toBe(publicRoot);
  });
  it("tolerates a public container disappearing after cleanup", async () => {
    const pod = await prepared();
    const published = await pod.repo.publish(pod.site, pod.page, pageData, true);
    const publicRoot = pod.repo.publicUrl(pod.site);
    let reads = 0;
    const repo = publishRepository(
      pod.wrap({
        head: async (url, options) => {
          if (url === publicRoot && ++reads === 3)
            throw new StorageError("not-found", { url, method: "HEAD" });
          return pod.storage.head(url, options);
        },
      }),
      pod.fetch,
      owner,
    );
    expect(
      (await repo.unpublish(published.site, published.page)).site.data.publicUrl,
    ).toBeUndefined();
  });
});
