<!-- AUTHORED-BY Claude Opus 5.5 -->

# 3. Signing people in

`@jeswr/pod-auth` handles sign-in for both Solid-OIDC and LWS. It gives you one thing to use
everywhere: `auth.fetch`, a fetch that adds credentials only inside storage roots it trusts.

The package skill, [pod-auth](../../packages/pod-auth/SKILL.md), has the full contract. This
chapter covers what an app author needs.

## Create the auth object

Make one per app session, as early as possible:

```ts
import { createPodAuth, type PodAuthOptions } from '@jeswr/pod-auth';

declare const ui: PodAuthOptions['ui']; // Your sign-in screens; see below.

export const auth = createPodAuth({
  clientId: 'https://app.example/.well-known/solid-client-id.jsonld',
  redirectUri: 'https://app.example/auth/callback.html',
  ui,
});
```

- **`clientId`** is the URL of your app's Client Identifier Document, a small JSON-LD file that
  tells identity providers your app's name, logo and callback URLs. Chapter 10 shows how to
  generate it. During local development you can use `{ dynamicRegistration: true }` with a
  `localhost` callback instead.
- **`redirectUri`** is the page the identity provider sends the user back to. It must be on
  your app's origin and listed in the Client Identifier Document.
- **`ui`** is three functions your app supplies. The SDK calls them when it needs the user.

## The three UI hooks

```ts
import type { PodAuthOptions } from '@jeswr/pod-auth';

declare function askForWebId(): Promise<string>;
declare function pickProvider(issuers: string[]): Promise<string>;
declare function openPopup(url: URL, signal: AbortSignal): Promise<string>;

export const ui: PodAuthOptions['ui'] = {
  // Called when login() was given no hint at all.
  getWebId: () => askForWebId(),
  // Called when a profile lists more than one identity provider.
  chooseIssuer: (issuers) => pickProvider(issuers),
  // Open the provider's page, wait for the redirect, return the full callback URL.
  getCode: (authorizationUrl, signal) => openPopup(authorizationUrl, signal),
};
```

`getCode` must return the **complete** callback URL, including its `code`, `state` and `iss`
query parameters, and must give up when `signal` aborts. Use a popup (or another window) whose
callback page posts its URL back to the opener. A full-page redirect does **not** work yet: the
sign-in state lives in the page that called `login()`, so navigating that page away loses it.

## Design the sign-in screen

Many people do not remember their WebID. Do not make it the only way in. The suite's sign-in
screen has two steps.

**Step 1, "Choose an account"**, appears only when accounts are remembered
(`auth.remembered()`). It is a rounded list of those accounts, one click each, ending with
**Use another account**, which opens step 2.

**Step 2, "Sign in"**, offers, in this order:

1. **A WebID field.** It also accepts a provider's address, for people who know that instead.
2. **"or"**, then one pill-shaped button per identity provider, in the provider's own colour,
   showing just its name and logo. Clicking one calls `auth.login({ issuer })` and the provider
   works out who the user is.
3. **Other provider**, an address field (with recently used providers) for anyone else,
   including people running their own.
4. A footer with **Get a pod** and **What is a WebID?** for people new to Solid.

### Use the shared sign-in card

`SignInCard` from `@jeswr/suite-ui/sign-in` draws this screen. It has no sign-in logic of its own:
you give it the providers and accounts to show, and it calls you back with what the user picked.
Load `@jeswr/suite-ui/styles/sign-in.css` after the suite-ui token, theme, density and component
styles.

Map the card's callbacks to `auth.login`, and pass `pending` and `error` back while a sign-in runs:

```ts
import type { PodAuth } from '@jeswr/pod-auth';
import type { SignInCardProps, SignInProvider } from '@jeswr/suite-ui/sign-in';

declare const auth: PodAuth;
declare function render(props: SignInCardProps): void; // Draw <SignInCard {...props} />.
declare function enterApp(): void;

// Home provider first. Only list providers you have tested against.
const providers: SignInProvider[] = [
  { id: 'home', name: 'Example Pods', issuer: 'https://login.pods.example/' },
  { id: 'community', name: 'Solid Community', issuer: 'https://solidcommunity.net/' },
];
const remembered = await auth.remembered();

function show(pending: SignInCardProps['pending'], error: string | null = null) {
  render({
    providers,
    // remembered() holds at most one account today (the last one used).
    recentAccounts: remembered.map((account) => ({
      webId: account.webId,
      name: account.displayName,
      photoUrl: account.avatar,
    })),
    pending,
    error,
    onAccount: (account) => {
      const issuer = remembered.find((entry) => entry.webId === account.webId)?.issuer;
      run({ kind: 'account', key: account.webId }, { webId: account.webId, issuer });
    },
    onWebId: (input) => run({ kind: 'webid', key: input }, { webId: input }),
    onProvider: (provider) =>
      run({ kind: 'provider', key: provider.id }, { issuer: provider.issuer }),
    onCustomProvider: (input) => run({ kind: 'custom', key: input }, { issuer: input }),
  });
}

type Pending = NonNullable<SignInCardProps['pending']>;

function run(pending: Pending, hint: { webId?: string; issuer?: string }) {
  show(pending);
  auth.login(hint).then(
    () => enterApp(), // Signed in.
    () => show(null, 'Sign-in did not finish. Please try again.'),
  );
}

show(null);
```

`render` stands for however your app re-renders; in React, keep the props in state and return
`<SignInCard {...props} />`.

