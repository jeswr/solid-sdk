<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
# Recipes first cut (sst-889p)

`/recipes` uses AppFrame, the shell pod session and @jeswr/solid-recipe. Demo mode
seeds fictional recipes and a weekly plan through the same SDK store used for live
pods. The recipe box supports search, category/cuisine/favourite filters and images
with a local placeholder when an image cannot load. Cook mode has larger text,
ingredient and step checklists, quantity scaling and optional screen wake lock.
The editor includes durations, yield, source, nutrition, rating and metadata; import
previews pasted HTML/JSON-LD in the editor before saving. Weekly plans link recipes
to days and support week navigation.

The state controller paints optimistically and serialises writes. It removes failed
intents from the queue and recomputes from confirmed data, shows a toast on failure,
fences stale refreshes and disposes account-specific work on unmount. Conditional
write conflicts require the user to refresh and reapply their change.

Already-open recipes and cook-mode checklists remain usable offline. Save controls
require reconnection; this first cut has no durable recipe cache or offline write queue.
Keep an unfinished form open while reconnecting. The shell service worker supplies
its own route fallback. This app does not copy another app's cache or store code.

Follow-up work for the lead's tracker:

- Add ingredients to Tasks.
- URL import through a shared, credential-free guarded page-fetch service.
- Durable account-scoped recipe snapshots and offline queued edits.
- Multiple meals per day, shopping lists, recipe deletion and bulk organisation.
- Rich HowToSection headings, linked authors and quantity/nutrition conversion.

Generator limitation: ordered collections require the documented literal position
encoding. Meal plans use generated independent day IRI fields rather than repeated
composite children. No other app's production code was copied or required for extraction.

`test/recipes*` covers lib, state, provider and demo behavior. The Playwright spec
`e2e/recipes.spec.ts` covers demo import, persisted creation, cooking, scaling and
planning at 375/768/1280 pixels with axe checks. Run that spec outside the port-restricted
sandbox. The package diff still needs the mandatory Claude review before merge.
