// AUTHORED-BY Codex GPT-6.1-Sol
import { buildClientId } from "@/shell/lib/client-id";
export function GET(request: Request): Response {
  return Response.json(buildClientId(request.url, process.env.NEXT_PUBLIC_SUITE_ORIGIN), {
    headers: { "content-type": "application/ld+json", "cache-control": "public, max-age=300" },
  });
}
