<!-- AUTHORED-BY Claude Opus 5.5 -->

# 3. Signing people in

`@jeswr/pod-auth` handles sign-in for both Solid-OIDC and LWS. It gives you one thing to use
everywhere: `auth.fetch`, a fetch that adds credentials only to the user's own storage.

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
query parameters, and must give up when `signal` aborts. A popup is the smoothest choice; a
full-page redirect also works if your callback page hands the URL back.

## Design the sign-in screen

Many people do not remember their WebID. Do not make it the only way in. A good sign-in screen
offers, in this order:

1. **Continue as …** for a remembered account (`auth.remembered()`), one click.
2. **A list of identity providers** the user may already have an account with. Clicking one calls
   `auth.login({ issuer })`. The provider works out who the user is.
3. **Use your WebID**, a text field, for people who know it. This calls `auth.login({ webId })`.
4. **Another provider**, a text field for any issuer URL, for people running their own.

```ts
import type { PodAuth } from '@jeswr/pod-auth';

declare const auth: PodAuth;

// Only list providers your app has been tested against.
export const providers = [
  { name: 'Solid Community', issuer: 'https://solidcommunity.net/' },
  { name: 'Example Provider', issuer: 'https://login.example/' },
];

// 1. "Continue as …"
export async function continueAsRemembered() {
  const [account] = await auth.remembered();
  return account === undefined ? null : auth.login({ webId: account.webId, issuer: account.issuer });
}

// 2. and 4. A provider button, or the "another provider" field.
export const signInWithProvider = (issuer: string) => auth.login({ issuer });

// 3. The WebID field.
export const signInWithWebId = (webId: string) => auth.login({ webId });
```

Keep the provider list short, and add a line for people who have no pod yet that says what a pod
is and where to get one.

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
storage URL and remember it. `identity.storages` lists the roots `auth.fetch` currently trusts with
credentials; it can be empty straight after a Solid sign-in, so do not use it to find the pod.

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
credentials only to URLs inside the user's verified storage, or roots you list in
`boundary.roots`. A request to anywhere else goes out with no credentials. Never call
`registerGlobally`, never patch `globalThis.fetch`, and never add `Authorization` or `DPoP`
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
