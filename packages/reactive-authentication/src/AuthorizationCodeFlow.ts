// AUTHORED-BY Codex GPT-6.1-Sol
import type { CodeProvider } from "./CodeProvider.js";
import { CodeRequestCancelledError } from "./CodeRequestCancelledError.js";

const authorizationWindowName = "oidcAuthentication";
const onlyOnce = { once: true };
const html = `
<style>
</style>
<form>
    <dialog part="new dialog" closedby="none">
        <p part="new text">
            <slot name="new-text">User interaction needed to launch authorization code flow in new window.</slot>
        </p>
        <button part="new open button" value="open">
            <slot name="new-open">Open new window</slot>
        </button>
        <button part="new cancel button" value="cancel">
            <slot name="new-cancel">Cancel</slot>
        </button>
    </dialog>
    <dialog part="switch dialog" closedby="none">
        <p part="switch text"> 
            <slot name="switch-text">There is an ongoing authorization code flow in another window.</slot>
        </p>
        <button part="switch open button" value="focus">
            <slot name="switch-open">Switch to ongoing flow</slot>
        </button>
        <button part="switch cancel button" value="cancel">
            <slot name="switch-cancel">Cancel</slot>
        </button>
    </dialog>
</form>
`;

/**
 * A web component (custom HTML element) that manages the user experience for OAuth 2.0 Authorization Code Grant.
 *
 * Put on an HTML page and connect to a token provider to implement the Authorization Code Flow using a popup.
 *
 * @remarks
 * This element is not {@link customElements.define defined} when importing the module. Import {@link registerElements} to define it.
 *
 * See the {@link getCode} method for integrating this element into your application.
 *
 * The appearance of this web component can be customized from the hosting HTML by using {@link https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/::part CSS parts}.
 * The following parts are available:
 * - `new dialog`: A {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog `dialog`} shown when the user needs to interact with the authorization server.
 * - `new text`: A {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/p `p`} that describes the dialog.
 * - `new open`: A {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/button `button`} that opens the authorization request popup.
 * - `new cancel`: A {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/button `button`} that cancels the authorization request and closes the popup.
 * - `switch dialog`: A {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog `dialog`} shown when there is an authorization request popup open.
 * - `switch text`: A {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/p `p`} that describes the dialog.
 * - `switch open`: A {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/button `button`} that switches to the authorization request popup.
 * - `switch cancel`: A {@link https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/button `button`} that cancels the authorization request and closes the popup.
 *
 * The text of this web component can be customized from the hosting HTML by using {@link https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_templates_and_slots slots}.
 * The following named slots are available:
 * - `new-text`: Child of the `new text` paragraph.
 * - `new-open`: Child of the `new open` button.
 * - `new-cancel`: Child of the `new cancel` button.
 * - `switch-text`: Child of the `switch text` paragraph.
 * - `switch-open`: Child of the `switch open` button.
 * - `switch-cancel`: Child of the `switch cancel` button.
 *
 * @example Minimal usage
 * ```html
 * <authorization-code-flow></authorization-code-flow>
 * ```
 *
 * @example Customizing text using slots
 * Any of the named slots can be used to customize the text shown in the dialogs:
 * ```html
 * <authorization-code-flow>
 *   <span slot="new-text">text of first (new) dialog</span>
 *   <span slot="new-open">text of first (new) dialog open button</span>
 *   <span slot="new-cancel">text of first (new) dialog cancel button</span>
 *   <span slot="switch-text">text of second (switch) dialog</span>
 *   <span slot="switch-open">text of second (switch) dialog open button</span>
 *   <span slot="switch-cancel">text of second (switch) dialog cancel button</span>
 * </authorization-code-flow>
 * ```
 *
 * @example Customizing appearance using CSS parts
 * CSS on the page hosting this web component can be used to customize the appearance of the elements that constitute its user interface:
 * ```html
 * <authorization-code-flow></authorization-code-flow>
 * <style>
 *   authorization-code-flow::part(new dialog) {
 *     border: 1px solid red;
 *   }
 *
 *   authorization-code-flow::part(new text) {
 *     border: 1px solid green;
 *   }
 *
 *   authorization-code-flow::part(new open) {
 *     border: 1px solid blue;
 *   }
 *
 *   authorization-code-flow::part(new cancel) {
 *     border: 1px solid yellow;
 *   }
 *
 *   authorization-code-flow::part(switch dialog) {
 *     border: 1px dotted red;
 *   }
 *
 *   authorization-code-flow::part(switch text) {
 *     border: 1px dotted green;
 *   }
 *
 *   authorization-code-flow::part(switch open) {
 *     border: 1px dotted blue;
 *   }
 *
 *   authorization-code-flow::part(switch cancel) {
 *     border: 1px dotted yellow;
 *   }
 * </style>
 * ```
 */
export class AuthorizationCodeFlow extends HTMLElement implements CodeProvider {
  #newModal!: HTMLDialogElement;
  #switchModal!: HTMLDialogElement;
  #authorizationWindow?: WindowProxy | null;
  #authorizationUri?: URL;
  #cancelCodeRequest: ((reason?: unknown) => void) | undefined;

