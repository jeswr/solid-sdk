<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/pod-type-index

**Experimental — AI-agent-generated.** Discover RDF classes across Solid Type Index documents
and LWS TypeIndexService / TypeSearchService endpoints.

```ts
import { createTypeIndex } from '@jeswr/pod-type-index';

const index = createTypeIndex({ storage, features, profile: webId, fetch: authFetch });
const locations = await index.find('https://schema.org/TextDigitalDocument');
const byClass = await index.findAll([documentClass, taskClass]);
const hint = await index.register(documentClass, { container: documents });
// On LWS, declare types when creating each resource (container types describe the container).
await storage.create(documents, body, { contentType: 'text/turtle', ...hint });
await index.unregister(documentClass, { container: documents });
```

`register` and `unregister` require exactly one `container` or `instance`. Their optional third
argument is `{ index: 'private' | 'public' }` (default `private`). Solid registration returns
`undefined`; LWS returns `{ links: [{ rel: 'type', target: canonicalClass }] }` without I/O.
LWS unregister is also a no-op: the server owns its index, and deleting resources removes their
entries. `listClasses()` reads the LWS TypeIndexService; on Solid it throws `unsupported`.

Solid discovers public indexes on the WebID subject in the profile and private indexes through
`pim:preferencesFile`; legacy private links directly in the profile are also read and maintained.
`findAll` reads each document once per call, even for shared index URLs and multiple classes.
Locations are de-duplicated, containers are returned as locations rather than traversed, and known
legacy class namespaces from `@jeswr/suite-vocab` are accepted. New registrations use canonical IRIs.
Missing linked indexes yield no locations; unreadable or invalid documents propagate errors.

On a bare profile, registration creates `settings/privateTypeIndex.ttl`, types it as a TypeIndex
and UnlistedDocument, links it from `settings/prefs.ttl`, then links preferences from the profile.
Public registration creates a ListedDocument and links it directly from the profile. Existing
preferences and unrelated RDF are retained. Existing default-path documents are adopted only when
typed as TypeIndex. Bootstrap requires reported root Write and Control access. Only a confirmed 404 permits creation, using `storage.create`'s exact-name
Solid PUT with `If-None-Match: *`. Edits require a strong observed ETag and `writeRdf` with `ifMatch`;
no wildcard overwrite is used. Conflicts re-read/reconcile at most twice. An interrupted bootstrap
may leave an unlinked index; repeating registration reuses it. No-op changes avoid writes.
Unregister removes only the exact class/location registration, keeps other entries and annotations,
and refuses ambiguous multi-class or multi-location entries. It does not delete documents/links.

All document and result URLs must be HTTP(S), credential-free, and inside the selected storage.
Foreign profile documents are unsupported by this storage-scoped API. Reads drop unsafe linked
URLs; mutations reject them. Data discovery grants no access. Bootstrap inherits the destination
container's access controls: callers must provision owner-only settings/preferences/private-index
access through their access layer before registration. The UnlistedDocument type itself is not
an ACL. This package does not modify access controls or make the profile private.

LWS requires advertised, available server type-index features. `findAll` sends one QUERY with an
OR group containing all requested classes and known aliases, partitions returned resource types,
and follows opaque next links with GET. `fetch` must be the guarded authenticated transport used
by storage; it is needed because StorageClient has no QUERY method. All other I/O uses the public
StorageClient API. No global fetch fallback or backend imports are used. Service endpoints and
pagination stay within storage scope. Each operation has a 30-second transport deadline, at most
64 documents/pages and 10,000 matching locations/items; LWS JSON pages are capped at 1 MiB.
Overflow rejects instead of returning misleading partial results. Results are never cached across
operations/accounts, and LWS results may reflect eventually consistent server derivation.

The `./testing` entry re-exports `createMemoryStorage` for offline fixtures. The React façade
package `@jeswr/suite-sdk` is absent from this SDK stack; its provider/hook integration is owned by
SDK-APP-01. Its future `useTypeIndex()` can hold this client per selected account/storage.
