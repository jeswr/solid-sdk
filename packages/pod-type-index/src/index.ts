// AUTHORED-BY Codex GPT-6.1-Sol
import { classIri, error, registration } from "./common.js";
import { lwsIndex } from "./lws.js";
import { solidIndex } from "./solid.js";
import type { TypeIndex, TypeIndexOptions } from "./types.js";

export type {
  RegistrationOptions,
  TypeHint,
  TypeIndex,
  TypeIndexOptions,
  TypeLocation,
} from "./types.js";

/** Create an account-scoped Solid Type Index or LWS service client. No I/O at construction. */
export function createTypeIndex(options: TypeIndexOptions): TypeIndex {
  const { storage, features, profile } = options;
  if (storage.protocol !== features.protocol)
    throw new TypeError("Storage and features protocols differ");
  const solid = storage.protocol === "solid" ? solidIndex(storage, profile) : undefined;
  const lws = lwsIndex(options);

  const findAll: TypeIndex["findAll"] = async (classes) => {
    for (const iri of classes) classIri(iri);
    return solid ? solid.findAll(classes) : lws.findAll(classes);
  };
  return {
    find: async (iri) => (await findAll([iri])).get(iri) as string[],
    findAll,
    async register(iri, location, opts = {}) {
      const args = registration(storage, iri, location, opts);
      if (!solid) return { links: [{ rel: "type", target: args.canonical }] };
      await solid.mutate(args.canonical, args.target, args.container, args.index, false);
      return undefined;
    },
    async unregister(iri, location, opts = {}) {
      const args = registration(storage, iri, location, opts);
      if (solid) await solid.mutate(args.canonical, args.target, args.container, args.index, true);
    },
    async listClasses() {
      if (solid) throw error("unsupported", storage.root);
      return lws.listClasses();
    },
  };
}
