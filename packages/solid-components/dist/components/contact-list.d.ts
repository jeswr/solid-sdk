import { type TemplateResult } from "lit";
import { Store } from "n3";
import type { DataController } from "../data-controller.js";
import { AbstractReadElement } from "./shared.js";
/**
 * A read-only `vcard:Individual` contact-list element.
 *
 * @solid-class http://www.w3.org/2006/vcard/ns#Individual
 * @solid-mode view
 * @solid-cardinality container
 *
 * @csspart list    - The <ul> wrapping the contacts.
 * @csspart contact - One contact <li>.
 * @csspart name    - A contact's display name.
 * @csspart emails  - A contact's email list.
 * @csspart phones  - A contact's phone list.
 * @csspart webid   - A contact's WebID link.
 * @csspart empty   - Placeholder when the graph holds no contacts.
 * @csspart error   - The error message when the read fails.
 * @csspart loading - Placeholder shown while reading.
 */
export declare class JeswrContactList extends AbstractReadElement {
    #private;
    protected loadFrom(controller: DataController, src: string, publicRead: boolean): Promise<{
        graph: Store;
        baseUrl: string;
    }>;
    protected renderReady(graph: Store): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-contact-list": JeswrContactList;
    }
}
