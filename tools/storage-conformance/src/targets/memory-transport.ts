// AUTHORED-BY Codex GPT-6.1-Sol
import { type EffectivePolicy, writeAcp, writeWac } from "@jeswr/pod-access";
import {
  type Entry,
  type ReadResult,
  type StorageClient,
  StorageError,
} from "@jeswr/storage-client";

/** Reference HTTP seam: only public memory StorageClient operations, never a socket/fallback. */
export async function memoryTransport(storage: StorageClient, webId: string, model: "wac" | "acp") {
  const suffix = model === "wac" ? ".acl" : ".acr";
  const head = storage.head.bind(storage);
  const read = storage.read.bind(storage);
  const solid = storage.protocol === "solid";
  const accessUrl = (url: string) => `${url}${suffix}`;
  let indexEndpoint: string | undefined;
  let searchEndpoint: string | undefined;
  let grantsEndpoint: string | undefined;

  if (solid) {
    const url = accessUrl(storage.root);
    const policy: EffectivePolicy = {
      grants: [
        {
          modes: new Set(["read", "write", "append", "control"]),
          who: [[{ kind: "agent", webId }]],
          except: [],
          appliesTo: "both",
          source: { url, node: `${url}#owner` },
        },
      ],
      denials: [],
    };
    await storage.create(
      storage.root,
      model === "wac"
        ? await writeWac(policy, storage.root, url)
        : await writeAcp(policy, storage.root, url, "css"),
      {
        name: suffix,
        contentType: "text/turtle",
      },
    );
  } else {
    grantsEndpoint = (await storage.create(storage.root, null, { kind: "container" })).url;
    indexEndpoint = (
      await storage.create(storage.root, '{"type":"TypeIndex","items":[]}', {
        contentType: "application/lws+json",
      })
    ).url;
    searchEndpoint = (await storage.create(storage.root, null, { kind: "container" })).url;
  }

  async function members(): Promise<Entry[]> {
    const result: Entry[] = [];
    const pending = [storage.root];
    const seen = new Set<string>();
    while (pending.length) {
      const parent = pending.pop() as string;
      if (seen.has(parent)) continue;
      seen.add(parent);
      for await (const entry of storage.listAll(parent)) {
        result.push(entry);
        if (
          entry.kind === "container" &&
          !entry.url.startsWith(`${storage.root}.versions/`) &&
          !entry.url.startsWith(`${storage.root}.trash/`)
        )
          pending.push(entry.url);
      }
    }
    return result;
  }

  function hints(result: ReadResult): ReadResult {
    if (!solid || result.url.endsWith(suffix)) return result;
    const links = new Map(result.links);
    links.set("acl", [{ target: accessUrl(result.url), params: {} }]);
    return { ...result, links, allow: { read: true, write: true, append: true, control: true } };
  }
  storage.head = async (url, opts) => hints(await head(url, opts));
  storage.read = async (url, opts) => {
    const result = hints(await read(url, opts));
    if (url !== indexEndpoint) return result;
    const types = [...new Set((await members()).flatMap((entry) => entry.types))].sort();
    const response = Response.json({ type: "TypeIndex", items: types.map((id) => ({ id })) });
    return {
      ...result,
      body: response.body,
      bytes: async () => new Uint8Array(await response.arrayBuffer()),
      text: () => response.text(),
      blob: () => response.blob(),
    };
  };

  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = request.url;
    if (!storage.isWithinStorage(url)) throw new TypeError("Foreign memory transport request");
    request.signal.throwIfAborted();
    try {
      if (url === searchEndpoint && request.method === "QUERY") {
        const query = (await request.json()) as { type: string[][] };
        if (!Array.isArray(query.type) || query.type.length !== 1 || !Array.isArray(query.type[0]))
          return new Response(null, { status: 400 });
        const wanted = new Set(query.type[0]);
        return Response.json(
          {
            type: "ContainerPage",
            items: (await members())
              .filter((entry) => entry.types.some((type) => wanted.has(type)))
              .map((entry) => ({ id: entry.url, type: entry.types })),
          },
          {
            headers: { "Content-Type": "application/lws+json" },
          },
        );
      }
      if (request.method === "PUT") {
        const ifNoneMatch = request.headers.get("if-none-match");
        const ifMatch = request.headers.get("if-match");
        const contentType = request.headers.get("content-type") ?? "application/octet-stream";
        const body = await request.text();
        if (ifNoneMatch === "*") {
          if (!solid) return new Response(null, { status: 405 });
          const result = await storage.create(new URL(".", url).href, body, {
            name: decodeURIComponent(new URL(url).pathname.split("/").at(-1) as string),
            contentType,
          });
          return new Response(null, { status: 201, headers: { ETag: result.etag as string } });
        }
        if (!ifMatch) return new Response(null, { status: 428 });
        const result = await storage.write(url, body, { ifMatch, contentType });
        return new Response(null, { status: 204, headers: { ETag: result.etag as string } });
      }
      if (request.method !== "HEAD" && request.method !== "GET")
        return new Response(null, { status: 405 });
      const result = request.method === "HEAD" ? await storage.head(url) : await storage.read(url);
      const headers = new Headers();
      if (result.etag) headers.set("ETag", result.etag);
      if (result.contentType) headers.set("Content-Type", result.contentType);
      const acl = result.links.get("acl")?.[0]?.target;
      if (acl) headers.set("Link", `<${acl}>; rel="acl"`);
      if (solid) headers.set("WAC-Allow", 'user="read write append control",public=""');
      return new Response(result.body as BodyInit | null, { status: result.status, headers });
    } catch (error) {
      if (!(error instanceof StorageError)) throw error;
      return new Response(null, {
        status: error.code === "conflict" ? 412 : (error.status ?? 500),
      });
    }
  };
  return { fetch: transport, grantsEndpoint, indexEndpoint, searchEndpoint };
}
