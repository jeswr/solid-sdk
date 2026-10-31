---
name: pod-type-index
description: Use or maintain @jeswr/pod-type-index for Solid class discovery and create-and-link registration, or LWS type index/search services and creation hints.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-type-index

Read README.md and `skills/solid-type-index/SKILL.md` before changing this package.
`createTypeIndex({ storage, features, profile, fetch? })` exposes `find`, `findAll`, `register`,
`unregister`, and LWS `listClasses`. The factory is synchronous and performs no requests.
Use only the public storage-client surface for storage I/O. The optional guarded authenticated
fetch is exclusively for LWS QUERY; absence fails closed. Never reach into storage backends.

Solid public pointers live on the WebID subject in the profile. Private pointers live on the same
subject in preferences reached through `pim:preferencesFile`. Read/maintain direct private profile
pointers for older clients. Bootstrap only confirmed 404s with exact-name create; require observed
strong ETags for edits. Re-read and reconcile on conflict with at most two retries. New writes use
suite-vocab canonical classes, typed TermWrapper/SetFrom construction, and N3 serialization.
Do not overwrite an unreadable document or grant permissions implicitly. The caller's access layer
must provision owner-only private destinations. Preserve profile readability and unrelated RDF.

Find all requested classes with one request per Solid document. Accept legacy namespace aliases,
return scoped instances and containers, and avoid container crawling. Unregister requires an exact
location; preserve unrelated registrations/annotations and reject ambiguous registrations.

LWS TypeSearchService uses QUERY with `application/lws-query+json` and an OR group of requested
classes plus aliases. Responses are `application/lws+json` ContainerPage; subsequent opaque page
links use GET. TypeIndexService uses GET and TypeIndex pages. Register returns an object whose
`links` can be spread into storage.create; unregister is a no-op. Never edit server-managed types.
Scope all URLs, forbid redirects, bound pages/body sizes, and reject overflow rather than truncating.

This is a security-critical package with 100% statement, branch, function, and line thresholds.
Use memory storage and injected transports for regression/adversarial tests. Build dependencies
first, then run this package's lint, build, typecheck, and test scripts plus the repository gates.
