// A mock LWS 1.0 authorization server and storage (w3c/lws-protocol@268fd25). The authorization server
// validates each suite's credential independently of the client library:
// - id_token: signature against the OpenID provider's JWKS, issuer, azp (OpenID suite)
// - jwt: sub = iss = client_id, aud contains this AS, exp/iat; key from the subject's controlled identifier
//   document selected by kid (CID suite), or decoded from the did:key identifier itself (did:key suite)
// - saml2: XML signature validated with xml-crypto against an out-of-band trusted IdP key (SAML suite)
import { DOMParser } from "@xmldom/xmldom"
import { p256 } from "@noble/curves/nist.js"
import { decodeJwt, decodeProtectedHeader, exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT } from "jose"
import { base58btc } from "multiformats/bases/base58"
import { varint } from "multiformats"
import { randomUUID } from "node:crypto"
import { SignedXml } from "xml-crypto"
import xpath from "xpath"
import { serve, transport } from "./http.js"

export const TYPES = {
    idToken: "urn:ietf:params:oauth:token-type:id_token",
    saml2: "urn:ietf:params:oauth:token-type:saml2",
    jwt: "urn:ietf:params:oauth:token-type:jwt",
}

/** Resolves a did:key to a public JWK (did:key method §3.1.3), independently of the library's encoder. */
export function jwkFromDidKey(did) {
    const bytes = base58btc.decode(did.slice("did:key:".length))
    const [code, length] = varint.decode(bytes)
    const key = bytes.subarray(length)
    if (code === 0xed) return {kty: "OKP", crv: "Ed25519", x: Buffer.from(key).toString("base64url")}
    if (code === 0x1200) {
        const raw = p256.Point.fromBytes(key).toBytes(false)
        return {kty: "EC", crv: "P-256", x: Buffer.from(raw.subarray(1, 33)).toString("base64url"), y: Buffer.from(raw.subarray(33)).toString("base64url")}
    }
    throw new Error(`unsupported multicodec ${code}`)
}

async function verifySelfIssued(token, as) {
    const claims = decodeJwt(token)
    const header = decodeProtectedHeader(token)
    if (header.alg === "none") throw new Error("unsigned")
    if (!(claims.sub === claims.iss && claims.iss === claims.client_id)) throw new Error("sub/iss/client_id differ")
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!aud.includes(as)) throw new Error("aud lacks this authorization server")
    if (typeof claims.iat !== "number" || typeof claims.exp !== "number") throw new Error("iat/exp required")

    let jwk
    if (claims.sub.startsWith("did:key:")) {
        jwk = jwkFromDidKey(claims.sub)
    } else {
        const document = await (await transport(claims.sub, {headers: {accept: "application/cid+json, application/json"}})).json()
        if (document.id !== claims.sub) throw new Error("CID id mismatch")
        const methods = document.verificationMethod ?? []
        const method = methods.find(m => m.id === header.kid || m.id === new URL(`#${header.kid}`, claims.sub).href)
        if (method === undefined) throw new Error("kid selects no verification method")
        const authentication = (document.authentication ?? []).map(a => typeof a === "string" ? a : a.id)
        if (!authentication.includes(method.id)) throw new Error("verification method not authorized for authentication")
        if (method.controller !== claims.sub) throw new Error("verification method controller mismatch")
        jwk = method.publicKeyJwk
    }
    await jwtVerify(token, await importJWK(jwk, header.alg), {issuer: claims.iss, audience: as, subject: claims.sub})
    return {sub: claims.sub, client: claims.client_id}
}

function verifySaml(token, as, idp) {
    const xml = Buffer.from(token, "base64url").toString("utf8")
    const doc = new DOMParser().parseFromString(xml, "text/xml")
    const signature = xpath.select("//*[local-name(.)='Signature' and namespace-uri(.)='http://www.w3.org/2000/09/xmldsig#']", doc)
    if (signature.length !== 1) throw new Error("expected exactly one signature")
    const signed = new SignedXml({publicCert: idp.publicKey, getCertFromKeyInfo: () => null})
    signed.loadSignature(signature[0])
    if (!signed.checkSignature(xml)) throw new Error("bad SAML signature")

    // Read claims only from what the signature covers (prevents signature wrapping).
    const references = signed.getSignedReferences()
    if (references.length !== 1) throw new Error("expected one signed reference")
    const assertion = new DOMParser().parseFromString(references[0], "text/xml")
    const value = path => xpath.select1(`string(${path})`, assertion)
    if (xpath.select("/*[local-name(.)='Assertion']", assertion).length !== 1) throw new Error("signed reference is not the assertion")
    const issuer = value("/*[local-name(.)='Assertion']/*[local-name(.)='Issuer']")
    const nameId = value("//*[local-name(.)='Subject']/*[local-name(.)='NameID']").trim()
    const recipient = value("//*[local-name(.)='SubjectConfirmationData']/@Recipient")
    const notOnOrAfter = value("//*[local-name(.)='Conditions']/@NotOnOrAfter")
    const audiences = xpath.select("//*[local-name(.)='Audience']", assertion).map(n => n.textContent.trim())
    if (issuer !== idp.entityId) throw new Error("untrusted SAML issuer")
    if (!audiences.includes(as)) throw new Error("audience lacks this authorization server")
    if (Date.parse(notOnOrAfter) <= Date.now()) throw new Error("expired assertion")
    return {sub: nameId, client: recipient}
}

