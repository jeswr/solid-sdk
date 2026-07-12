import { type TemplateResult } from "lit";
import { Store } from "n3";
import type { DataController } from "../data-controller.js";
import { AbstractReadElement } from "./shared.js";
/**
 * A read-only `as:Note` chat-message list element.
 *
 * (No `@solid-shape`: the chat-interop SHACL shape is an anonymous `sh:NodeShape`
 * with `sh:targetClass as:Note`, so there is no canonical shape IRI to advertise.
 * The `@solid-class` target class is the binding key the resolver maps on.)
 *
 * @solid-class https://www.w3.org/ns/activitystreams#Note
 * @solid-mode view
 * @solid-cardinality container
 *
 * @csspart list     - The <ul> wrapping the messages.
 * @csspart message  - One message <li>.
 * @csspart content  - A message's body text (escaped — never markup).
 * @csspart author   - A message's author (a WebID link when http(s), else text).
 * @csspart time     - A message's published timestamp.
 * @csspart reply    - A message's "in reply to" indicator.
 * @csspart empty    - Placeholder when the graph holds no messages.
 * @csspart error    - The error message when the read fails.
 * @csspart loading  - Placeholder shown while reading.
 */
export declare class JeswrMessageList extends AbstractReadElement {
    #private;
    protected loadFrom(controller: DataController, src: string, publicRead: boolean): Promise<{
        graph: Store;
        baseUrl: string;
    }>;
    protected renderReady(graph: Store): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-message-list": JeswrMessageList;
    }
}
