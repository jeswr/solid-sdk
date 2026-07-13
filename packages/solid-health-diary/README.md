<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-health-diary

Typed RDF models for meals, exposures, symptoms, elimination protocols, and tolerance conclusions
in a Solid health diary.

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
- Privacy: `writeOwnerOnlyAcl` writes a fail-closed owner-only WAC document;
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