/**
 * @param {object} options
 * @param {object} [options.op] OpenID provider (for id_token validation)
 * @param {{entityId: string, publicKey: string}} [options.idp] trusted SAML IdP
 * @param {string[]} [options.subjectTokenTypes] advertised types
 * @param {(base: string) => string} [options.asUri] as_uri to announce (default: this server)
 */
export async function startLws(options = {}) {
    const asKeys = await generateKeyPair("ES256")
    const stats = {exchanges: [], rejected: [], accepted: []}

    const server = await serve(async (request, {url: base}) => {
        const url = new URL(request.url)
        const as = `${base}/`
        const realm = `${base}/storage_1`
        const json = (body, status = 200) => Response.json(body, {status, headers: {"cache-control": "no-store"}})

        if (url.pathname === "/.well-known/lws-configuration") {
            return json({
                issuer: as,
                token_endpoint: `${base}/token`,
                jwks_uri: `${base}/jwks`,
                grant_types_supported: ["urn:ietf:params:oauth:grant-type:token-exchange"],
                subject_token_types_supported: options.subjectTokenTypes ?? [TYPES.jwt, "urn:ietf:params:oauth:token-type:id-token", TYPES.saml2],
                subject_identifier_types_supported: ["did:key", "https"],
            })
        }

        if (url.pathname === "/token") {
            const form = new URLSearchParams(await request.text())
            stats.exchanges.push(Object.fromEntries(form))
            if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:token-exchange") return json({error: "unsupported_grant_type"}, 400)
            if (form.get("resource") !== realm) return json({error: "invalid_target"}, 400)
            let subject
            try {
                switch (form.get("subject_token_type")) {
                    case TYPES.idToken: {
                        const {payload} = await jwtVerify(form.get("subject_token"), options.op.jwks, {issuer: options.op.issuer})
                        if (typeof payload.azp !== "string") throw new Error("azp required")
                        subject = {sub: payload.webid ?? payload.sub, client: payload.azp}
                        break
                    }
                    case TYPES.jwt:
                        subject = await verifySelfIssued(form.get("subject_token"), as)
                        break
                    case TYPES.saml2:
                        subject = verifySaml(form.get("subject_token"), as, options.idp)
                        break
                    default:
                        throw new Error("unsupported subject token type")
                }
            } catch (e) {
                stats.rejected.push(e.message)
                return json({error: "invalid_grant", error_description: e.message}, 400)
            }
            const now = Math.floor(Date.now() / 1000)
            const accessToken = await new SignJWT({client_id: subject.client})
                .setProtectedHeader({alg: "ES256", typ: "at+jwt"})
                .setSubject(subject.sub).setIssuer(as).setAudience(form.get("resource"))
                .setIssuedAt(now).setExpirationTime(now + 300).setJti(randomUUID())
                .sign(asKeys.privateKey)
            return json({access_token: accessToken, token_type: "Bearer", expires_in: 300, issued_token_type: "urn:ietf:params:oauth:token-type:access_token"})
        }

        if (url.pathname === "/storage_1") {
            return new Response(JSON.stringify({
                "@context": ["https://www.w3.org/ns/cid/v1", "https://www.w3.org/ns/lws/v1"],
                id: realm, type: "Storage",
                service: [{type: "StorageRoot", serviceEndpoint: `${base}/root/`}],
            }), {headers: {"content-type": "application/lws+cid"}})
        }

        if (options.documents?.[url.pathname]) {
            return Response.json(options.documents[url.pathname](base))
        }

        // Protected storage resources under /root/ (and a misplaced one under /other/).
        const challenge = error => new Response("unauthorized", {status: 401, headers: {
            "www-authenticate": `Bearer as_uri="${options.asUri?.(base) ?? as}", realm="${realm}"${error ? `, error="${error}"` : ""}`,
            link: `<${realm}>; rel="https://www.w3.org/ns/lws#storage"`,
        }})
        const authorization = request.headers.get("authorization")
        if (!authorization?.startsWith("Bearer ")) return challenge()
        try {
            const {payload} = await jwtVerify(authorization.slice(7), asKeys.publicKey, {issuer: as, typ: "at+jwt"})
            // LWS: aud contains exactly one value identifying the storage containing the target.
            if (payload.aud !== realm || !url.pathname.startsWith("/root/")) return challenge("invalid_token")
            stats.accepted.push({url: request.url, sub: payload.sub, client: payload.client_id})
            return new Response(`hello ${payload.sub}`)
        } catch {
            return challenge("invalid_token")
        }
    })

    return {server, stats, get url() { return server.url }, close: () => server.close(), exportJWK: () => exportJWK(asKeys.publicKey)}
}
