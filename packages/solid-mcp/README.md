<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/solid-mcp

An MCP server that exposes a Solid pod as scoped resources and read, search, list, and write tools.

Library callers supply authentication; the stdio CLI supports CSS client credentials.
Access is confined to one pod root, and writes are disabled by default.

> Experimental — AI-agent-generated. Review the scope and keep `readOnly: true` unless the MCP client should modify pod
> data.

## Install

```sh
npm install github:jeswr/solid-mcp#main "@modelcontextprotocol/sdk@^1.29"
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import { createSolidMcpServer } from "@jeswr/solid-mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = createSolidMcpServer({
  fetch: authenticatedFetch,
  podRoot: "https://alice.example/",
  webId: "https://alice.example/profile/card#me",
  readOnly: true,
});

await server.connect(new StdioServerTransport());
```

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Authenticated stdio CLI

The bundled `solid-mcp` CLI logs in with a Community Solid Server (CSS) account's
client-credentials token **id and secret**, exchanged for a DPoP-bound access token.
These are CSS account credentials, not a public OIDC Client Identifier Document.
Tokens and the DPoP key stay in process memory; expired tokens are re-acquired using
the same key. Nothing is cached on disk. All registered tools and resources use the
same authenticated fetch; writes still require `readOnly: false`.

Set environment variables or create `~/.config/solid-mcp/config.json`:

```json
{
  "podRoot": "https://alice.example/",
  "webId": "https://alice.example/profile/card#me",
  "readOnly": true,
  "oidcIssuer": "https://solid.example/",
  "clientId": "YOUR_CSS_CREDENTIAL_ID",
  "clientSecret": "YOUR_CSS_CREDENTIAL_SECRET"
}
```

Create the file privately before editing it, and keep it out of version control:

```sh
mkdir -p ~/.config/solid-mcp
install -m 600 /dev/null ~/.config/solid-mcp/config.json
# Edit the file with your own values, then verify its mode:
chmod 600 ~/.config/solid-mcp/config.json
```

An existing config must be a regular file with **exactly mode 0600**; symlinks and
other modes are refused, including when environment variables override its values.
Environment variables override individual JSON fields:

| Environment | JSON field | Meaning |
| --- | --- | --- |
| `SOLID_MCP_POD_ROOT` | `podRoot` | Required absolute pod/container URL ending in `/` |
| `SOLID_MCP_WEBID` | `webId` | Optional owner WebID for Type Index discovery |
| `SOLID_MCP_READONLY` | `readOnly` | Defaults to `true`; explicit `false` enables writes |
| `SOLID_MCP_CLIENT_ID` | `clientId` | CSS client-credentials token id |
| `SOLID_MCP_CLIENT_SECRET` | `clientSecret` | CSS client-credentials token secret |
| `SOLID_MCP_OIDC_ISSUER` | `oidcIssuer` | Issuer used for OIDC discovery |
| `SOLID_MCP_TOKEN_URL` | `tokenUrl` | Explicit token endpoint; overrides discovery |

Provide both credentials and either the issuer or token endpoint. Partial auth
settings or failed login stop startup; there is no anonymous fallback after an auth
failure. With no auth settings, public-pod access remains available. Authenticated
pod/auth endpoints require HTTPS, with HTTP allowed for loopback development.
Credentials are only attached within the configured pod scope; off-pod profile
discovery is anonymous. Diagnostics go to stderr; stdout carries MCP messages only.

### Claude Desktop

Build the CLI and its workspace dependencies from the suite root:

```sh
pnpm --filter '@jeswr/solid-mcp...' run build
```

