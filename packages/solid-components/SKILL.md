---
name: solid-components
description: Use when offering extension request-access consent after a solid-components DataController AccessDeniedError.
---

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Request access after denial

Use `canRequestAccess()` to detect a callable `globalThis.solid.requestAccess`.
Both the core and `./react` entries export the helpers, request/result types, and
`RequestAccessUnavailableError`. Gate the app's own button on both the error
class and capability:

```ts
import { AccessDeniedError, canRequestAccess } from "@jeswr/solid-components";

function renderAccessAction(error: unknown, container: HTMLElement, onRequest: () => void) {
  if (error instanceof AccessDeniedError && canRequestAccess()) {
    const button = document.createElement("button");
    button.textContent = "Request access";
    button.addEventListener("click", onRequest);
    container.append(button);
  }
}
```

In that user-gesture handler call `requestAccessAfterDenial(error, request)`;
the [README example](./README.md#request-access-after-a-denied-read) includes
result/error handling. Pass non-empty class/mode arrays; every class must be an
absolute HTTP(S) IRI. Use `read`, `append`, or `write` for compatibility with the
current extension (case-insensitive, trimmed). The helper also accepts the exact
full ACL Read/Append/Write IRIs required by its contract, but the current
extension parser rejects them. Do not guess modes or translate the request.

The exact request object is passed through, including optional purpose and
ISO-8601 duration. The current extension requires a positive bounded duration;
use `P30D`, for example. Approval means `ok === true` and non-empty grants, which
can represent partial approval. It does not guarantee a retry will succeed.
The helper never retries a read or calls login. Handle extension rejection and
`RequestAccessUnavailableError` (the capability can disappear after rendering).
Tests inject fake targets or `window.solid`; no real accounts or network calls.
