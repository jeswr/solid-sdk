// AUTHORED-BY Codex (GPT-6.1 Sol)
import { type RoleGrant, readGrants, setGrants } from "@jeswr/pod-access/roles";
import { createTypeIndex } from "@jeswr/pod-type-index";
import {
  createPodClient,
  type StorageClient,
  StorageError,
  type WriteResult,
} from "@jeswr/storage-client";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import {
  type PageData,
  parsePage,
  parseSite,
  SITE_CLASS,
  type SiteData,
  serializePage,
  serializeSite,
  validatePage,
  validateSite,
} from "./model.js";
import { type RenderSite, renderFeed, renderIndex, renderPage } from "./render.js";
import { assertSlug } from "./slugs.js";

export interface Stored<T> {
  url: string;
  etag: string;
  data: T;
}
export type StoredSite = Stored<SiteData>;
export type StoredPage = Stored<PageData>;
export interface PublishRepository {
  listSites(): Promise<StoredSite[]>;
  listPages(site: StoredSite): Promise<StoredPage[]>;
  createSite(key: string, data: SiteData): Promise<StoredSite>;
  saveSite(site: StoredSite, data: SiteData): Promise<StoredSite>;
  createPage(site: StoredSite, id: string, data: PageData): Promise<StoredPage>;
  savePage(site: StoredSite, page: StoredPage, data: PageData): Promise<StoredPage>;
  publish(
    site: StoredSite,
    page: StoredPage,
    data: PageData,
    confirmed: boolean,
  ): Promise<{ site: StoredSite; page: StoredPage }>;
  unpublish(site: StoredSite, page: StoredPage): Promise<{ site: StoredSite; page: StoredPage }>;
  refreshPublic(site: StoredSite): Promise<StoredSite>;
  publicUrl(site: StoredSite): string;
}
export class PublicationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PublicationError";
  }
}
function missing(error: unknown): boolean {
  return error instanceof StorageError && error.code === "not-found";
}
function validator(etag: string | null): string {
  if (!etag || !/^"[^"\r\n]*"$/.test(etag))
    throw new PublicationError("Your pod did not return a safe version. Reload before saving.");
  return etag;
}
function writtenVersion(result: WriteResult): string {
  if (result.etagSource !== "response")
    throw new PublicationError(
      "The save could not confirm its own version. Reload before editing again.",
    );
  return validator(result.etag);
}
/** All reusable listing, source privacy, Type Index and static I/O stay in the SDK. */
export function publishRepository(
  storage: StorageClient,
  fetch: typeof globalThis.fetch,
  owner: string,
): PublishRepository {
  if (storage.protocol !== "solid")
    throw new PublicationError("Publish needs a Solid pod with stable public file paths.");
  const sourceRoot = new URL("publish/", storage.root).href;
  const roleOptions = { fetch, webId: owner, root: storage.root, model: "wac" as const };
  const manager: RoleGrant = {
    agent: { type: "webid", id: owner },
    role: "manager",
    inherited: false,
    source: "",
  };
  async function permissions(url: string, publicRead: boolean) {
    const options = {
      ...roleOptions,
      kind: url.endsWith("/") ? ("folder" as const) : ("resource" as const),
    };
    const expected = await readGrants(url, options);
    const grants = [
      manager,
      ...(publicRead
        ? [
            {
              agent: { type: "public" as const },
              role: "viewer" as const,
              inherited: false,
              source: "",
            },
          ]
        : []),
    ];
    const result = await setGrants([url], grants, { ...options, expected, ownOnly: true });
    if (result.failed.length)
      throw new PublicationError(
        "Your pod could not confirm the site's permissions. Nothing more was published.",
        { cause: result.failed[0]?.error },
      );
  }
  async function container(parent: string, name: string): Promise<string> {
    const url = new URL(`${name}/`, parent).href;
    try {
      await storage.head(url);
      return url;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    try {
      const made = await storage.create(parent, null, { name, kind: "container" });
      if (made.url !== url) throw new PublicationError("The pod returned a different file path.");
    } catch (error) {
      if (!(error instanceof StorageError && error.code === "conflict")) throw error;
      await storage.head(url);
    }
    return url;
  }
  function siteKey(site: StoredSite): string {
    const key = site.url.slice(sourceRoot.length).split("/")[0] as string;
    assertSlug(key);
    if (site.url !== new URL(`${key}/site.ttl`, sourceRoot).href)
      throw new TypeError("Site is outside Publish storage.");
    return key;
  }
  function pageScope(site: StoredSite, page: StoredPage): void {
    siteKey(site);
    const root = new URL("pages/", site.url).href;
    const id = page.url.slice(root.length, -4);
    if (!/^[a-z0-9-]+$/.test(id) || page.url !== `${root}${id}.ttl`)
      throw new TypeError("Page is outside its site.");
  }
  function publicUrl(site: StoredSite): string {
    return new URL(`public/sites/${siteKey(site)}/`, storage.root).href;
  }
  async function requireCurrent(record: StoredSite | StoredPage) {
    const current = await storage.head(record.url);
    if (validator(current.etag) !== record.etag)
      throw new PublicationError(
        "This item changed elsewhere. Reload before publishing or unpublishing.",
      );
  }
  async function initialise() {
    await container(storage.root, "publish");
    await permissions(sourceRoot, false);
  }
  async function read<T>(
    url: string,
    parse: typeof parseSite | typeof parsePage,
  ): Promise<Stored<T>> {
    await storage.head(url);
    await permissions(url, false);
    const result = await storage.readRdf(url);
    const data = parse(url, result.dataset);
    if (!data)
      throw new PublicationError(
        "A Publish document is invalid. Your pod data has been left in place.",
      );
    return { url, etag: validator(result.etag), data: data as T };
  }
  async function privateCreate(
    parent: string,
    name: string,
    body: string,
  ): Promise<{ url: string; etag: string }> {
    const made = await storage.create(parent, "", { name, contentType: "text/turtle" });
    if (made.url !== new URL(encodeURIComponent(name), parent).href)
      throw new PublicationError("The pod returned a different source path.");
    // Empty placeholders inherit the private parent. Seal the resource before any source bytes.
    await permissions(made.url, false);
    const empty = await storage.read(made.url);
    if ((await empty.text()) !== "")
      throw new PublicationError("This file changed while it was being created.");
    const result = await storage.write(made.url, body, {
      ifMatch: validator(empty.etag),
      contentType: "text/turtle",
    });
    return { url: made.url, etag: writtenVersion(result) };
  }
  // The Type Index owns RDF bootstrap. Its new private files are sealed before content;
  // edits seal index/preferences documents while preserving the public profile's audience.
  const indexStorage: StorageClient = {
    ...storage,
    create: async (parent, body, options) => {
      if (options?.kind === "container") return storage.create(parent, body, options);
      if (!options?.name || typeof body !== "string")
        throw new PublicationError("Unsupported Type Index creation.");
      const created = await privateCreate(parent, options.name, body);
      return { ...created, created: true, etagSource: "response" };
    },
    writeRdf: async (url, dataset, options) => {
      if (url !== owner.split("#")[0]) await permissions(url, false);
      return storage.writeRdf(url, dataset, options);
    },
  };
  const index = createTypeIndex({
    storage: indexStorage,
    features: storage.features,
    profile: owner,
    fetch,
  });
  async function listSites(): Promise<StoredSite[]> {
    await initialise();
    const urls = new Set<string>();
    for await (const entry of storage.listAll(sourceRoot)) {
      if (entry.kind !== "container") continue;
      const key = entry.url.slice(sourceRoot.length, -1);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || key.length > 80) continue;
      await permissions(entry.url, false);
      urls.add(new URL("site.ttl", entry.url).href);
    }
    for (const url of await index.find(SITE_CLASS)) {
      // Discovery hints never widen this app's write boundary.
      try {
        siteKey({ url } as StoredSite);
        urls.add(url);
      } catch {
        /* Foreign models remain untouched. */
      }
    }
    const result: StoredSite[] = [];
    for (const url of urls) {
      try {
        result.push(await read<SiteData>(url, parseSite));
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    return result.sort((a, b) => a.data.name.localeCompare(b.data.name));
  }
  async function listPages(site: StoredSite): Promise<StoredPage[]> {
    siteKey(site);
    const root = new URL("pages/", site.url).href;
    await permissions(new URL("./", site.url).href, false);
    try {
      await storage.head(root);
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
    await permissions(root, false);
    const result: StoredPage[] = [];
    for await (const entry of storage.listAll(root)) {
      if (entry.kind !== "resource" || !/\/[-a-z0-9]+\.ttl$/.test(entry.url)) continue;
      const candidate = { url: entry.url } as StoredPage;
      pageScope(site, candidate);
      result.push(await read<PageData>(entry.url, parsePage));
    }
    return result.sort(
      (a, b) => a.data.position - b.data.position || a.data.slug.localeCompare(b.data.slug),
    );
  }
  async function createSite(key: string, data: SiteData): Promise<StoredSite> {
    assertSlug(key);
    validateSite(data);
    await initialise();
    const root = await container(sourceRoot, key);
    await permissions(root, false);
    const url = new URL("site.ttl", root).href;
    const made = await privateCreate(
      root,
      "site.ttl",
      await serializeSite(url, { ...data, publicUrl: undefined }),
    );
    const site = { ...made, data: validateSite({ ...data, publicUrl: undefined }) };
    await index.register(SITE_CLASS, { instance: made.url });
    return site;
  }
  async function writeSite(site: StoredSite, data: SiteData): Promise<StoredSite> {
    siteKey(site);
    await permissions(site.url, false);
    const valid = validateSite(data);
    const saved = await storage.write(site.url, await serializeSite(site.url, valid), {
      ifMatch: site.etag,
      contentType: "text/turtle",
    });
    return { url: site.url, etag: writtenVersion(saved), data: valid };
  }
  function saveSite(site: StoredSite, data: SiteData): Promise<StoredSite> {
    return writeSite(site, { ...data, publicUrl: site.data.publicUrl });
  }
  async function checkSlug(site: StoredSite, data: PageData, except?: string) {
    const all = await listPages(site);
    if (all.some((p) => p.url !== except && p.data.slug === data.slug))
      throw new TypeError("Another page already uses this URL. Choose a different slug.");
  }
  async function createPage(site: StoredSite, id: string, data: PageData): Promise<StoredPage> {
    assertSlug(id);
    validatePage(data);
    await checkSlug(site, data);
    const root = await container(new URL("./", site.url).href, "pages");
    await permissions(root, false);
    const url = new URL(`${id}.ttl`, root).href;
    const valid = validatePage(data);
    const made = await privateCreate(root, `${id}.ttl`, await serializePage(url, valid));
    return { ...made, data: valid };
  }
  async function savePage(site: StoredSite, page: StoredPage, data: PageData): Promise<StoredPage> {
    pageScope(site, page);
    const valid = validatePage(data);
    await checkSlug(site, valid, page.url);
    await permissions(page.url, false);
    const saved = await storage.write(page.url, await serializePage(page.url, valid), {
      ifMatch: page.etag,
      contentType: "text/turtle",
    });
    return { url: page.url, etag: writtenVersion(saved), data: valid };
  }
  async function output(url: string, body: string, type: string) {
    try {
      const current = await storage.head(url);
      await storage.write(url, body, { ifMatch: validator(current.etag), contentType: type });
    } catch (error) {
      if (!missing(error)) throw error;
      const parent = new URL("./", url).href;
      await storage.create(parent, body, { name: url.slice(parent.length), contentType: type });
    }
  }
  async function remove(url: string) {
    try {
      const current = await storage.head(url);
      await storage.delete(url, { ifMatch: validator(current.etag) });
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
  async function removePageOutput(site: StoredSite, slug: string) {
    assertSlug(slug);
    const directory = new URL(`${slug}/`, publicUrl(site)).href;
    await remove(new URL("index.html", directory).href);
    await remove(directory);
  }
  async function rebuild(site: StoredSite): Promise<StoredSite> {
    const pages = (await listPages(site))
      .map((p) => p.data)
      .filter((p) => p.status === "published");
    const root = publicUrl(site);
    if (!pages.length) {
      await remove(new URL("index.html", root).href);
      await remove(new URL("feed.xml", root).href);
      return writeSite(site, { ...site.data, publicUrl: undefined });
    }
    const publicRoot = await container(storage.root, "public");
    const sites = await container(publicRoot, "sites");
    await container(sites, siteKey(site));
    const renderSite: RenderSite = { ...site.data, publicUrl: root };
    for (const page of pages) {
      const directory = await container(root, page.slug);
      await output(
        new URL("index.html", directory).href,
        renderPage(renderSite, page, pages),
        "text/html; charset=utf-8",
      );
    }
    await output(
      new URL("index.html", root).href,
      renderIndex(renderSite, pages, pages),
      "text/html; charset=utf-8",
    );
    await output(
      new URL("feed.xml", root).href,
      renderFeed(renderSite, pages),
      "application/rss+xml; charset=utf-8",
    );
    // This is the only public grant: the rendered site's own folder and members.
    await permissions(root, true);
    return writeSite(site, { ...site.data, publicUrl: root });
  }
  async function refreshPublic(site: StoredSite): Promise<StoredSite> {
    if (!site.data.publicUrl)
      throw new PublicationError("Confirm publication before creating public files.");
    await requireCurrent(site);
    return rebuild(site);
  }
  async function publish(site: StoredSite, page: StoredPage, data: PageData, confirmed: boolean) {
    pageScope(site, page);
    if (!site.data.publicUrl && !confirmed)
      throw new PublicationError("Confirm that anyone may read this site before publishing.");
    await requireCurrent(site);
    const saved = await savePage(site, page, {
      ...data,
      status: "published",
      published: data.published ?? page.data.published ?? new Date(),
    });
    if (page.data.slug !== saved.data.slug) await removePageOutput(site, page.data.slug);
    try {
      return { page: saved, site: await rebuild(site) };
    } catch (cause) {
      throw new PublicationError(
        "Your source was saved, but publishing did not finish. Reload and publish again to repair the public files.",
        { cause },
      );
    }
  }
  async function unpublish(site: StoredSite, page: StoredPage) {
    pageScope(site, page);
    await requireCurrent(site);
    await requireCurrent(page);
    // Remove public bytes before recording draft status; a failed delete never claims privacy.
    await removePageOutput(site, page.data.slug);
    const saved = await savePage(site, page, { ...page.data, status: "draft" });
    return { page: saved, site: await rebuild(site) };
  }
  return {
    listSites,
    listPages,
    createSite,
    saveSite,
    createPage,
    savePage,
    publish,
    unpublish,
    refreshPublic,
    publicUrl,
  };
}
export async function openPublishRepository(
  fetch: typeof globalThis.fetch,
  root: string,
  owner: string,
  options?: { protocol: "solid" },
): Promise<PublishRepository> {
  if (options?.protocol === "solid")
    return publishRepository(createSolidBackend({ fetch, root }), fetch, owner);
  const { storage } = await createPodClient({ fetch, storage: root });
  return publishRepository(storage, fetch, owner);
}