With the private config above, add this to `claude_desktop_config.json` (on macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`). Replace both
paths with absolute paths for your installation, then restart Claude Desktop.
See the [official local-server setup](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

```json
{
  "mcpServers": {
    "solid-pod": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/solid-sdk/packages/solid-mcp/dist/cli.js"]
    }
  }
}
```

### Claude Code

Use the same private config and build output. In the project's `.mcp.json`, following
the [Claude Code MCP configuration](https://code.claude.com/docs/en/mcp):

```json
{
  "mcpServers": {
    "solid-pod": {
      "type": "stdio",
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/solid-sdk/packages/solid-mcp/dist/cli.js"]
    }
  }
}
```

### Codex

With the same private config and build output, add to `~/.codex/config.toml`, following
the [official Codex MCP configuration](https://developers.openai.com/codex/mcp/):

```toml
[mcp_servers.solid-pod]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/solid-sdk/packages/solid-mcp/dist/cli.js"]
```

For environment-only setup, Codex can forward credentials from its launching shell:

```toml
[mcp_servers.solid-pod]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/solid-sdk/packages/solid-mcp/dist/cli.js"]
env_vars = ["SOLID_MCP_POD_ROOT", "SOLID_MCP_WEBID", "SOLID_MCP_READONLY", "SOLID_MCP_CLIENT_ID", "SOLID_MCP_CLIENT_SECRET", "SOLID_MCP_OIDC_ISSUER", "SOLID_MCP_TOKEN_URL"]
```

## Key API

- Server: `createSolidMcpServer`, `SolidMcpServerConfig`, `SolidMcpConfig`, `MemoryClientInfo`.
- Operations: `listContainer`, `readResource`, `readRdf`, `search`, `writeResource`.
- Scope: `normalizePodRoot`, `requirePodScopedUrl`, `podScopedUrlOrUndefined`.
- Data seam: `PodPort`, `createStoragePodPort`, `createFetchPodPort`, `PodConditions`.
- Registry: `createPodToolRegistry`, `registerPodTools`, `PodTool` (Zod schema, handler, readOnly flag).
- MCP tools: `pod_list`, `pod_read`, `search`, `fetch`, `context_read`, and opt-in `pod_write`;
  `memory_remember`, `memory_recall`, `memory_forget`, `profile_get`, `address_get`,
  and `health_query` with trusted client identity.
- Shared context: `context_read` takes no arguments and discovers the configured owner's
  private Type Index registration for `https://jeswr.org/ns/agent#SharedContext`.
  Legacy class aliases are canonicalized through suite-vocab and receive the same
  validation and ambiguity checks, including duplicate entries naming the same document.
  It accepts exactly one pod-scoped HTTP(S) document instance, without a fragment.
  Only no private pointer or no registration falls back to `SHARED_CONTEXT_PATH`
  (`agent/context/shared-context.md` below the configured root). Unsafe, duplicate,
  container, malformed or unreadable registrations return `{status:"error",reason}`;
  registration URLs are withheld. Public indexes are ignored. A missing context returns
  `{status:"not_found",url,setup}`. Redirects and aliases are refused at every read.
  Text has Unicode-aware card redaction (`CARD_REDACTION`, `redactedCardNumbers`) using
  pkg-memory's single detector. It checks Luhn-valid 13–19 digit windows starting with
  2–6, folding Unicode decimal scripts and NFKC digit forms while preserving UTF-16 spans.
  Only ASCII space, hyphen, NBSP, thin/narrow no-break spaces and en/em dashes separate
  digit groups; dots, commas and other punctuation end a run. Overlapping/adjacent
  matches merge and cover up to 19 digits. Ordinary phone lists, dates and versions stay intact.
  The effective WAC ACL must grant Write/Append/Control only to the owner. Public mutation
  headers, other agents, public/authenticated classes, groups, origins and unprovable ACL
  evidence return `{status:"untrusted",url,reason}` with no text. An owner-only ACL yields
  `aclVerified:true`; a portable/LWS port with no private discovery pointers and no exposed
  ACL support returns conventional-path text with `aclVerified:false`. WAC-Allow public
  mutation evidence still denies on those ports.
  Every existing private index and preferences document must also have verifiable
  owner-only mutation authority through its own or inherited WAC ACL. Unsafe or
  unavailable pointer ACL evidence returns `{status:"error",reason:"pointer_acl_untrusted"}`
  without reading or returning context text. The public profile remains exempt.
  ACP-only pods advertising `rel="acl"` to `.acr` or `?ext=acr` fail closed as untrusted
  context (`context_untrusted`): the API returns `{status:"untrusted",url,reason:"acl_unverifiable"}`,
  or `pointer_acl_untrusted` when discovery pointers use ACP. ACP is unsupported.
  Helpers: `readSharedContext`, `sharedContextUrl`, `createContextToolRegistry`,
  `setupSharedContext`. See decision 0004.
