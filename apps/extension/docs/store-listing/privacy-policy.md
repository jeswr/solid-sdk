<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Solid — draft privacy policy

**DRAFT — pending Jesse Wright's review. Not a published policy or a store submission.**

Effective date: **[Jesse: fill in before publication]**

Solid connects supported websites to the Solid accounts and data stores you choose. A Solid
data store is often called a “pod.” This policy describes the extension's own handling of
your information. Your identity provider, pod provider, and sites you approve have their
own privacy policies.

## What stays on your device

The extension stores the following locally in your browser:

- **Sign-in tokens and security keys.** Each account has its own access token, refresh token
  when supplied, and security key pair. These live only in the extension worker's account
  database (IndexedDB), outside web pages. Private keys cannot be exported. The extension
  does not give tokens or private keys to websites. You enter your password on your chosen
  identity provider's sign-in page; the extension does not save that password.
- **Accounts and recent-account details.** Account addresses, display names, profile photo
  addresses, account labels, provider addresses, and pod settings support the account menu
  and sign-in experience. A recent-account list remembers up to eight account addresses,
  names, and photo addresses so you can sign in again.
- **Access decisions.** Local grants record the sites you approve, the account chosen for
  each site, the data and actions allowed, resource addresses, and access dates and expiry.
  These decisions are kept in extension storage and checked for every request.
- **Settings and sign-in setup.** The extension remembers application identity-document
  addresses and preferences, and temporarily saves the values needed to finish a sign-in.
- **Local copies of approved pod data.** The worker can cache resource contents in the
  extension's CacheStorage, with resource metadata and security challenge values in
  IndexedDB. The cache separates accounts and access scopes. Access is checked before a
  cached response is served, and reads are checked with the pod for updates.
- **Form-fill choices.** If you choose **Remember for this site** when filling a form, the
  extension records the site, the account, the kinds of detail you allowed (contact details
  and/or address), and when you chose them. This is kept separately from site access and
  never gives a site access to your account or pod. These records have no automatic expiry;
  signing out of or removing that profile deletes them. Revoking a site's access does not
  delete its remembered form-fill choice.

These stores are local to the extension; the extension does not sync them to a developer
service. It does not collect a general browsing history. Site and resource addresses saved
for access decisions and cached data are used to provide the connection you approved.

## What is sent and who receives it

Sign-in requests go directly to your chosen identity provider. Token exchanges and renewals
send the sign-in information that provider needs. Requests for your data go directly to
your chosen pods. Tokens and signed security proofs are sent only to the appropriate
approved provider or pod; private keys stay on your device.

A website you approve receives the selected account's public account address and the
results of requests allowed by its access grant. A site without your approval receives
only the ability to ask you to sign in or request access, without your account address or
pod contents. Ordinary website traffic continues under the browser's normal rules.

On pages you visit, the extension looks at form fields locally, in your browser, to find
ones it could fill. It reads field labels, autocomplete hints, accessible names, field names,
IDs and placeholders. It does not read what you have typed, and it sends nothing anywhere
while doing this.

When you ask it to fill a form, the extension reads your name, email address, phone number,
organisation and postal address from your account profile and linked address book. It shows
them to you in an extension window first. Only the values you approve are written into the
fields of that page, in the same tab and frame. Choosing **Fill** shares those values with
the website straight away: the page's own scripts can read or send them before you submit,
just as if you had typed them. The extension never submits the form and does not save the
values. Forms are never filled without your request, and password, payment and
one-time-code fields are never filled.

The extension also reads public account information, profile photos, provider information,
and application identity documents from the addresses associated with your account or app.
The extension's own public application identity document may be read from its project
website. These public lookups do not send your Solid tokens or private keys to unrelated
hosts. They retrieve data and images, not executable extension code.

Jesse and the extension's developers do not receive copies of your tokens, keys, account
list, access decisions, or pod contents. There is no developer-operated data collection
service. Your chosen providers receive normal network request information, such as your
IP address, when you connect to them.

## No tracking, remote code, or sale of data

The extension contains no analytics or advertising trackers. It does not download or run
remote code; its executable code is included in the installed extension.

We do not sell, rent, or transfer your information to advertisers, data brokers, or other
third parties. Information is exchanged only to provide the account connections and data
sharing you choose, as described above. It is not used for unrelated purposes, credit
decisions, or lending. Its use is limited to the extension's stated purpose and the Chrome
Web Store's Limited Use requirements.

## Your controls and deletion

- **Revoke a site's access** in the side panel to remove its grant and the local cached data
  for that access scope. Its next extension request is denied, including requests through
  a previously saved function. Other sites keep their own grants. If the browser fails to
  delete a cached item, the extension keeps its record and deletes the item when you sign out
  of or remove that profile.
- **Remove a profile** in the account controls to delete that account's extension sign-in
  tokens and keys, revoke its site access, delete its remembered form-fill choices, and
  purge its locally cached pod data. This does
  not delete your account or files at your provider.
- **Sign out** to clear the selected account's extension session and local cached data.
  Other signed-in accounts remain available. Account display entries and recent-account
  details can remain so you can sign in again; removing a profile also leaves the separate
  recent-account list and application settings.
- **Uninstall the extension** to remove its browser-managed local storage, including
  remaining recent-account details, settings, grants, tokens, keys, and cached pod data.

Revoking access or uninstalling cannot erase copies a site already received, and does not
delete information stored by your chosen identity or pod provider. Manage those copies
with the site or provider concerned. They may also retain their own sign-in sessions.

## Contact and updates

Privacy contact: **[Jesse: insert a monitored contact email or support URL before publication]**.

If the extension's data practices change, this policy and the store disclosures must be
updated to describe those practices before the change is released.
