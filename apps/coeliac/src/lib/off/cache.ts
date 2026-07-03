// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Cache an OFF product in the pod as an RDF `diet:FoodItem` document
 * (`/health/diary/cache/off/{barcode}.ttl`, DESIGN §2.3/§5.2) so the diary does
 * not re-hit OFF and the product view works offline. Written via the package's
 * typed `FoodItem` accessor (never hand-built triples); the `diet:offRef` carries
 * the ODbL attribution link. Best-effort: a cache read/write failure never blocks
 * a lookup or a log.
 */
import { FoodItem, foodItemSubject, parseFoodItem } from "@jeswr/solid-health-diary";
import { fetchRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { offCacheUrl } from "../pod/layout.js";
import { putResource } from "../pod/pod-fs.js";
import { datasetToTurtle } from "../pod/rdf-io.js";
import { type OffProduct, offProductRef, offProductToFoodItem } from "./off.js";

/** Serialise an OFF product to a `diet:FoodItem` cache document (Turtle). */
export async function serializeOffCache(url: string, product: OffProduct): Promise<string> {
  const subject = foodItemSubject(url, 0);
  const store = new Store();
  const fi = new FoodItem(subject, store, DataFactory).mark();
  const data = offProductToFoodItem(product);
  fi.name = data.name;
  fi.offBarcode = data.offBarcode;
  fi.offRef = data.offRef;
  fi.ingredientsText = data.ingredientsText;
  fi.sourceConfidence = data.sourceConfidence;
  for (const t of data.declaredAllergen ?? []) fi.declaredAllergen.add(t);
  for (const t of data.traceAllergen ?? []) fi.traceAllergen.add(t);
  for (const t of data.additive ?? []) fi.additive.add(t);
  for (const t of data.offCategory ?? []) fi.offCategory.add(t);
  return datasetToTurtle(store);
}

/** Write an OFF product to the pod cache (best-effort; swallows errors). */
export async function writeOffCache(
  authedFetch: typeof globalThis.fetch,
  storageRoot: string,
  product: OffProduct,
): Promise<void> {
  if (!product.found) return;
  try {
    const url = offCacheUrl(storageRoot, product.barcode);
    await putResource(authedFetch, url, await serializeOffCache(url, product));
  } catch {
    // caching is a nicety — never break the flow
  }
}

/**
 * Read a cached OFF product from the pod, or `undefined` if not cached / a read
 * error. The reconstructed product carries the food-relevant fields (name,
 * ingredients, tags) + the ODbL attribution; crowd metadata (data-quality,
 * completeness) is not cached and is empty on the offline path.
 */
export async function readOffCache(
  authedFetch: typeof globalThis.fetch,
  storageRoot: string,
  barcode: string,
): Promise<OffProduct | undefined> {
  try {
    const url = offCacheUrl(storageRoot, barcode);
    const { dataset } = await fetchRdf(url, { fetch: authedFetch });
    const fi = parseFoodItem(foodItemSubject(url, 0), dataset);
    if (!fi) return undefined;
    return {
      barcode,
      found: true,
      name: fi.name,
      brands: undefined,
      quantity: undefined,
      ingredientsText: fi.ingredientsText,
      allergensTags: fi.declaredAllergen ?? [],
      tracesTags: fi.traceAllergen ?? [],
      additivesTags: fi.additive ?? [],
      categoriesTags: fi.offCategory ?? [],
      dataQualityTags: [],
      lastEdit: undefined,
      completeness: undefined,
      attribution: "Open Food Facts",
      sourceUrl: fi.offRef ?? offProductRef(barcode),
    };
  } catch {
    return undefined;
  }
}