- One-release aliases in v0.2: `solid_list`, `solid_read`, `solid_search`, `solid_write`.
  List/read/write aliases retain the same schemas, output and read-only enforcement.
  `solid_search` retains its optional scope and ranked array response.

## Owner setup for shared context

Run `solid-mcp context-init [--initial-text TEXT]` with the same private CLI configuration
and an owner WebID, or call:

```ts
const result = await setupSharedContext(pod, { webId: pod.webId, initialText: "# How I work\n" });
```

This owner-facing helper is never an MCP tool. It creates the conventional document with
`If-None-Match: *` after writing its advertised owner-only WAC ACL. It registers through
`@jeswr/pod-type-index`, provisioning private settings/preferences/index ACLs before writes.
Index bootstrap needs root WAC-Allow `user` Write+Control evidence. Results are `created`
or `already_exists` with `{url,registered:true}`, or `error` with a fixed reason. Existing
document bytes are preserved; a different registration stops setup without mutation.
A successful rerun performs no writes. Strong ETags protect existing ACL/index updates;
unsafe or shared ACLs refuse replacement. The CLI subcommand explicitly enables setup
writes and reports to stderr; regular stdio remains read-only by default.
Setup preserves ACLs on existing private indexes and preferences documents, including
inherited permissions and public Read grants. If mutation authority is not verifiably
owner-only, setup returns `pointer_acl_untrusted` with a fixed `setup` instruction; the
owner must fix the effective index/preferences ACLs before rerunning setup. Only newly
created resources have their ACLs provisioned by setup. Unknown CLI launch arguments are
ignored unless the first argument is `context-init`, whose options are validated strictly.

Trust reads and ACL checks are separate requests. A concurrent owner or ACL controller
can change content, pointers or permissions between them; these checks do not provide an
atomic read/ACL snapshot. Generic mutation protection for governing ancestor ACLs of
pointer/profile documents is deferred to PR #447's server-advertised ACL discovery;
this branch adds no ACL-suffix restriction.

## Portable pod access

```ts
import { createStoragePodPort, createSolidMcpServer } from "@jeswr/solid-mcp";

const pod = createStoragePodPort({
  fetch: authenticatedFetch,
  podRoot: "https://alice.example/",
  webId: "https://alice.example/profile/card#me",
  readOnly: true,
});
const server = createSolidMcpServer({ pod });
```

`createStoragePodPort(config, discoveryFetch?)` uses `@jeswr/storage-client` to discover
Solid or LWS and paginate listings. A separate trusted, guarded anonymous `discoveryFetch`
is required to read same-origin storage descriptions outside the pod root; those requests
are refused when it is omitted. Resource credentials stay within the pod.
Discovery failures propagate without choosing a fallback backend.
The adapter refuses redirects. Solid create-only writes keep their exact URL and
`If-None-Match: *`; LWS create-only writes fail before mutation because LWS names are
hints. Updates preserve `ifMatch`; deletion without a supplied validator first reads
an ETag and refuses deletion when none is available. Container writes require create-only
conditions and accept empty bodies or LDP container types; other container metadata
is refused before mutation. Exact named creates reject URL spellings the backend would rewrite.
The legacy `createFetchPodPort` and fetch-based server configuration remain
supported. Supplying both `fetch` and `pod` to the server keeps chat ACL discovery through
the fetch capability while pod operations use the supplied port.

