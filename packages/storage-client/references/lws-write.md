<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

# LWS write side

Read with [storage-client guidance](../SKILL.md) and the [LWS read side](lws-read.md) for shared validation.


- Every mutation target, destination, Location, Content-Location and follow-up HEAD stays scoped
  to the root, with the same canonicalisation, credential redaction, manual redirects, bounded
  Link parsing and response storage-id validation as reads. Mutation URLs reject queries and
  fragments, including empty delimiters. PUT/PATCH/DELETE accept only 200/204/205; POST requires
  201. In particular, PUT never creates: 404 remains not-found, 201 is invalid-response.
- `write`/`writeRdf` require a nonempty `ifMatch`; `'*'` sends `If-Match: *`. All other mutations
  require a non-wildcard ETag. Headers reject whitespace padding, CR/LF/NUL and non-ByteString
  values; media types must be syntactically valid. Root content cannot be PUT; other resource
  kinds are validated by the server, never inferred from an identifier's trailing slash.
  RDF serialisation uses the shared serializer; JSON-LD writing remains unsupported.
- `create` always POSTs: optional decoded `name` is percent-encoded as the Slug hint, never an exact child name.
  Name hints reject empty values and control characters before any request; spaces are encoded. Emit Container
  or DataResource Link type plus each validated `opts.links` entry. Initial up/linkset metadata is
  refused. Create parents and move destinations may be slashless opaque identifiers; the server
  validates their kind. Null bodies become empty bodies; containers default to application/lws+json, resources
  require contentType. Location is mandatory, scoped and query/fragment-free, but need not follow
  the parent's URL path (LWS logical containment). It cannot name the parent or root. Untrusted
  Location and Content-Location values are never retained in errors or causes.
- Ordinary mutation results use their response ETag or a follow-up HEAD, else null if HEAD fails:
  the mutation already committed. Streaming bodies are forwarded with duplex half and never
  replayed automatically; failures, including HTTP errors, are nonretryable for streams.
- JSON patch sends application/json-patch+json plus If-Match. Raw patches validate mediaType and
  string body. RDF patch rebuilds caller quads before asynchronous reads, refuses invalid term
  positions, variables and any nonempty where clause. When any SPARQL format is advertised, HEAD
  discovers the actual resource media type: only that format's advertisement enables SPARQL
  DELETE DATA/INSERT DATA for default-graph patches, using the shared safe formula serializer.
  Patches containing named graphs always use RMW to preserve graph identity in TriG/N-Quads.
- **Otherwise RDF patch is RMW:** readRdf, check the initial ETag against the caller's ifMatch,
  applyQuadPatch in n3 Store, serialize in the original writable RDF format, then PUT with the
  read ETag. On 412 reread and reapply exactly once; the initial caller ETag check is not repeated
  against the newer state. A second 412 propagates. Missing retry ETags fail closed; absent
  deletions conflict, blank-node deletions and named graphs in triple-only formats are refused.
- `setMetadata` uses the linkset ETag (not the content ETag), checked before PATCH. Generate
  sequential JSON Patch against a cloned raw document, retaining other anchors, relations and
  attributes. Add new anchors/rel arrays when needed, append absent targets, remove all matching
  target occurrences descending within each repeated anchor context, and escape JSON Pointer
  keys. Empty/no-op changes avoid PATCH. Explicit anchors must be scoped; hrefs and extension
  rels must be absolute IRIs; registered rel tokens lower-case. type/up/linkset are always
  unsupported here, including when MoveResource is available; anchor is reserved structure.
- `move` requires features.move available, a matching source ETag, and a usable linkset ETag.
  Container moves also require detail.containers. Refuse root/self moves. Ignore name. Require
  one resource context with one up target, then send test of the raw anchor and replace of
  `/linkset/i/up/0/href`, with the linkset's If-Match. When Content-Location is present (or
  preservesIdentifier is false), require scoped Content-Location and parse the bounded returned
  linkset; require one scoped anchor with exactly one up target naming the destination and one
  linkset target naming Content-Location, independently of context order. Reject missing or
  ambiguous identity relations before the follow-up HEAD. A move with
  preservesIdentifier false requires Content-Location. HEAD the resulting resource for its ETag;
  the PATCH ETag belongs to the linkset. created is true only when the identifier changes.
- Nonrecursive delete sends If-Match and refuses the root. Recursive delete always uses client
  traversal: features.recursiveDelete advertises the POST-based RecursiveDeleteService, which
  does not establish Depth support for DELETE. HEAD-check the top ETag,
  preflight paginated listings + HEAD through logical containment (not URI prefixes), accepting
  slashless opaque container identifiers only after HEAD confirms their container kind. Require
  each child's up to match its listed parent and every child to have an ETag. Cycles, duplicates, root members,
  and trees above 10,000 nodes fail before deletion. Delete in reverse traversal order, refreshing
  container ETags after child deletion; every DELETE is conditional. Concurrent additions can
  still produce 409 and partial deletion. Errors propagate without a destructive retry.

- `WriteOptions.keepalive` / `CreateOptions.keepalive` reach fetch after the shared 64 KiB
  encoded-body check; unknown-size streams/Blobs fail bad-request before sending.
- `MetadataOp.title` adds RFC 9264's title attribute to a new target, or updates it on an
  existing href while retaining its other attributes. Removal continues to match hrefs.
