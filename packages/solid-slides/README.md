<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
# @jeswr/solid-slides

Generated presentation and slide entities, Markdown interchange, immutable slide operations and atomic pod storage for Slides.

`codegen/slides.ontology.ttl`, `slides.shapes.ttl` and `codegen.config.json` generate every RDF accessor, guard and model declaration in `src/generated/`. `src/model.ts` is the thin document facade: it assembles generated Presentation and Slide entities in one document and validates hash-node membership. Parsing uses fetch-rdf; serialising uses rdf-serialize/N3 Writer. No runtime/generator modifications.

The presentation class is `http://schema.org/PresentationDigitalDocument`. Its name, description and parts use schema:name, schema:description and schema:hasPart; dates use dct:created/modified. Slides use `https://jeswr.org/ns/slides#Slide`, schema:position/name/text/image and suite layout/secondBody/imageAlt/speakerNotes/hidden/drawing. Presentation theme and aspectRatio are suite properties. The drawing value is an opaque IRI, without rendering or a class assertion on the linked document.

No federation presentation sector exists in this checkout. This is a new narrow profile: themes light/dark/contrast/warm, ratios 16:9/4:3 and six slide layouts. The generator can project exactly one child per composite link, so a repeated `hasPart` set uses generated flat entities and a document facade. Slides are hash IRIs; a whole deck saves with one If-Match. Positions determine order; slide operations renumber without mutating their inputs.

`deckFromMarkdown` splits lines exactly `---`, takes the first `# ` heading as title, and recognises `???` or `Note:` speaker notes. `deckToMarkdown` emits readable Markdown plus URI-encoded JSON comments for deck and layout metadata, escaping literal convention lines. Importing exported files revives dates and validates through the generated model. Standard Markdown has no front matter. Export requires at least one slide. Markdown preview uses marked and a strict sanitize-html allowlist; external images belong in the dedicated image field.

`createDeckRepository(storage, { profile })` uses the public storage client, registers `slides/` in the private Type Index and supports injected TypeIndex fixtures. A saved deck carries its URL and strong ETag. Conflicts throw `DeckConflictError` with both versions. PNG/JPEG/WebP/GIF uploads are capped at 10 MB. Collection and upload identifiers always come from storage responses. Empty placeholders from interrupted two-step creates are skipped by the library; malformed non-empty presentations report an error. `openSolidDeckRepository` is an explicit factory for the Suite's already authenticated Solid sessions, including its demo transport, which does not advertise a storage-description link.

The package deliberately does not supply PPTX interchange, collaboration, transitions, drawing rendering or comments. Suite UI graduation remains a separate change.
