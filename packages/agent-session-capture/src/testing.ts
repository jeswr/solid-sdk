// AUTHORED-BY Codex GPT-6.1-Sol
import type { SolidMcpConfig } from "@jeswr/solid-mcp";

/** Recorded request made through the real client-credentials and ChatWriter implementations. */
export interface CaptureRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

/** In-memory HTTP pod/token endpoint for fixture-only capture tests; no network or credentials. */
export function createCaptureTestTransport() {
  const requests: CaptureRequest[] = [];
  const resources = new Map<string, string>();
  const httpTransport: SolidMcpConfig["fetch"] = async (input, init) => {
    const request = new Request(input, init);
    const { url, method, headers } = request;
    const body = await request.text();
    requests.push({ url, method, headers, body });
    if (url === "https://issuer.example/token")
      return Response.json({
        access_token: "fixture-access-token",
        token_type: "DPoP",
        expires_in: 3600,
      });
    if (method === "HEAD")
      return new Response(null, {
        status: resources.has(url) ? 200 : 404,
        headers: { link: `<${url}.acl>; rel="acl"` },
      });
    if (method === "PUT") {
      if (headers.get("if-none-match") === "*" && resources.has(url))
        return new Response(null, { status: 412 });
      resources.set(url, body);
      return new Response(null, { status: 201 });
    }
    const stored = resources.get(url);
    return new Response(stored, {
      status: stored === undefined ? 404 : 200,
      headers: { "content-type": "text/turtle" },
    });
  };
  return { fetch: httpTransport, requests, resources };
}
