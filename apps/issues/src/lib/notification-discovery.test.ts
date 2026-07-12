import { describe, it, expect } from "vitest";
import { Parser, Store } from "n3";
import {
  linkHeaderTarget,
  webSocketSubscriptionEndpoint,
  resolveStorageDescriptionUrl,
  discoverWebSocketSubscriptionEndpoint,
  WEBSOCKET_CHANNEL_TYPE,
} from "./notification-discovery";

/** Parse a Turtle string into an in-memory dataset (the test's own fixture loader). */
function turtle(ttl: string): Store {
  const store = new Store();
  store.addQuads(new Parser({ format: "text/turtle" }).parse(ttl));
  return store;
}

const PREFIXES = `
@prefix notify: <http://www.w3.org/ns/solid/notifications#> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
`;

describe("linkHeaderTarget", () => {
  const base = "https://pod.example/alice/issues/";

  it("extracts the storageDescription target (quoted absolute rel)", () => {
    const header = '</.well-known/solid>; rel="http://www.w3.org/ns/solid/terms#storageDescription"';
    expect(linkHeaderTarget(header, "http://www.w3.org/ns/solid/terms#storageDescription", base)).toBe(
      "https://pod.example/.well-known/solid",
    );
  });

  it("extracts describedby and resolves a relative target against the base", () => {
    const header = "<.meta>; rel=describedby";
    expect(linkHeaderTarget(header, "describedby", base)).toBe("https://pod.example/alice/issues/.meta");
  });

  it("picks the right link when several are present in one header", () => {
    const header =
      '<https://pod.example/acl>; rel="acl", ' +
      '</.well-known/solid>; rel="http://www.w3.org/ns/solid/terms#storageDescription", ' +
      '<https://pod.example/type-index>; rel="type"';
    expect(linkHeaderTarget(header, "http://www.w3.org/ns/solid/terms#storageDescription", base)).toBe(
      "https://pod.example/.well-known/solid",
    );
  });

  it("matches one rel among a space-separated rel set", () => {
    const header = '</desc>; rel="describedby other"';
    expect(linkHeaderTarget(header, "describedby", base)).toBe("https://pod.example/desc");
  });

  it("is case-insensitive on the rel value", () => {
    const header = "</desc>; rel=DescribedBy";
    expect(linkHeaderTarget(header, "describedby", base)).toBe("https://pod.example/desc");
  });

  it("returns undefined for a missing header or an absent rel", () => {
    expect(linkHeaderTarget(null, "describedby", base)).toBeUndefined();
    expect(linkHeaderTarget('<https://pod.example/acl>; rel="acl"', "describedby", base)).toBeUndefined();
  });
});

describe("webSocketSubscriptionEndpoint", () => {
  it("resolves the subscription endpoint for the WebSocketChannel2023 channel type", () => {
    const ds = turtle(`${PREFIXES}
      <https://pod.example/.well-known/solid>
        notify:subscription <https://pod.example/.notifications/WebSocketChannel2023/> .
      <https://pod.example/.notifications/WebSocketChannel2023/>
        notify:channelType notify:WebSocketChannel2023 .
    `);
    expect(webSocketSubscriptionEndpoint(ds)).toBe(
      "https://pod.example/.notifications/WebSocketChannel2023/",
    );
  });

  it("resolves when the channel type is declared via rdf:type instead of notify:channelType", () => {
    const ds = turtle(`${PREFIXES}
      <https://pod.example/storage>
        notify:subscription <https://pod.example/sub/ws> .
      <https://pod.example/sub/ws> a notify:WebSocketChannel2023 .
    `);
    expect(webSocketSubscriptionEndpoint(ds)).toBe("https://pod.example/sub/ws");
  });

  it("resolves a subject directly typed as the channel (no notify:subscription back-link)", () => {
    const ds = turtle(`${PREFIXES}
      <https://pod.example/sub/ws> notify:channelType notify:WebSocketChannel2023 .
    `);
    expect(webSocketSubscriptionEndpoint(ds)).toBe("https://pod.example/sub/ws");
  });

  it("ignores a non-WebSocket channel and returns undefined (graceful fallback)", () => {
    const ds = turtle(`${PREFIXES}
      <https://pod.example/.well-known/solid>
        notify:subscription <https://pod.example/.notifications/WebhookChannel2023/> .
      <https://pod.example/.notifications/WebhookChannel2023/>
        notify:channelType notify:WebhookChannel2023 .
    `);
    expect(webSocketSubscriptionEndpoint(ds)).toBeUndefined();
  });

  it("returns undefined for an empty / channel-less storage description", () => {
    const ds = turtle(`${PREFIXES}
      <https://pod.example/.well-known/solid> a solid:StorageDescription .
    `);
    expect(webSocketSubscriptionEndpoint(ds)).toBeUndefined();
  });

  it("exposes the WebSocketChannel2023 channel-type IRI in the notify namespace", () => {
    expect(WEBSOCKET_CHANNEL_TYPE).toBe("http://www.w3.org/ns/solid/notifications#WebSocketChannel2023");
  });
});

