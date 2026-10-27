// AUTHORED-BY Codex GPT-6
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parseLinkHeaders, parseWacAllow } from "@jeswr/storage-capabilities";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import type { Mode, PodHttp, Progress } from "../../src/engine/index.js";

export function accessLink(response: Response, resource: string): string {
  const links = parseLinkHeaders(response.headers.get("link"), resource).filter(
    (link) => link.context === resource && link.rel.includes("acl"),
  );
  assert.equal(links.length, 1, `Expected one ACL link on ${resource}`);
  return (links[0] as (typeof links)[number]).target;
}

export function modesFromHead(response: Response): Set<Mode> | undefined {
  if ([401, 403].includes(response.status)) return undefined;
  assert.equal(response.status, 200, "Access probe must not treat HTTP errors as denials");
  const header = response.headers.get("wac-allow");
  // The shipped ACP config omits WacAllowMetadataWriter. In that case use
  // conditional operation probes, rather than inventing empty permissions.
  if (!header) return undefined;
  const parsed = parseWacAllow(header);
  assert.ok(parsed, "Malformed WAC-Allow cannot establish permission safety");
  const modes = new Set<Mode>(parsed.user);
  assert.ok(modes.has("read"), "Successful HEAD must advertise Read");
  if (modes.has("write")) modes.add("append");
  return modes;
}

/** Generate a non-empty insert through RDF accessors + Writer, never a no-op PATCH. */
export async function appendProbeBody(): Promise<string> {
  const store = new Store();
  const term = new TermWrapper("urn:css-test:probe", store, DataFactory);
  SetFrom.subjectPredicate(
    term,
    "urn:css-test:predicate",
    NamedNodeAs.string,
    NamedNodeFrom.string,
  ).add("urn:css-test:value");
  const writer = new Writer({ format: "N-Triples" });
  writer.addQuads([...store]);
  const triples = await new Promise<string>((resolve, reject) =>
    writer.end((error, value) => (error ? reject(error) : resolve(value))),
  );
  return `INSERT DATA {\n${triples}}`;
}

export function conditionalAccess(response: Response, existingContainerPut = false): boolean {
  // CSS authorizes before evaluating If-Match. A random, non-matching ETag
  // proves authorization with 412 while ensuring the request cannot mutate data.
  if (response.status === 412) return true;
  // CSS rejects PUT on existing containers after authorization, before If-Match.
  // This contextual 409 proves Write and cannot change that container.
  if (existingContainerPut && response.status === 409) return true;
  if ([401, 403].includes(response.status)) return false;
  throw new Error(`Conditional permission probe returned unexpected HTTP ${response.status}`);
}

export async function probeAccess(
  fetcher: typeof fetch,
  resource: string,
  acl: string,
  patch: string,
): Promise<Set<Mode>> {
  const response = await fetcher(resource, { method: "HEAD", redirect: "manual" });
  const advertised = modesFromHead(response);
  if (advertised) return advertised;
  const modes = new Set<Mode>(response.status === 200 ? ["read"] : []);
  // Do not assume a denied read also denies append/write/control. These probes
  // catch a transient write-only grant, which GET-only auditing would miss.
  for (const [mode, url, method] of [
    ["write", resource, "PUT"],
    ["append", resource, "PATCH"],
    ["control", acl, "PUT"],
  ] as const) {
    const check = await fetcher(url, {
      method,
      redirect: "manual",
      headers: {
        "if-match": `"css-test-never-match-${randomUUID()}"`,
        "content-type": method === "PATCH" ? "application/sparql-update" : "text/turtle",
      },
      body: method === "PATCH" ? patch : "",
    });
    const allowed = conditionalAccess(
      check,
      method === "PUT" && url === resource && resource.endsWith("/"),
    );
    await check.arrayBuffer();
    if (allowed) modes.add(mode);
  }
  if (modes.has("write")) modes.add("append");
  return modes;
}

export function assertSubset(source: ReadonlySet<Mode>, target: ReadonlySet<Mode>, label: string) {
  for (const mode of target) assert.ok(source.has(mode), `${label}: target widened ${mode}`);
}

export interface WriteProgress extends Progress {
  method: "PUT" | "DELETE";
  status: number;
}

/** The engine's void progress hook cannot await HTTP probes, so fence every
 * transport write with the same observer before the executor can continue. */
export function observeWrites(
  http: PodHttp,
  onProgress: (progress: WriteProgress) => Promise<void>,
): { http: PodHttp; writes: WriteProgress[] } {
  const writes: WriteProgress[] = [];
  async function observe(url: string, method: "PUT" | "DELETE", response: Response) {
    const progress: WriteProgress = {
      phase: "copy",
      current: url,
      done: writes.length + 1,
      total: writes.length + 1,
      method,
      status: response.status,
    };
    writes.push(progress);
    await onProgress(progress);
    return response;
  }
  return {
    writes,
    http: {
      ...http,
      put: async (url, body, init) => observe(url, "PUT", await http.put(url, body, init)),
      delete: async (url, init) => observe(url, "DELETE", await http.delete(url, init)),
    },
  };
}
