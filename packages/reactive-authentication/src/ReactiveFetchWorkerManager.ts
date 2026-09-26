import type { CodeProvider } from "./CodeProvider.js"
import type { IssuerProvider } from "./IssuerProvider.js"
import { CANCEL, isInteractionRequest, MAX_URL_LENGTH, type InteractionReply, type InteractionRequest } from "./worker/messages.js"

export interface ReactiveFetchWorkerManagerOptions {
    /** Runs authorization UI (e.g. `<authorization-code-flow>`). */
    readonly codeProvider: CodeProvider

    /** Chooses issuers (e.g. `<idp-picker>`); without it, issuer requests are refused. */
    readonly issuerProvider?: IssuerProvider

    /** The service worker script, e.g. `new URL("./sw.js", import.meta.url)`. */
    readonly scriptUrl: URL

    readonly scope?: string
}

/**
 * Page side of service-worker authentication: registers the worker and answers its interaction requests.
 *
 * Messages are accepted only from an active service worker of this origin whose script is `scriptUrl`,
 * only in the documented shape, one at a time per request port; cancellation from the worker aborts the UI.
 */
export class ReactiveFetchWorkerManager {
    readonly #options: ReactiveFetchWorkerManagerOptions
    readonly #onMessage = (event: MessageEvent) => void this.#handle(event)

    constructor(options: ReactiveFetchWorkerManagerOptions) {
        this.#options = options
    }

    async register(): Promise<ServiceWorkerRegistration> {
        navigator.serviceWorker.addEventListener("message", this.#onMessage)
        const registration = await navigator.serviceWorker.register(this.#options.scriptUrl, {type: "module", ...(this.#options.scope === undefined ? {} : {scope: this.#options.scope})})
        await navigator.serviceWorker.ready
        return registration
    }

    unregisterListener(): void {
        navigator.serviceWorker.removeEventListener("message", this.#onMessage)
    }

    async #handle(event: MessageEvent): Promise<void> {
        const port = event.ports[0]
        if (port === undefined || !this.#trusted(event) || !isInteractionRequest(event.data)) return

        const controller = new AbortController()
        port.onmessage = message => {
            if (message.data?.type === CANCEL.type) controller.abort(new DOMException("Cancelled by service worker", "AbortError"))
        }

        let reply: InteractionReply
        try {
            reply = {ok: true, value: await this.#interact(event.data, controller.signal)}
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e))
            reply = {ok: false, name: error.name.slice(0, 255), message: error.message.slice(0, 2047)}
        }

        if (!controller.signal.aborted) port.postMessage(reply)
        port.close()
    }

    async #interact(request: InteractionRequest, signal: AbortSignal): Promise<string> {
        if (request.kind === "code") {
            using code = await this.#options.codeProvider.getCode(new URL(request.url), signal)
            if (code.value.length > MAX_URL_LENGTH) throw new Error("Authorization response too long")
            return code.value
        }

        if (this.#options.issuerProvider === undefined) throw new Error("No issuer provider configured")
        return (await this.#options.issuerProvider.getIssuer(new Request(request.url, {signal}))).href
    }

    #trusted(event: MessageEvent): boolean {
        const source = event.source
        return event.origin === location.origin &&
            typeof ServiceWorker !== "undefined" && source instanceof ServiceWorker &&
            source.scriptURL === this.#options.scriptUrl.href
    }
}
