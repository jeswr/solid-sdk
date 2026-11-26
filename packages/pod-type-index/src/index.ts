// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Sonnet 5.5
import { classIri, error, registration, throwIfAborted } from "./common.js";
import { lwsIndex } from "./lws.js";
import { solidIndex } from "./solid.js";
import type { TypeIndex, TypeIndexOptions } from "./types.js";

export type {
  RegistrationOptions,
  TypeHint,
  TypeIndex,
  TypeIndexOptions,
  TypeIndexReadOptions,
  TypeLocation,
} from "./types.js";

/** Create an account-scoped Solid Type Index or LWS service client. No I/O at construction. */
export function createTypeIndex(options: TypeIndexOptions): TypeIndex {
  const { storage, features, profile } = options;
  if (storage.protocol !== features.protocol)
    throw new TypeError("Storage and features protocols differ");
  const solid = storage.protocol === "solid" ? solidIndex(storage, profile) : undefined;
  const lws = lwsIndex(options);

  const findAll: TypeIndex["findAll"] = async (classes, opts = {}) => {
    for (const iri of classes) classIri(iri);
    throwIfAborted(opts.signal, storage.root);
    return solid ? solid.findAll(classes, opts.signal) : lws.findAll(classes, opts.signal);
  };
  return {
    find: async (iri, opts) => (await findAll([iri], opts)).get(iri) as string[],
    findAll,
    async register(iri, location, opts = {}) {
      const args = registration(storage, iri, location, opts);
      if (!solid) return { links: [{ rel: "type", target: args.canonical }] };
      await solid.mutate(
        args.canonical,
        args.target,
        args.container,
        args.index,
        false,
        opts.signal,
      );
      return undefined;
    },
    async unregister(iri, location, opts = {}) {
      const args = registration(storage, iri, location, opts);
      if (solid) {
        await solid.mutate(
          args.canonical,
          args.target,
          args.container,
          args.index,
          true,
          opts.signal,
        );
      }
    },
    async listClasses(opts = {}) {
      if (solid) throw error("unsupported", storage.root);
      throwIfAborted(opts.signal, storage.root);
      return lws.listClasses(opts.signal);
    },
  };
}
