// Service worker: authenticates the page's fetches inside the boundary. Bundle this file (service workers
// cannot use import maps), e.g. `esbuild sw.js --bundle --format=esm --outfile=dist/sw.js`.

import {
  CachingAuthorizationServerProvider,
  CredentialBoundary,
  DPoPTokenProvider,
  DynamicRegistrationClientProvider,
  SessionFence,
  XASProvider,
} from "@jeswr/reactive-authentication";
import {
  BridgedCodeProvider,
  BridgedIssuerProvider,
  installReactiveAuthentication,
  WindowBridge,
} from "@jeswr/reactive-authentication/service-worker";
import { createIndexedDbStore } from "@key-value-kit/storage/indexeddb";
import { createMemoryStore } from "@key-value-kit/storage/memory";

const namespace = "example-app/v1/default-account";
const fence = new SessionFence(namespace, {
  store: createIndexedDbStore({ namespace: `${namespace}:fence` }),
});
const cache = createMemoryStore(); // shared by the per-tab providers below: tabs share sessions
const bridge = new WindowBridge(self);

installReactiveAuthentication(self, {
  boundary: new CredentialBoundary(["https://alice.solidcommunity.net/"]),
  fence,
  // One provider set per tab, so the popup opens in the tab whose request needs it.
  providers: (clientId) => [
    new DPoPTokenProvider(
      new URL("/callback.html", self.location.href).href,
      new BridgedCodeProvider(bridge.forClient(clientId)),
      new CachingAuthorizationServerProvider(
        new XASProvider(new BridgedIssuerProvider(bridge.forClient(clientId))),
      ),
      new DynamicRegistrationClientProvider(),
      cache,
      { namespace, fence },
    ),
  ],
});

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
