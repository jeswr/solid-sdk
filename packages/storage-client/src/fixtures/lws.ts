// AUTHORED-BY Codex GPT-6.1-Sol
// Synthetic sparq-lws-core exchanges, not deployment captures. Source paths below are relative
// to /home/user/sparq/crates/sparq-lws-core/ (read-only reference):
// src/lws/mod.rs:421-425 storage id = root; :244 default page_size=100 (fixture overrides to 500).
// src/lws/resources.rs:1180-1247 members (absolute ids, compact type, format/modified; no etag
// in served items); :1305-1319 sizes and page slices; :1353-1402 page ETags, Container JSON,
// Vary/Last-Modified and first/prev/next/last links; :684-704 up/storage/type/linkset headers.
// src/lws/mod.rs:2641-2649 Link syntax; :2709-2767 service listings have the same Container shape.
// src/lws/index.rs:625-675 uses ContainerPage for type search, not ordinary container pages.
// src/lws/resources.rs:4696-4740 linksets (server up/type/self and array-valued self attributes).
// src/lws/resources.rs:1027-1038 data headers; :4781-4784 linkset ETag; :5032-5040 linkset
// Allow/Accept-Patch/anchor headers (stored linksets advertise anchor, not lws#storage).
// Opaque ETag values are synthetic; page suffixes match the stored-container wire format.
import type { RecordedExchanges } from "./css.js";

export const LWS_ROOT = "https://lws.example/";
export const LWS_CONTAINER = `${LWS_ROOT}notes/`;
const LWS = "https://www.w3.org/ns/lws#";
const modified = "2026-10-02T10:30:00Z";

const members = Array.from({ length: 1500 }, (_, i) => ({
  id: `${LWS_CONTAINER}note-${String(i).padStart(4, "0")}.ttl`,
  type: "DataResource",
  format: "text/turtle",
  size: 17,
  modified,
}));
const resource = `${LWS_CONTAINER}note-0000.ttl`;
const links = (url: string, kind: string, up: string) => [
  `<${up}>; rel="up"`,
  `<${LWS_ROOT}>; rel="${LWS}storage"`,
  `<${LWS}${kind}>; rel="type"`,
  `<${url}.meta>; rel="linkset"; type="application/linkset+json"`,
];

/** 1,500 stored members, configured page_size=500, followed by a resource and its linkset. */
export const lwsReadExchanges: RecordedExchanges = {
  ...Object.fromEntries(
    [1, 2, 3].map((page) => {
      const pageUrl = (n: number) => `${LWS_CONTAINER}?page=${n}`;
      const pageLinks = [
        ...links(LWS_CONTAINER, "Container", LWS_ROOT),
        `<${pageUrl(1)}>; rel="first"`,
        ...(page > 1 ? [`<${pageUrl(page - 1)}>; rel="prev"`] : []),
        ...(page < 3 ? [`<${pageUrl(page + 1)}>; rel="next"`] : []),
        `<${pageUrl(3)}>; rel="last"`,
      ];
      return [
        `GET ${page === 1 ? LWS_CONTAINER : pageUrl(page)}`,
        {
          status: 200,
          headers: {
            "content-type": "application/lws+json",
            etag: `"abcdefghijklmnopqrstuvwx${page === 1 ? "" : `-p${page}`}"`,
            "last-modified": "Fri, 02 Oct 2026 10:30:00 GMT",
            vary: "Accept",
            link: pageLinks.join(", "),
          },
          body: JSON.stringify({
            "@context": "https://www.w3.org/ns/lws/v1",
            id: LWS_CONTAINER,
            type: "Container",
            totalItems: 1500,
            items: members.slice((page - 1) * 500, page * 500),
          }),
        },
      ];
    }),
  ),
  [`HEAD ${resource}`]: {
    status: 200,
    headers: {
      "content-type": "text/turtle",
      etag: '"note"',
      "last-modified": "Fri, 02 Oct 2026 10:30:00 GMT",
      "accept-ranges": "bytes",
      "x-content-type-options": "nosniff",
      "content-length": "17",
      link: links(resource, "DataResource", LWS_CONTAINER).join(", "),
    },
  },
  [`GET ${resource}`]: {
    status: 200,
    headers: {
      "content-type": "text/turtle",
      etag: '"note"',
      "last-modified": "Fri, 02 Oct 2026 10:30:00 GMT",
      "accept-ranges": "bytes",
      "x-content-type-options": "nosniff",
      "content-length": "17",
      link: links(resource, "DataResource", LWS_CONTAINER).join(", "),
    },
    body: '<> <urn:p> "hi" .\n',
  },
  [`GET ${resource}.meta`]: {
    status: 200,
    headers: {
      "content-type": "application/linkset+json",
      etag: '"ls-abcdefghijklmnop"',
      allow: "GET, HEAD, PUT, PATCH",
      "accept-patch": "application/json-patch+json",
      link: `<${resource}>; rel="anchor"`,
    },
    body: JSON.stringify({
      linkset: [
        {
          anchor: resource,
          up: [{ href: LWS_CONTAINER }],
          type: [{ href: `${LWS}DataResource` }],
          self: [{ href: resource, format: ["text/turtle"], size: ["17"], modified: [modified] }],
        },
      ],
    }),
  },
};

// T-024 synthetic write exchanges. These represent the ADR-003 §7 wire contract, not
// deployment captures; move's Content-Location variant is supplied by the mutation tests.
export const LWS_WRITE_RESOURCE = `${LWS_CONTAINER}write.ttl`;
export const LWS_WRITE_METADATA = `${LWS_WRITE_RESOURCE}.meta`;
export const lwsWriteExchanges: RecordedExchanges = {
  [`PUT ${LWS_WRITE_RESOURCE}`]: { status: 204, headers: { etag: '"written"' } },
  [`POST ${LWS_CONTAINER}`]: {
    status: 201,
    headers: { location: LWS_WRITE_RESOURCE },
  },
  [`HEAD ${LWS_WRITE_RESOURCE}`]: {
    status: 200,
    headers: {
      etag: '"resource"',
      "content-type": "text/turtle",
      link: `<${LWS_WRITE_METADATA}>; rel="linkset", <${LWS_CONTAINER}>; rel="up"`,
    },
  },
  [`GET ${LWS_WRITE_RESOURCE}`]: {
    status: 200,
    headers: { etag: '"resource"', "content-type": "text/turtle" },
    body: '<urn:s> <urn:p> "old".\n',
  },
  [`PATCH ${LWS_WRITE_RESOURCE}`]: { status: 204, headers: { etag: '"patched"' } },
  [`DELETE ${LWS_WRITE_RESOURCE}`]: { status: 204, headers: {} },
  [`GET ${LWS_WRITE_METADATA}`]: {
    status: 200,
    headers: { etag: '"metadata"', "content-type": "application/linkset+json" },
    body: JSON.stringify({
      linkset: [
        {
          anchor: LWS_WRITE_RESOURCE,
          up: [{ href: LWS_CONTAINER }],
          related: [{ href: "urn:old" }],
        },
      ],
    }),
  },
  [`PATCH ${LWS_WRITE_METADATA}`]: { status: 204, headers: { etag: '"updated-metadata"' } },
  [`HEAD ${LWS_WRITE_METADATA}`]: { status: 200, headers: { etag: '"observed-metadata"' } },
};
