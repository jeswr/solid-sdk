/** A single member of a container. */
export interface ContainerMember {
    /** Absolute URL of the member. */
    readonly url: string;
    /** True iff the member is itself a container (trailing slash). */
    readonly container: boolean;
}
/**
 * List the direct `ldp:contains` members of the container at `containerUrl`.
 *
 * @param containerUrl - absolute container URL (trailing slash).
 * @param base - the driver base (members are validated to lie under it).
 * @param fetchImpl - the (possibly authenticated) fetch to use.
 * @returns the direct members; `null` if the container does not exist (404),
 *   which the caller treats as an empty listing.
 */
export declare function listContainer(containerUrl: string, base: string, fetchImpl: typeof globalThis.fetch): Promise<ContainerMember[] | null>;
//# sourceMappingURL=container.d.ts.map