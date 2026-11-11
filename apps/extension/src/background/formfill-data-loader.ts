// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdfSync, type Quad } from '@jeswr/fetch-rdf';
import { Writer } from 'n3';
import type { ResolveFetch } from './core/class-resolve';
import { type FormFillData, readFormFillData } from './core/formfill-data';
import { isValidClientIdUrl } from './core/origin-policy';
import { BUFFERED_RDF_LIMITS } from './core/rdf-limits';

const VCARD = 'http://www.w3.org/2006/vcard/ns#';
const LINKS = new Set([
  ...[
    'hasAddress',
    'hasEmail',
    'hasTelephone',
    'hasName',
    'hasOrganizationName',
    'hasAddressBook',
    'inAddressBook',
  ].map((p) => `${VCARD}${p}`),
  'http://schema.org/address',
  'https://schema.org/address',
  'http://www.w3.org/ns/solid/terms#publicAddressBook',
  'http://www.w3.org/ns/solid/terms#privateAddressBook',
]);

/** Public profile is credential-free. Only explicit profile links on pod origins get private reads. */
export async function loadFormFillData(
  webId: string,
  podOrigins: ReadonlySet<string>,
  fetchDocument: ResolveFetch,
): Promise<FormFillData> {
  if (!isValidClientIdUrl(webId)) throw new Error('Profile address is unavailable.');
  const publicDocument = await fetchDocument(webId, false);
  if (!publicDocument.ok) throw new Error('Could not load your profile.');
  const quads: Quad[] = [];
  parseRdfSync(publicDocument.text, {
    ...BUFFERED_RDF_LIMITS,
    baseIRI: publicDocument.url.split('#')[0],
    format: 'text/turtle',
    onQuad: (quad) => quads.push(quad),
  });
  const links = new Set<string>();
  for (const q of quads) {
    if (
      q.subject.value !== webId ||
      !LINKS.has(q.predicate.value) ||
      q.object.termType !== 'NamedNode'
    )
      continue;
    const url = new URL(q.object.value);
    url.hash = '';
    const profileUrl = new URL(webId);
    profileUrl.hash = '';
    if (url.href !== profileUrl.href && isValidClientIdUrl(url.href) && podOrigins.has(url.origin))
      links.add(url.href);
  }
  // Bounded, one-hop discovery. No crawling other contacts or arbitrary profile-supplied hosts.
  for (const url of [...links].slice(0, 8)) {
    const document = await fetchDocument(url, true);
    if (document.ok)
      parseRdfSync(document.text, {
        ...BUFFERED_RDF_LIMITS,
        baseIRI: document.url.split('#')[0],
        format: 'text/turtle',
        onQuad: (quad) => quads.push(quad),
      });
  }
  const turtle = await new Promise<string>((resolve, reject) => {
    const writer = new Writer();
    writer.addQuads(quads);
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
  return readFormFillData(webId, turtle, publicDocument.url.split('#')[0]);
}
