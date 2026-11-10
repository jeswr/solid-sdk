// AUTHORED-BY Codex GPT-6.1-Sol
import { timingSafeEqual } from "node:crypto";

export function secureResponse(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

export function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] as string,
  );
}

export function page(title: string, content: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1>${content}</main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export function publicOrigin(value: string): URL {
  const url = new URL(value);
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error("MCP_PUBLIC_ORIGIN must be an HTTPS origin or loopback HTTP origin");
  return url;
}

export async function form(request: Request): Promise<URLSearchParams> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/x-www-form-urlencoded"
  )
    throw new Error("Invalid form");
  const reader = request.body?.getReader();
  let text = "";
  let size = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  if (reader) {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16_384) {
          void reader.cancel().catch(() => {});
          throw new Error("Form too large");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  const result = new URLSearchParams(text);
  for (const name of result.keys())
    if (result.getAll(name).length !== 1) throw new Error("Duplicate form field");
  return result;
}
