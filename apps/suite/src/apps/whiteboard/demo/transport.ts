// AUTHORED-BY Codex (GPT-6.1 Sol)
/** The demo fixture omits discovery metadata. Supply an empty Solid description only in demo mode. */
export function drawingDemoTransport(
  fetch: typeof globalThis.fetch,
  root: string,
): typeof globalThis.fetch {
  const description = new URL(".whiteboard-storage-description", root).href;
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === description)
      return new Response("", {
        headers: { "content-type": "text/turtle", "cache-control": "max-age=3600" },
      });
    const response = await fetch(input, init);
    if (url !== root || !response.ok) return response;
    const headers = new Headers(response.headers);
    headers.append(
      "link",
      `<${description}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
    );
    return new Response(response.body, { status: response.status, headers });
  };
}
