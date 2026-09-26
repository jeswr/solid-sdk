// A script acting as itself with OAuth 2.0 client credentials and DPoP (e.g. Community Solid Server
// client credentials tokens). Run with Node.js >= 24.5.
import { ClientCredentialsTokenProvider, CredentialBoundary, ReactiveFetchManager, XASProvider } from "@solid/reactive-authentication"

const provider = new ClientCredentialsTokenProvider(
    new XASProvider({getIssuer: async () => new URL("https://solidcommunity.net/")}),
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
)
const manager = new ReactiveFetchManager({providers: [provider], boundary: new CredentialBoundary(["https://bot.solidcommunity.net/"])})
console.log((await manager.fetch("https://bot.solidcommunity.net/private/")).status)
