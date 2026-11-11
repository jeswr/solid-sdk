// AUTHORED-BY Codex GPT-6.1-Sol
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient, StorageError } from "@jeswr/storage-client";
import { createSolidPod, type SolidPod } from "@sparq-org/solid-server";
import { recordingSession } from "../recording.js";
import type { ConformanceTarget } from "../types.js";

/** Adapt fetch to the published dispatcher without opening sockets or using global fetch. */
export function podFetch(pod: SolidPod): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    const url = new URL(request.url);
    if (url.origin !== new URL(pod.baseUrl).origin) throw new TypeError("Foreign pod request");
    const rawHeaders = [...request.headers].flat();
    const result = await pod.dispatch({
      method: request.method,
      url: `${url.pathname}${url.search}`,
      rawHeaders,
      body: new Uint8Array(await request.arrayBuffer()),
    });
    request.signal.throwIfAborted();
    const headers = new Headers();
    for (let i = 0; i < result.headers.length; i += 2) {
      headers.append(result.headers[i] as string, result.headers[i + 1] as string);
    }
    const response = new Response(
      request.method === "HEAD" || [204, 205, 304].includes(result.status)
        ? null
        : new Uint8Array(result.body),
      { status: result.status, headers },
    );
    Object.defineProperty(response, "url", { value: request.url });
    return response;
  };
}

/** Real sparq Solid router, fixed-owner authentication, one WASM instance per suite. */
export const sparqSolidTarget: ConformanceTarget = {
  name: "sparq-solid",
  async start() {
    const root = "http://sparq-solid.example/";
    const webId = "https://identity.example/alice#me";
    const pod = await createSolidPod({ baseUrl: root, ownerWebid: webId, oidc: false });
    try {
      const session = recordingSession("sparq-solid", podFetch(pod));
      const transport = session.fetch;
      // The published pod starts empty. Provision its root through the real protocol.
      const seeded = await transport(root, {
        method: "PUT",
        headers: {
          "Content-Type": "text/turtle",
          Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
          "If-None-Match": "*",
        },
        body: "",
      });
      if (seeded.status !== 201) throw new Error("Root provisioning failed");
      const { storage } = await createPodClient({
        fetch: transport,
        storage: root,
        capabilities: createMemoryCache(),
      });
      return {
        root,
        webId,
        fetch: transport,
        storage,
        serviceEndpoints: {
          trash: `${root}.trash/`,
          versioning: `${root}.versions/?resource={resource}`,
        },
        recordScenario: session.recordScenario,
        requestCount: session.requestCount,
        claims: {
          protocol: "solid",
          move: {
            state: "available",
            evidence: "emulated",
            detail: { native: false, containers: true, preservesIdentifier: false },
          },
          liveUpdates: { state: "unknown", evidence: "target", detail: { channels: [] } },
        },
        async authFetchFor(identity) {
          if (identity === webId) return transport;
          // oidc:false treats EVERY request as owner. Never pretend this is a second identity.
          throw new StorageError("unsupported", { method: "AUTH", url: root });
        },
        async stop() {
          pod.free();
        },
      };
    } catch (error) {
      pod.free();
      throw error;
    }
  },
};
