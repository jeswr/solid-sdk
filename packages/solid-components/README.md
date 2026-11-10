<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-components

Codegen-friendly Lit components and controllers for reading, displaying, and conditionally updating Solid RDF data.

It provides typed viewers for tasks, contacts, profiles, bookmarks, messages, and containers, plus
SHACL view/form components and a static RDF-class resolver.

Bookmark views, forms, and class resolution accept both `https://jeswr.org/ns/bookmark#Bookmark`
and the legacy `https://w3id.org/jeswr/bookmark#Bookmark`, including mixed data. Forms display
canonical values first and save the canonical class, `notes`, and `archived` predicates,
clearing legacy aliases on the edited bookmark while preserving unrelated data.

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

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## Request access after a denied read

Both the core and `./react` entries export `canRequestAccess`,
`requestAccessAfterDenial`, and `RequestAccessUnavailableError`. An app can render
its own button after catching a `DataController` read error:

```ts
import {
  AccessDeniedError,
  canRequestAccess,
  requestAccessAfterDenial,
} from "@jeswr/solid-components";

function showReadError(error: unknown, container: HTMLElement) {
  if (!(error instanceof AccessDeniedError) || !canRequestAccess()) return;
  const button = document.createElement("button");
  button.textContent = "Request access";
  const message = document.createElement("p");
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const { granted } = await requestAccessAfterDenial(error, {
        classes: ["https://schema.org/Person"],
        modes: ["read"],
        purpose: "Display contacts",
        duration: "P30D",
      });
      message.textContent = granted ? "Access granted; you may retry the read." : "Access denied.";
    } catch {
      message.textContent = "Could not request access.";
    } finally {
      button.disabled = false;
    }
  });
  container.append(button, message);
}
```

The helper requires non-empty arrays of absolute HTTP(S) class IRIs and supported
modes, rejecting invalid entries before calling the extension. Supported modes
are `read`, `append`, `write` (case-insensitive, surrounding whitespace allowed),
or their exact `http://www.w3.org/ns/auth/acl#Read`, `#Append`, `#Write` IRIs.
Use short modes with the current extension: its parser does not yet accept the
full IRIs. `Control` and compact `acl:Read` forms are unsupported.

The request object, including optional purpose/duration, is forwarded unchanged.
The extension validates expiry; supply an ISO-8601 duration such as `P30D` for its
current bounded-grant policy. `{ ok, granted }` contains booleans: `granted` is
true only for `ok: true` with non-empty grants, including partial approvals. This
does not prove the original resource is readable. The caller controls any retry;
the helper never reads data or calls login. Extension rejections propagate, and
a missing callable capability rejects with `RequestAccessUnavailableError`.

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
