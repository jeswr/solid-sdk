<!-- AUTHORED-BY Codex GPT-6 -->

The complete Solid OIDC context is bundled from
https://www.w3.org/ns/solid/oidc-context.jsonld (retrieved 2026-10-26).
The complete federation context is bundled from
https://w3id.org/jeswr/fed (retrieved 2026-10-26 with `Accept: application/ld+json`),
as referenced by the shipped Pod Chat client identifier. Its published namespace
mappings are preserved. The source is `context.jsonld` in
[solid-federation-vocab](https://github.com/jeswr/solid-federation-vocab), under MIT.
The JSON copies are upstream documents; this file records their provenance.

Both are imported into the package build; no runtime download occurs. Only those
exact context URLs are accepted, including for nested context loads. All other
remote contexts are refused. Context updates require an explicit source change.

The W3C context document is provided under the
[W3C Software and Document License](https://www.w3.org/copyright/software-license/).
