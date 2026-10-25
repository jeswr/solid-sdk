import * as oauth from "oauth4webapi"
import type { ClientProvider } from "./ClientProvider.js"
import { supportsOfflineAccess } from "./supportsOfflineAccess.js"
import { oauthOptions, type HttpOptions } from "./transport.js"

/** Registers a new public client with OAuth 2.0 Dynamic Client Registration. */
export class DynamicRegistrationClientProvider implements ClientProvider {
    readonly #http: HttpOptions | undefined

    constructor(http?: HttpOptions) {
        this.#http = http
    }

    async getClient(as: oauth.AuthorizationServer, redirectUri: string, signal: AbortSignal): Promise<oauth.Client> {
        const metadata = {
            redirect_uris: [redirectUri],
            grant_types: ["authorization_code"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
        }

        if (supportsOfflineAccess(as)) {
            metadata.grant_types.push("refresh_token")
        }

        const registrationResponse = await oauth.dynamicClientRegistrationRequest(as, metadata, oauthOptions(this.#http, signal))
        return await oauth.processDynamicClientRegistrationResponse(registrationResponse)
    }
}
