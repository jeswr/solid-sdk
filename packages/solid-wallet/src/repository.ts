// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { checkOwnerOnly, type OwnerOnlyOptions } from "@jeswr/pod-access";
import { setGrants } from "@jeswr/pod-access/roles";
import { createTypeIndex, type TypeIndex } from "@jeswr/pod-type-index";
import { type StorageClient, StorageError, type WriteResult } from "@jeswr/storage-client";
import { MAX_CREDENTIAL_BYTES, parseCredential } from "./credential.js";
import { WALLET_CLASS, type WalletItemData, walletItem } from "./model.js";
export interface WalletRecord extends WalletItemData {
  url: string;
  etag: string | null;
}
export class WalletPrivacyError extends Error {
  constructor() {
    super(
      "Wallet storage is shared, or its effective access could not be confirmed. Make it owner-only in Permissions before saving documents.",
    );
    this.name = "WalletPrivacyError";
  }
}
export async function limitedText(
  body: ReadableStream<Uint8Array> | null,
  limit = MAX_CREDENTIAL_BYTES,
): Promise<string> {
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new TypeError("The byte limit must be a whole non-negative number");
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) throw new TypeError("This file is too large");
      chunks.push(part.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}
export function createWalletRepository(options: {
  storage: StorageClient;
  fetch: typeof fetch;
  webId: string;
  typeIndex?: TypeIndex;
  /** Supply only from independently trusted deployment configuration. */
  acpDialect?: OwnerOnlyOptions["acpDialect"];
}) {
  const { storage, fetch: transport, webId } = options;
  const base = new URL("wallet/", storage.root).href;
  const roles = { fetch: transport, root: storage.root, kind: "folder" as const };
  const paths = {
    base,
    files: new URL("files/", base).href,
    credentials: new URL("credentials/", base).href,
  };
  const profileDocument = new URL(webId);
  profileDocument.hash = "";
  // The Type Index SDK delegates privacy to its caller. Check every linked
  // preferences/index document, including custom locations, before using it.
  const privateIndexStorage: StorageClient = {
    ...storage,
    async readRdf(url, readOptions) {
      const result = await storage.readRdf(url, readOptions);
      if (url !== profileDocument.href) await privateAccess(url);
      return result;
    },
    async writeRdf(url, dataset, writeOptions) {
      if (url !== profileDocument.href) await privateAccess(url);
      return storage.writeRdf(url, dataset, writeOptions);
    },
    async create(parent, body, createOptions) {
      await privateAccess(parent);
      return storage.create(parent, body, createOptions);
    },
  };
  const index =
    options.typeIndex ??
    createTypeIndex({
      storage: privateIndexStorage,
      features: storage.features,
      profile: webId,
      fetch: transport,
    });
  async function privateAccess(url: string) {
    if (
      !(
        await checkOwnerOnly({
          storage,
          url,
          ownerWebId: webId,
          ...(options.acpDialect ? { acpDialect: options.acpDialect } : {}),
        })
      ).private
    )
      throw new WalletPrivacyError();
  }
  async function container(parent: string, name: string): Promise<string> {
    const expected = new URL(`${name}/`, parent).href;
    try {
      await storage.head(expected);
      return expected;
    } catch (error) {
      if (!(error instanceof StorageError) || error.code !== "not-found") throw error;
    }
    try {
      const created = await storage.create(parent, null, { name, kind: "container" });
      const result = await setGrants(
        [created.url],
        [{ agent: { type: "webid", id: webId }, role: "manager", inherited: false, source: "" }],
        { ...roles, webId, ownOnly: true },
      );
      if (result.failed.length) throw new WalletPrivacyError();
      return created.url;
    } catch (error) {
      if (!(error instanceof StorageError) || error.code !== "conflict") throw error;
      return expected;
    }
  }
  async function assertPrivate() {
    for (const location of Object.values(paths)) await privateAccess(location);
  }
  function itemUrl(value: string): string {
    const safe = assertWithinPodScope(base, value, { allowRoot: false });
    const url = new URL(safe);
    if (url.search || url.hash || !url.pathname.endsWith(".ttl") || new URL(".", url).href !== base)
      throw new TypeError("Not a wallet item");
    return safe;
  }
  async function read(url: string): Promise<WalletRecord> {
    const result = await storage.readRdf(itemUrl(url));
    const data = walletItem.parse(url, result.dataset);
    if (!data) throw new TypeError("This wallet item has invalid metadata");
    return { ...data, url, etag: result.etag };
  }
  async function initialise() {
    if (storage.protocol !== "solid")
      throw new Error("Wallet currently needs Solid storage with readable WAC or ACP permissions");
    const actual = await container(storage.root, "wallet");
    if (actual !== base) throw new Error("The pod assigned an unsupported wallet location");
    await privateAccess(base);
    for (const name of ["files", "credentials"] as const) {
      const actualChild = await container(base, name);
      if (actualChild !== paths[name])
        throw new Error("The pod assigned an unsupported wallet folder");
      await privateAccess(actualChild);
    }
    // The index library requires the private destination to be provisioned by its caller.
    const settings = await container(storage.root, "settings");
    await privateAccess(settings);
    await index.register(WALLET_CLASS, { container: base }, { index: "private" });
  }
  async function list(onInvalidRecord?: (url: string) => void): Promise<WalletRecord[]> {
    await assertPrivate();
    const items: WalletRecord[] = [];
    let scanned = 0;
    for await (const entry of storage.listAll(base, { maxBytes: 2_097_152 })) {
      if (entry.kind === "container" || !entry.url.endsWith(".ttl")) continue;
      if (++scanned > 500)
        throw new Error(
          "This wallet has more than 500 documents; the list could not be loaded completely",
        );
      const url = itemUrl(entry.url);
      try {
        items.push(await read(url));
      } catch (error) {
        if (
          !(error instanceof TypeError) &&
          !(error instanceof StorageError && ["not-rdf", "not-found"].includes(error.code))
        )
          throw error;
        onInvalidRecord?.(url);
      }
    }
    return items;
  }
  // A missing mutation validator requires a fresh HEAD, bound to matching metadata.
  // Never attach another writer's version to our older local representation.
  async function version(item: WalletRecord): Promise<string> {
    if (item.etag) return item.etag;
    const head = await storage.head(item.url);
    if (!head.etag)
      throw new Error("This item has no version; reload it before editing or deleting");
    const current = await read(item.url);
    if (
      current.etag !== head.etag ||
      (await walletItem.serialize(item.url, current)) !==
        (await walletItem.serialize(item.url, item))
    )
      throw new StorageError("precondition-failed", { method: "HEAD", url: item.url });
    return head.etag;
  }
  async function savedRecord(
    data: WalletItemData,
    result: Pick<WriteResult, "url" | "etag" | "etagSource">,
  ): Promise<WalletRecord> {
    const item = { ...data, url: result.url, etag: result.etag };
    if (!item.etag || result.etagSource === "follow-up") {
      item.etag = null;
      // The PUT has already committed; a failed follow-up must not roll it back in the UI.
      try {
        item.etag = await version(item);
      } catch {
        /* Retry validation before the next mutation. */
      }
    }
    return item;
  }
  async function save(
    data: WalletItemData,
    existing?: WalletRecord,
    name?: string,
  ): Promise<WalletRecord> {
    const validationUrl = new URL("validation.ttl", base).href;
    if (!walletItem.parse(validationUrl, walletItem.build(validationUrl, data)))
      throw new TypeError("This document needs a name, valid kind and timestamps");
    await assertPrivate();
    const id = existing?.url;
    if (id) {
      await privateAccess(itemUrl(id));
      const etag = await version(existing);
      const result = await storage.write(id, await walletItem.serialize(id, data), {
        contentType: "text/turtle",
        ifMatch: etag,
      });
      return savedRecord(data, result);
    }
    if (name !== undefined && !/^[a-zA-Z0-9_-]+\.ttl$/.test(name))
      throw new TypeError("Choose a wallet item filename ending in .ttl");
    const created = await storage.create(base, null, {
      name: name ?? `${crypto.randomUUID()}.ttl`,
      contentType: "text/turtle",
    });
    let emptyEtag: string | undefined;
    try {
      const current = await storage.read(created.url);
      if (!current.etag || (await current.bytes()).length !== 0)
        throw new Error("The new record changed before it could be saved");
      emptyEtag = current.etag;
      const result = await storage.write(
        created.url,
        await walletItem.serialize(created.url, data),
        {
          contentType: "text/turtle",
          ifMatch: emptyEtag,
        },
      );
      return savedRecord(data, result);
    } catch (error) {
      // Delete only the exact empty version we observed, never a concurrent update
      // or a successfully committed PUT whose response was lost.
      if (emptyEtag) await storage.delete(created.url, { ifMatch: emptyEtag }).catch(() => {});
      throw error;
    }
  }
  async function remove(item: WalletRecord) {
    await assertPrivate();
    await privateAccess(itemUrl(item.url));
    await storage.delete(item.url, { ifMatch: await version(item) });
    // Blobs and VC resources stay available for undo. Permanent orphan cleanup is separate.
  }
  async function upload(file: Blob) {
    if (
      !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type) ||
      file.size > 10_485_760
    )
      throw new TypeError("Choose a JPEG, PNG, WebP or PDF up to 10 MiB");
    await assertPrivate();
    return (
      await storage.create(paths.files, file, { name: crypto.randomUUID(), contentType: file.type })
    ).url;
  }
  async function storeCredential(source: string) {
    await parseCredential(source);
    await assertPrivate();
    return (
      await storage.create(paths.credentials, source, {
        name: `${crypto.randomUUID()}.json`,
        contentType: "application/ld+json",
      })
    ).url;
  }
  async function credential(url: string) {
    const safe = assertWithinPodScope(paths.credentials, url, { allowRoot: false });
    return limitedText((await storage.read(safe, { accept: "application/ld+json" })).body);
  }
  async function preview(url: string): Promise<Blob> {
    const safe = assertWithinPodScope(paths.files, url, { allowRoot: false });
    const result = await storage.read(safe);
    const type = result.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(type))
      throw new TypeError("This file type cannot be previewed safely");
    const reader = result.body?.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    if (reader)
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 10_485_760) throw new TypeError("Preview is larger than 10 MiB");
          chunks.push(new Uint8Array(part.value));
        }
      } catch (error) {
        void reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
    return new Blob(chunks, { type });
  }
  return {
    ...paths,
    initialise,
    assertPrivate,
    list,
    read,
    save,
    remove,
    upload,
    storeCredential,
    credential,
    preview,
  };
}
export type WalletRepository = ReturnType<typeof createWalletRepository>;
