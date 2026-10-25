// LWS SAML 2.0 suite. The client transports a signed assertion; the authorization server validates it
// against its out-of-band trust in the identity provider. Obtaining the assertion is the job of an
// established SAML stack — typically the application's own service provider backend (e.g. samlify,
// node-saml, Shibboleth) exposing an endpoint that returns the assertion for the logged-in user with
// the authorization server in its AudienceRestriction.
import { CredentialBoundary, LwsTokenProvider, ReactiveFetchManager, SamlAssertionSource } from "@solid/reactive-authentication"

const source = new SamlAssertionSource({
    id: "https://idp.example/saml|alice",
    obtainAssertion: async ({authorizationServer, signal}) => {
        const response = await fetch(`/saml/assertion?audience=${encodeURIComponent(authorizationServer.href)}`, {signal, credentials: "same-origin"})
        const {xml, recipient, notOnOrAfter} = await response.json()
        return {xml, clientId: recipient, expiresAt: Date.parse(notOnOrAfter)}
    },
})

const manager = new ReactiveFetchManager({
    providers: [new LwsTokenProvider(source)],
    boundary: new CredentialBoundary(["https://storage.example/root/"]),
})
console.log((await manager.fetch("https://storage.example/root/data")).status)
