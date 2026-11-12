<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/suite-templates

Reusable templates for Docs, Sheets, Notes and Tasks. Built-ins are neutral Markdown,
plain grids and task titles. Consumers convert these through their own app models.

`templates.ttl`, `templates.shacl.ttl` and `codegen.config.json` generate the metadata
model in `src/generated/`. No federation sector currently describes app templates.
The profile uses `https://jeswr.org/ns/templates#Template`, a subclass of
`schema:CreativeWork` (also an extra type on metadata); `schema:about` is narrowed to four app slugs,
`schema:genre` stores category, `schema:text`/`schema:image` preview, `schema:url` content,
and Dublin Core stores author and timestamps. Regenerate with `pnpm run codegen`;
the drift test compares every artifact byte for byte.

`createTemplateStore({ storage, profile, fetch, ensurePrivateAccess, onEntryError? })` lists, reads, saves and deletes
metadata in the dedicated-class collection, conventionally `<storage>/templates/`. Each save creates an independent content snapshot
through the caller's `(resourceUrl, { copyImages }) => { body, contentType, previewText? }` builder, then publishes
metadata. All writes use observed strong ETags. Pass a profile to register the container
in the private Type Index. Discovery and permissions errors propagate; only 404 is empty.
Deletion conditionally removes metadata, its in-collection content snapshot and its copied
images (siblings named `<id>.asset.*`; LWS keeps those names in resource metadata). Only
`*.template.ttl` metadata (including LWS display names) counts toward the 1,000-record
limit. Invalid entries are skipped and reported to `onEntryError` (default: console.warn).
Discovery is cached per account store; LWS collection names alone are never adopted.
A new collection is registered before access is verified, because Solid servers drop the
creation type link and the index is then the only way back to it.
`ensurePrivateAccess` must establish or verify owner-only access before any content write;
the suite uses pod-access's shared private-container helper. `copyImages` copies in-pod
images to collection siblings, deduplicating and relocating editor JSON URL attributes.
`copyTemplateImages` also supports instantiation through a caller's image uploader;
`relocateAttributes` is shared with Docs copy/import. `templatePreview` bounds plain text
previews to 160 characters. `container` and `assertContains` expose the located collection
and logical-parent scope validation for nested template data. Failed
saves may leave an unpublished content resource; they never publish incomplete metadata.
