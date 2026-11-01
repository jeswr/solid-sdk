// AUTHORED-BY Codex GPT-6.1-Sol
import { vi } from "vitest";
export function mockPod() {
  const files = new Map<string, { body: string | Blob; type: string; etag: string | null }>();
  let revision = 0;
  const failures = new Map<string, number>();
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const failure = failures.get(`${method} ${url}`);
    if (failure) return new Response(null, { status: failure });
    const file = files.get(url);
    if (method === "HEAD")
      return file
        ? new Response(null, { headers: file.etag ? { etag: file.etag } : {} })
        : new Response(null, { status: 404 });
    if (method === "GET")
      return file
        ? new Response(file.body, {
            headers: { "content-type": file.type, ...(file.etag ? { etag: file.etag } : {}) },
          })
        : new Response(null, { status: 404 });
    if (!headers.has("if-match") && !headers.has("if-none-match"))
      throw new Error("Unconditional mutation");
    if (headers.get("if-none-match") === "*" && file) return new Response(null, { status: 412 });
    if (headers.has("if-match") && file?.etag !== headers.get("if-match"))
      return new Response(null, { status: 412 });
    if (method === "DELETE") {
      files.delete(url);
      return new Response(null, { status: 204 });
    }
    const etag = `"${++revision}"`;
    files.set(url, {
      body: init?.body as string | Blob,
      type: headers.get("content-type") as string,
      etag,
    });
    return new Response(null, { status: 201, headers: { etag } });
  });
  return { fetch, files, failures };
}
