// AUTHORED-BY Claude Opus 5.5
// Synthetic Community Solid Server 7.x exchanges for the Solid backend's read side (T-021).
// Shaped after CSS's public behaviour (headers, link relations, container listings); not captured
// from a deployment, and free of personal data and credentials.

export interface RecordedResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** Responses keyed by `"<METHOD> <absolute URL>"`. */
export type RecordedExchanges = Readonly<Record<string, RecordedResponse>>;

export const CSS_ROOT = "https://css.example/alice/";
const notes = `${CSS_ROOT}notes/`;

const LDP_RESOURCE = '<http://www.w3.org/ns/ldp#Resource>; rel="type"';
const LDP_CONTAINER = [
  '<http://www.w3.org/ns/ldp#Container>; rel="type"',
  '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
  LDP_RESOURCE,
].join(", ");

const listing = `@prefix dc: <http://purl.org/dc/terms/>.
@prefix ldp: <http://www.w3.org/ns/ldp#>.
@prefix posix: <http://www.w3.org/ns/posix/stat#>.
@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.

<> a ldp:Container, ldp:BasicContainer, ldp:Resource;
    dc:modified "2026-10-01T09:00:00.000Z"^^xsd:dateTime;
    ldp:contains <today.ttl>, <photo.png>, <archive/>, <archive/deep.ttl>, <https://evil.example/x>.
<today.ttl> a <http://www.w3.org/ns/iana/media-types/text/turtle#Resource>, ldp:Resource,
        <https://schema.example/Note>;
    dc:modified "2026-10-02T10:30:00.000Z"^^xsd:dateTime;
    posix:mtime 1790937000;
    posix:size 143.
<photo.png> a ldp:Resource;
    dc:format "image/png";
    posix:size 8.
<archive/> a ldp:Container, ldp:BasicContainer, ldp:Resource;
    dc:modified "2026-09-30T08:00:00.000Z"^^xsd:dateTime.
`;

const today = `@prefix schema: <https://schema.example/>.
<> a schema:Note; schema:text "Buy oat milk".
`;

const meta = `<${notes}today.ttl> <https://schema.example/license> <https://license.example/cc0>;
    <http://www.iana.org/assignments/relation/author> <https://id.example/alice#me>.
`;

/** CSS read-side exchanges: a listing with mixed members, a Turtle note, a PNG and metadata. */
export const cssReadExchanges: RecordedExchanges = {
  [`GET ${notes}`]: {
    status: 200,
    headers: {
      "content-type": "text/turtle",
      etag: '"1790850000000-text/turtle"',
      link: LDP_CONTAINER,
      "wac-allow": 'user="read write append control",public=""',
    },
    body: listing,
  },
  [`HEAD ${notes}today.ttl`]: {
    status: 200,
    headers: {
      "content-type": "text/turtle",
      etag: '"1790937000000-text/turtle"',
      "last-modified": "Fri, 02 Oct 2026 10:30:00 GMT",
      link: `${LDP_RESOURCE}, <${notes}today.ttl.meta>; rel="describedby", <${notes}today.ttl.acl>; rel="acl"`,
      "wac-allow": 'user="read write append control",public=""',
    },
  },
  [`GET ${notes}today.ttl`]: {
    status: 200,
    headers: {
      "content-type": "text/turtle",
      etag: '"1790937000000-text/turtle"',
      "last-modified": "Fri, 02 Oct 2026 10:30:00 GMT",
      link: `${LDP_RESOURCE}, <${notes}today.ttl.meta>; rel="describedby"`,
      "wac-allow": 'user="read write append control",public=""',
    },
    body: today,
  },
  [`GET ${notes}today.ttl.meta`]: {
    status: 200,
    headers: { "content-type": "text/turtle", etag: '"1790937000001-text/turtle"' },
    body: meta,
  },
  [`GET ${notes}photo.png`]: {
    status: 200,
    headers: {
      "content-type": "image/png",
      etag: '"1790900000000-image/png"',
      link: LDP_RESOURCE,
      "wac-allow": 'user="read",public=""',
    },
    body: "PNGBYTES",
  },
};