`PodPort` exposes raw-byte `read`, `list`, conditional `write` and `delete`, `root` and
`webId`. Its optional `head` returns `PodHeadResult.acl`, an absolute WAC ACL URL
discovered from a unique, unanchored `rel="acl"` Link on the exact target, including
HTTP 404 for resources not yet created. Both HEAD and read results may retain raw
`wacAllow` evidence, including public permissions, for shared-context trust checks. HEAD refuses redirects. Optional
`PodReadOptions.accept` selects a representation; generic reads keep
the backend default, while RDF/profile reads request RDF explicitly. The fetch adapter retains listing metadata, ETags, guarded read redirects,
and refusal of all mutation redirects. Mutations reject the root and its slashless
alias. Both adapter and server default to read-only; opt into writes at both layers.
The configured WebID remains readable for Type Index discovery even when off-pod;
off-pod profile redirects are refused for ordinary injected fetch functions. The CLI's
anonymous transport permits bounded, validated same-origin profile redirects.
Client tools and resources are always confined to the pod root. A custom PodPort
must enforce its data boundary and mutation policy too, and retain otherwise ambiguous
container identities in `PodReadResult.isContainer`.
Every tool, including `fetch` and both search names, uses the injected port's current
`read` and `list` methods. Authorization decorators, filtered listings, and redacted
read results remain authoritative. Fetch-backed streaming and parsing limits are
enforced inside that boundary.
Search records a match only after the target read succeeds, including matches
based solely on a Type Index hint, filename or URL. Read denials discard the
candidate; an authorized read with no matching RDF literal can still match by name.
All pod output passes through the operation-local `PodOutput` projection. It uses
the injected port's current methods and successful reads for the caller's purpose;
list entries and Type Index registrations grant no permission to disclose data.
Lists, search descriptions, resource reads, tool results, chat results and write
receipts share this boundary. A write receipt requires read authorization after
the write; the write can succeed even if that receipt is denied.

Generic access reserves the personal-data subtree `private/pkg/`, derived from
`NanopubStore`'s storage layout. It includes nanopublications, policy, locks, audit
logs and their local ACLs. Only the internal personal-tool and audit path can
access this area; personal reads still require the current purpose policy and,
for sensitive data, a verified audit append. Generic reads and mutations return
the fixed diagnostic `Personal data requires a purpose-limited tool`, without
echoing a URL. Generic writes/deletes also refuse ancestors of the reserved area.
Listings, search candidates/results, Type Index hints, container projections and
MCP resource enumeration omit protected children before reading them. Redirect
hops and returned aliases receive the same checks, including slashless containers,
query/fragment aliases, case variants, percent decoding and normalized `..` paths.

Container representations are rebuilt from authorized children through typed
RDF accessors and the N3 Writer. This applies to container URLs, slashless roots,
query/redirect aliases, LDP container type Link headers (including redirect hops),
and RDF identified as a container or containing membership statements.
Membership and server-managed descriptions are retained only for authorized
children. The content of an authorized document is its own data: prose, JSON
fields and RDF terms are never scanned for URLs, redacted or followed for further
authorization. Backend errors are mapped to fixed public diagnostics so
rejected URLs, names and values cannot escape through error messages. Authorization
decisions are never retained across operations or callers.

Server-rendered container bodies, including plain text and HTML, are never returned.
The listing requests RDF and fails closed when it cannot produce the filtered graph.
Initial reads and container projection share a 5000 ms deadline and a 1 MiB
per-response limit. Native authorization-only reads discard unused non-RDF bodies;
RDF container identities are checked before authorizing resource descriptions.
Decorated reads receive complete bodies up to the input limit. Larger downloads
fail closed so a content-based authorization check cannot inspect a partial body.

The existing fetch-based server configuration and exported pod operations remain
supported. Operations also accept a PodPort directly. The programmatic `search` operation retains its ranked array output; the MCP
`search` tool returns the ChatGPT envelope described below.

## ChatGPT search and fetch

`search` accepts `{query}` and returns one MCP text block containing JSON:
`{results:[{id,title,url}]}`. IDs are pod resource URLs. It searches Type Index
registrations and container listings, matching names, URLs, and RDF literals
(including chat titles). Personal memory is available through `memory_recall`
under its purpose policy. Results are deduplicated and ranked.
The legacy `solid_search` tool retains its original array response.

