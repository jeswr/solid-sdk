import { type TemplateResult } from "lit";
import { Store } from "n3";
import type { DataController } from "../data-controller.js";
import { AbstractReadElement } from "./shared.js";
/**
 * A read-only `book:Bookmark` list element.
 *
 * @solid-class https://w3id.org/jeswr/bookmark#Bookmark
 * @solid-mode view
 * @solid-cardinality container
 *
 * @csspart list     - The <ul> wrapping the bookmarks.
 * @csspart bookmark - One bookmark <li>.
 * @csspart title    - A bookmark's title (a link to its url).
 * @csspart tags     - A bookmark's tag list.
 * @csspart meta     - A bookmark's metadata (created / archived).
 * @csspart empty    - Placeholder when the graph holds no bookmarks.
 * @csspart error    - The error message when the read fails.
 * @csspart loading  - Placeholder shown while reading.
 */
export declare class JeswrBookmarkList extends AbstractReadElement {
    #private;
    protected loadFrom(controller: DataController, src: string, publicRead: boolean): Promise<{
        graph: Store;
        baseUrl: string;
    }>;
    protected renderReady(graph: Store): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-bookmark-list": JeswrBookmarkList;
    }
}
