// AUTHORED-BY Codex GPT-6
import { mobileClientIdDocument } from "@jeswr/suite-native";
import { trustedClientOrigin } from "@/shell/lib/client-id";

/** Deployment configuration owns the public identity; loopback fallback is never cached. */
export function GET(request: Request): Response {
  const origin = trustedClientOrigin(process.env, request.url);
  if (!origin.origin)
    return new Response("Set NEXT_PUBLIC_SUITE_ORIGIN to serve the Client Identifier Document.", {
      status: 404,
    });
  return Response.json(
    mobileClientIdDocument({
      origin: origin.origin,
      clientName: "Solid Suite",
      logoPath: "/icon.svg",
    }),
    {
      headers: {
        "content-type": "application/ld+json",
        "cache-control": origin.cacheable ? "public, max-age=300" : "no-store",
        "access-control-allow-origin": "*",
      },
    },
  );
}
