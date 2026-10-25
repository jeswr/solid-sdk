/**
 * Shared fixtures for the fetch-rdf test suite.
 */

export const TURTLE_SAMPLE = `
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix : <http://example.org/> .

:alice a foaf:Person ;
  foaf:name "Alice" ;
  foaf:knows :bob .

:bob a foaf:Person ;
  foaf:name "Bob" .
`;

export const N_TRIPLES_SAMPLE = `<http://example.org/alice> <http://xmlns.com/foaf/0.1/name> "Alice" .
<http://example.org/alice> <http://xmlns.com/foaf/0.1/knows> <http://example.org/bob> .
<http://example.org/bob> <http://xmlns.com/foaf/0.1/name> "Bob" .
`;

export const N_QUADS_SAMPLE = `<http://example.org/alice> <http://xmlns.com/foaf/0.1/name> "Alice" <http://example.org/g1> .
<http://example.org/alice> <http://xmlns.com/foaf/0.1/knows> <http://example.org/bob> <http://example.org/g1> .
`;

export const JSON_LD_SAMPLE = JSON.stringify({
  '@context': {
    foaf: 'http://xmlns.com/foaf/0.1/',
    name: 'foaf:name',
    knows: { '@id': 'foaf:knows', '@type': '@id' },
  },
  '@id': 'http://example.org/alice',
  '@type': 'foaf:Person',
  name: 'Alice',
  knows: 'http://example.org/bob',
});

/** Build a `Response`-shaped object suitable for handing to a mock fetch.
 *
 * Note: the WHATWG `Response` constructor *adds* a default
 * `content-type: text/plain;charset=UTF-8` header when given a string
 * body. To model "server returned no Content-Type", pass
 * `omitContentType: true` and we'll delete the header after construction. */
export function makeResponse(
  body: string,
  init: {
    status?: number;
    contentType?: string;
    omitContentType?: boolean;
    etag?: string;
    url?: string;
  } = {},
): Response {
  const status = init.status ?? 200;
  const headers = new Headers();
  if (init.contentType !== undefined) headers.set('content-type', init.contentType);
  if (init.etag !== undefined) headers.set('etag', init.etag);
  // The web `Response` constructor doesn't expose `url` — undici/Node/whatwg
  // all derive it from the request. We use `Object.defineProperty` so the
  // mock looks like a real fetched Response.
  const res = new Response(body, { status, headers });
  if (init.contentType === undefined && init.omitContentType !== true) {
    // Mirror the real fetch behaviour: most servers send a Content-Type.
    // If the caller didn't pin one, default to text/turtle so RDF tests
    // are well-defined; explicit `omitContentType: true` opts out.
    res.headers.set('content-type', 'text/turtle');
  }
  if (init.omitContentType === true) {
    res.headers.delete('content-type');
  }
  if (init.url !== undefined) {
    Object.defineProperty(res, 'url', { value: init.url, configurable: true });
  }
  return res;
}
