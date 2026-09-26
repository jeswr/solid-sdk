import { hasAmbiguousPath, isWithin, parseHttpUrl } from "./url.js"

export interface CredentialBoundaryOptions {
    /**
     * Permit `http:` entries. Only for local development: credentials sent over plain HTTP can be read
     * and replayed by anyone on the network path.
     */
    readonly allowInsecureHttp?: boolean
}

/**
 * The explicit set of URLs that may receive credentials.
 *
 * Entries ending with `/` cover that container and everything below it, respecting path-segment
 * boundaries; other entries match that exact resource (any query string). Matching compares parsed
 * origins, never string prefixes, so look-alike hosts (`pod.example.attacker.test`), downgraded
 * schemes, other ports and sibling paths (`/alice-evil/`) are outside the boundary.
 *
 * Discovery (WebID profiles, storage descriptions, challenges) never adds entries on its own: the
 * application decides what to trust, and can widen the boundary at runtime with {@link add}.
 */
export class CredentialBoundary {
    readonly #entries = new Set<string>()
    readonly #allowInsecureHttp: boolean
    readonly #unrestricted: boolean

    constructor(entries: Iterable<string | URL> = [], options: CredentialBoundaryOptions = {}, unrestricted = false) {
        this.#allowInsecureHttp = options.allowInsecureHttp ?? false
        this.#unrestricted = unrestricted
        for (const entry of entries) {
            this.add(entry)
        }
    }

    /**
     * A boundary that allows every HTTP(S) URL, reproducing the pre-boundary behaviour of upgrading any 401.
     *
     * @deprecated Any server your application contacts — including URLs found in fetched data — can then
     * obtain credentials by answering 401. Use an explicit boundary instead.
     */
    static unrestricted(): CredentialBoundary {
        console.warn("CredentialBoundary.unrestricted(): credentials may be sent to any server that answers 401")
        return new CredentialBoundary([], {allowInsecureHttp: true}, true)
    }

    /** Adds a container (trailing `/`) or exact resource URL to the boundary. */
    add(entry: string | URL): this {
        this.#entries.add(this.#canonical(entry))
        return this
    }

    delete(entry: string | URL): boolean {
        return this.#entries.delete(this.#canonical(entry))
    }

    /** Current entries, canonicalized. */
    get entries(): readonly string[] {
        return [...this.#entries]
    }

    allows(url: string | URL): boolean {
        const target = parseHttpUrl(url)
        if (target === undefined || hasAmbiguousPath(target)) return false
        if (target.protocol === "http:" && !this.#allowInsecureHttp) return false
        if (this.#unrestricted) return true

        for (const entry of this.#entries) {
            if (entry.endsWith("/") ? isWithin(target, entry) : sameResource(target, entry)) {
                return true
            }
        }

        return false
    }

    #canonical(entry: string | URL): string {
        const url = parseHttpUrl(entry)
        if (url === undefined) throw new TypeError(`Credential boundary entries must be absolute HTTP(S) URLs without credentials: ${entry}`)
        if (url.protocol === "http:" && !this.#allowInsecureHttp) throw new TypeError(`Credential boundary entry uses insecure HTTP: ${url.href}`)
        if (hasAmbiguousPath(url)) throw new TypeError(`Credential boundary entries cannot contain encoded separators or dots: ${url.href}`)
        if (url.search !== "" || url.hash !== "") throw new TypeError(`Credential boundary entries cannot have a query or fragment: ${url.href}`)
        return url.href
    }
}

function sameResource(target: URL, entry: string): boolean {
    const url = new URL(entry)
    return target.origin === url.origin && target.pathname === url.pathname
}
