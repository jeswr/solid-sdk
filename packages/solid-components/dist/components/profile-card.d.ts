import { type TemplateResult } from "lit";
import { Store } from "n3";
import type { DataController } from "../data-controller.js";
import { AbstractReadElement } from "./shared.js";
/**
 * A read-only WebID profile card.
 *
 * (No `@solid-class`: a WebID profile has no single canonical `rdf:type` — it is
 * identified by being a `solid:oidcIssuer`-bearing / `foaf:Person` subject — so this
 * element is bound by IRI, not auto-resolved by `<solid-view>` on rdf:type. It is the
 * composition target a contact's WebID link or an explicit `src` points at.)
 *
 * @solid-mode view
 * @solid-cardinality one
 *
 * @csspart card    - The profile card wrapper.
 * @csspart photo   - The avatar image.
 * @csspart name    - The display name.
 * @csspart org     - The organisation / role line.
 * @csspart website - The homepage link.
 * @csspart webid   - The WebID link.
 * @csspart empty   - Placeholder when the profile holds no renderable fields.
 * @csspart error   - The error message when the read fails.
 * @csspart loading - Placeholder shown while reading.
 */
export declare class JeswrProfileCard extends AbstractReadElement {
    protected loadFrom(controller: DataController, src: string, publicRead: boolean): Promise<{
        graph: Store;
        baseUrl: string;
    }>;
    protected renderReady(graph: Store, baseUrl: string): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-profile-card": JeswrProfileCard;
    }
}