The shared discovery/scan limits default to depth 4, 500 distinct resources, and
5000 ms. Set `searchLimits: {maxDepth, maxResources, maxTimeMs}` in the server
configuration to override them. Discovery, redirect hops, and hinted resources
consume the same resource budget. A deadline returns the matches found so far;
the exact search response has no additional completeness fields. Each scanned
response is also limited to 1 MiB. Direct Type Index instances are negotiated
as RDF even when their URLs have no file extension.

`fetch` accepts `{id}` (an absolute pod URL) and returns one MCP text block
containing `{id,title,text,url,metadata}`. Titles use the decoded filename.
Metadata contains `contentType`, `truncated`, and an optional `etag`. RDF is
parsed with bounded N3/JSON-LD parsers and serialized as Turtle; `text/*` is
returned as text for ordinary documents. Recognized containers always return projected
Turtle with its own content type and no source ETag. Named-graph RDF is rendered as a
union graph (Turtle has no graph labels).
Other media types, including non-RDF `application/json`, return empty text
and metadata without downloading the body through an undecorated fetch-backed adapter.
Custom PodPorts return byte arrays and must bound their own backend reads; the
server still bounds parsing and tool output.

Both the input and UTF-8 output are capped at 1 MiB. Text returns a complete
UTF-8 prefix and `metadata.truncated: true` when capped. Oversized RDF returns
empty text with that flag, since a partial document may be invalid RDF. Missing
Content-Type is treated as binary. JSON-LD inline contexts are supported; remote
contexts and `@import` are refused to prevent parser-initiated network requests.
Parsing stops before storing more than 16,384 quads (including duplicate input
statements), 1 MiB of expanded term values, or 1 MiB of term bytes across quads.
N3-family structural nesting is capped at 64 levels; pending contexts and
generated blank nodes also consume the shared 1 MiB allocation budget.
The Turtle writer retains at most 1 MiB and stops as soon as its output exceeds
that limit. These parsing budgets also apply to search profiles, Type Indexes,
container listings, and literal reads; search skips documents that exceed them.
All fetch URLs and redirect hops are validated against the configured pod scope.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Memory tools

Memory tools require the pod owner's WebID and trusted `clientInfo` supplied by the
server's composition layer. `clientId` is an absolute IRI (HTTPS or URN), bound to
the authenticated MCP client; tool arguments cannot override it. `name` and `model`
are optional metadata. For example:

```ts
const server = createSolidMcpServer({
  pod,
  readOnly: false,
  clientInfo: {
    clientId: "https://example.org/clients/assistant",
    name: "Example assistant",
    model: "Example model",
  },
});
```

- `memory_remember({text, fact?, quote?, hedged?, about?, conversationId?})`
  returns `{id, epistemic}`. Fact values follow `@jeswr/pkg-memory`'s `Fact` union:
  email/phone strings; address, preference, condition, allergy, medication and
  relationship objects. `about` defaults to the owner. A quoted, unhedged fact is
  `SelfReportedExplicit`; hedging takes precedence and yields `SelfReportedHedged`;
  other facts are `Inferred`. Quotes retain up to 300 Unicode code points.
- Without `fact`, the assertion embeds a `@jeswr/solid-memory` `MemoryItem` as
  `Mentioned`, including when quoted. It has no separate resource to orphan.
  Free text has no inferred DPV category and remains uncategorized; requesting it
  through recall fails closed under the purpose filter.
- `memory_recall({query?, about?, categories?, purpose, include?, limit?})`
  returns `{facts:[...]}`. `purpose` is `ServiceProvision` or `Personalisation`.
  The default selects `belief: "definitely"` and `validity: "Current"`;
  `include` can add `might`, `mentioned` and `past`. Query matching is case
  insensitive over text and assertion values; categories are absolute DPV IRIs.
  The default limit is 20, maximum 100. Each fact carries text, assertion Turtle,
  belief, epistemic/validity status, optional hedge, date, categories,
  `provenanceId`, and owner/client/model/conversation provenance.
