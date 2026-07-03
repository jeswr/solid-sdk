// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Resolve a product for a barcode: OFF live first (freshest), pod cache as the
 * offline fallback, and write-through to the pod cache on a successful live
 * lookup (DESIGN §5.2/§6). The barcode is the only thing sent to OFF — never any
 * health data.
 */
import { readOffCache, writeOffCache } from "./cache.js";
import { lookupProduct, type OffProduct } from "./off.js";

export interface ResolveContext {
  publicFetch: typeof globalThis.fetch;
  authedFetch: typeof globalThis.fetch;
  storageRoot: string | null;
  /** The pod owner WebID — required to write-through the owner-only-ACL'd cache. */
  webId: string | null;
}

/** A product plus where it came from (for the offline note in the UI). */
export interface ResolvedProduct {
  product: OffProduct;
  source: "off" | "cache";
}

/**
 * Resolve a product. Tries OFF live; on a network failure falls back to the pod
 * cache (offline). A successful live lookup is written through to the cache
 * (best-effort). Re-throws the original {@link OffLookupError} only when there is
 * no cached fallback, so the caller can offer manual entry.
 */
export async function resolveProduct(
  barcode: string,
  ctx: ResolveContext,
): Promise<ResolvedProduct> {
  try {
    const product = await lookupProduct(barcode, ctx.publicFetch);
    if (product.found && ctx.storageRoot && ctx.webId) {
      void writeOffCache(ctx.authedFetch, ctx.storageRoot, ctx.webId, product);
    }
    return { product, source: "off" };
  } catch (err) {
    if (ctx.storageRoot) {
      const cached = await readOffCache(ctx.authedFetch, ctx.storageRoot, barcode);
      if (cached) return { product: cached, source: "cache" };
    }
    throw err;
  }
}
