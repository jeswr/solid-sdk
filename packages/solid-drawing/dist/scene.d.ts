/**
 * Typed build / serialise / parse helpers for a `draw:Scene` descriptor.
 *
 * A scene descriptor is the small RDF document that DESCRIBES a drawing without
 * touching the canvas: it carries the title/timestamps/version/background and,
 * crucially, points at the byte-exact `.excalidraw` JSON resource via
 * `draw:sceneDocument`. The canvas JSON is an OPAQUE blob stored as its own
 * resource — this package never parses or shreds it into triples.
 *
 * **RDF discipline (the suite house rule).** Quads are built through the rdf-js
 * `DataFactory` and an `n3.Store`, serialised with `n3.Writer`, and parsed back
 * with `@jeswr/fetch-rdf`'s `parseRdf` (the suite's vetted parser). NOTHING here
 * hand-concatenates triple strings, and there is no bespoke RDF parser. This
 * mirrors how `@jeswr/solid-task-model` (`Task` in `src/task.ts`) and
 * `solid-issues` build their RDF.
 */
import type { DatasetCore, NamedNode } from "@rdfjs/types";
import { type Quad, Store } from "n3";
/**
 * The plain-data shape of a drawing scene descriptor. Only `sceneDocument` is
 * required (a scene is meaningless without the canvas it points at); every other
 * field is optional metadata.
 */
export interface SceneData {
    /**
     * The IRI of the byte-exact `.excalidraw` JSON resource (the opaque canvas
     * blob). Required — REQUIRED `draw:sceneDocument`.
     */
    sceneDocument: string;
    /** Human-readable title — `dct:title`. */
    title?: string;
    /** Creation time — `dct:created` (serialised as `xsd:dateTime`). */
    created?: string;
    /** Last-modified time — `dct:modified` (serialised as `xsd:dateTime`). */
    modified?: string;
    /** Excalidraw scene-format version — `draw:schemaVersion` (a plain literal). */
    schemaVersion?: string;
    /** Canvas background colour — `draw:viewBackgroundColor` (a plain literal). */
    viewBackgroundColor?: string;
    /** IRI of a thumbnail image resource — `draw:thumbnail`. */
    thumbnail?: string;
    /** IRI of the real-world subject the drawing depicts — `schema:about`. */
    about?: string;
    /** IRI of the activity/agent that produced the scene — `prov:wasGeneratedBy`. */
    wasGeneratedBy?: string;
}
/**
 * The canonical subject IRI for a scene stored at `resourceUrl`. Conventionally
 * the descriptor lives in the same document and is named with the `#it` fragment,
 * matching how the suite models name their primary subject.
 */
export declare function sceneSubject(resourceUrl: string): NamedNode;
/**
 * Build a fresh `n3.Store` holding one `draw:Scene` rooted at
 * `${resourceUrl}#it`. The store is the value the `n3.Writer` serialises; pass
 * it to {@link storeToTurtle} (or {@link serializeScene} does both).
 *
 * **IRI safety.** Every IRI field is caller-supplied and potentially hostile, and
 * `n3.Writer` does NOT escape IRIs (see {@link safeHttpIri}), so each is routed
 * through `safeHttpIri` before `namedNode()` — otherwise a `>` or space in the value
 * would break out of the serialised `<…>` and inject arbitrary triples. Optional IRI
 * fields whose value is not a valid http(s) IRI are DROPPED (the triple is omitted);
 * the REQUIRED `sceneDocument` cannot be dropped, so an invalid/hostile value makes
 * `buildScene` throw a `TypeError` rather than emit an unsafe/attacker-chosen link.
 *
 * @throws {TypeError} when `data.sceneDocument` is not a parseable http(s) IRI — a
 *   deliberate departure from a total contract: a scene with no valid canvas link is
 *   invalid input, and writing the raw value would be a triple-injection sink.
 */
export declare function buildScene(resourceUrl: string, data: SceneData): Store;
/** Serialise any `n3.Store` to Turtle with the model's prefixes (via `n3.Writer`). */
export declare function storeToTurtle(store: Store): Promise<string>;
/**
 * Serialise a scene to Turtle (via `n3.Writer`, with the model's prefixes).
 *
 * `async` so that a synchronous failure in {@link buildScene} (an invalid required
 * `sceneDocument`) surfaces as a REJECTED promise, not a synchronous throw — a
 * `Promise`-returning function should never throw before it returns.
 */
export declare function serializeScene(resourceUrl: string, data: SceneData): Promise<string>;
/**
 * Read a `draw:Scene` descriptor out of an already-parsed RDF dataset.
 *
 * Returns `undefined` when the `${resourceUrl}#it` subject is not a `draw:Scene`
 * OR does not carry EXACTLY ONE `draw:sceneDocument` IRI — a scene with no canvas
 * link, a non-IRI link, or TWO links is not a valid scene (the SHACL shape
 * enforces the same `minCount 1, maxCount 1`), so it is reported as absent rather
 * than parsed into a record that points at an ambiguous / attacker-chosen canvas.
 *
 * Every OPTIONAL field is read through the same exact-one + nodeKind/datatype
 * checks the bundled SHACL shape declares (each property is `maxCount 1`;
 * `dct:created`/`dct:modified` are `xsd:dateTime`; thumbnail/about/provenance are
 * IRIs). A field whose value would FAIL the shape — duplicated, wrong nodeKind, or
 * (for the timestamps) the wrong datatype — is DROPPED, so the returned `SceneData`
 * is always a graph the shape would accept rather than a half-trusted record built
 * from one the shape rejects.
 */
export declare function parseScene(resourceUrl: string, dataset: DatasetCore): SceneData | undefined;
/**
 * Parse a Turtle / JSON-LD body into a scene descriptor, dispatching on
 * `contentType` via `@jeswr/fetch-rdf`'s `parseRdf` (the suite's vetted RDF
 * parser — never a bespoke one). Returns `undefined` if the document holds no
 * valid `draw:Scene` at `${url}#it`.
 *
 * @param url         - the resource URL (base IRI for relative refs + to locate
 *   the `#it` subject).
 * @param body        - the raw response body.
 * @param contentType - the `Content-Type` header value (null ⇒ text/turtle, per
 *   the Solid Protocol §5.2 default).
 */
export declare function parseSceneTtl(url: string, body: string, contentType?: string | null): Promise<SceneData | undefined>;
export type { Quad };
//# sourceMappingURL=scene.d.ts.map