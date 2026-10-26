// A real service worker using the library: intercepts fetches inside the boundary and asks the requesting
// tab (through the window bridge) to run the authorization popup. Providers are created per window client
// and share one session cache, so tabs share sessions while interactions go to the tab that needs them.
import { createMemoryStore } from "@key-value-kit/storage/memory"
import {
    CredentialBoundary, DPoPTokenProvider, DynamicRegistrationClientProvider, SessionFence, XASProvider,
} from "../../dist/mod.js"
import { BridgedCodeProvider, installReactiveAuthentication, WindowBridge } from "../../dist/service-worker.js"

const config = new URL(self.location.href).searchParams
const http = {allowInsecureRequests: true} // local plain-HTTP test servers only
const bridge = new WindowBridge(self, {timeoutMs: 30_000})
const cache = createMemoryStore()
const fence = new SessionFence("sw-test")
const asProvider = new XASProvider({getIssuer: async () => new URL(config.get("op"))}, http)
const clientProvider = new DynamicRegistrationClientProvider(http)

installReactiveAuthentication(self, {
    providers: clientId => [new DPoPTokenProvider(
        new URL("/callback.html", self.location.href).href,
        new BridgedCodeProvider(bridge.forClient(clientId)),
        asProvider, clientProvider, cache,
        {http, namespace: "sw-test", fence},
    )],
    boundary: new CredentialBoundary([`${config.get("rs")}/alice/`, `${config.get("rs")}/bob/`], {allowInsecureHttp: true}),
    fence,
})

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()))
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()))
// A page this active worker does not control (after a hard reload, or — in Firefox under automation — a tab opened
// after activation) asks to be claimed. The library's own messages use dedicated MessageChannel ports.
self.addEventListener("message", event => {
    if (event.data === "claim") event.waitUntil(self.clients.claim())
})