- `memory_forget({id, mode: "retract" | "delete"})` accepts a returned nanopub UUID
  IRI. Retraction appends a `Retracted` revision with `prov:invalidatedAtTime` and
  preserves the original. Deletion removes only a nanopublication written by this
  client, including a wrapped note, using the ETag of the checked attribution.

Nanopublications use the existing owner-only ACL and byte-preserving TriG storage
at `private/pkg/mcp/`. Assertion provenance attributes the claim to the owner;
publication-info provenance attributes the nanopublication to `clientInfo.clientId`
and retains the optional model (`schema:instrument`) and conversation id
(`dct:isPartOf`, as a literal). Every call uses the current injected PodPort methods
and an operation-local output boundary. Memory writes require `readOnly:false` at
both server and adapter layers.

Before writing any private content, memory discovers the server-advertised WAC
ACL for each protected container, policy, mutex and nanopub through `PodPort.head`.
It accepts the advertised URL only inside the protected `private/pkg/` area,
including non-default ACL locations there. An ACL advertised elsewhere in the pod
(such as `permissions/`) is refused before ACL access or private content writes;
there is no fallback to `.acl`. This keeps every accepted personal ACL behind the
generic-tool boundary. Missing HEAD metadata, absent or unsafe WAC links and ACP
storage fail closed with `Memory protection unavailable`. Existing ACLs must be
proven dedicated to the exact target before replacement; shared or unscoped rules,
including legacy `acl:defaultForNew` scopes, refuse the write. ACL mutations use
strong read ETags with `If-Match`, or `If-None-Match: *` when absent.

Recall evaluates the owner-editable `private/pkg/mcp-policy.ttl` for this client on
every call. Health and finance are denied by default. Denials expose category names
only. The first memory write creates the default policy; recall always requires an
existing policy and never creates one. Existing owner policies are preserved, and
unreadable or malformed policies fail closed.

## Profile, address and health tools

These tools require the same trusted `clientInfo` and owner WebID as memory tools.
Every call requires `purpose: "ServiceProvision" | "Personalisation"` and reevaluates
the existing owner policy for that client. Reads never create a missing policy.
Missing, unreadable or malformed policies fail closed. Denial errors contain only
fixed category names, without values, subject identities or owner-supplied IRIs.

When the configured WebID profile document is inside the pod, generic reads,
writes and deletes refuse it with `Personal data requires a purpose-limited tool`.
Listings, search and resource enumeration omit it, including encoded aliases and
redirects. Internal storage, Type Index and issuer discovery remain available, as
does `profile_get` after its Contact policy check. Off-pod WebIDs do not change
generic access to other in-pod documents.

- `profile_get({purpose})` returns `{name, emails, phones}` from the configured
  in-pod WebID under `pd:Contact`. Names use vCard then FOAF; missing names are
  `null`. Contacts support direct `mailto:`/`tel:` IRIs and local vCard
  `hasValue` nodes, deduplicated and sorted, with scheme prefixes removed.
  Linked documents are never followed. Off-pod WebIDs and redirects are refused.
- `address_get({purpose, at?})` returns `{addresses:[...]}` from `pd:PhysicalAddress`
  nanopublications. Only definitely-true, Current claims about the owner qualify,
  including for as-of reads. `at` accepts an ISO date (midnight UTC) or a datetime
  with an explicit timezone, up to microsecond precision; it defaults to now.
  `schema:validFrom`/`validThrough` are inclusive. Date, year-month and year
  bounds cover their whole calendar period in UTC; datetime bounds are exact.
  Absent bounds are open; ambiguous, malformed or timezone-free datetime bounds
  fail closed. Results retain every qualifying address, its fields, validity
  bounds and `provenanceId`, ordered by address ID then provenance ID.
