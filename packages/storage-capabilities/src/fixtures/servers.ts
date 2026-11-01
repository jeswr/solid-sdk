// AUTHORED-BY Claude Opus 5.5
import { sparqLwsCid } from "./sparq-lws.js";

/**
 * Representative server exchanges for offline tests. These are synthetic: shaped after the
 * public behaviour of each server (header names, link relations, description bodies), not
 * captured from a deployment, and they contain no personal data or credentials.
 */
export interface RecordedResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** A storage as seen from one resource: responses keyed by `"<METHOD> <absolute URL>"`. */
export interface StorageFixture {
  readonly name: "css" | "sparq-lws" | "ess" | "nss";
  /** A resource inside the storage to start discovery from. */
  readonly resource: string;
  /** The storage root that discovery is expected to find. */
  readonly root: string;
  readonly responses: Readonly<Record<string, RecordedResponse>>;
}

const PIM_STORAGE_TYPE = '<http://www.w3.org/ns/pim/space#Storage>; rel="type"';
const LDP_CONTAINER_TYPE = '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"';
const LDP_RESOURCE_TYPE = '<http://www.w3.org/ns/ldp#Resource>; rel="type"';
const STORAGE_DESCRIPTION = "http://www.w3.org/ns/solid/terms#storageDescription";
const ACP_ACCESS_CONTROL = "http://www.w3.org/ns/solid/acp#accessControl";

const css = "https://css.example";
/** Community Solid Server 7.x: pod at /alice/, `/.well-known/solid` with two subscription services. */
export const cssStorage: StorageFixture = {
  name: "css",
  resource: `${css}/alice/notes/today.ttl`,
  root: `${css}/alice/`,
  responses: {
    [`HEAD ${css}/alice/notes/today.ttl`]: {
      status: 200,
      headers: {
        "content-type": "text/turtle",
        etag: '"1793000000000-text/turtle"',
        link: [
          LDP_RESOURCE_TYPE,
          `<${css}/.well-known/solid>; rel="${STORAGE_DESCRIPTION}"`,
          `<${css}/alice/notes/today.ttl.meta>; rel="describedby"`,
          `<${css}/alice/notes/today.ttl.acl>; rel="acl"`,
        ].join(", "),
        "wac-allow": 'user="read write append control",public=""',
      },
    },
    [`HEAD ${css}/alice/notes/`]: {
      status: 200,
      headers: {
        link: [LDP_CONTAINER_TYPE, `<${css}/.well-known/solid>; rel="${STORAGE_DESCRIPTION}"`].join(
          ", ",
        ),
      },
    },
    [`HEAD ${css}/alice/`]: {
      status: 200,
      headers: {
        link: [
          LDP_CONTAINER_TYPE,
          PIM_STORAGE_TYPE,
          `<${css}/.well-known/solid>; rel="${STORAGE_DESCRIPTION}"`,
        ].join(", "),
      },
    },
    [`GET ${css}/.well-known/solid`]: {
      status: 200,
      headers: { "content-type": "application/ld+json", etag: '"description-v1"' },
      body: JSON.stringify({
        "@context": ["https://www.w3.org/ns/solid/notification/v1"],
        id: `${css}/.well-known/solid`,
        subscription: [
          {
            id: `${css}/.notifications/WebSocketChannel2023/`,
            channelType: "WebSocketChannel2023",
            feature: ["accept", "endAt", "rate", "startAt", "state"],
          },
          {
            id: `${css}/.notifications/WebhookChannel2023/`,
            channelType: "WebhookChannel2023",
            feature: ["accept", "endAt", "rate", "startAt", "state"],
          },
        ],
      }),
    },
    [`OPTIONS ${css}/alice/`]: {
      status: 204,
      headers: {
        allow: "OPTIONS, HEAD, GET, PATCH, POST, PUT, DELETE",
        "accept-patch": "text/n3, application/sparql-update",
        "accept-post": "*/*",
        link: `<${css}/alice/.acl>; rel="acl"`,
        "wac-allow": 'user="read write append control",public="read"',
      },
    },
  },
};

const lws = "https://lws.example";
/** sparq in LWS mode: `Link rel=lws#storage` to the CID (see `sparqLwsCid`). */
export const sparqLwsStorage: StorageFixture = {
  name: "sparq-lws",
  resource: `${lws}/data/file`,
  root: `${lws}/`,
  responses: {
    [`HEAD ${lws}/data/file`]: {
      status: 200,
      headers: {
        link: [
          `<${sparqLwsCid.id}>; rel="https://www.w3.org/ns/lws#storage"`,
          `<${lws}/data/>; rel="up"`,
          `<${lws}/data/file.linkset>; rel="linkset"`,
          '<https://www.w3.org/ns/lws#DataResource>; rel="type"',
        ].join(", "),
      },
    },
    [`GET ${sparqLwsCid.id}`]: {
      status: 200,
      headers: { "content-type": "application/lws+cid", etag: '"cid-v1"' },
      body: JSON.stringify(sparqLwsCid),
    },
  },
};

