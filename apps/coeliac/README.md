<!-- AUTHORED-BY GPT-6.1 Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
# coeliac-app

A privacy-first food-and-symptom diary for coeliac disease and other food intolerances. Log meals, exposures, and symptoms; the app helps surface likely trigger patterns, run structured elimination protocols, and shape a personalised diet plan — while keeping all of your health data in your own [Solid](https://solidproject.org/) pod rather than on someone else's server. The diary is written with the reusable [`@jeswr/solid-health-diary`](https://github.com/jeswr/solid-health-diary) model (the shared `diet:` sector of the @jeswr federation vocabulary), so it stays portable and readable by other pod-native apps.

> **Status: under active development.** This is an experimental, AI-assisted build — not a finished or production-ready product, and **not medical advice**. Consult a qualified healthcare professional about diagnosis, testing, and any dietary change.

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

The app uses local fonts and builds without downloading font assets. Production builds use
Webpack with two workers; Turbopack's PostCSS worker requires a listening port unavailable
in the restricted build environment.

## Sign-in and diary sessions

`@jeswr/app-session` owns the shared two-step sign-in screen, remembered accounts,
explicit provider choice, popup authorization and one restore per page. The client-only
adapter in `src/lib/pod-auth.ts` resolves URLs after mount, so custom elements and browser
location are never evaluated during Next.js prerendering. `/clientid.jsonld` registers only
`/callback.html`. Dynamic registration and insecure HTTP are limited to development on
a loopback host.

The diary context keeps its existing API. It passes the core's authenticated fetch explicitly
to provisioning, the private type index and outbox synchronization. Public reads use
app-session's pristine fetch with cookies omitted; global fetch is never patched. Diary writes
require a verified storage root from the core. A WebID without advertised storage can view cached
data, with a warning; logging and syncing require an advertised pod.

Login and restore provision the diary and flush pending changes in the background; reconnect
flushes again. Logout attempts a final flush, calls the same core's logout and purges the
WebID-scoped health cache. On page startup, expiry or a restore that finds no session purges
the previously remembered account's cache before offering sign-in, without activating a diary
session. Logout through the same core also purges an active cache; cross-tab logout is not
observed. Purge and revoke warnings remain independent, with separate retries. The local
adapter calls core logout directly so it can report revocation failures.

On first mount the shared cleanup removes exactly the old controller's
`coeliac-diary-session` IndexedDB database and localStorage keys `coeliac-diary:last-account`
and `coeliac-diary:accounts`. These were its `dbName`, `rememberedAccountsKey` and
`recentAccountsKey` options. The health-data database, theme and other apps' storage stay intact.
Legacy credential cleanup is best-effort.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
