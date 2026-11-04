// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import type { ResolveWebIdKeyOptions } from "@jeswr/solid-vc";
/** Same fetch signature as ADR-003 AuthFetch, without coupling to a backend. */
export type AuditFetch = NonNullable<ResolveWebIdKeyOptions["fetch"]>;
export function storageRoot(root: string): string {
  const url = new URL(root);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith("/")
  )
    throw new Error("Invalid audit storage root");
  return url.href;
}
export function auditBase(root: string): string {
  return new URL("agent/audit/", storageRoot(root)).href;
}
export function documentUrl(root: string, iri: string): string {
  const url = new URL(iri);
  url.hash = "";
  return assertWithinPodScope(root, url.href);
}
/** Refuse redirects even when an injected adapter followed one; never forward server errors. */
export async function request(io: AuditFetch, url: string, init: RequestInit): Promise<Response> {
  const response = await io(url, { ...init, redirect: "manual", credentials: "omit" });
  if (
    response.redirected ||
    (response.url && response.url !== url) ||
    (response.status >= 300 && response.status < 400)
  )
    throw new Error("Audit redirect refused");
  return response;
}
export async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1024 * 1024) {
        await reader.cancel();
        throw new Error("Audit resource exceeds bound");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function readDocument(
  io: AuditFetch,
  url: string,
  accept = "text/turtle",
): Promise<{ body: string; etag: string | null } | undefined> {
  const response = await request(io, url, { headers: { Accept: accept } });
  if (response.status === 404) return undefined;
  if (response.status !== 200)
    throw new Error("Audit resource unreadable (auditor needs read access)");
  const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!accept.split(",").includes(type ?? "")) throw new Error("Unexpected audit media type");
  return { body: await boundedText(response), etag: response.headers.get("etag") };
}
