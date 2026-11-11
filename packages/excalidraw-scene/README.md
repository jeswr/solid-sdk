<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
# @jeswr/excalidraw-scene

Pure TypeScript Excalidraw v2 document validation, immutable editing, geometry and portable SVG
export. No runtime dependencies, RDF, React or DOM access. The stream parser uses standard Web Streams.

`parseScene(json)` and `serializeScene(scene)` preserve unknown properties, files and future element
types. An unedited parsed scene serialises to its original bytes, including whitespace; edits preserve
unknown values but use JSON.stringify formatting. Unknown element types and image references are retained
but never rendered. Nothing dereferences embedded files or URLs. This is a focused renderer, not a
pixel-identical renderer for roughness, hachure fills, bound text or Excalidraw's hand-drawn fonts.

Imports are limited to 8 MiB UTF-8, 5,000 elements, nesting depth 32, 250,000 JSON values and 20,000
points per path. Coordinates must be finite and within ±10,000,000. Known element geometry, styles,
revisions, flags and point arrays are validated. Unknown element bodies remain opaque JSON.

Constructors: `rectangle`, `ellipse`, `diamond`, `line`, `arrow`, `freedraw`, `text`, `imageReference`
and `createElement`. Edits: `addElement`, `updateElements`, `deleteElements`, `moveElements`,
`resizeElement`, `reorderElements`, `groupElements`, `duplicateElements`. Deletion sets `isDeleted`;
edits advance `version`, replace `versionNonce` and stamp `updated`. A `Revision` can inject the
clock and nonce. Array order is drawing order; reorders clear stale fractional indices.
Duplication remaps selected groups, bindings and bound text references, dropping external bindings.

`elementBounds`, `sceneBounds`, `elementsInBox`, `hitTest`, `hitElement` and `rotatePoint` share
geometry between the editor and reusable `sceneToSvg`. `sceneToSvgContent` supplies safe fragments
for an existing SVG viewport. All text and attribute values are escaped, paint colours are checked,
and exports contain no files, external links, scripts, foreignObject or user-provided SVG markup.
