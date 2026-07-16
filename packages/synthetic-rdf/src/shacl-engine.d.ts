declare module "shacl-engine" {
  import type { DataFactory, DatasetCore, DatasetCoreFactory, Quad } from "@rdfjs/types";

  interface EngineFactory extends DataFactory, DatasetCoreFactory<Quad> {}

  interface EngineReport {
    conforms: boolean;
    dataset: DatasetCore;
  }

  export class Validator {
    constructor(shapes: DatasetCore, options: { factory: EngineFactory });
    validate(data: { dataset: DatasetCore }): Promise<EngineReport>;
  }
}
