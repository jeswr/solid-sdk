// AUTHORED-BY GPT-5.6 Sol via codex

import { serialize } from "@jeswr/rdf-serialize";
import type {
  DatasetCore,
  DatasetCoreFactory,
  Quad,
  DataFactory as RdfDataFactory,
} from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { Validator } from "shacl-engine";
import type { ShaclValidator } from "./types.js";

const factory = {
  ...DataFactory,
  dataset: (quads?: Iterable<Quad>) =>
    new Store(quads === undefined ? undefined : ([...quads] as never)) as unknown as DatasetCore,
} as RdfDataFactory & DatasetCoreFactory<Quad>;

/** Create the optional `shacl-engine` adapter used by checked generation. */
export function shaclEngineValidator(): ShaclValidator {
  return {
    async validate(data: DatasetCore, shapes: DatasetCore) {
      const report = await new Validator(shapes, { factory }).validate({ dataset: data });
      return {
        conforms: report.conforms,
        report: await serialize([...report.dataset], {
          prefixes: { sh: "http://www.w3.org/ns/shacl#" },
        }),
      };
    },
  };
}
