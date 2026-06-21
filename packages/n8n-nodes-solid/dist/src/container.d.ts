/** A single member of a container. */
export interface ContainerMember {
    /** Absolute URL of the member. */
    readonly url: string;
    /** True iff the member is itself a container (trailing slash). */
    readonly container: boolean;
}
/**
 * Parse the direct `ldp:contains` members of a container document.
 *
 * @param body - the raw container document text (as fetched by the node).
 * @param contentType - the response `Content-Type` header (may be `null`;
 *   `parseRdf` defaults a null content-type to `text/turtle`).
 * @param containerUrl - the absolute container URL; used as the parse `baseIRI`
 *   so relative `ldp:contains` IRIs resolve to absolute member URLs, and as the
 *   scope-guard base so a hostile/buggy server cannot inject a foreign member.
 * @param base - the configured pod base; members are validated to lie under it.
 * @returns the direct members (the container itself and out-of-pod members are
 *   excluded). A valid but empty document yields `[]`.
 */
export declare function parseContainerListing(body: string, contentType: string | null, containerUrl: string, base: string): Promise<ContainerMember[]>;
//# sourceMappingURL=container.d.ts.map