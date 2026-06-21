// src/shape.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
var DRAWING_SHAPE_PATH = fileURLToPath(
  new URL("../drawing.shacl.ttl", import.meta.url)
);
var DRAWING_ONTOLOGY_PATH = fileURLToPath(
  new URL("../drawing.ttl", import.meta.url)
);
var cachedShape;
var cachedOntology;
function drawingShapeTtl() {
  if (cachedShape === void 0) cachedShape = readFileSync(DRAWING_SHAPE_PATH, "utf8");
  return cachedShape;
}
function drawingOntologyTtl() {
  if (cachedOntology === void 0) cachedOntology = readFileSync(DRAWING_ONTOLOGY_PATH, "utf8");
  return cachedOntology;
}
export {
  DRAWING_ONTOLOGY_PATH,
  DRAWING_SHAPE_PATH,
  drawingOntologyTtl,
  drawingShapeTtl
};
//# sourceMappingURL=shape.js.map
