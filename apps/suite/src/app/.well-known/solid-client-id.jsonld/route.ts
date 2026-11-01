// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { buildClientId, trustedClientOrigin } from "@/shell/lib/client-id";

/**
 * The document's client_id and redirect URIs come only from deployment
 * configuration (NEXT_PUBLIC_SUITE_ORIGIN, or the Vercel-provided host), never
 * from request headers, so a forged Host cannot poison a cached copy. Without
 * configuration only a loopback request is answered (local development), and
 * that answer is never cached.
 */
export function GET(request: Request): Response {
  const origin = trustedClientOrigin(process.env, request.url);
  if (!origin.origin)
    return new Response("Set NEXT_PUBLIC_SUITE_ORIGIN to serve the Client Identifier Document.", {
      status: 404,
    });
  return Response.json(buildClientId(request.url, origin.origin), {
    headers: {
      "content-type": "application/ld+json",
      "cache-control": origin.cacheable ? "public, max-age=300" : "no-store",
    },
  });
}
