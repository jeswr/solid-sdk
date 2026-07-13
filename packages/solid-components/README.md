<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-components

Codegen-friendly Lit components and controllers for reading, displaying, and conditionally updating Solid RDF data.

It provides typed viewers for tasks, contacts, profiles, bookmarks, messages, and containers, plus
SHACL view/form components and a static RDF-class resolver.

> Experimental and security-sensitive. Keep authenticated and public fetch seams separate, and use
> an explicit base scope for writes.

## Install

```sh
npm install github:jeswr/solid-components#main
```

Requires Node.js 22.19 or newer for tooling. Consumers may build React wrappers from the `./react`
class/controller re-exports with `react`, `react-dom`, and `@lit/react`. The optional
`@jeswr/guarded-fetch` peer is required for untrusted remote graph sources and scoped
`DataWriter` writes.

## Minimal usage

```ts
import "@jeswr/solid-components";

const view = document.createElement("solid-view");
view.src = "https://alice.example/contacts/";
view.fetch = authenticatedFetch;
view.publicFetch = pristineFetch;
document.body.append(view);
```

`solid-view` reads `rdf:type`, chooses a registered viewer, and forwards the fetch seam. Set
`classIri` when the class is already known and the initial type probe should be skipped.

## Key API

- Reads: `DataController`, conditional `read`, `listContainer`, and four typed error classes.
- Writes: `DataWriter`, merge-preserving conditional saves, and write-scope/conflict errors.
- Views: `solid-view`, `jeswr-shacl-view`, task/contact/profile/bookmark/message/container elements.
- Forms: `jeswr-shacl-form`, `jeswr-task-form`, `jeswr-contact-form`, `jeswr-bookmark-form`.
- Resolution: `resolveComponent`, `resolveComponentForClass`, `RESOLVER_ENTRIES`.
- Code generation: committed `custom-elements.json` and `./react` class/controller re-exports for
  building wrappers.

## Links

- [Source](https://github.com/jeswr/solid-components)
- [Issues](https://github.com/jeswr/solid-components/issues)
- [Custom Elements Manifest](./custom-elements.json)
- [SHACL](https://www.w3.org/TR/shacl/)

## License

[MIT](./LICENSE) © Jesse Wright
