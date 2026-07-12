import type { Quad } from "@rdfjs/types";
import type { AppRegistration } from "./types.js";
/** The output of {@link selfDescribe}. */
export interface SelfDescription {
    /** The constructed quads (an `fedapp:App` graph). */
    readonly quads: readonly Quad[];
    /** Serialise to Turtle (default) or another n3 format. */
    toString(format?: string): Promise<string>;
}
/**
 * Build an app's `fedapp:App` self-description from a plain {@link AppRegistration}.
 *
 * Flat-form sectors/access/consumes/produces are attached directly to the App;
 * each `sectorUse` block becomes a typed `fedapp:SectorUse` blank node linked via
 * `fedapp:sectorUse`. `declaresShape` shapes are attached to the App.
 *
 * @param app - the registration to describe (`app.id` is the client_id IRI).
 * @returns a {@link SelfDescription} carrying the quads + a Turtle serialiser.
 */
export declare function selfDescribe(app: AppRegistration): SelfDescription;
//# sourceMappingURL=selfDescribe.d.ts.map