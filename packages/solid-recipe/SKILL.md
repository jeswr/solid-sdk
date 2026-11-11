---
name: solid-recipe
description: Use when reading or writing Solid recipes and weekly meal plans through @jeswr/solid-recipe, changing its generated profile, importing schema.org JSON-LD, scaling ingredients or formatting cooking durations.
---
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

# Solid recipe model

Recipes (`https://schema.org/Recipe`) and weekly plans
(`https://jeswr.org/ns/recipe#MealPlan`) use the generated model in
`src/generated/model.js`. `src/model.ts` is a thin facade for validation and ordered
text. Never edit `src/generated/`; change `codegen/recipe.ontology.ttl`,
`codegen/recipe.shapes.ttl` or `codegen.config.json`, then run
`pnpm --filter @jeswr/solid-recipe run codegen --update-lock`. The byte-for-byte drift
test and the README's "Exact divergences" regression pins must pass.

The composite Recipe includes optional NutritionInformation and personal Review →
Rating nodes. No federation recipe sector exists in this revision; profile
narrowings are documented in the SHACL header. MealPlan is generated with one
optional recipe subject IRI per weekday and its week identifier in `schema:name`.

Standard `schema:recipeIngredient` and `schema:recipeInstructions` always contain
clean text. Private `recipe:orderedIngredient` and `recipe:orderedInstruction`
copies encode six-digit positions to preserve order and duplicates. Decode only
those private values; external standard strings, even `123456: hi`, are text.
Repeated composite children and RDF lists are not admitted by the generator.

`fromSchemaOrgJsonLd`, `extractRecipeJsonLd` and `importRecipe` are inert and
network-free. Keep the input and traversal bounds. `durationMinutes` accepts
nonnegative fixed cooking durations in XSD lexical form; only seconds may be
fractional. `durationFromMinutes` normalises numeric form input into whole hours,
minutes and decimal seconds at microsecond precision. `normalizeDuration` omits
invalid, unsupported or unsafe-size optional imports. `scaleIngredient` affects
only an initial quantity or range.

`openRecipeStore` creates `recipes/` and `meal-plans/` and registers their respective
classes in the Type Index. `recipeStore(storage, container, planContainer?)` also
supports memory clients; the default plan container is the supplied container for
existing callers. Listing filters by generated type, reads legacy co-located plans,
and returns `skipped` entries without hiding valid records. Access and transport
errors propagate. Nullable or weak ETags permit reading; writes require an observed
strong ETag. `savePlan` uses the recipe subjects known from successful list/create/
update calls, without listing again, and works when destructured. Retain actual
server-assigned resource URLs and pass authenticated fetch from the session.

From the workspace root, with Node 24 on PATH:

```sh
pnpm exec turbo run lint build typecheck test --filter=@jeswr/solid-recipe
```