- `health_query({kind, purpose})` returns `{kind, facts:[{id, provenanceId, assertion}]}`,
  where `assertion` is graph-scoped Turtle. Kinds are `conditions`, `allergies`,
  `medications` and `observations`. Only definitely-true, Current owner health
  claims qualify. Canonical and legacy suite health terms are read without
  rewriting stored claims. Every candidate category needs a permit before
  content filtering; `pd:MedicalHealth` also needs a permit for an empty query.

Special-category reads, including permitted memory recall and financial data,
require a writable server and PodPort. Before returning results they append a
PROV activity to `private/pkg/audit/<yyyy-mm>.ttl`: client IRI, DPV purpose,
special categories and UTC time, with no fact values. Empty permitted health
queries are audited too. Before writing audit content, the server discovers each
protected target's actual WAC ACL using HEAD and installs an owner-only authorization
there; it never guesses a `.acl` URL. As with memory writes, the ACL URL itself
must lie inside the protected `private/pkg/` area; other in-pod locations are
refused without fallback.
Missing, ambiguous or unsafe WAC links, ACP-only storage, and custom PodPorts without
WAC HEAD metadata refuse auditing and the sensitive read with the fixed diagnostic
`Audit protection unavailable`. Existing ACLs must contain only supported WAC
authorizations dedicated to that exact target; shared, unscoped or unprovable ACLs
refuse replacement with the same fixed diagnostic, preserving all existing grants.
ACL writes use the strong read ETag with `If-Match`, or `If-None-Match: *` on 404.
ACP is unsupported. Strong ETags and bounded
compare-and-swap retries preserve concurrent entries. The saved activity is verified
through the current PodPort. Audit denial, corruption,
overflow or persistence failure withholds the tool result. Ordinary contact
and address reads remain available on a read-only server when permitted.

## Chat tools

All four tools use `@jeswr/solid-chat-interop`'s reusable `ChatWriter` and require
`webId` to identify the owner. `chat_save` also requires `readOnly:false`.

- `chat_save({provider, conversationId, title, messages})` returns `{url, saved, skipped}`.
  Messages are `{id?, role, text, createdAt}`. Providers: `claude`, `chatgpt`, `codex`.
  Roles: `system`, `user`, `assistant`, `tool`; dates require an explicit timezone.
- `chat_list({provider?, since?, cursor?, limit?})` returns `{conversations, nextCursor?}`.
  Summaries include URL, provider, conversation ID, title and latest message time
  (`updatedAt`, absent for empty conversations). URL order and an exclusive cursor
  provide paging; `since` is exclusive against latest message time, before paging.
  Limit defaults to 20, maximum 100. Reuse filters when following a cursor.
- `chat_get({provider, conversationId})` returns the conversation plus its URL and
  messages ordered by time, then ID.
- `chat_export({provider, conversationId})` returns `{url, markdown}`: the same
  conversation as a Markdown transcript to paste into another account. Titles and
  text are redacted again on export, and each message sits in its own code fence.

Storage is `<podRoot>private/chats/<provider>/<conversationId>/`, with owner-only
WAC ACLs written before chat content and create-only message PUTs using
`If-None-Match: *`. First title and message contents win; retrying an existing ID
skips it. IDs use 1–200 letters, digits, underscores or hyphens. Omitted message IDs
are deterministic hashes; capture callers should supply source IDs to distinguish
otherwise identical events. The fetch adapter retains pod-scope and redirect checks
and accepts only Turtle/N3-family RDF for chats, preventing remote JSON-LD context
loads. Servers must support the ACL-before-content sequence; errors fail closed.
ACL discovery uses HEAD and a unique WAC `rel="acl"` Link, including on 404 for
containers not yet created. Missing/ambiguous ACL links, ACP and unsafe ACL URLs
abort saves; ACL associations are rechecked after container creation. Writes refuse
all redirects. Listing skips containers whose conversation metadata returns 404,
while preserving permission, transport and message-read errors.

