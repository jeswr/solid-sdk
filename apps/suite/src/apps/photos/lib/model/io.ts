// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf } from "@jeswr/fetch-rdf";
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import { serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore } from "@rdfjs/types";
import { Container } from "@solid/object";
import { DataFactory } from "n3";
import { type Album, buildAlbum, parseAlbum } from "./album.js";
import { buildPhoto, type Photo, parsePhoto, parsePhotos, RestoreReceipt } from "./photograph.js";
import { type ImageEncoder, preparePhoto, type UploadInput } from "./upload.js";
import { documentUrl, httpIri } from "./validation.js";
import { PREFIXES } from "./vocab.js";

export class PhotoIoError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
  ) {
    super(`Photo storage request failed (${status})`);
    this.name = "PhotoIoError";
  }
}
export type Precondition = { create: true } | { etag: string };
function condition(value: Precondition): Record<string, string> {
  if ("create" in value) return { "if-none-match": "*" };
  if (!value.etag.trim()) throw new TypeError("An ETag is required");
  return { "if-match": value.etag };
}

/** Fetch is mandatory, scoped to the app container including redirect hops. */
export function photoStorage(fetch: typeof globalThis.fetch, storage: string) {
  const base = httpIri(storage);
  if (!base.endsWith("/") || new URL(base).hash || new URL(base).search)
    throw new TypeError("Expected a storage container URL");
  const root = new URL("photos/", base).href;
  const scoped = createPodScopedFetch(root, { fetch });
  async function read(url: string) {
    return fetchRdf(documentUrl(url), { fetch: scoped, headers: { "cache-control": "no-cache" } });
  }
  async function put(url: string, body: BodyInit, contentType: string, precondition: Precondition) {
    const response = await scoped(documentUrl(url), {
      method: "PUT",
      headers: { "content-type": contentType, ...condition(precondition) },
      body,
    });
    if (!response.ok) throw new PhotoIoError(url, response.status);
    return { etag: response.headers.get("etag") };
  }
  async function write(url: string, dataset: DatasetCore, precondition: Precondition) {
    return put(
      url,
      await serialize([...dataset], { prefixes: PREFIXES }),
      "text/turtle",
      precondition,
    );
  }
  async function remove(url: string, etag: string) {
    const response = await scoped(documentUrl(url), {
      method: "DELETE",
      headers: condition({ etag }),
    });
    if (!response.ok && response.status !== 404 && response.status !== 410)
      throw new PhotoIoError(url, response.status);
  }
  async function removeBinary(url: string) {
    const response = await scoped(documentUrl(url), { method: "HEAD" });
    if (response.status === 404 || response.status === 410) return;
    if (!response.ok) throw new PhotoIoError(url, response.status);
    const etag = response.headers.get("etag");
    if (!etag) throw new TypeError("Binary deletion requires an ETag");
    await remove(url, etag);
  }
  async function ensureContainers(paths: readonly string[]) {
    for (const path of paths) {
      const url = new URL(path, root).href;
      const response = await scoped(url, {
        method: "PUT",
        headers: {
          "content-type": "text/turtle",
          "if-none-match": "*",
          link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
        },
        body: "",
      });
      if (!response.ok && response.status !== 412) throw new PhotoIoError(url, response.status);
    }
  }
  return {
    root,
    read,
    write,
    remove,
    removeBinary,
    ensureContainers,
    async loadPhoto(url: string) {
      const { dataset, etag } = await read(url);
      return { photo: parsePhoto(url, dataset), dataset, etag };
    },
    async loadPhotos(url: string) {
      const { dataset, etag } = await read(url);
      return { photos: parsePhotos(url, dataset), etag };
    },
    async savePhoto(url: string, photo: Photo, precondition: Precondition) {
      const dataset = buildPhoto(url, photo);
      if ("etag" in precondition) {
        condition(precondition);
        const existing = await read(url);
        if (existing.etag !== precondition.etag) throw new PhotoIoError(url, 412);
        // Supported photo fields are replaceable; completion evidence is durable.
        new RestoreReceipt(`${documentUrl(url)}#it`, dataset, DataFactory).restoreActivity =
          new RestoreReceipt(
            `${documentUrl(url)}#it`,
            existing.dataset,
            DataFactory,
          ).restoreActivity;
      }
      return write(url, dataset, precondition);
    },
    async loadAlbum(url: string) {
      const { dataset, etag } = await read(url);
      return { album: parseAlbum(url, dataset), etag };
    },
    async saveAlbum(url: string, album: Album, precondition: Precondition) {
      return write(url, buildAlbum(url, album), precondition);
    },
    async list(containerUrl: string): Promise<string[]> {
      const { dataset } = await fetchRdf(containerUrl, {
        fetch: scoped,
        headers: { "cache-control": "no-cache" },
      });
      const container = new Container(containerUrl, dataset, DataFactory);
      return [...container.contains].map((resource) => resource.id).sort();
    },
    async uploadPhotos(inputs: readonly UploadInput[], encoder: ImageEncoder, now: string) {
      const uploaded = [];
      // Prepare before creating/writing resources, so invalid inputs do not publish metadata.
      for (const input of inputs) {
        const prepared = await preparePhoto(storage, input, encoder, now);
        await ensureContainers(["", "originals/", "thumbs/", "items/"]);
        await put(prepared.photo.contentUrl, prepared.original, prepared.original.type, {
          create: true,
        });
        await put(prepared.photo.thumbnailUrl as string, prepared.thumbnail, "image/webp", {
          create: true,
        });
        const result = await write(prepared.itemUrl, buildPhoto(prepared.itemUrl, prepared.photo), {
          create: true,
        });
        uploaded.push({ ...prepared, ...result });
      }
      return uploaded;
    },
  };
}
export type PhotoStorage = ReturnType<typeof photoStorage>;
