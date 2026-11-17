// AUTHORED-BY Codex GPT-6.1-Sol
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { Parser, Store } from "n3";
import type { MemoryPod } from "./testing.js";

/** Memory StorageClient plus synchronous snapshots for existing adapter assertions. */
export async function storageMemoryPod(
  root: string,
  profileUrl: string,
  profile: string,
): Promise<MemoryPod> {
  const memory = createMemoryStorage({ protocol: "solid", root });
  const snapshots = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const plain = (url: string) => url.split("#", 1)[0] as string;
  async function snapshot(url: string): Promise<void> {
    const result = await memory.read(url);
    if (result.kind === "resource")
      snapshots.set(url, {
        bytes: await result.bytes(),
        contentType: result.contentType as string,
      });
    pod.putCount++;
  }
  const storage: StorageClient = {
    ...memory,
    async create(container, body, opts) {
      const result = await memory.create(container, body, opts);
      await snapshot(result.url);
      return result;
    },
    async write(url, body, opts) {
      const result = await memory.write(url, body, opts);
      await snapshot(url);
      return result;
    },
    async writeRdf(url, dataset, opts) {
      const result = await memory.writeRdf(url, dataset, opts);
      await snapshot(url);
      return result;
    },
    async delete(url, opts) {
      await memory.delete(url, opts);
      snapshots.delete(url);
    },
  };
  const pod: MemoryPod = {
    storage,
    putCount: 0,
    get(url) {
      const value = snapshots.get(plain(url));
      return value
        ? value.contentType === "text/turtle" || value.contentType === "application/json"
          ? new TextDecoder().decode(value.bytes)
          : ""
        : undefined;
    },
    bytes: (url) => {
      const value = snapshots.get(plain(url));
      return value &&
        value.contentType !== "text/turtle" &&
        value.contentType !== "application/json"
        ? value.bytes
        : undefined;
    },
    contentType: (url) => snapshots.get(plain(url))?.contentType,
    dataset: (url) => new Store(new Parser({ baseIRI: plain(url) }).parse(pod.get(url) ?? "")),
    urls: () => [...snapshots.keys()].sort(),
    async fetch(input, init) {
      const request = new Request(input, init);
      const url = plain(request.url);
      const method = request.method;
      try {
        if (method === "GET" || method === "HEAD") {
          const result = await storage.read(url, { signal: request.signal });
          return new Response(
            method === "HEAD" ? null : ((await result.bytes()) as Uint8Array<ArrayBuffer>),
            {
              headers: {
                etag: result.etag as string,
                "content-type": result.contentType as string,
              },
            },
          );
        }
        if (method === "PUT") {
          const contentType = request.headers.get("content-type") ?? "text/turtle";
          const body = new Uint8Array(await request.arrayBuffer());
          let etag = request.headers.get("if-match");
          if (!etag && request.headers.get("if-none-match") !== "*") {
            try {
              etag = (await storage.head(url)).etag;
            } catch (error) {
              if (!(error instanceof StorageError) || error.status !== 404) throw error;
            }
          }
          const result = etag
            ? await storage.write(url, body, { contentType, ifMatch: etag })
            : await storage.create(new URL(".", url).href, body, {
                contentType,
                exactUrl: url,
              });
          return new Response(null, {
            status: result.created ? 201 : 205,
            headers: { etag: result.etag as string },
          });
        }
        if (method === "DELETE") {
          const etag = request.headers.get("if-match") ?? (await storage.head(url)).etag;
          await storage.delete(url, { ifMatch: etag as string });
          return new Response(null, { status: 205 });
        }
        return new Response(null, { status: 405 });
      } catch (error) {
        if (!(error instanceof StorageError) || error.status === null) throw error;
        return new Response(null, { status: error.code === "conflict" ? 412 : error.status });
      }
    },
  };
  await storage.create(new URL(".", profileUrl).href, profile, {
    exactUrl: profileUrl,
    contentType: "text/turtle",
  });
  pod.putCount = 0;
  return pod;
}