Chat tools are registered alongside the canonical pod tools and compatibility
aliases when using the fetch-based server configuration. The chat adapter retains
its ACL discovery and write safeguards. The portable `PodPort` configuration
registers pod and memory tools; chat tools currently require the fetch-based
configuration for their ACL discovery.
Chat writes keep `contextGuard` off: ChatWriter's create-only resources use agent/account
identifiers and do not accept arbitrary context or pointer mutation targets. Its own
ACL-before-content and conditional-write checks remain active.

## Streamable HTTP

```ts
import { createServer } from "node:http";
import { createMcpHttpHandler } from "@jeswr/solid-mcp/http";
import { createSolidMcpServer } from "@jeswr/solid-mcp";

const handler = createMcpHttpHandler({
  resourceUrl: "https://mcp.example/mcp",
  allowedOrigins: ["https://client.example"],
  authenticate: async (request) => verifyMcpResourceToken(request.headers.get("authorization")),
  server: async (principal) => createSolidMcpServer(await podConfigFor(principal)),
});

// Node: mount this handler at /mcp, preserving the public Host behind a proxy.
createServer(handler).listen(3000, "127.0.0.1");
// Web/serverless route: return await handler(request).
```

`verifyMcpResourceToken` and `podConfigFor` above are application callbacks: verify the MCP
resource token (including audience), return a principal, and resolve that principal's pod
session on the server. Return `null`, `undefined`, or `false` (or throw) to reject authentication.
MCP bearer tokens must never be used as pod credentials. The `server` factory must return a
fresh MCP SDK `McpServer` for every request; singleton reuse is rejected.

The SDK transport runs in stateless mode with JSON responses and no session IDs. POST bodies
are capped at 1 MiB, including chunked bodies; GET, DELETE and other methods return 405 after
authentication. Invalid JSON/UTF-8 returns 400, oversized bodies return 413, and failures to
authenticate return 401 with the protected-resource metadata challenge. The application serves
that metadata separately, by default at the RFC 9728 §3.1 location returned by
`protectedResourceMetadataUrl(resourceUrl)`, using the OAuth server's well-known insertion rule:
`https://mcp.example/mcp` advertises
`https://mcp.example/.well-known/oauth-protected-resource/mcp`; a root resource advertises
`https://mcp.example/.well-known/oauth-protected-resource`. Both the transport and
`@jeswr/mcp-oauth` use `metadataUrl` from `@jeswr/mcp-oauth/metadata` to construct this URL.
Pass `resourceMetadataUrl` to advertise another URL, for example
`oauth.protectedResourceMetadataUrl()` from the composed authorization server.

Host must exactly match the public URL's authority, including any port. Forwarding headers do
not override this check. A Web Request without an explicit Host is checked using its URL;
Node requests require Host. An absent Origin is accepted for native clients; present origins
must exactly match `allowedOrigins`. Wildcards, opaque origins, and origin URLs with paths
are rejected at configuration time. Allowed browser origins receive explicit CORS headers and
unauthenticated POST preflight responses. No wildcard CORS or cookie credentials are enabled.

## Links

- [Source](https://github.com/jeswr/solid-mcp)
- [Issues](https://github.com/jeswr/solid-mcp/issues)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Solid Protocol](https://solidproject.org/TR/protocol)

## License

[MIT](./LICENSE) © Jesse Wright

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Session capture integration

The public exports `loadCliConfig(env?, home?)`, `createCliFetch(config, fetch?)`
and `createChatPodPort(config)` let `@jeswr/agent-session-capture` reuse the stdio
configuration, DPoP login, pod scope and WAC discovery behavior. The chat adapter
keeps write permission checks; callers must supply `readOnly: false` explicitly.


Generic mutations re-read private context discovery on each operation. They refuse the
registered context, its ancestors and advertised ACL, and private index/preferences
pointers and their advertised ACLs. Unprovable discovery with a configured owner blocks
generic mutations with the fixed personal-data diagnostic. Setup uses its separate
owner-facing capability; it is never registered as an MCP tool.

`PodHeadResult.aclError` distinguishes malformed, ambiguous or unsupported ACL-link
evidence from absent ACL capability. Trust checks deny this evidence rather than
returning unverified text.
