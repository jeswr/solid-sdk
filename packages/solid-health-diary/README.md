<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-health-diary

Typed RDF models for meals, exposures, symptoms, elimination protocols, and tolerance conclusions
in a Solid health diary.

Writers use `https://jeswr.org/ns/sectors/health/diet#`, with canonical health and core
vocabularies under `https://jeswr.org/ns/`. Readers also accept the read-only legacy aliases
exported as `LEGACY_DIET_NS`, `LEGACY_HEALTH_NS`, and `LEGACY_CORE_NS`.

> Health data is sensitive. Write an owner-only ACL before diary data, and treat the package as an
> experimental data model rather than medical advice.

## Install

```sh
npm install github:jeswr/solid-health-diary#main @rdfjs/types
```

Requires Node.js 20 or newer.

## Minimal usage

```ts
import {
  deriveExposures,
  parseMealTtl,
  serializeMeal,
  writeOwnerOnlyAcl,
} from "@jeswr/solid-health-diary";

const container = "https://alice.example/health/diary/";
const ownerWebId = "https://alice.example/profile/card#me";
await writeOwnerOnlyAcl(container, ownerWebId, authenticatedFetch);

const mealUrl = `${container}meal-1.ttl`;
const items = [{ id: `${mealUrl}#item-0`, name: "Dried apricots", offCategory: ["en:dried-apricots"] }];
const exposures = deriveExposures(items);
const turtle = await serializeMeal(mealUrl, { startTime: new Date(), items, exposures });
const meal = await parseMealTtl(mealUrl, turtle, "text/turtle");
```

## Key API

- Meals and food: `buildMeal`, `serializeMeal`, `parseMealTtl`, `deriveExposures`.
- Symptoms and conclusions: typed builders, serializers, parsers, and data types from the root export.
- Privacy: `writeOwnerOnlyAcl` writes fail-closed owner-only WAC/ACP access;
  `buildOwnerOnlyAcl` returns the document without writing it.
- Node-only validation assets: `dietShaclTtl` and `dietVocabTtl` from
  `@jeswr/solid-health-diary/shape`.

## Links

- [Source](https://github.com/jeswr/solid-health-diary)
- [Issues](https://github.com/jeswr/solid-health-diary/issues)
- [SHACL profile](./shapes/diet.shacl.ttl)
- [Vocabulary](./shapes/diet.vocab.ttl)

## License

MIT © Jesse Wright

## Owner-only access changes (sst-9ku5)

Online owner-only writes now delegate to `@jeswr/pod-access/roles` `makeOwnerOnly`.
They discover the server's ACL/ACR Link, support WAC and CSS ACP, and refuse missing
or ambiguous Links, unknown/mixed models, malformed/unsupported policies, unsafe URLs
and foreign resource bindings. Targets must exist and support HEAD discovery; an
`acl`-only Link requires model evidence in readable own or ancestor RDF. Credentialed
URLs, resource queries/fragments and ambiguous encoded paths now refuse. The wrappers
use the default trusted CSS dialect;
ESS deployments should call `makeOwnerOnly` with `implementation: "ess"` directly.
Creation uses `If-None-Match: *`; replacement requires a strong ETag and `If-Match`.
An existing document naming other principals now refuses instead of silently removing
their access; explicit removal requires a direct helper call with `replace: true`.
Foreign inherited ACP member grants always refuse. No error is swallowed and 412 is
never retried. Access transport now refuses redirects and disables caching; failures
use pod-access's typed role errors (parser errors propagate).

The owner receives Read/Write/Append and management; explicit Append is redundant with
Write. Containers retain member defaults; resource writes omit defaults. Descendants'
own policies are not rewritten. Private access is still installed before imported content.
The exported offline WAC builders keep their signatures and graph meaning (Read/Write/
Control and their historical defaults) but now use pod-access's policy serializer, so
Turtle prefix spelling and authorization subject names can change. They do not perform
server discovery or prove that a resource is private. Any `aclUrlFor` export remains a
deprecated offline convention, and is never used to choose an online write URL.
