// AUTHORED-BY Claude Opus 5.5
import { serviceWorkerSource } from "@/shell/lib/service-worker";

// Rendered once at build time, so every deploy gets a new cache version and old caches are
// removed when the new worker activates.
export const dynamic = "force-static";
const version = Date.now().toString(36);

export function GET() {
  return new Response(serviceWorkerSource(version), {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
      "service-worker-allowed": "/",
    },
  });
}
