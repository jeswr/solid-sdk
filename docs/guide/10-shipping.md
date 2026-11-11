<!-- AUTHORED-BY Claude Opus 5.5 -->

# 10. Shipping

## Publish a Client Identifier Document

Identity providers show your app's name and logo on the consent screen and only send users back
to callback URLs you have declared. Both come from your Client Identifier Document.

1. Write a config file:

   ```json
   {
     "origin": "https://reading-list.example",
     "name": "Reading List",
     "logo": "https://reading-list.example/logo.svg",
     "redirectUris": ["https://reading-list.example/auth/callback.html"],
     "fedapp": { "sectors": ["https://jeswr.org/ns/sectors/bookmarks#sector"] }
   }
   ```

2. Generate the document from the workspace root:

   ```sh
   node scripts/client-id.mjs client-id.config.json apps/reading-list/public
   ```

3. Serve `public/.well-known/solid-client-id.jsonld` at exactly the generated URL, with
   `Content-Type: application/ld+json`, and use that URL as `clientId` in `createPodAuth`.

List every callback URL your app uses, including popup and full-page ones. The document must not
change during a deploy. The [solid-client-id skill](../../skills/solid-client-id/SKILL.md) explains
the common failures, such as a `redirect_uri` mismatch.

## Add your app to the workspace

- Put it in `apps/<slug>`, named `@jeswr/app-<slug>`, with `"private": true`.
- Depend on SDK packages with `workspace:*`. Do not commit an app-local lockfile.
- Before adding any third-party dependency, run `pnpm run check:packages <name>`. Dependency
  install scripts never run in this workspace.
- Do not depend on `@sparq-org/sparq`, `@jeswr/storage-client/solid` or
  `@jeswr/storage-client/lws` directly. `pnpm run check:sdk-layers` fails if you do.
- Add the app to `suite.json`.

## Run the gate

```sh
pnpm run gate        # lint, build, typecheck and test what you changed, and its dependents
pnpm run gate:full   # everything, before a release
```

The gate also type-checks the code samples in this guide and in the agent skills, so a change to a
public API that breaks a sample fails here.

## Deploy

The web apps are built together and published to GitHub Pages; the suite shell also deploys to
Vercel. [Deployment](../deployment.md) lists every app and its build command.

## Checklist before you call it done

- [ ] Sign-in lists remembered accounts, then offers a WebID field, provider buttons and "Other
  provider".
- [ ] Every edit sends the ETag it read, and conflicts are handled.
- [ ] No URL is built from a container and a name.
- [ ] RDF goes through a domain package or typed accessors only.
- [ ] Notifications trigger re-reads, and the app re-lists after `resync`.
- [ ] Controls the server cannot support are hidden.
- [ ] Logout drops every client, subscription and cache for the account.
- [ ] Data-layer tests pass on the memory pod in both `solid` and `lws` modes.
- [ ] Screens checked at 375, 768 and 1280 pixels, light and dark.

That is the whole path. For anything this guide does not cover, start from the
[build-solid-app skill](../../skills/build-solid-app/SKILL.md), which links every package's own
guide.
