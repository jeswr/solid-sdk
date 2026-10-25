import { createMemoryStore } from "@key-value-kit/storage/memory"
import {
    CachingAuthorizationServerProvider, CachingClientProvider, CredentialBoundary, DPoPTokenProvider,
    DynamicRegistrationClientProvider, ReactiveFetchManager, SessionFence, XASProvider,
} from "../../dist/mod.js"
import { insecure, transport } from "./http.js"
import { automaticCodeProvider } from "./openid.js"

export const callback = "https://app.example/callback"

/** Wires a Solid-OIDC client exactly as an application would, against the local servers. */
export function solidClient(op, rs, options = {}) {
    const code = options.code ?? automaticCodeProvider()
    const http = options.http ?? insecure
    const as = new CachingAuthorizationServerProvider(new XASProvider({getIssuer: async () => new URL(op.issuer)}, http))
    const client = new CachingClientProvider(new DynamicRegistrationClientProvider(http))
    const provider = new DPoPTokenProvider(callback, code, as, client, options.cache, {http, ...options.provider})
    const boundary = new CredentialBoundary([`${rs.url}/alice/`, `${rs.url}/bob/`], {allowInsecureHttp: true})
    const manager = new ReactiveFetchManager({providers: [provider], boundary, fetch: options.fetch ?? transport, ...(options.fence ? {fence: options.fence} : {})})
    return {manager, provider, code, boundary}
}

/** Two "tabs": separate fences over one shared generation store, as IndexedDB would provide. */
export function sharedFences(namespace = `ns-${crypto.randomUUID()}`) {
    const store = createMemoryStore()
    return [new SessionFence(namespace, {store}), new SessionFence(namespace, {store})]
}

export function deferred() {
    return Promise.withResolvers()
}
