// AUTHORED-BY Codex GPT-6
/** Host/store boundary only: structuredClone cannot clone live Proxy-backed RDF views. */
import { CoreNode } from "./core-node.js";
export function copyData<T>(value: T): T {
  const plain = (item: unknown): unknown => {
    if (item instanceof CoreNode) return item.toObject();
    if (Array.isArray(item)) return Array.from(item, plain);
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype)
      return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, plain(value)]));
    return item;
  };
  return structuredClone(plain(value)) as T;
}
