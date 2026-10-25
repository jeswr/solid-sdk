/**
 * Registers the Web Components (custom HTML elements) of this library.
 *
 * @example Importing as a module specifier
 * ```js
 * import "@solid/reactive-authentication/registerElements"
 * ```
 *
 * @example Importing from a CDN
 * ```html
 * <script type="module" src="https://unpkg.com/@solid/reactive-authentication/dist/registerElements.js"></script>
 * <authorization-code-flow></authorization-code-flow>
 * <idp-picker></idp-picker>
 * <webid-picker></webid-picker>
 * ```
 *
 * @module
 */

import { AuthorizationCodeFlow, IdpPicker, WebIdPicker } from "./elements.js"

customElements.define("authorization-code-flow", AuthorizationCodeFlow)
customElements.define("idp-picker", IdpPicker)
customElements.define("webid-picker", WebIdPicker)
