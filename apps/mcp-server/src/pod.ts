// AUTHORED-BY Codex GPT-6.1-Sol
import { randomBytes } from "node:crypto";
import { fetchRdf } from "@jeswr/fetch-rdf";
import { createNodeGuardedFetch, refuseRedirects } from "@jeswr/guarded-fetch/node";
import { Agent, Container } from "@solid/object";
import { DataFactory } from "n3";

/** Resolve only the verified WebID; ambiguous storage requires operator selection. */
export async function podRootFor(webId: string, transport?: typeof fetch): Promise<string> {
  const profile = await profileFor(webId, transport);
  const roots = [...profile.storageUrls];
  if (roots.length !== 1) throw new Error("Expected exactly one advertised pod root");
  return roots[0] as string;
}

async function profileFor(webId: string, transport?: typeof fetch): Promise<Agent> {
  const url = new URL(webId);
  url.hash = "";
  const { dataset } = await fetchRdf(url.href, {
    fetch: refuseRedirects(
      transport ??
        createNodeGuardedFetch({ maxBytes: 1024 * 1024, timeoutMs: 8_000, maxRedirects: 0 }),
    ),
  });
  return new Agent(webId, dataset, DataFactory);
}

/** A fragment WebID is a profile identity, never an issuer discovery URL. */
export async function podLoginFor(
  input: string,
  transport?: typeof fetch,
): Promise<{ issuer: string; expectedWebId?: string }> {
  if (!new URL(input).hash) return { issuer: input };
  const issuers = [...(await profileFor(input, transport)).oidcIssuer];
  if (issuers.length !== 1) throw new Error("WebID must advertise exactly one issuer");
  return { issuer: issuers[0] as string, expectedWebId: input };
}

/** Adapt CSS's PUT responses without relaxing conditional writes or ACL checks.
 * Recover binary validators only after byte-exact readback; an existing container
 * conflict becomes a create-only precondition failure only after typed discovery.
 */
export function withCssCompatibility(fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    let request = new Request(input, init);
    const binary =
      request.method === "PUT" &&
      request.headers.get("content-type") === "application/octet-stream";
    let expected = binary ? new Uint8Array(await request.clone().arrayBuffer()) : undefined;
    // The memory mutex body is opaque and never read by its writer. A unique
    // owner marker prevents a readback from adopting a concurrent writer's lock
    // after a delete/recreate race on servers that omit PUT ETags.
    if (
      expected?.length === 0 &&
      request.headers.get("if-none-match") === "*" &&
      new URL(request.url).pathname.endsWith("/private/pkg/mcp/.write-lock")
    ) {
      expected = randomBytes(32);
      request = new Request(request, { body: Buffer.from(expected) });
    }
    const response = await fetcher(request);
    if (
      response.status === 409 &&
      request.method === "PUT" &&
      new URL(request.url).pathname.endsWith("/") &&
      request.headers.get("if-none-match") === "*"
    ) {
      try {
        const { dataset } = await fetchRdf(request.url, { fetch: refuseRedirects(fetcher) });
        const container = new Container(request.url, dataset, DataFactory);
        if (
          ["Container", "BasicContainer", "DirectContainer", "IndirectContainer"].some((type) =>
            container.type.has(`http://www.w3.org/ns/ldp#${type}`),
          )
        ) {
          void response.body?.cancel().catch(() => {});
          return new Response(null, { status: 412 });
        }
      } catch {
        /* Unverified conflicts retain their original failure. */
      }
      return response;
    }
    if (!response.ok || response.headers.has("etag") || !expected) return response;
    const read = await fetcher(request.url, { method: "GET", redirect: "manual" });
    const etag = read.headers.get("etag");
    if (
      !read.ok ||
      read.headers.get("content-type")?.split(";")[0] !== "application/octet-stream" ||
      !etag ||
      !/^"[^"\r\n]+"$/.test(etag)
    ) {
      void read.body?.cancel().catch(() => {});
      throw new Error("Cannot verify binary write validator");
    }
    const actual = new Uint8Array(await read.arrayBuffer());
    if (
      actual.length !== expected.length ||
      !actual.every((value, index) => value === expected[index])
    )
      throw new Error("Binary write changed before verification");
    const headers = new Headers(response.headers);
    headers.set("etag", etag);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
