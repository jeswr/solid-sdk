import type { IssuerProvider } from "./IssuerProvider.js"
import { ReactiveAuthenticationError } from "./ReactiveAuthenticationError.js"
import type { HttpOptions } from "./transport.js"
import { issuersFromWebId } from "./webId.js"

/**
 * Obtains the issuer from a WebID profile (`solid:oidcIssuer`, Solid-OIDC §6.1). When several are listed,
 * `choose` picks one (default: the only one, or an error).
 */
export class WebIdIssuerProvider implements IssuerProvider {
    constructor(
        private readonly getWebId: (request: Request) => Promise<URL>,
        private readonly http?: HttpOptions,
        private readonly choose: (issuers: URL[]) => URL | Promise<URL> = only,
    ) {
    }

    async getIssuer(request: Request): Promise<URL> {
        const webId = await this.getWebId(request)
        const issuers = await issuersFromWebId(webId, request.signal, this.http)
        if (issuers.length === 0) throw new ReactiveAuthenticationError("WebID profile lacks OIDC issuer")
        return await this.choose(issuers)
    }
}

function only(issuers: URL[]): URL {
    if (issuers.length !== 1) throw new ReactiveAuthenticationError("WebID profile lists several issuers; supply a chooser")
    return issuers[0]!
}
