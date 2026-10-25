import * as oauth from "oauth4webapi"

/** A Fetch API compatible function. */
export type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Network options shared by every component that makes its own HTTP requests. */
export interface HttpOptions {
    /**
     * Non-reactive transport for discovery, registration, token and profile requests. Defaults to the
     * pre-registration `fetch` (see {@link nonReactiveFetch}), so these requests never re-enter a reactive
     * fetch that is waiting on them.
     */
    readonly fetch?: FetchFunction

    /**
     * Allow `http:` endpoints. Only for local development servers; never enable in production.
     * @defaultValue `false`
     */
    readonly allowInsecureRequests?: boolean
}

const originals = new WeakMap<Function, FetchFunction>()

/** Records that `reactive` wraps `original`, so providers can bypass it. */
export function registerReactiveFetch(reactive: Function, original: FetchFunction): void {
    originals.set(reactive, original)
}

/**
 * The `fetch` to use for requests that must not be authenticated reactively: the current global
 * `fetch`, or the function it replaced if it is a registered reactive fetch.
 *
 * Resolved at call time so tests and applications can still replace the global transport.
 */
export function nonReactiveFetch(): FetchFunction {
    const current = globalThis.fetch
    return originals.get(current) ?? current.bind(globalThis)
}

export function transportOf(http: HttpOptions | undefined): FetchFunction {
    return http?.fetch ?? ((input, init) => nonReactiveFetch()(input, init))
}

let warned = false

/** Request options for oauth4webapi carrying the transport, cancellation and the insecure-HTTP decision. */
export function oauthOptions(http: HttpOptions | undefined, signal?: AbortSignal) {
    if (http?.allowInsecureRequests === true && !warned) {
        warned = true
        console.warn("reactive-authentication: insecure HTTP OAuth requests enabled; use only for local development")
    }

    const transport = transportOf(http)
    return {
        ...(signal === undefined ? {} : {signal}),
        [oauth.customFetch]: (url: string, options: oauth.CustomFetchOptions<string, unknown>) => transport(url, options as RequestInit),
        [oauth.allowInsecureRequests]: http?.allowInsecureRequests === true,
    }
}

/** Rejects `http:` URLs unless insecure requests were explicitly allowed. */
export function assertSecureUrl(url: URL, http: HttpOptions | undefined): void {
    if (url.protocol === "https:") return
    if (url.protocol === "http:" && http?.allowInsecureRequests === true) return
    throw new TypeError(`Refusing non-HTTPS request to ${url.href}; set allowInsecureRequests only for local development`)
}

/** Fetches a URL with the non-reactive transport, enforcing HTTPS unless insecure requests are allowed. */
export async function secureFetch(url: URL, init: RequestInit, http: HttpOptions | undefined): Promise<Response> {
    assertSecureUrl(url, http)
    return await transportOf(http)(url, init)
}
