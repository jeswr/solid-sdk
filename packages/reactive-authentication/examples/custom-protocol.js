// Any protocol can take part: implement TokenProvider. The reactive algorithm (boundary, replay,
// redirects, bounded retries, logout fence) is shared; the provider only decides whether it can answer a
// challenge and how to attach credentials. This one answers `WWW-Authenticate: ApiKey realm="…"`.
import { CredentialBoundary, ReactiveFetchManager } from "@solid/reactive-authentication"

class ApiKeyProvider {
    #key
    constructor(key) { this.#key = key }

    async matches(request, challenge) {
        return challenge?.challenges.some(c => c.scheme === "apikey") ?? false
    }

    async upgrade(request) {
        const headers = new Headers(request.headers)
        headers.set("Authorization", `ApiKey ${this.#key}`)
        return new Request(request, {headers})
    }

    async forget() { this.#key = undefined }
}

const manager = new ReactiveFetchManager({
    providers: [new ApiKeyProvider(process.env.API_KEY)],
    boundary: new CredentialBoundary(["https://api.example/"]),
})
console.log((await manager.fetch("https://api.example/things")).status)
