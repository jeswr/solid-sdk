// AUTHORED-BY Codex GPT-6.1-Sol
import { buildClientId } from "@/shell/lib/client-id";

/** The document must be served at exactly its client_id, so use the public host the request named. */
function publicUrl(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) url.host = host;
  if (proto === "https" || proto === "http") url.protocol = `${proto}:`;
  return url.href;
}

export function GET(request: Request): Response {
  return Response.json(buildClientId(publicUrl(request), process.env.NEXT_PUBLIC_SUITE_ORIGIN), {
    headers: { "content-type": "application/ld+json", "cache-control": "public, max-age=300" },
  });
}
