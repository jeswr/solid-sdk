// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { readWac } from "@jeswr/pod-access";
import { isRoleError, type RoleGrant, readGrants, setGrants } from "@jeswr/pod-access/roles";
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
export interface PublishListing<T> {
  items: T[];
  invalid: { url: string }[];
}
export interface PublishRepository {
  listSites(): Promise<PublishListing<StoredSite>>;
  listPages(site: StoredSite): Promise<PublishListing<StoredPage>>;
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
export class UnsupportedPublishAccessError extends PublicationError {
  constructor() {
    super("This pod's access control isn't supported by Publish yet.");
  }
}
class InvalidDocumentError extends PublicationError {}
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
  const access = storage.features.accessControl;
  if (access.state === "available" && access.detail.model !== "wac")
    throw new UnsupportedPublishAccessError();
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
    let expected: Awaited<ReturnType<typeof readGrants>>;
    try {
      expected = await readGrants(url, options);
    } catch (error) {
      if (error instanceof TypeError || (isRoleError(error) && error.code === "unsupported"))
        throw new UnsupportedPublishAccessError();
      throw error;
    }
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
  // Read raw WAC modes, including partial/unmapped grants that the roles projection drops.
  // Sources created by Publish have their own ACL; missing/ambiguous ACLs cannot prove privacy.
  async function assertOwnerOnly(url: string) {
    const head = await createSolidBackend({ fetch, root: storage.root }).head(url);
    const links = head.links.get("acl") ?? [];
    const acl = links[0]?.target;
    if (links.length !== 1 || !acl || !storage.isWithinStorage(acl))
      throw new PublicationError("Couldn't verify owner-only source permissions.");
    const policy = readWac((await storage.readRdf(acl)).dataset, url, acl, undefined, true);
    if (
      !policy.grants.length ||
      policy.grants.some(
        (grant) =>
          grant.who.length === 0 ||
          grant.who.some(
            (clause) =>
              clause.length !== 1 || clause[0]?.kind !== "agent" || clause[0].webId !== owner,
          ),
      )
    )
      throw new PublicationError(
        "Publish needs owner-only sources. Remove source sharing before publishing.",
      );
    for (const scope of url.endsWith("/") ? ["resource", "members"] : ["resource"]) {
      const modes = new Set(
        policy.grants
          .filter((g) => g.appliesTo === scope || g.appliesTo === "both")
          .flatMap((g) => [...g.modes]),
      );
      if (
        !["read", "write", "control"].every((mode) =>
          modes.has(mode as "read" | "write" | "control"),
        )
      )
        throw new PublicationError("Couldn't verify owner-only source permissions.");
    }
  }
  async function container(parent: string, name: string, privateSource = false): Promise<string> {
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
      if (privateSource) await permissions(url, false);
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
    await container(storage.root, "publish", true);
  }
  async function read<T>(
    url: string,
    parse: typeof parseSite | typeof parsePage,
  ): Promise<Stored<T>> {
    const result = await storage.readRdf(url);
    const data = parse(url, result.dataset);
    if (!data)
      throw new InvalidDocumentError(
        "A Publish document is invalid. Your pod data has been left in place.",
      );
    return { url, etag: validator(result.etag), data: data as T };
  }
  async function privateCreate(
    parent: string,
    name: string,
    body: string,
  ): Promise<{ url: string; etag: string }> {
    await assertOwnerOnly(parent);
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
  // edits verify index/preferences privacy while preserving the public profile's audience.
  const indexStorage: StorageClient = {
    ...storage,
    create: async (parent, body, options) => {
      if (options?.kind === "container") {
        if (!options.name) throw new PublicationError("Unsupported Type Index creation.");
        const url = await container(parent, options.name, true);
        return {
          url,
          etag: (await storage.head(url)).etag,
          created: true,
          etagSource: "follow-up",
        };
      }
      if (!options?.name || typeof body !== "string")
        throw new PublicationError("Unsupported Type Index creation.");
      const created = await privateCreate(parent, options.name, body);
      return { ...created, created: true, etagSource: "response" };
    },
    writeRdf: async (url, dataset, options) => {
      if (url !== owner.split("#")[0]) await assertOwnerOnly(url);
      return storage.writeRdf(url, dataset, options);
    },
  };
  const index = createTypeIndex({
    storage: indexStorage,
    features: storage.features,
    profile: owner,
    fetch,
  });
  async function listSites(): Promise<PublishListing<StoredSite>> {
    await initialise();
    const urls = new Set<string>();
    for await (const entry of storage.listAll(sourceRoot)) {
      if (entry.kind !== "container") continue;
      const key = entry.url.slice(sourceRoot.length, -1);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || key.length > 80) continue;
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
    const invalid: { url: string }[] = [];
    for (const url of urls) {
      try {
        result.push(await read<SiteData>(url, parseSite));
      } catch (error) {
        if (missing(error)) continue;
        if (
          error instanceof InvalidDocumentError ||
          (error instanceof StorageError &&
            ["not-rdf", "forbidden", "unauthenticated"].includes(error.code))
        )
          invalid.push({ url });
        else throw error;
      }
    }
    return { items: result.sort((a, b) => a.data.name.localeCompare(b.data.name)), invalid };
  }
  async function listPages(site: StoredSite): Promise<PublishListing<StoredPage>> {
    siteKey(site);
    const root = new URL("pages/", site.url).href;
    try {
      await storage.head(root);
    } catch (error) {
      if (missing(error)) return { items: [], invalid: [] };
      throw error;
    }
    const result: StoredPage[] = [];
    const invalid: { url: string }[] = [];
    for await (const entry of storage.listAll(root)) {
      if (entry.kind !== "resource" || !/\/[-a-z0-9]+\.ttl$/.test(entry.url)) continue;
      const candidate = { url: entry.url } as StoredPage;
      pageScope(site, candidate);
      try {
        result.push(await read<PageData>(entry.url, parsePage));
      } catch (error) {
        if (missing(error)) continue;
        if (
          error instanceof InvalidDocumentError ||
          (error instanceof StorageError &&
            ["not-rdf", "forbidden", "unauthenticated"].includes(error.code))
        )
          invalid.push({ url: entry.url });
        else throw error;
      }
    }
    return {
      items: result.sort(
        (a, b) => a.data.position - b.data.position || a.data.slug.localeCompare(b.data.slug),
      ),
      invalid,
    };
  }
  async function createSite(key: string, data: SiteData): Promise<StoredSite> {
    assertSlug(key);
    validateSite(data);
    await initialise();
    const root = await container(sourceRoot, key, true);
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
    const { items: all } = await listPages(site);
    if (all.some((p) => p.url !== except && p.data.slug === data.slug))
      throw new TypeError("Another page already uses this URL. Choose a different slug.");
  }
  async function createPage(site: StoredSite, id: string, data: PageData): Promise<StoredPage> {
    assertSlug(id);
    validatePage(data);
    await checkSlug(site, data);
    const root = await container(new URL("./", site.url).href, "pages", true);
    const url = new URL(`${id}.ttl`, root).href;
    const valid = validatePage(data);
    const made = await privateCreate(root, `${id}.ttl`, await serializePage(url, valid));
    return { ...made, data: valid };
  }
  async function savePage(site: StoredSite, page: StoredPage, data: PageData): Promise<StoredPage> {
    pageScope(site, page);
    const valid = validatePage(data);
    await checkSlug(site, valid, page.url);
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
      const made = await storage.create(parent, body, {
        name: url.slice(parent.length),
        contentType: type,
      });
      if (made.url !== url) throw new PublicationError("The pod returned a different output path.");
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
  async function cleanStaleOutput(site: StoredSite, pages: readonly PageData[]) {
    const root = publicUrl(site);
    const live = new Set(pages.filter((p) => p.status === "published").map((p) => p.slug));
    try {
      await storage.head(root);
    } catch (error) {
      if (missing(error)) return;
      throw error;
    }
    for await (const entry of storage.listAll(root)) {
      if (entry.kind !== "container") continue;
      const slug = entry.url.slice(root.length, -1);
      // Never follow a listing outside this exact site's validated direct slug folders.
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
        slug.length > 80 ||
        entry.url !== new URL(`${slug}/`, root).href
      )
        continue;
      if (!live.has(slug)) await removePageOutput(site, slug);
    }
  }
  async function rebuild(site: StoredSite): Promise<StoredSite> {
    const listing = await listPages(site);
    const pages = listing.items.map((p) => p.data).filter((p) => p.status === "published");
    await cleanStaleOutput(site, pages);
    const root = publicUrl(site);
    if (!pages.length) {
      await remove(new URL("index.html", root).href);
      await remove(new URL("feed.xml", root).href);
      try {
        await storage.head(root);
        await permissions(root, false);
      } catch (error) {
        if (!missing(error)) throw error;
      }
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
    await permissions(root, true);
    return writeSite(site, { ...site.data, publicUrl: root });
  }
  async function verifySources(site: StoredSite) {
    await assertOwnerOnly(sourceRoot);
    await assertOwnerOnly(new URL("./", site.url).href);
    await assertOwnerOnly(site.url);
    const listing = await listPages(site);
    await assertOwnerOnly(new URL("pages/", site.url).href);
    for (const page of listing.items) await assertOwnerOnly(page.url);
  }
  async function refreshPublic(site: StoredSite): Promise<StoredSite> {
    if (!site.data.publicUrl)
      throw new PublicationError("Confirm publication before creating public files.");
    await requireCurrent(site);
    await verifySources(site);
    return rebuild(site);
  }
  async function publish(site: StoredSite, page: StoredPage, data: PageData, confirmed: boolean) {
    pageScope(site, page);
    if (!site.data.publicUrl && !confirmed)
      throw new PublicationError("Confirm that anyone may read this site before publishing.");
    await requireCurrent(site);
    await verifySources(site);
    const saved = await savePage(site, page, {
      ...data,
      status: "published",
      published: data.published ?? page.data.published ?? new Date(),
    });
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
    const listing = await listPages(site);
    await cleanStaleOutput(
      site,
      listing.items.filter((p) => p.url !== page.url).map((p) => p.data),
    );
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
