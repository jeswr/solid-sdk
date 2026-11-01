// AUTHORED-BY Codex GPT-6.1-Sol
import { once } from "node:events";
import { createServer } from "node:http";
import { expect, test, vi } from "vitest";
// Test-only integration across workspace source. The deployable has no pod-package dependencies.
import { createNotifications } from "../../../packages/pod-notifications/src/client.js";
import type { EventSourceLike } from "../../../packages/pod-notifications/src/types.js";
import { createMemoryStorage } from "../../../packages/storage-client/src/memory.js";
import { covered, epoch, vector } from "../test/fixtures.js";
import { nodeHandler } from "./node.js";
import { createRelay } from "./relay.js";

test("memory LWS change -> signed webhook -> HTTP relay -> native EventSource -> ChangeEvent", async () => {
  const v = await vector();
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const relayUrl = `http://127.0.0.1:${address.port}`;
  const root = "http://localhost:3500/pod/";
  const description = "http://localhost:3500/description";
  const keyid = `${description}#key`;
  const document = {
    ...v.document,
    id: description,
    verificationMethod: [
      { id: keyid, publicKeyJwk: v.jwk, type: "JsonWebKey", controller: description },
    ],
    authentication: [keyid],
    "@context": "https://www.w3.org/ns/lws/v1",
    service: [
      { type: "StorageRoot", serviceEndpoint: root },
      {
        type: "NotificationService",
        serviceEndpoint: `${root}webhooks`,
        subscriptionType: ["WebhookSubscription"],
      },
    ],
  };
  const relay = createRelay({
    publicUrl: relayUrl,
    allowInsecureLoopback: true,
    verifyIdToken: async () => ({ subject: "alice", expiresAt: Date.now() + 60_000 }),
    fetch: async () => Response.json(document),
    now: () => epoch,
  });
  server.on("request", nodeHandler(relay, relayUrl));
  const memory = createMemoryStorage({ protocol: "lws", root });
  memory.features.liveUpdates = {
    state: "available",
    evidence: "fixture",
    detail: { channels: ["webhook"] },
  };
  let inbox = "";
  const stages: string[] = [];
  const deleted = vi.fn();
  const podFetch: typeof fetch = async (input, init) => {
    stages.push(`pod:${init?.method ?? "GET"}`);
    if (init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      expect(body.type).toBe("WebhookSubscription");
      inbox = body.inbox;
      expect(body.topic).toEqual([root]);
      return Response.json({ subscription: `${root}subscription` });
    }
    if (init?.method === "DELETE") {
      deleted();
      return new Response(null, { status: 204 });
    }
    if (init?.method === "OPTIONS") return new Response(null);
    if (init?.method === "HEAD")
      return new Response(null, {
        headers: { link: `<${description}>; rel="https://www.w3.org/ns/lws#storage"` },
      });
    if (String(input) === description)
      return Response.json(document, { headers: { "content-type": "application/lws+cid" } });
    throw new Error("Unexpected memory target request");
  };
  const client = createNotifications({
    storage: memory,
    fetch: podFetch,
    relay: {
      url: relayUrl,
      getIdToken: async () => "session-id-token",
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        stages.push(`relay:${response.status}`);
        return response;
      },
    },
    allowInsecureLoopback: true,
    eventSourceFactory: (url) => new EventSource(url) as unknown as EventSourceLike,
  });
  const sub = await client.subscribe([root]);
  try {
    await vi.waitFor(() => expect(sub.state, stages.join(",")).toBe("live"), { timeout: 3000 });
    const change = new Promise<unknown>((resolve) => sub.on("change", resolve));
    const created = await memory.create(root, "hello", { contentType: "text/plain", name: "note" });
    const json = {
      type: "Notification",
      storage: description,
      activity: [
        {
          id: "created",
          type: "Create",
          object: { id: created.url, type: "DataResource" },
          target: root,
        },
      ],
    };
    const signed = v.signed(json, {
      url: inbox,
      params: `;created=${epoch / 1000};keyid="${keyid}";alg="ed25519"`,
      components: [...covered, "@target-uri", "date", "content-length"],
      headers: {
        date: new Date(epoch).toUTCString(),
        "content-length": String(Buffer.byteLength(JSON.stringify(json))),
      },
    });
    const delivered = await fetch(inbox, {
      method: "POST",
      headers: signed.headers,
      body: new Uint8Array(signed.body),
    });
    expect(delivered.status).toBe(202);
    await expect(change).resolves.toMatchObject({
      type: "Create",
      object: created.url,
      via: "webhook-relay",
      objectKind: "resource",
    });
    await sub.close();
    expect(deleted).toHaveBeenCalledTimes(1);
  } finally {
    await sub.close();
    relay.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
