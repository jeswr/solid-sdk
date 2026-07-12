// AUTHORED-BY Codex GPT-5

/** A supported value projection from SHACL into @rdfjs/wrapper. */
export interface ValueMapping {
  typescriptType: "boolean" | "Date" | "number" | "string";
  readMapper: string;
  writeMapper: string;
  termKind: "iri" | "literal";
}

/** A single direct sh:property constraint on a node shape. */
export interface PropertyModel {
  accessorName: string;
  constantName: string;
  datatype?: string;
  maxCount?: number;
  minCount: number;
  message?: string;
  path: string;
  requiredClass?: string;
  shapeName?: string;
  value: ValueMapping;
}

/** The subset of a SHACL node shape supported by this PoC. */
export interface ShapeModel {
  classConstantName: string;
  className: string;
  properties: PropertyModel[];
  shapeIri: string;
  targetClass: string;
}

/** Parsed inputs used by the source emitters. This stays internal; it is not a model.json contract. */
export interface SectorModel {
  prefixes: Readonly<Record<string, string>>;
  shapes: ShapeModel[];
  terms: Readonly<Record<string, string>>;
}

export interface GenerateOptions {
  ontologyPath: string;
  outDir: string;
  packageName: string;
  shapesPath: string;
}
