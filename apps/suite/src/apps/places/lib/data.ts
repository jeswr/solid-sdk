// AUTHORED-BY Codex (GPT-6.1 Sol)
import { openPlacesRepository } from "@jeswr/solid-places";
import { createPodClient } from "@jeswr/storage-client";
import type { PodSession } from "@/lib/session/pod-session";
export async function openPlaces(session: PodSession) {
  // The suite's explicitly non-enforcing demo pod predates storage-description
  // discovery. Reuse its own root listing as the empty description, then let the
  // public factory probe its advertised ACL. No backend is selected by the app.
  const transport: typeof fetch =
    session.mode === "demo"
      ? async (input, init) => {
          const response = await session.fetch(input, init);
          const request = input instanceof Request ? input : undefined;
          const url = request?.url ?? String(input);
          const method = init?.method ?? request?.method ?? "GET";
          if (
            url !== session.storageUrl ||
            response.headers.get("x-solid-demo-access-control") !== "none"
          )
            return response;
          if (method === "OPTIONS") {
            const metadata = await session.fetch(session.storageUrl, {
              method: "HEAD",
              redirect: "error",
            });
            const headers = new Headers(response.headers);
            for (const name of ["link", "wac-allow"]) {
              const value = metadata.headers.get(name);
              if (value) headers.set(name, value);
            }
            return new Response(null, { status: response.status, headers });
          }
          if (method !== "HEAD") return response;
          const headers = new Headers(response.headers);
          headers.append(
            "link",
            `<${session.storageUrl}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
          );
          return new Response(null, { status: response.status, headers });
        }
      : session.fetch;
  const { storage } = await createPodClient({ fetch: transport, storage: session.storageUrl });
  return openPlacesRepository({
    fetch: session.fetch,
    storageUrl: session.storageUrl,
    owner: session.webId,
    storage,
  });
}