const ess = "https://storage.ess.example";
/** Inrupt ESS-like storage: notifications description plus ACP (`acp#accessControl` link). */
export const essStorage: StorageFixture = {
  name: "ess",
  resource: `${ess}/pod-1/notes/x.ttl`,
  root: `${ess}/pod-1/`,
  responses: {
    [`HEAD ${ess}/pod-1/notes/x.ttl`]: {
      status: 200,
      headers: {
        link: [
          LDP_RESOURCE_TYPE,
          `<${ess}/pod-1/.well-known/solid>; rel="${STORAGE_DESCRIPTION}"`,
          `<${ess}/pod-1/notes/x.ttl?ext=acr>; rel="${ACP_ACCESS_CONTROL}"`,
        ].join(", "),
        "wac-allow": 'user="read write",public=""',
      },
    },
    [`HEAD ${ess}/pod-1/notes/`]: {
      status: 200,
      headers: { link: LDP_CONTAINER_TYPE },
    },
    [`HEAD ${ess}/pod-1/`]: {
      status: 200,
      headers: { link: [LDP_CONTAINER_TYPE, PIM_STORAGE_TYPE].join(", ") },
    },
    [`GET ${ess}/pod-1/.well-known/solid`]: {
      status: 200,
      headers: { "content-type": "text/turtle" },
      body: `@prefix notify: <http://www.w3.org/ns/solid/notifications#> .
<${ess}/pod-1/.well-known/solid> a <http://www.w3.org/ns/pim/space#Storage> ;
  notify:subscription <https://notification.ess.example/websocket> .
<https://notification.ess.example/websocket> notify:channelType notify:WebSocketChannel2023 ;
  notify:feature notify:state, notify:rate .
`,
    },
    [`OPTIONS ${ess}/pod-1/`]: {
      status: 204,
      headers: {
        allow: "OPTIONS, HEAD, GET, PATCH, POST, PUT, DELETE",
        "accept-patch": "text/n3, application/sparql-update",
        link: `<${ess}/pod-1/?ext=acr>; rel="${ACP_ACCESS_CONTROL}"`,
        "wac-allow": 'user="read write append control",public=""',
      },
    },
  },
};

const nss = "https://nss.example";
/** Node Solid Server 5.x: no storage description, only `Updates-Via` (legacy solid-0.1 websockets). */
export const nssStorage: StorageFixture = {
  name: "nss",
  resource: `${nss}/public/note.ttl`,
  root: `${nss}/`,
  responses: {
    [`HEAD ${nss}/public/note.ttl`]: {
      status: 200,
      headers: {
        link: [
          `<note.ttl.acl>; rel="acl"`,
          `<note.ttl.meta>; rel="describedBy"`,
          LDP_RESOURCE_TYPE,
        ].join(", "),
        "updates-via": "wss://nss.example",
        "wac-allow": 'user="read write append control",public="read"',
      },
    },
    [`HEAD ${nss}/public/`]: {
      status: 200,
      headers: {
        link: `<.acl>; rel="acl", ${LDP_CONTAINER_TYPE}`,
        "updates-via": "wss://nss.example",
      },
    },
    [`HEAD ${nss}/`]: {
      status: 200,
      headers: {
        link: `<.acl>; rel="acl", ${LDP_CONTAINER_TYPE}, ${PIM_STORAGE_TYPE}`,
        "updates-via": "wss://nss.example",
      },
    },
    [`OPTIONS ${nss}/`]: {
      status: 204,
      headers: {
        allow: "OPTIONS, HEAD, GET, PATCH, POST, PUT, DELETE",
        "accept-patch": "application/sparql-update",
        link: `<${nss}/.acl>; rel="acl"`,
        "wac-allow": 'user="read write append control",public="read"',
      },
    },
  },
};

/** The four ADR-002 fixtures. */
export const storageFixtures: readonly StorageFixture[] = [
  cssStorage,
  sparqLwsStorage,
  essStorage,
  nssStorage,
];

/**
 * A fake `fetch` that replays a fixture: unknown requests get a 404 with no links. HEAD
 * responses carry no body. Every call is recorded in `calls` as `"<METHOD> <URL>"`.
 */
export function fixtureFetch(
  fixture: StorageFixture,
): typeof globalThis.fetch & { readonly calls: string[] } {
  const calls: string[] = [];
  const replay = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const key = `${method} ${url}`;
    calls.push(key);
    const recorded = fixture.responses[key];
    if (!recorded) return new Response(null, { status: 404 });
    return new Response(method === "HEAD" ? null : (recorded.body ?? null), {
      status: recorded.status,
      headers: recorded.headers,
    });
  };
  return Object.assign(replay, { calls });
}
