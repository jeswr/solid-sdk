// LWS OpenID Connect suite: the user's ID token is the authentication credential; the storage's
// authorization server exchanges it (RFC 8693) for an access token bound to the storage (realm).
import {
    CredentialBoundary, DynamicRegistrationClientProvider, LwsTokenProvider, OidcIdTokenSource,
    ReactiveFetchManager, XASProvider,
} from "@solid/reactive-authentication"

// The OpenID provider must issue ID tokens whose `sub` is the agent's URI and which carry `azp`.
const openIdProvider = await new XASProvider({getIssuer: async () => new URL("https://openid.example")})
    .getAuthorizationServer(new Request("https://openid.example"))

const source = new OidcIdTokenSource(
    openIdProvider,
    "https://app.example/callback.html",
    document.querySelector("authorization-code-flow"),   // or any CodeProvider
    new DynamicRegistrationClientProvider(),
    {requireAudience: false},                            // true: refuse ID tokens whose aud omits the AS
)

// By default the authorization server and realm named by the 401 must be on the resource's origin.
const manager = new ReactiveFetchManager({
    providers: [new LwsTokenProvider(source)],
    boundary: new CredentialBoundary(["https://storage.example/root/"]),
})

const response = await manager.fetch("https://storage.example/root/notes")
console.log(response.status, (await source.identity())?.subject)
