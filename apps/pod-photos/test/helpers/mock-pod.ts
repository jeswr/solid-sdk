// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * A tiny in-memory Solid pod for tests: a `fetch` implementation backed by a
 * URL→Turtle map that honours the request semantics the data layer relies on —
 * `If-None-Match: *` create-only (412 if present), `If-Match` (412 on mismatch),
 * ETags, `DELETE`, and `cache-control: no-cache` revalidation GETs. RDF bodies
 * are stored verbatim and served as `text/turtle`.
 */

export interface MockResource {
  body: string;
  etag: string;
  contentType: string;
}

export class MockPod {
  readonly resources = new Map<string, MockResource>();
  private seq = 0;

  /** Seed a Turtle resource directly (bypassing the write path). */
  seed(url: string, body: string, contentType = 'text/turtle'): void {
    this.resources.set(MockPod.key(url), { body, etag: this.nextEtag(), contentType });
  }

  private nextEtag(): string {
    this.seq += 1;
    return `"etag-${this.seq}"`;
  }

  /**
   * Strip the fragment from a request URL. A WebID like `…/card#me` and the
   * document URL `…/card` address the SAME stored resource on a real Solid
   * server (the fragment is resolved client-side), so the mock must key on the
   * fragment-less URL — otherwise a read of `#me` and a write of the document
   * touch different slots and the ETag-guarded profile write spuriously 412s.
   */
  private static key(url: string): string {
    try {
      const u = new URL(url);
      u.hash = '';
      return u.toString();
    } catch {
      return url;
    }
  }

  /** A `fetch` bound to this pod, suitable for the `fetchImpl` test override. */
  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = MockPod.key(typeof input === 'string' ? input : input.toString());
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const existing = this.resources.get(url);

    if (method === 'GET') {
      if (!existing) return new Response('Not found', { status: 404 });
      return new Response(existing.body, {
        status: 200,
        headers: { 'content-type': existing.contentType, etag: existing.etag },
      });
    }

    if (method === 'PUT') {
      if (headers.get('if-none-match') === '*' && existing) {
        return new Response('Exists', { status: 412 });
      }
      const ifMatch = headers.get('if-match');
      if (ifMatch && (!existing || existing.etag !== ifMatch)) {
        return new Response('Precondition failed', { status: 412 });
      }
      const etag = this.nextEtag();
      this.resources.set(url, {
        body: typeof init?.body === 'string' ? init.body : '',
        etag,
        contentType: headers.get('content-type') ?? 'text/turtle',
      });
      return new Response(null, { status: existing ? 205 : 201, headers: { etag } });
    }

    if (method === 'DELETE') {
      if (!existing) return new Response(null, { status: 404 });
      this.resources.delete(url);
      return new Response(null, { status: 205 });
    }

    return new Response('Method not allowed', { status: 405 });
  };
}

/** Build a `ldp:contains` container listing Turtle for the given child URLs. */
export function containerTurtle(containerUrl: string, children: string[]): string {
  const head = `<${containerUrl}> a <http://www.w3.org/ns/ldp#Container>, <http://www.w3.org/ns/ldp#BasicContainer>`;
  if (children.length === 0) return `${head} .`;
  const contains = `  <http://www.w3.org/ns/ldp#contains> ${children
    .map((c) => `<${c}>`)
    .join(', ')} .`;
  return `${head} ;\n${contains}`;
}

/** One annotated child for {@link richContainerTurtle}. */
export interface RichChild {
  url: string;
  /** Mark as a sub-container (ldp:Container). */
  container?: boolean;
  /** ISO last-modified (→ dcterms:modified). */
  modified?: string;
  /** Byte size (→ stat:size). */
  size?: number;
  /** MIME type (→ a literal the @solid/object Resource exposes as mimeType). */
  mimeType?: string;
}

/**
 * A richer container listing carrying the per-child `dcterms:modified` /
 * `stat:size` / `stat:mtime` style metadata that `@solid/object`'s
 * `ContainerDataset` surfaces — so the listing branches that read those fields
 * are exercised.
 */
export function richContainerTurtle(containerUrl: string, children: RichChild[]): string {
  const LDP = 'http://www.w3.org/ns/ldp#';
  const DCT = 'http://purl.org/dc/terms/';
  const STAT = 'http://www.w3.org/ns/posix/stat#';
  const IANA = 'http://www.w3.org/ns/iana/media-types/';
  const lines = [
    `<${containerUrl}> a <${LDP}Container>, <${LDP}BasicContainer> ;`,
    `  <${LDP}contains> ${children.map((c) => `<${c.url}>`).join(', ')} .`,
  ];
  for (const c of children) {
    const rdfTypes = [c.container ? `<${LDP}Container>` : `<${LDP}Resource>`];
    // `@solid/object` derives mimeType from an IANA media-type rdf:type IRI.
    if (c.mimeType) rdfTypes.push(`<${IANA}${c.mimeType}#Resource>`);
    const parts = [`<${c.url}> a ${rdfTypes.join(', ')}`];
    if (c.modified) {
      parts.push(`<${DCT}modified> "${c.modified}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`);
    }
    if (c.size !== undefined) parts.push(`<${STAT}size> ${c.size}`);
    lines.push(`${parts.join(' ;\n  ')} .`);
  }
  return lines.join('\n');
}
