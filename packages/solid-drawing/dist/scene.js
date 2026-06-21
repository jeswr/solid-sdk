// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
import { DataFactory, Store, Writer } from "n3";
import { DCT_CREATED, DCT_MODIFIED, DCT_TITLE, DRAW_SCENE, DRAW_SCENE_DOCUMENT, DRAW_SCHEMA_VERSION, DRAW_THUMBNAIL, DRAW_VIEW_BACKGROUND_COLOR, PREFIXES, PROV_WAS_GENERATED_BY, RDF_TYPE, SCHEMA_ABOUT, XSD_DATE_TIME, XSD_STRING, } from "./vocab.js";
const { namedNode, literal, quad } = DataFactory;
/**
 * The canonical subject IRI for a scene stored at `resourceUrl`. Conventionally
 * the descriptor lives in the same document and is named with the `#it` fragment,
 * matching how the suite models name their primary subject.
 */
export function sceneSubject(resourceUrl) {
    return namedNode(`${resourceUrl}#it`);
}
/** An `xsd:dateTime` literal for a timestamp string. */
function dateTime(value) {
    return literal(value, XSD_DATE_TIME);
}
/**
 * Build a fresh `n3.Store` holding one `draw:Scene` rooted at
 * `${resourceUrl}#it`. The store is the value the `n3.Writer` serialises; pass
 * it to {@link storeToTurtle} (or {@link serializeScene} does both).
 */
export function buildScene(resourceUrl, data) {
    const subject = sceneSubject(resourceUrl);
    const store = new Store();
    store.addQuad(quad(subject, RDF_TYPE, DRAW_SCENE));
    // Required: the link to the byte-exact .excalidraw JSON blob.
    store.addQuad(quad(subject, DRAW_SCENE_DOCUMENT, namedNode(data.sceneDocument)));
    if (data.title !== undefined) {
        store.addQuad(quad(subject, DCT_TITLE, literal(data.title)));
    }
    if (data.created !== undefined) {
        store.addQuad(quad(subject, DCT_CREATED, dateTime(data.created)));
    }
    if (data.modified !== undefined) {
        store.addQuad(quad(subject, DCT_MODIFIED, dateTime(data.modified)));
    }
    if (data.schemaVersion !== undefined) {
        store.addQuad(quad(subject, DRAW_SCHEMA_VERSION, literal(data.schemaVersion)));
    }
    if (data.viewBackgroundColor !== undefined) {
        store.addQuad(quad(subject, DRAW_VIEW_BACKGROUND_COLOR, literal(data.viewBackgroundColor)));
    }
    if (data.thumbnail !== undefined) {
        store.addQuad(quad(subject, DRAW_THUMBNAIL, namedNode(data.thumbnail)));
    }
    if (data.about !== undefined) {
        store.addQuad(quad(subject, SCHEMA_ABOUT, namedNode(data.about)));
    }
    if (data.wasGeneratedBy !== undefined) {
        store.addQuad(quad(subject, PROV_WAS_GENERATED_BY, namedNode(data.wasGeneratedBy)));
    }
    return store;
}
/** Serialise any `n3.Store` to Turtle with the model's prefixes (via `n3.Writer`). */
export function storeToTurtle(store) {
    const writer = new Writer({ prefixes: { ...PREFIXES } });
    writer.addQuads([...store]);
    return new Promise((resolve, reject) => {
        writer.end((error, result) => (error ? reject(error) : resolve(result)));
    });
}
/** Serialise a scene to Turtle (via `n3.Writer`, with the model's prefixes). */
export function serializeScene(resourceUrl, data) {
    return storeToTurtle(buildScene(resourceUrl, data));
}
/**
 * The SINGLE object of `(subject, predicate, ?)` when there is EXACTLY ONE — else
 * `undefined`. Every property in the SHACL shape is `maxCount 1`, so a predicate
 * that appears zero or two-plus times is malformed; the parser returns `undefined`
 * for it (the field is dropped) rather than silently picking the first of several.
 * This keeps the parsed `SceneData` a graph that would PASS the bundled shape —
 * never a half-trusted record built from a graph the shape rejects.
 */
function exactlyOne(dataset, subject, predicate) {
    const matches = dataset.match(subject, predicate, null, null);
    if (matches.size !== 1)
        return undefined;
    for (const q of matches)
        return q.object;
    return undefined;
}
/** The exactly-one IRI value of `(subject, predicate, ?)` (a NamedNode), else undefined. */
function exactlyOneIri(dataset, subject, predicate) {
    const obj = exactlyOne(dataset, subject, predicate);
    return obj?.termType === "NamedNode" ? obj.value : undefined;
}
/**
 * The exactly-one literal lexical value of `(subject, predicate, ?)`, else
 * undefined. When `datatype` is given the literal's datatype IRI must match it
 * (the shape's `sh:datatype` rule) — e.g. a `dct:created "yesterday"` (a plain
 * `xsd:string`, not `xsd:dateTime`) is rejected, mirroring the SHACL rejection.
 */
function exactlyOneLiteral(dataset, subject, predicate, datatype) {
    const obj = exactlyOne(dataset, subject, predicate);
    if (obj?.termType !== "Literal")
        return undefined;
    if (datatype !== undefined && obj.datatype.value !== datatype.value)
        return undefined;
    return obj.value;
}
function setIfDefined(data, key, value) {
    if (value !== undefined)
        data[key] = value;
}
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
export function parseScene(resourceUrl, dataset) {
    const subject = sceneSubject(resourceUrl);
    const isScene = dataset.match(subject, RDF_TYPE, DRAW_SCENE, null).size > 0;
    if (!isScene)
        return undefined;
    const sceneDocument = exactlyOneIri(dataset, subject, DRAW_SCENE_DOCUMENT);
    if (sceneDocument === undefined)
        return undefined;
    const data = { sceneDocument };
    setIfDefined(data, "title", exactlyOneLiteral(dataset, subject, DCT_TITLE, XSD_STRING));
    setIfDefined(data, "created", exactlyOneLiteral(dataset, subject, DCT_CREATED, XSD_DATE_TIME));
    setIfDefined(data, "modified", exactlyOneLiteral(dataset, subject, DCT_MODIFIED, XSD_DATE_TIME));
    setIfDefined(data, "schemaVersion", exactlyOneLiteral(dataset, subject, DRAW_SCHEMA_VERSION));
    setIfDefined(data, "viewBackgroundColor", exactlyOneLiteral(dataset, subject, DRAW_VIEW_BACKGROUND_COLOR));
    setIfDefined(data, "thumbnail", exactlyOneIri(dataset, subject, DRAW_THUMBNAIL));
    setIfDefined(data, "about", exactlyOneIri(dataset, subject, SCHEMA_ABOUT));
    setIfDefined(data, "wasGeneratedBy", exactlyOneIri(dataset, subject, PROV_WAS_GENERATED_BY));
    return data;
}
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
export async function parseSceneTtl(url, body, contentType = "text/turtle") {
    // Coalesce BEFORE parsing: callers routinely pass `Response.headers.get(
    // "content-type")`, which is `null` for a header-less response, so honour the
    // documented "⇒ text/turtle" default here rather than leaning on parseRdf.
    const resolvedContentType = contentType ?? "text/turtle";
    // Lazy import keeps the (Node-targeted) fetch-rdf dep off any pure-parse path a
    // consumer might tree-shake, matching how the suite apps import it.
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const dataset = (await parseRdf(body, resolvedContentType, { baseIRI: url }));
    return parseScene(url, dataset);
}
//# sourceMappingURL=scene.js.map