// AUTHORED-BY Codex GPT-6.1-Sol
import { classIri, error, locations, registration, selectSources } from "./common.js";
import { lwsIndex } from "./lws.js";
import { solidIndex } from "./solid.js";
import type { FoundRegistration, TypeIndex, TypeIndexOptions } from "./types.js";

export type {
  FindOptions,
  FoundRegistration,
  RegistrationOptions,
  TypeHint,
  TypeIndex,
  TypeIndexOptions,
  TypeLocation,
  TypeSource,
} from "./types.js";

/** Create an account-scoped Solid Type Index or LWS service client. No I/O at construction. */
export function createTypeIndex(options: TypeIndexOptions): TypeIndex {
  const { storage, features, profile } = options;
  if (storage.protocol !== features.protocol)
    throw new TypeError("Storage and features protocols differ");
  const solid = storage.protocol === "solid" ? solidIndex(storage, profile) : undefined;
  const lws = lwsIndex(options);

  const findAllRegistrations: TypeIndex["findAllRegistrations"] = async (classes, opts) => {
    for (const iri of classes) classIri(iri);
    const sources = selectSources(opts);
    return solid ? solid.findAll(classes, sources) : lws.findAll(classes, sources);
  };
  const findAll: TypeIndex["findAll"] = async (classes, opts) =>
    new Map(
      [...(await findAllRegistrations(classes, opts))].map(([iri, found]) => [
        iri,
        locations(found),
      ]),
    );
  return {
    find: async (iri, opts) => (await findAll([iri], opts)).get(iri) as string[],
    findAll,
    findRegistrations: async (iri, opts) =>
      (await findAllRegistrations([iri], opts)).get(iri) as FoundRegistration[],
    findAllRegistrations,
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
