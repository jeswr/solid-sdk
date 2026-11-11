<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
# @jeswr/solid-slides

Generated presentation and slide entities, Markdown interchange, immutable slide operations and atomic pod storage for Slides.

`codegen/slides.ontology.ttl`, `slides.shapes.ttl` and `codegen.config.json` generate every RDF accessor, guard and model declaration in `src/generated/`. `src/model.ts` is the thin document facade: it assembles generated Presentation and Slide entities in one document and validates hash-node membership. Parsing uses fetch-rdf; serialising uses rdf-serialize/N3 Writer. No runtime/generator modifications.

The presentation class is `http://schema.org/PresentationDigitalDocument`. Its name, description and parts use schema:name, schema:description and schema:hasPart; dates use dct:created/modified. Slides use `https://jeswr.org/ns/slides#Slide`, schema:position/name/text/image and suite layout/secondBody/imageAlt/speakerNotes/hidden/drawing. Presentation theme and aspectRatio are suite properties. The drawing value is an opaque IRI, without rendering or a class assertion on the linked document.

No federation presentation sector exists in this checkout. This is a new narrow profile: themes light/dark/contrast/warm, ratios 16:9/4:3 and six slide layouts. The generator can project exactly one child per composite link, so a repeated `hasPart` set uses generated flat entities and a document facade. Slides are hash IRIs; a whole deck saves with one If-Match. Positions determine order; slide operations renumber without mutating their inputs.

`deckFromMarkdown` splits lines exactly `---`, takes the first `# ` heading as title, and recognises `???` or `Note:` speaker notes. `deckToMarkdown` emits readable Markdown plus URI-encoded JSON comments for deck and layout metadata, escaping literal convention lines. Importing exported files revives dates and validates through the generated model. Standard Markdown has no front matter. Export requires at least one slide. Markdown preview uses marked and a strict sanitize-html allowlist; external images belong in the dedicated image field.

`createDeckRepository(storage, { profile })` uses the public storage client, registers `slides/` in the private Type Index and supports injected TypeIndex fixtures. `openDeckRepository({ fetch, storageUrl, profile })` opens it through `createPodClient` discovery, so Solid and LWS pods each get their own backend; `assumeSolidWhenUndescribed` opens a storage that advertises no description at all as plain Solid, and is meant only for transports known to be Solid (the Suite's demo pod).

`list()` returns `{ decks, broken }`: an unreadable (403, network) or invalid (broken Turtle, not a presentation, over `DECK_BYTE_LIMIT`, 4 MB, enforced while streaming) file is reported in `broken` and never hides the others. Reads run four at a time. Empty placeholders from interrupted two-step creates are skipped and, once ten minutes old, deleted with If-Match. Uploaded images (`<uuid>-<name>` in `slides/`) older than a day that no presentation references are deleted, but only when every presentation could be read; `removeUploads(urls)` deletes this collection's uploads on demand, best effort.

Weak or missing ETags are accepted for reading. Writes and deletes need a strong version: a weak tag is upgraded only when a HEAD returns the strong tag with the same opaque value; otherwise they throw `DeckVersionError` (RFC 9110 If-Match never matches a weak tag). A write whose response carries no strong ETag of its own is confirmed by re-reading. Conflicts throw `DeckConflictError` with both versions. A deck moved or copied to another URL keeps the absolute IRIs it was written with; when a document has exactly one presentation and none at its own URL, it is read at its original location and the next save rewrites it under the new URL. `ensure(deck, name)` keeps, creates or repairs an app-owned sample file (empty or invalid content is replaced) and is only for demo seeding. PNG/JPEG/WebP/GIF uploads are capped at 10 MB. Collection and upload identifiers always come from storage responses.

Saved and exported decks normalise CRLF and CR to LF. A multi-line slide title is exported as one heading line and travels exactly in the slide metadata comment.

The package deliberately does not supply PPTX interchange, collaboration, transitions, drawing rendering or comments. Suite UI graduation remains a separate change.
