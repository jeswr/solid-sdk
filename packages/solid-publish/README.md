<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

# @jeswr/solid-publish

Publish a small static website from a Solid pod. The browser-safe package owns the
generated RDF model, Markdown rendering, RSS and all publishing/storage operations.
No scripts, third-party stylesheet requests or suite runtime are needed to read the output.

`Site` is `https://schema.org/WebSite`; `Page` is `https://schema.org/WebPage`.
`codegen/publish.ttl`, `codegen/publish.shacl.ttl` and `codegen.config.json` are the
inputs to `pnpm run codegen`. Every accessor, RDF builder/parser and serializer in
`src/generated/` is generated; `src/model.ts` is a thin validation facade.

The site fields are schema.org `name`, `description`, `author` (display-name string),
`inLanguage`, `url` (the successful public container), Dublin Core `created`/`modified`
and `https://jeswr.org/ns/publish#theme` (paper, journal or garden).
Pages use schema.org `headline`, `text`, `abstract`, `genre` (page or post),
`creativeWorkStatus` (draft or published), `position`, `datePublished`, `dateModified`,
`image` and literal `keywords`, plus `https://jeswr.org/ns/publish#slug`.
All schema.org IRIs use HTTPS. There is no publishing federation sector to narrow.
The SHACL header documents the local projection and date/author/enum restrictions.

`validateSite`, `validatePage`, `serializeSite`, `serializePage`, `parseSite` and
`parsePage` delegate RDF to the generated entities. The facade validates the URL slug
grammar, a language-code grammar and publication dates. Generated `subject()` uses an
absolute document URL plus `#it`. Slugs contain lowercase ASCII letters/digits with
single internal hyphens and at most 80 characters. Slug uniqueness is checked per site.
`slugify` and `uniqueSlug` help create them without changing stable source identifiers.

`renderPage(site, page, pages)`, `renderIndex(site, posts, navigation?)` and
`renderFeed(site, posts)` are pure. Supply `site.publicUrl` as an absolute, slash-ended
public container. Markdown goes through marked 17.0.6 and sanitize-html 2.18.1, the
same versions as app-suite. The explicit tag/attribute/protocol allow-list excludes
scripts, styles, forms, embeds, event handlers and scheme-relative links. External links
get `rel="noopener noreferrer"`. All template text and XML fields are escaped;
XML also removes illegal XML 1.0 code points. An inline stylesheet, semantic landmarks,
skip link, language, canonical/description/Open Graph metadata and script-src 'none'
CSP make each HTML file self-contained. Markdown H1s become H2s below the page title.

`openPublishRepository(fetch, storageRoot, owner, options?)` discovers a storage through
the SDK. A caller that already knows the account protocol may supply `{protocol: "solid"}`;
this uses the SDK's public Solid backend without guessing from HTTP errors or hostnames.
The suite uses this explicit path because its PodSession contract is Solid, including
the demo pod, which has no discovery-description link. `publishRepository(storage, fetch,
owner)` accepts an existing SDK storage client for integration and tests.

Sources live at `publish/<site>/site.ttl` and `publish/<site>/pages/<id>.ttl`. The
repository uses pod-access roles to install owner-only own permissions on every source
folder and document before writing source bytes. New files start as empty placeholders.
It registers WebSite instances in the private Type Index through pod-type-index; private
index/preferences creation is sealed before RDF is written. It preserves the public
profile's audience. Only generated entities read/write the website and page RDF.

Public output is `public/sites/<site>/index.html`, `<slug>/index.html` and `feed.xml`.
Publishing requires first-time confirmation, saves the owner-only RDF source, rebuilds
published pages/navigation/index/feed, then grants public **Read only** on that site's
container and its members via pod-access. It never grants public access to ancestors or
source RDF. Saving a private draft writes no public bytes. Editing a published page in
the app stays in a local editor draft until Update. Unpublishing removes its HTML and
refreshes all remaining public navigation and RSS; removing the last published page
also removes the index/feed and clears the public URL. It cannot recall reader copies.

All writes/deletes use observed strong ETags; stale saves are refused. Saved source
versions must come from the write response itself: a later HEAD's ETag may belong to
another writer, so an uncertain response requires a reload before another edit. Publication is a
sequence of conditional operations, not a pod transaction. A network/permission failure
can leave some public files updated and others unchanged. The error explicitly reports
that the source may have been saved; reload and repeat the operation to converge.
Concurrent changes after a final version check remain a protocol limitation.

The first cut supports WAC Solid storage only. ACP and LWS fail closed: inherited ACP
rules require a richer proof of owner-only source access, and LWS may assign opaque paths.
Unusual WAC policies or folder/member scope mismatches are refused by pod-access.

Generator constraints encountered: `language` is a reserved accessor name, so the field
is `inLanguage`; the slug pattern is `\S` in SHACL with its stricter grammar in the facade.
No generator/runtime modifications or hand-written RDF accessors were needed.

Validation: package function/security tests, byte-for-byte codegen drift, app state/data
tests and a demo Playwright spec (run by the lead). No third-party dependencies were added
to the workspace; this package reuses already locked versions.