The card shows the account list only when `recentAccounts` is not empty. Provider pills use the
provider's brand colour and logo when the suite knows it, and a monogram otherwise; set `color`
(a six-digit `#rrggbb`) or `iconUrl` to override. The
[suite-ui README](../../packages/suite-ui/README.md#shared-sign-in-card) lists every prop.

**Not ready yet.** The WebID field passes whatever the user typed to `onWebId`, which may be a
provider's address rather than a WebID. `@jeswr/pod-auth/directory` (in review) adds a helper that
tells the two apart and a list of known providers. Until it lands, treat the input as a WebID.

Signing in through a provider already fails when the WebID profile does not name that provider.
The same pull request (in review) gives that failure a named error, `IssuerNotAuthorizedError`, so
you can explain it to the user.

## Restore the session on start-up

```ts
import type { PodAuth } from '@jeswr/pod-auth';

declare const auth: PodAuth;

const identity = await auth.restore();
if (identity === null) {
  // Show the sign-in screen.
} else {
  // identity.webId and identity.issuer say who is signed in.
}
```

`restore()` uses a refresh token stored next to a key that cannot be exported from the browser,
so it normally needs no UI at all. If the provider rejects that token, `restore()` makes one
silent attempt (`prompt=none`) through your `getCode` hook, so that hook must cope with a request
the user never sees; it never falls back to an interactive sign-in. If that fails it returns
`null`. A network failure also returns `null` but keeps the stored session, so a later retry can
still succeed.

## Find the user's pod

Signing in tells you who the user is, not where their data lives. On Solid, the WebID profile
lists the user's storages (`pim:storage`). Read it with the shared RDF tools:

```ts
import { fetchRdf } from '@jeswr/fetch-rdf';
import type { PodAuth } from '@jeswr/pod-auth';
import { Agent } from '@solid/object';
import { DataFactory } from 'n3';

export async function findStorages(auth: PodAuth): Promise<string[]> {
  const identity = await auth.identity();
  if (identity === null) throw new Error('Not signed in');
  if (identity.webId === null) return [...identity.storages]; // Agents without a WebID.
  const { dataset } = await fetchRdf(identity.webId, { fetch: auth.fetch });
  return [...new Agent(identity.webId, dataset, DataFactory).storageUrls];
}
```

Use the only storage when there is one, and let the user choose when there are several. When
there are none (a new account on some servers starts with a bare profile), ask the user for their
storage URL and remember it. `auth.fetch` sends credentials only to storages the profile lists or
you configure, and the configured list is fixed when the auth object is made: create a new one with
that URL in `boundary.roots`, then call `restore()`. `identity.storages` lists every root
`auth.fetch` trusts, including any you configured, so read the profile rather than that list to
find the user's pod.

## Listen for session changes

```ts
import type { PodAuth } from '@jeswr/pod-auth';

declare const auth: PodAuth;
declare function clearAccountState(): void;

const stop = auth.on('logout', () => clearAccountState());
auth.on('expired', () => {
  // The stored session is gone; ask the user to sign in again.
});
stop();
```

On `logout`, drop every client, subscription and cache you built for that account.
`auth.logout()` revokes the refresh token when the provider supports it, deletes the local
session and key, and always emits `logout`, even if revocation fails. It does not sign the user
out of the provider's own website.

To switch accounts, call `logout()` first, then `login()` again. Several accounts at once are
**not ready yet**.

## The safe fetch

Use `auth.fetch` for every pod request, and pass it to the other SDK packages. It attaches
credentials only to URLs inside two kinds of storage root:

- roots you list in `boundary.roots`, and
- the storages the signed-in user's own WebID profile lists (`pim:storage`), loaded when they sign
  in or the session is restored, and dropped on logout.

Nothing a server sends back adds a root. A site that says it is a storage, or answers 401, gets no
credentials unless the user's profile names it or you listed it. A request anywhere else goes out
without credentials.

To send credentials only to pods you list, for example in an app tied to one pod, turn the profile
roots off:

```ts
import { createPodAuth, type PodAuthOptions } from '@jeswr/pod-auth';

declare const ui: PodAuthOptions['ui'];

export const strictAuth = createPodAuth({
  clientId: 'https://app.example/.well-known/solid-client-id.jsonld',
  redirectUri: 'https://app.example/auth/callback.html',
  ui,
  boundary: { roots: ['https://pod.example/alice/'], automatic: false },
});
```

To keep profile roots but accept only some hosts, leave `automatic` out and pass
`eligible: (url) => url.origin === 'https://pod.example'`. `eligible` filters listed roots and
profile roots alike. These options only decide where credentials go; requests elsewhere still run,
without them.

Never call `registerGlobally`, never patch `globalThis.fetch`, and never add `Authorization` or `DPoP`
headers yourself.

`auth.identity()` tells you who is signed in without any network traffic. Do not treat a public
profile read as proof that the user signed in.

## Server-side agents

Bots, importers and MCP servers use `@jeswr/pod-auth/node`:

- `forClientCredentials` signs in as a service with a client ID and secret.
- `forCid` signs in as an LWS agent with a Controlled Identifier document and a private key you
  provide.

Both return the same `fetch` shape, so the rest of your code does not change. Both require an
explicit list of storage roots the agent may touch.

## React

`@jeswr/pod-auth/react` has a `PodAuthProvider` and a `usePodAuth()` hook that mirror the auth
object's state. Mount one provider at the top of the app.

Next: [reading and writing data](04-reading-and-writing.md).
