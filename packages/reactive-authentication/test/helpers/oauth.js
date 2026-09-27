// A generic OAuth 2.0 / OpenID Connect provider (Auth0/Keycloak-like) and Bearer-protected APIs. Access tokens
// are opaque random strings the APIs look up — clients must never decode them.
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { createHash, randomUUID } from "node:crypto"
import { serve } from "./http.js"

const b64url = buffer => Buffer.from(buffer).toString("base64url")

/**
 * @param {object} [options]
 * @param {"oidc"|"oauth2"|"none"} [options.discovery] which metadata document to serve (default both)
 * @param {string} [options.clientSecret] require client_secret_basic
 * @param {number} [options.expiresIn]
 * @param {boolean} [options.refresh] issue rotating refresh tokens (default true)
 * @param {boolean} [options.rotate] rotate refresh tokens on use (default true); false keeps the same one
 * @param {{nonce?: boolean, issuer?: boolean, audience?: boolean, state?: boolean, redirect?: string}} [options.tamper]
 * @param {string} [options.tokenType] token_type to issue (default Bearer)
 */
export async function startOAuthProvider(options = {}) {
    const keys = await generateKeyPair("ES256")
    const jwk = {...await exportJWK(keys.publicKey), kid: "k1", alg: "ES256", use: "sig"}
    const codes = new Map()
    const tokens = new Map() // access token -> {aud, scope, exp, revoked}
    const refreshTokens = new Map() // refresh token -> {state, client, aud, scope}
    const stats = {authorize: [], token: [], refresh: 0, reuse: 0, grants: 0}
    const tamper = options.tamper ?? {}
    const state = {discoveryGate: undefined}

    const server = await serve(async (request, {url: base}) => {
        const url = new URL(request.url)
        const issuer = `${base}/`
        const json = (body, status = 200) => Response.json(body, {status, headers: {"cache-control": "no-store"}})
        const metadata = {
            issuer,
            authorization_endpoint: `${base}/authorize`,
            token_endpoint: `${base}/token`,
            jwks_uri: `${base}/jwks`,
            code_challenge_methods_supported: ["S256"],
            response_types_supported: ["code"],
            id_token_signing_alg_values_supported: ["ES256"],
            authorization_response_iss_parameter_supported: true,
        }
        if (url.pathname.startsWith("/.well-known/") && state.discoveryGate) await state.discoveryGate
        switch (url.pathname) {
            case "/.well-known/openid-configuration":
                return options.discovery === "oauth2" || options.discovery === "none" ? new Response(null, {status: 404}) : json(metadata)
            case "/.well-known/oauth-authorization-server":
                return options.discovery === "oidc" || options.discovery === "none" ? new Response(null, {status: 404}) : json(metadata)
            case "/jwks":
                return json({keys: [jwk]})
            case "/authorize": {
                const p = Object.fromEntries(url.searchParams)
                stats.authorize.push(p)
                const redirect = new URL(tamper.redirect ?? p.redirect_uri)
                redirect.searchParams.set("state", tamper.state ? "forged" : p.state)
                redirect.searchParams.set("iss", issuer)
                if (p.code_challenge_method !== "S256" || !p.code_challenge) {
                    redirect.searchParams.set("error", "invalid_request")
                } else {
                    const code = randomUUID()
                    codes.set(code, p)
                    redirect.searchParams.set("code", code)
                }
                return new Response(null, {status: 302, headers: {location: redirect.href}})
            }
            case "/token": {
                const form = Object.fromEntries(new URLSearchParams(await request.text()))
                stats.token.push({...form, dpop: request.headers.get("dpop"), authorization: request.headers.get("authorization")})
                const client = clientOf(request, form)
                if (client === undefined) return json({error: "invalid_client"}, 401)

                if (form.grant_type === "authorization_code") {
                    const code = codes.get(form.code)
                    codes.delete(form.code)
                    if (code === undefined || code.client_id !== client || code.redirect_uri !== form.redirect_uri) return json({error: "invalid_grant"}, 400)
                    if (b64url(createHash("sha256").update(form.code_verifier ?? "").digest()) !== code.code_challenge) return json({error: "invalid_grant", error_description: "pkce"}, 400)
                    return json(await issue(issuer, client, code.scope, form.resource ?? code.resource, code.nonce))
                }
                if (form.grant_type === "refresh_token") {
                    stats.refresh++
                    const record = refreshTokens.get(form.refresh_token)
                    if (record === undefined || record.client !== client) return json({error: "invalid_grant"}, 400)
                    if (record.used) {
                        stats.reuse++
                        return json({error: "invalid_grant"}, 400)
                    }
                    if (options.rotate === false) {
                        // Non-rotating provider: a new access token, the same refresh token.
                        const {refresh_token: _, ...renewed} = await issue(issuer, client, record.scope, record.aud, undefined, false)
                        return json({...renewed, refresh_token: form.refresh_token})
                    }
                    record.used = true
                    return json(await issue(issuer, client, record.scope, record.aud, undefined, false))
                }
                return json({error: "unsupported_grant_type"}, 400)
            }
        }
        return new Response(null, {status: 404})
    })

    function clientOf(request, form) {
        if (options.clientSecret === undefined) return form.client_id
        const [id, secret] = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Basic /, ""), "base64").toString().split(":").map(decodeURIComponent)
        return secret === options.clientSecret ? id : undefined
    }

    async function issue(issuer, client, scope, aud, nonce, withIdToken = true) {
        stats.grants++
        const accessToken = randomUUID()
        const expiresIn = options.expiresIn ?? 300
        tokens.set(accessToken, {aud, scope, exp: Date.now() + expiresIn * 1000})
        const result = {access_token: accessToken, token_type: options.tokenType ?? "Bearer", expires_in: expiresIn, scope}
        if (options.refresh !== false) {
            const refreshToken = randomUUID()
            refreshTokens.set(refreshToken, {client, aud, scope})
            result.refresh_token = refreshToken
        }
        if (withIdToken && scope.split(" ").includes("openid")) {
            const now = Math.floor(Date.now() / 1000)
            result.id_token = await new SignJWT(nonce === undefined ? {} : {nonce: tamper.nonce ? "wrong" : nonce})
                .setProtectedHeader({alg: "ES256", kid: "k1"})
                .setIssuer(tamper.issuer ? "https://evil.example/" : issuer)
                .setAudience(tamper.audience ? "someone-else" : client)
                .setSubject("user-42").setIssuedAt(now).setExpirationTime(now + 300)
                .sign(keys.privateKey)
        }
        return result
    }

    return {
        server, stats,
        get url() { return server.url },
        get issuer() { return `${server.url}/` },
        metadata: () => ({
            issuer: `${server.url}/`, authorization_endpoint: `${server.url}/authorize`, token_endpoint: `${server.url}/token`,
            code_challenge_methods_supported: ["S256"],
        }),
        /** Whether an opaque token is valid for `aud`. */
        accepts(token, aud) {
            const record = tokens.get(token)
            return record !== undefined && !record.revoked && record.exp > Date.now() && record.aud === aud
        },
        revoke(token) { const record = tokens.get(token); if (record) record.revoked = true },
        setTamper(value) { Object.assign(tamper, value) },
        /** Holds discovery responses until the returned function is called. */
        delayDiscovery() { const {promise, resolve} = Promise.withResolvers(); state.discoveryGate = promise; return () => { state.discoveryGate = undefined; resolve() } },
        close: () => server.close(),
    }
}

/** An API that accepts Bearer tokens for `audience` from the provider. */
export async function startApi(provider, audience) {
    const accepted = []
    const server = await serve(request => {
        const token = request.headers.get("authorization")?.replace(/^Bearer /, "")
        if (token !== undefined && provider.accepts(token, audience ?? server.url)) {
            accepted.push({url: request.url, token, dpop: request.headers.get("dpop")})
            return new Response("api ok")
        }
        return new Response(null, {status: 401, headers: {"www-authenticate": `Bearer realm="api"${token === undefined ? "" : ', error="invalid_token"'}`}})
    })
    return {server, accepted, get url() { return server.url }, close: () => server.close()}
}
