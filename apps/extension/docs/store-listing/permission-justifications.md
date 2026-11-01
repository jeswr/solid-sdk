<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Solid — draft permission justifications and data declarations

**DRAFT — pending Jesse Wright's review. Proposed form answers only; do not submit.**

These answers cover every permission in [`src/manifest.json`](../../src/manifest.json)
and follow the repository's [permission rationale](../manifest-permissions.md). The
[Chrome Web Store privacy form](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
asks for a single purpose, a justification for each permission, a remote-code declaration,
and data-use disclosures and certifications. Jesse must confirm the final package matches
these drafts before entering them in the dashboard.

## Single purpose

Let people sign in to their Solid accounts in the browser and control which account and
data each supported website can access.

## Permission: `storage`

Remember account display details, recent accounts, preferences, application identifiers,
temporary sign-in setup, and the user's site-access decisions. Each access decision binds
one exact site to one account and the approved data, actions, and expiry. Sign-in tokens and
non-exportable private security keys are kept separately in the worker's account IndexedDB,
outside web pages. This permission supports the local settings and grants stored through
Chrome's storage API; it does not send those records to a developer service.

## Permission: `identity`

Open the user's chosen Solid identity provider in Chrome's sign-in flow and receive the
redirect back to the extension using `chrome.identity.launchWebAuthFlow`. This completes
sign-in and lets the worker obtain the selected account's tokens. It does not request the
user's Google account or read the password entered at the Solid provider.

## Permission: `sidePanel`

Provide the account controls and “Sites with access” manager in a persistent Chrome side
panel. Users can manage profiles, inspect site access, shorten expiry, change a site's
account, and revoke access while keeping their current page open.

## Permission: `contextMenus`

Add the “Open Solid side panel” item to the extension toolbar icon's context menu. This
opens the persistent account and access manager. The ordinary toolbar click opens the
quick account popup. It also adds “Fill from pod” to the context menu of editable form
fields; the click is routed only to that tab and frame, and opens the form-fill review
window.

## Permission: `scripting`

Register the packaged page-fetch integration only on origins the user has explicitly
approved. Each dynamic registration matches one exact scheme, hostname, and port, in the
top frame. The worker updates these registrations when access changes, expires, or the
worker starts. It removes registrations when access ends. The worker independently checks
the current grant on every request, including calls saved by an already-open page.

## Permission: `alarms`

Wake the worker when the earliest site-access grant expires so it can remove the site's
registered integration and clear access in open pages. Every data request also checks
expiry itself, so a delayed alarm cannot extend access.

## Host permission: `<all_urls>`

Connect to the Solid account, identity provider, and pods chosen by the user. Those servers
can be on arbitrary domains and cannot be listed in advance. The worker needs cross-origin
access for account and provider discovery, sign-in and token renewal, public application
identity documents, profile information, and approved pod reads and writes.

The manifest also loads a small packaged consent interface and its message bridge on web
pages so a new site can ask for access. Before approval it exposes only sign-in and access
request functions, without an account address or authenticated fetch, and leaves the page's
native fetch unchanged. Approval binds that exact site to one account and data scope. The
worker checks Chrome's verified sending origin, the live grant, and the allowed destination
before accessing cached data or sending a request. Unrelated pages cannot use the host
permission to obtain another account's data or credentials.

The isolated message bridge also runs in subframes so a "Fill from pod" click on a
form field inside one can be routed to that frame. Form filling works only on HTTPS pages
(loopback HTTP for development) and frames with the top page's origin; cross-origin frames
are refused. The bridge never sends profile values unless the user approves them in the
extension's review window.

No `tabs` permission is requested. Existing host access supports the tab-origin checks
needed to send access updates only to the relevant pages. There are no optional permissions
in the current manifest.

## Remote code

**Proposed answer: No, I am not using remote code.**

All executable extension code and bundled dependencies ship in the extension package.
Remote account documents, sign-in metadata, application identity documents, pod resources,
and profile images are treated as data. They are not downloaded scripts or evaluated code.
The extension has no remote script loader or remote code updates outside Chrome's normal
extension update mechanism.

## Data-usage disclosures

Use these disclosures alongside the [draft privacy policy](privacy-policy.md). The fact
that data stays local or travels directly to user-chosen services must not be presented as
“no user data handled.”

| Form data type | Draft disclosure and use |
|---|---|
| Personally identifiable information | Account addresses, display names, profile photo addresses, and user-chosen account labels support account selection. An approved site sees only the account bound to its grant. When the user asks to fill a form, the extension reads their name, email address, phone number, organisation and postal addresses from their own profile and address book, shows them for review, and writes only approved values into that page. Choosing Fill shares those values with the website. The values are not stored or sent to the developer; remembered per-site choices (which kinds of detail were allowed, not the values) are kept until sign-out or profile removal. |
| Authentication information | Account tokens and non-exportable security keys stay in worker storage. Sign-in exchanges go to the chosen provider; authenticated data requests go to approved pod destinations. Websites never receive tokens or private keys. The extension does not store passwords. |
| Web history | Limited site origins and resource addresses are retained in access decisions, application mappings, and cache metadata. The extension does not record general browsing history. Disclose this limited URL handling conservatively for Jesse's review. |
| Website content | The extension handles the pod data requested by approved apps, may cache it locally, and returns permitted results to those apps. To offer form filling, it automatically inspects form fields on visited pages, locally in the browser: labels, autocomplete hints, accessible names, field names, IDs and placeholders. It does not read typed values or send this to anyone, and profile data is only fetched when the user asks to fill. It does not scrape arbitrary page contents. |
| Personal communications / location | Not collected. Form-fill contact details are disclosed under personally identifiable information. Jesse should review whether postal-address filling also needs the location category. |

The extension has no dedicated collection of health, financial, payment, location, personal
communication, or general interaction/activity data. A user-selected pod resource can
itself contain sensitive information in these categories. Jesse must review the supported
data and applicable form categories before certification; this draft does not claim that
arbitrary pod content is free of sensitive information.

There is no analytics, advertising, or developer collection endpoint. Recent-account
metadata can remain after logout or profile removal; uninstalling removes all local
extension data. Profile removal deletes that account's credentials, access, and cached
pod data. Revoking a site's access deletes the cached data for that access; an item the
browser fails to delete stays indexed and is deleted at the profile's next sign-out or
removal. These retention details match the draft privacy policy.

## Proposed data-usage certifications

Jesse should certify the following only after reviewing the final release:

- User information is not sold or passed to third parties beyond the exchanges needed to
  provide the connections and sharing the user chooses.
- Information is used and shared only to deliver this extension's stated single purpose.
- Information is never used or shared to assess creditworthiness or make lending decisions.

The proposed declarations comply with the Chrome Web Store's Limited Use restrictions.
Final review must confirm that the published privacy policy, dashboard selections, and
packaged behavior agree. Public privacy-policy URL and monitored support contact:
**[Jesse: fill in before publication]**.
