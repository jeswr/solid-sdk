<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Appendix: TrashService and VersioningService client protocol

Append-only contribution for the solid-sd draft in
`jeswr/solid-specs/specs/service-description/` (SDK-APP-12, bead sst-8xm.78).
The draft repository is absent from this lane; this file is the complete appendix for
transfer there. This appendix does not change T-090's acceptance criteria or the
service-description discovery algorithm.

The key words MUST, MUST NOT, SHOULD, and MAY have their usual RFC 2119 meaning.
Endpoints are discovered as `ssd:TrashService` and `ssd:VersioningService` service
entries. Their advertisement conveys capability, never authorization. All requests
use the authenticated transport and retain the storage client's scope checks.
Servers SHOULD expose Link, Location, ETag, and Memento-Datetime through CORS.

## TrashService

The service endpoint MUST be a container. Its description MAY include
`ssd:retention` with datatype `xsd:duration`, for example `"P30D"^^xsd:duration`.
This describes server retention; clients MUST NOT assume a trashed resource will
remain available indefinitely.

To trash a resource, POST `application/json` with exactly `{"resource": "<url>"}`
to the service endpoint. The server moves the resource into trash, removes the live
resource, and returns **201** with a **Location** naming the trashed copy. Its
identifier is not preserved. Clients MUST use Location rather than deriving a name.

The service listing uses the storage's ordinary container protocol. Each entry's
metadata document (Solid `describedby`, LWS `linkset`) MUST associate the trashed URL
with exactly one `original` relation, as defined by RFC 7089. In Solid RDF, the
registered relation is represented by
`http://www.iana.org/assignments/relation/original`; the trash time is
`http://purl.org/dc/terms/modified` (`xsd:dateTime`) on the trashed resource. In an
LWS RFC 9264 JSON linkset, the `original` target carries a string `modified`
attribute containing the trash time, for example:

```json
{"linkset":[{"anchor":"https://pod.example/.trash/entry-7","original":[{"href":"https://pod.example/notes/a","modified":"2026-10-31T10:00:00Z"}]}]}
```

To restore, POST `application/json` with exactly `{"restore": "<trashedUrl>"}` to
the same endpoint. Success is **200 or 201**, with **Location** mandatory: the
original URL on Solid, a newly assigned identifier on LWS. A restore removes the
trash entry. A server MUST report a conflict rather than overwrite an occupied
Solid original URL. Missing or expired entries are not found. To purge, DELETE the
trashed copy. Clients SHOULD HEAD it and use its current ETag in If-Match. Purge
permanently removes that copy; it MUST NOT delete the original/live resource.

Example 1 — trash, metadata, restore, purge (independent entries):

```http
POST /.trash/ HTTP/1.1
Content-Type: application/json

{"resource":"https://pod.example/notes/a"}

HTTP/1.1 201 Created
Location: https://pod.example/.trash/entry-7

POST /.trash/ HTTP/1.1
Content-Type: application/json

{"restore":"https://pod.example/.trash/entry-7"}

HTTP/1.1 200 OK
Location: https://pod.example/notes/a

DELETE /.trash/entry-8 HTTP/1.1
If-Match: "trash-8"

HTTP/1.1 204 No Content
```

On LWS the restore response instead assigns a new Location, for example
`https://pod.example/resources/new-42`.

## VersioningService

The service endpoint is a URI template containing one `{resource}` variable. Its
value is the absolute live resource URL, expanded using RFC 6570 simple string
expansion (percent encoding the complete URL). Expansion identifies a container
of immutable versions. A live resource MAY also advertise that container through
`Link: <container>; rel="version-history"` (RFC 5829). Clients MAY prefer that
link. Each listed version MUST provide **Memento-Datetime** on HEAD and GET
(RFC 7089); its ETag is the version representation's validator. Version bytes and
their timestamp MUST NOT change. ETags and listing order do not imply chronology.

Example 2 — version discovery and listing (Solid; LWS uses its ordinary JSON
container representation):

A service entry in an LWS CID advertises the template as follows:

```json
{
  "type": "https://jeswr.org/ns/solid-sd#VersioningService",
  "serviceEndpoint": "https://pod.example/.versions/?resource={resource}"
}
```

```http
HEAD /notes/a HTTP/1.1

HTTP/1.1 200 OK
ETag: "live-3"
Link: <https://pod.example/.versions/a/>; rel="version-history"

GET /.versions/a/ HTTP/1.1
Accept: text/turtle

HTTP/1.1 200 OK
Content-Type: text/turtle

<https://pod.example/.versions/a/> <http://www.w3.org/ns/ldp#contains>
  <https://pod.example/.versions/a/1>, <https://pod.example/.versions/a/2> .

HEAD /.versions/a/1 HTTP/1.1

HTTP/1.1 200 OK
ETag: "version-1"
Memento-Datetime: Sat, 31 Oct 2026 10:00:00 GMT
```

To restore a version, the client MUST verify it belongs to the resource's history,
read the current live resource's ETag, GET the selected version, and PUT those bytes
and Content-Type over the live URL with **If-Match: the observed live ETag**. A
missing or unusable live validator MUST fail closed. The client MUST NOT use `*`,
the version's ETag, or an unconditional write. A 412 propagates for caller conflict
handling; clients MUST NOT silently retry over concurrent edits. The restore is a
new content write and creates a new version; it does not mutate the selected version.

Example 3 — conditional restore, preserving version media type and bytes:

```http
HEAD /notes/a HTTP/1.1

HTTP/1.1 200 OK
ETag: "live-3"

GET /.versions/a/1 HTTP/1.1

HTTP/1.1 200 OK
Content-Type: text/plain
ETag: "version-1"
Memento-Datetime: Sat, 31 Oct 2026 10:00:00 GMT

first draft

PUT /notes/a HTTP/1.1
Content-Type: text/plain
If-Match: "live-3"

first draft

HTTP/1.1 204 No Content
ETag: "live-4"
```

The SDK only enables these operations when `features.trash` or
`features.versioning` is `available` with an endpoint. Otherwise every operation
throws `unsupported` before I/O. Unsafe service endpoints, metadata, linked histories,
and returned Locations do not authorize out-of-scope requests. The SDK's existing
path guard refuses encoded slashes in paths; a query template such as example 2
(or a scoped `version-history` link) interoperates without weakening that guard.
