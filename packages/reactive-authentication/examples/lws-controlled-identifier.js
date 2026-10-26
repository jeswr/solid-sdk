// LWS self-signed identity with a controlled identifier (CID) document: an agent (bot, script, server)
// signs its own short-lived JWT; the authorization server dereferences `sub` and verifies it with the
// verification method named by `kid`.
import {
    CredentialBoundary, LwsTokenProvider, ReactiveFetchManager, SelfIssuedJwtSource,
    createControlledIdentifierDocument, trustAuthorizationServers,
} from "@solid/reactive-authentication"

const subject = "https://agent.example/id"
const keys = await crypto.subtle.generateKey({name: "ECDSA", namedCurve: "P-256"}, false, ["sign", "verify"])

// Publish this document at `subject` (application/cid+json or JSON-LD). Keep the private key secret.
const {document, keyId} = await createControlledIdentifierDocument(subject, keys.publicKey)
console.log(JSON.stringify(document, null, 2))

const source = new SelfIssuedJwtSource({subject, privateKey: keys.privateKey, algorithm: "ES256", keyId})
const manager = new ReactiveFetchManager({
    providers: [new LwsTokenProvider(source, {
        // A separately hosted authorization server must be trusted explicitly.
        trustAuthorizationServer: trustAuthorizationServers(["https://as.storage.example/"]),
    })],
    boundary: new CredentialBoundary(["https://storage.example/root/"]),
})
console.log((await manager.fetch("https://storage.example/root/data")).status)