  /** How often to check whether the user closed the popup. @defaultValue 500 ms */
  closedPollMs = 500;

  /** @ignore */
  connectedCallback() {
    const template = this.ownerDocument.createElement("template");
    template.innerHTML = html;

    const shadow = this.attachShadow({ mode: "closed" });
    shadow.appendChild(this.ownerDocument.importNode(template.content, true));

    this.#newModal = shadow.querySelector("dialog[part *= 'new']")!;
    this.#switchModal = shadow.querySelector("dialog[part *= 'switch']")!;

    shadow.querySelector("form")!.addEventListener("submit", this.#onSubmit.bind(this));
  }

  /**
   * A {@link CodeProvider} that directs the user to the authorization endpoint in a popup and waits for the
   * redirect back.
   *
   * @remarks Only one flow runs at a time (a Web Lock shared by all tabs); waiting for it can be aborted.
   * The callback page must `postMessage` its URL to the opener. Only messages from the popup window itself
   * whose origin (and whose reported URL's origin) equals the `redirect_uri` origin are accepted. Closing
   * the popup or pressing cancel rejects with {@link CodeRequestCancelledError}; every outcome removes
   * listeners and closes the popup.
   *
   * @param {URL} authorizationUri - The endpoint that the user should be directed to for authorization.
   * @param {AbortSignal} signal - An abort signal that can be used to cancel the authorization flow.
   *
   * @return A promise that resolves with the redirect URL received from the popup window.
   *
   * @example Using with a token provider
   * ```html
   * <authorization-code-flow></authorization-code-flow>
   * <script>
   *   const callbackUri = "http://localhost:8080/callback.html"
   *   const ui = document.querySelector("authorization-code-flow")
   *   const provider = new DPoPTokenProvider(callbackUri, ui, asProvider, clientProvider)
   * </script>
   * ```
   */
  async getCode(
    authorizationUri: URL,
    signal: AbortSignal,
  ): Promise<Disposable & { readonly value: string }> {
    const redirect = authorizationUri.searchParams.get("redirect_uri");
    if (redirect === null) throw new TypeError("Authorization request lacks redirect_uri");
    const callbackOrigin = new URL(redirect).origin;

    return await navigator.locks.request("AuthorizationCodeFlow.getCode", { signal }, async () => {
      signal.throwIfAborted();
      this.#authorizationUri = authorizationUri;
      const { promise, reject, resolve } = Promise.withResolvers<string>();
      const view = this.ownerDocument.defaultView;

      const cleanup = () => {
        view?.removeEventListener("message", onMessage);
        signal.removeEventListener("abort", onAbort);
        clearInterval(poll);
        this.#newModal.close();
        this.#switchModal.close();
        this.#cancelCodeRequest = undefined;
        // Close before releasing the lock so the named popup cannot be reused by the next flow.
        this.#authorizationWindow?.close();
      };
      const fail = (reason: unknown) => {
        cleanup();
        reject(reason);
      };
      const onMessage = (message: MessageEvent) => {
        if (message.source === null || message.source !== this.#authorizationWindow) return;
        if (message.origin !== callbackOrigin || !isCallback(message.data, callbackOrigin)) return;
        cleanup();
        resolve(message.data);
      };
      const onAbort = () => fail(signal.reason);
      const poll = setInterval(() => {
        if (this.#authorizationWindow?.closed === true)
          fail(new CodeRequestCancelledError(authorizationUri));
      }, this.closedPollMs);

      this.#cancelCodeRequest = fail;
      signal.addEventListener("abort", onAbort, onlyOnce);
      view?.addEventListener("message", onMessage);

      this.#openAuthorizationWindow();
      if (this.#authorizationWindow === null) {
        this.#interactionNeeded();
      }

      const value = await promise;
      // Cleanup is complete under the lock; later disposal must not affect another flow.
      return { value, [Symbol.dispose]() {} };
    });
  }

  /** Closes the popup, if open. */
  cleanup(): void {
    this.#authorizationWindow?.close();
  }

  #onSubmit(e: SubmitEvent) {
    e.preventDefault();

    switch ((e.submitter as HTMLButtonElement).value) {
      case "open":
        this.#openAuthorizationWindow();
        break;
      case "focus":
        this.#authorizationWindow?.focus();
        break;
      case "cancel":
        this.#cancelCodeRequest?.call(
          undefined,
          new CodeRequestCancelledError(this.#authorizationUri!),
        );
        break;
    }
  }

  #interactionNeeded() {
    this.#switchModal.close();
    this.#newModal.showModal();
  }

  #openAuthorizationWindow() {
    this.#authorizationWindow = open(this.#authorizationUri, authorizationWindowName);
    if (this.#authorizationWindow === null) return;
    this.#newModal.close();
    this.#switchModal.showModal();
  }
}

/** The callback reports its own URL: a bounded string on the expected origin. */
function isCallback(data: unknown, origin: string): data is string {
  if (typeof data !== "string" || data.length > 8192) return false;
  try {
    return new URL(data).origin === origin;
  } catch {
    return false;
  }
}
