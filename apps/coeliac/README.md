<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# coeliac-app

A privacy-first food-and-symptom diary for coeliac disease and other food intolerances. Log meals, exposures, and symptoms; the app helps surface likely trigger patterns, run structured elimination protocols, and shape a personalised diet plan — while keeping all of your health data in your own [Solid](https://solidproject.org/) pod rather than on someone else's server. The diary is written with the reusable [`@jeswr/solid-health-diary`](https://github.com/jeswr/solid-health-diary) model (the shared `diet:` sector of the @jeswr federation vocabulary), so it stays portable and readable by other pod-native apps.

> **Status: under active development.** This is an experimental, AI-assisted build — not a finished or production-ready product, and **not medical advice**. Consult a qualified healthcare professional about diagnosis, testing, and any dietary change.

## Pod data layer

Each authenticated session lazily creates one `StorageClient` through the root
`@jeswr/storage-client` factory, using the authenticated fetch wrapped in
`createPodScopedFetch`. The client is shared by diary/outbox writes, genetics,
OFF and knowledge caches, community publishing, and Type Index documents inside storage.
WebID storage-root discovery precedes client creation. Failed client discovery
can retry on the next operation without blocking the local cache or outbox.
The session rejects LWS with a typed `UnsupportedStorageError`: the diary requires
Solid's fixed URLs and owner-only WAC `.acl` resources.

WebID profiles and existing Type Index documents outside the storage root use
the session's authenticated fetch scoped to each document's own origin, with
`redirect: "manual"`. Reads use `fetch-rdf`, edits use RDF wrapper accessors and
`n3.Writer`, and updates retain the document's ETag. This supports separate WebID
and storage origins without broadening the diary client's scope.

The existing Solid layout and owner-only WAC ACLs remain: the reviewed
`buildOwnerOnlyAcl` builder supplies ACL content, and StorageClient persists it
before descendant data. Conditional updates preserve the observed ETag and
surface 412 failures. Existing unconditional Solid upserts explicitly use the
SDK's `ifMatch: "*"`; container creation uses `create` and tolerates only the 412
name-taken response. A real 409 is a failure. HTTP write failures retain the UI's
`PodWriteError` messages (including ACL status text) and keep the SDK error as their
cause. Status-less storage/discovery failures use short, stable messages in the UI
and outbox. Cache failures remain best-effort. Type Index registration rejects on
failure; the session shows a warning while logging and outbox flushing continue.

Tests inject `@jeswr/storage-client/memory` clients, including real conditional
write conflicts and ACL ordering. The session test harness records memory-client
operations; public API requests use a separate stub fetch. Routing regression
tests disable network fetch and require successful memory-storage round-trips.
Separate stub-fetch regressions cover cross-origin profile/index updates,
conditional writes and redirect refusal, plus visible registration/sync failures.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
