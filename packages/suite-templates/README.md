<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/suite-templates

Reusable templates for Docs, Sheets, Notes and Tasks. Built-ins are neutral Markdown,
plain grids and task titles. Consumers convert these through their own app models.

`templates.ttl`, `templates.shacl.ttl` and `codegen.config.json` generate the metadata
model in `src/generated/`. No federation sector currently describes app templates.
The profile reuses `schema:CreativeWork`; `schema:about` is narrowed to four app slugs,
`schema:genre` stores category, `schema:text`/`schema:image` preview, `schema:url` content,
and Dublin Core stores author and timestamps. Regenerate with `pnpm run codegen`;
the drift test compares every artifact byte for byte.

`createTemplateStore({ storage, profile, fetch })` lists, reads, saves and deletes
metadata under `<storage>/templates/`. Each save creates an independent content snapshot
through the caller's `(resourceUrl) => { body, contentType }` builder, then publishes
metadata. All writes use observed strong ETags. Pass a profile to register the container
in the private Type Index. Discovery and permissions errors propagate; only 404 is empty.
Deletion removes metadata, retaining content which other records may reference. Failed
saves may leave an unpublished content resource; they never publish incomplete metadata.
