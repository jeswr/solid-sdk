# Manifest permissions — rationale (EXT-05)

The host permission enables worker egress to user-chosen Solid servers. Explicit origin
consent, independently checked by the worker, controls which pages can use that egress.

## Permissions

| Permission | Purpose |
|---|---|
| `storage` | Settings, recent-account display metadata, client IDs, transient PKCE parameters, and `solid:origin-grants`. The origin table contains `{origin, profileId, scope: {pods, classes?}, createdAt, expiresAt?}`; class grants nest under their parent. Tokens and non-extractable DPoP keys remain in worker-owned profile IndexedDB. Legacy implicit grants do not authorize access. |
| `identity` | Solid-OIDC authorization-code + PKCE through `chrome.identity.launchWebAuthFlow`. |
| `sidePanel` | The persistent account surface; EXT-06 owns its grants-manager UI. |
| `contextMenus` | The toolbar's “Open Solid side panel” menu entry. |
| `scripting` | Register the MAIN-world fetch-patch entry only for explicitly granted origins, with one exact `scheme://host:port/*` match per origin (including explicit default ports), no wildcard hosts or schemes, top frame only. Reconcile on worker wake, install/update, grant changes, and expiry. Remove the legacy `solid-main-world-inject` all-origins registration. |
| `alarms` | Wake the worker at the earliest origin-grant expiry to unregister scripts and clear page capabilities. Alarms are a cleanup mechanism: every request independently checks expiry, even if the alarm is late. |

No `tabs` permission is requested. Existing host access permits tab-URL visibility for
scoped state broadcasts. Each tab receives only its bound profile's WebID; other tabs
receive null. The worker revalidates each tab's URL origin immediately before sending to
the top frame. Tab messages include the intended `origin`; the ISOLATED bridge drops a
message unless it equals its own `location.origin`, closing navigation races during delivery.
Switching the default profile does not change origin bindings.

## `host_permissions: ["<all_urls>"]`

The worker discovers arbitrary user-chosen WebID, pod and issuer origins and performs
cross-origin discovery, token exchange/refresh and authenticated resource access. These
hosts cannot be enumerated at installation. The broad host permission does not grant
web pages access to any profile or pod.

The worker enforces these boundaries before cache access or egress:

- The ISOLATED bridge overwrites any page-supplied origin with `window.location.origin`.
  It also reads transient user activation itself. The worker requires agreement with
  Chrome's sender origin/URL; mismatched, opaque and missing anchors fail closed.
- A live explicit origin grant selects exactly one profile. Login, a client-ID declaration,
  a pod/issuer origin, a default-profile switch, and standalone legacy class records do not
  grant a page access. Removed/signed-out profiles cannot supply credentials.
- Credential targets must be in both the profile's allowed-origin set and the parent
  grant's pod scope. Nested class grants additionally enforce pinned targets, mode, WebID
  and expiry. A child cannot bypass an absent, revoked or expired parent.
- Page-supplied `Authorization`/`DPoP` headers are stripped. Tokens attach only to approved
  profile credential origins, never the token endpoint, never remote cleartext HTTP.
- Foreign targets are permitted only on the calling app's own origin without Solid
  credentials. A declined automatic diversion returns a sentinel, with no worker network;
  the page performs its own native fetch with normal CORS semantics.

Revocation unregisters future injections, cancels pending profile operations and purges
that origin's replica slice. Existing pages also lose their privileged API/patch on the
state broadcast. A captured function remains subject to the worker gate on its next call.
Grant expiry is checked before serving cached bytes, before egress and before returning
results. Registration failure does not confer authority.

## Manifest content scripts: `["<all_urls>"]`

The ISOLATED bridge and MAIN-world **stub** remain available on arbitrary pages so a new
app can request consent. Without an origin grant `window.solid` has only `login` and
`requestAccess`, plus the credential-free DOM presence marker/event. There is no `webId`,
`fetch`, client-ID setter, logout or class-management API, and native `window.fetch` is
preserved. The stub enables these capabilities only after a grant-backed state response.
The dynamic registration is scoped to granted origins, never `<all_urls>`.

Presence and page-side capability state are cooperation signals, not authentication:
a page can spoof messages to its own MAIN-world scripts, but cannot mint an origin grant,
select a different profile's credentials or bypass worker enforcement.

## Trusted management seam

Only browser-attested extension contexts may list origin grants (`SOLID_ORIGIN_GRANTS_LIST`),
revoke (`SOLID_ORIGIN_GRANT_REVOKE`), shorten expiry (`SOLID_ORIGIN_GRANT_EXPIRY`), or change
profile (`SOLID_ORIGIN_GRANT_PROFILE`). Mutations name the exact `origin`; expiry uses an
epoch-millisecond `expiresAt`, profile changes use `profileId`. Profile rebinding clears the
old pod/class scope and cached slice; fresh class consent is required for data access.
The consent picker resolves and displays each profile's own targets, never transfers the
previous profile's targets.

Chrome's [content-script registration](https://developer.chrome.com/docs/extensions/reference/api/scripting#method-registerContentScripts)
and [match-pattern documentation](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
describe the browser API; the worker's canonical-origin comparison remains the authority.

Dynamic registrations always specify a port: HTTPS uses `:443` and HTTP uses `:80` when
its canonical origin omits the default port. Chrome treats an omitted pattern port as a
wildcard, so `https://app.example/*` would also inject into `https://app.example:8443`.
An explicit default port also matches port-less URLs; no wildcard-port fallback is needed.
This follows Chrome's [port matching documentation](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
and Chromium's [`ExtensionURLPatternTest.Match17`](https://chromium.googlesource.com/chromium/src/+/main/extensions/common/url_pattern_unittest.cc),
which checks default-port matching and rejection of alternate ports. Unit regressions model
these port semantics for HTTPS, HTTP, custom ports and IPv6, including replacement of old
wildcard-port registrations on wake.
