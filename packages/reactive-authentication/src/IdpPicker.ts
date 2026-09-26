import { IssuerRequestCancelledError } from "./IssuerRequestCancelledError.js"
import type { IssuerProvider } from "./IssuerProvider.js"
import { ReactiveAuthenticationError } from "./ReactiveAuthenticationError.js"
import type { HttpOptions } from "./transport.js"
import { issuersFromWebId } from "./webId.js"
import type { WebIdPicker } from "./WebIdPicker.js"

const onlyOnce = {once: true}
const html = `
<dialog>
    <fieldset>
        <legend>
            <slot name="legend">Authorization Server URI required</slot>
        </legend>
        <p>
            <span>
                <slot name="description">The application needs an Authorization Server URI so it can handle the following request URI.</slot>
            </span>
            <details>
                <summary>
                    <slot name="summary">Request URI</slot>
                </summary>
                <code></code>
            </details>
        </p>
        <form method="dialog">
            <label>
                <span>
                    <slot name="inputlabel">Authorization Server URI</slot>
                </span>
                <input autofocus required type="url" list="autocomplete">
                <datalist id="autocomplete"></datalist>
            </label>
            <button>
                <slot name="ok-button">OK</slot>
            </button>
            <button type="button" id="webid" hidden disabled accesskey="w">
                <slot name="webid-button">Use <u>W</u>ebID</slot>
            </button>
            <button type="button" id="cancel">
                <slot name="cancel-button">Cancel</slot>
            </button>
        </form>
        <slot name="webid-picker"></slot>
    </fieldset>
</dialog>
`

/**
 * A web component (custom HTML element) that prompts the user for the URI of the authorization server (identity provider) to use for a request.
 *
 * @remarks
 * This element is not {@link customElements.define defined} when importing the module. Import {@link registerElements} to define it.
 *
 * See the {@link getIssuer} method for integrating this element into your application.
 */
export class IdpPicker extends HTMLElement implements IssuerProvider {
    #dialog!: HTMLDialogElement
    #input!: HTMLInputElement
    #code!: HTMLElement
    #webIdButton!: HTMLButtonElement
    #webIdPicker: WebIdPicker | null = null
    #suggestion = ""
    #request?: Request

    /** Network options for WebID profile retrieval (non-reactive transport by default). */
    http?: HttpOptions

    /** @ignore */
    connectedCallback() {
        const template = this.ownerDocument.createElement("template")
        template.innerHTML = html

        const shadow = this.attachShadow({mode: "closed"})
        shadow.appendChild(this.ownerDocument.importNode(template.content, true))

        this.#dialog = shadow.querySelector("dialog")!
        this.#input = shadow.querySelector("input")!
        this.#code = shadow.querySelector("code")!
        this.#webIdPicker = this.querySelector(":scope > webid-picker[slot='webid-picker']")
        this.#webIdButton = shadow.querySelector<HTMLButtonElement>("#webid")!

        shadow.querySelector("form")!.addEventListener("submit", e => this.#dialog.returnValue = this.#input.value)
        shadow.querySelector("#cancel")!.addEventListener("click", () => this.#dialog.close())
        this.#webIdButton.addEventListener("click", this.#useWebId.bind(this))

        // Options cannot be slotted into a datalist
        for (const option of this.querySelectorAll(":scope > option")) {
            shadow.querySelector("datalist")!.appendChild(option.cloneNode())
        }

        this.#webIdButton.disabled = this.#webIdButton.hidden = this.#webIdPicker === null
    }

    /** Pre-fills the input, e.g. with an issuer hint from the application URL, leaving confirmation to the user. */
    suggest(issuer: URL): void {
        this.#suggestion = issuer.href
    }

    async getIssuer(request: Request): Promise<URL> {
        return await navigator.locks.request("IdpPicker.getIssuer", async _ => {
            this.#request = request
            this.#input.value = this.#suggestion
            this.#code.innerText = request.url
            this.#dialog.returnValue = ""
            this.#dialog.showModal()

            const {promise, reject, resolve} = Promise.withResolvers<URL>()

            const onClose = () => {
                request.signal.removeEventListener("abort", onAbort)
                if (this.#dialog.returnValue !== "") {
                    resolve(new URL(this.#dialog.returnValue))
                } else {
                    reject(new IssuerRequestCancelledError(request))
                }
            }
            const onAbort = () => {
                this.#dialog.removeEventListener("close", onClose)
                this.#dialog.close()
                reject(request.signal.reason)
            }

            request.signal.addEventListener("abort", onAbort, onlyOnce)
            this.#dialog.addEventListener("close", onClose, onlyOnce)

            return await promise
        })
    }

    async #useWebId() {
        this.#webIdButton.disabled = true
        try {
            const webid = await this.#webIdPicker!.getWebId(this.#request!)
            const [issuer] = await issuersFromWebId(webid, this.#request!.signal, this.http)
            if (issuer === undefined) throw new ReactiveAuthenticationError("WebID profile lacks OIDC issuer")
            this.#input.value = issuer.href
        } finally {
            this.#webIdButton.disabled = false
            this.#input.focus()
        }
    }
}