describe("resolveStorageDescriptionUrl", () => {
  it("prefers the storageDescription Link rel from a HEAD response", async () => {
    const doFetch = (async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("HEAD");
      return new Response(null, {
        headers: {
          link: '</.well-known/solid>; rel="http://www.w3.org/ns/solid/terms#storageDescription"',
        },
      });
    }) as unknown as typeof fetch;
    expect(await resolveStorageDescriptionUrl("https://pod.example/alice/issues/", doFetch)).toBe(
      "https://pod.example/.well-known/solid",
    );
  });

  it("falls back to describedby when storageDescription is absent", async () => {
    const doFetch = (async () =>
      new Response(null, { headers: { link: "<.meta>; rel=describedby" } })) as unknown as typeof fetch;
    expect(await resolveStorageDescriptionUrl("https://pod.example/alice/issues/", doFetch)).toBe(
      "https://pod.example/alice/issues/.meta",
    );
  });

  it("falls back to /.well-known/solid when no Link rel is present", async () => {
    const doFetch = (async () => new Response(null, { headers: {} })) as unknown as typeof fetch;
    expect(await resolveStorageDescriptionUrl("https://pod.example/alice/issues/", doFetch)).toBe(
      "https://pod.example/.well-known/solid",
    );
  });

  it("falls back to /.well-known/solid when the HEAD throws", async () => {
    const doFetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await resolveStorageDescriptionUrl("https://pod.example/alice/issues/", doFetch)).toBe(
      "https://pod.example/.well-known/solid",
    );
  });
});

describe("discoverWebSocketSubscriptionEndpoint (end to end, mocked fetch)", () => {
  it("discovers the endpoint via Link header → storage description doc", async () => {
    const descriptionTtl = `${PREFIXES}
      <https://pod.example/.well-known/solid>
        notify:subscription <https://pod.example/.notifications/WebSocketChannel2023/> .
      <https://pod.example/.notifications/WebSocketChannel2023/>
        notify:channelType notify:WebSocketChannel2023 .
    `;
    const doFetch = (async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return new Response(null, {
          headers: {
            link: '</.well-known/solid>; rel="http://www.w3.org/ns/solid/terms#storageDescription"',
          },
        });
      }
      if (url === "https://pod.example/.well-known/solid") {
        return new Response(descriptionTtl, { headers: { "content-type": "text/turtle" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    expect(await discoverWebSocketSubscriptionEndpoint("https://pod.example/alice/issues/", doFetch)).toBe(
      "https://pod.example/.notifications/WebSocketChannel2023/",
    );
  });

  it("returns undefined (→ poll) when the server advertises no channel", async () => {
    const doFetch = (async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { headers: {} });
      // /.well-known/solid exists but advertises no WebSocketChannel2023.
      return new Response(`${PREFIXES}\n<${url}> a <http://www.w3.org/ns/pim/space#Storage> .`, {
        headers: { "content-type": "text/turtle" },
      });
    }) as unknown as typeof fetch;

    expect(
      await discoverWebSocketSubscriptionEndpoint("https://pod.example/alice/issues/", doFetch),
    ).toBeUndefined();
  });

  it("returns undefined when the storage description doc is not found (404)", async () => {
    const doFetch = (async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { headers: {} });
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    expect(
      await discoverWebSocketSubscriptionEndpoint("https://pod.example/alice/issues/", doFetch),
    ).toBeUndefined();
  });

  it("returns undefined (never throws) when discovery fetch errors", async () => {
    const doFetch = (async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { headers: {} });
      throw new Error("boom");
    }) as unknown as typeof fetch;

    await expect(
      discoverWebSocketSubscriptionEndpoint("https://pod.example/alice/issues/", doFetch),
    ).resolves.toBeUndefined();
  });
});
