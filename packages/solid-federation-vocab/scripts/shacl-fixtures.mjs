// AUTHORED-BY Codex GPT-6.1-Sol
// Offline SHACL fixture gate. Profiles and data are parsed with n3, as in validate.mjs.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Parser, Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";

const SH = "http://www.w3.org/ns/shacl#";
const OWL = "http://www.w3.org/2002/07/owl#";
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const objects = (store, subject, predicate) => [
  ...SetFrom.subjectPredicate(
    new TermWrapper(subject, store, DataFactory),
    predicate,
    (term) => term,
    (term) => term,
  ),
];
const parse = (file) =>
  new Store(new Parser({ baseIRI: pathToFileURL(file).href }).parse(readFileSync(file, "utf8")));

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

// sh:path, severity, messages and minCount=0 alone do not reject any data.
function constrainedProperties(store, shape, visited = new Set()) {
  if (visited.has(shape.value)) return [];
  visited.add(shape.value);
  return [
    ...objects(store, shape, `${SH}property`).filter((property) =>
      store.getQuads(property, null, null, null).some(({ predicate, object }) => {
        const local = predicate.value.slice(SH.length);
        return (
          predicate.value.startsWith(SH) &&
          !["path", "severity", "message", "name", "description", "order", "group"].includes(
            local,
          ) &&
          !(local === "minCount" && Number(object.value) === 0)
        );
      }),
    ),
    ...objects(store, shape, `${SH}node`).flatMap((parent) =>
      constrainedProperties(store, parent, visited),
    ),
  ];
}

// Untargeted helper NodeShapes are reached through sh:node callers.
function targets(shapes, data, shape, visited = new Set()) {
  if (visited.has(shape.value)) return [];
  visited.add(shape.value);
  return [
    ...objects(shapes, shape, `${SH}targetNode`),
    ...objects(shapes, shape, `${SH}targetClass`).flatMap((type) =>
      data.getSubjects(TYPE, type, null),
    ),
    ...objects(shapes, shape, `${SH}targetSubjectsOf`).flatMap((property) =>
      data.getSubjects(property, null, null),
    ),
    ...objects(shapes, shape, `${SH}targetObjectsOf`).flatMap((property) =>
      data.getObjects(null, property, null),
    ),
    ...shapes
      .getSubjects(`${SH}node`, shape, null)
      .flatMap((caller) => targets(shapes, data, caller, visited)),
  ];
}

// sh:node adds wrapper results; count the underlying constraint once, including
// when the same helper is also independently targeted by the profile.
function leafResults(results) {
  return results.flatMap((result) =>
    result.detail.length ? leafResults(result.detail) : [result],
  );
}

export async function validateSectorFixtures(root, log = console.log) {
  const sectorsRoot = join(root, "sectors");
  const byDirectory = new Map();
  for (const file of walk(sectorsRoot)
    .filter((file) => file.endsWith(".shacl.ttl"))
    .sort()) {
    const dir = dirname(file);
    const ontologyFile = join(dir, `${basename(dir)}.ttl`);
    if (!byDirectory.has(dir)) {
      byDirectory.set(dir, {
        sector: relative(sectorsRoot, dir),
        shapes: new Store(),
        ontology: existsSync(ontologyFile) ? parse(ontologyFile) : new Store(),
      });
    }
    byDirectory.get(dir).shapes.addQuads([...parse(file)]);
  }
  const profiles = [...byDirectory.values()];
  const problems = [];
  let fixtureCount = 0;
  let sectorCount = 0;
  for (const profile of profiles) {
    if (!profile.shapes.countQuads(null, `${SH}property`, null, null)) continue;
    sectorCount += 1;
    const shapes = new Store();
    const included = new Set();
    function include(current) {
      if (included.has(current.sector)) return;
      included.add(current.sector);
      shapes.addQuads([...current.shapes]);
      for (const imported of current.ontology.getObjects(null, `${OWL}imports`, null)) {
        const dependency = profiles.find(
          ({ ontology }) =>
            ontology.countQuads(imported, TYPE, `${OWL}Ontology`, null) ||
            ontology.countQuads(null, `${OWL}versionIRI`, imported, null),
        );
        if (dependency) include(dependency);
      }
    }
    include(profile);
    const covered = profile.shapes
      .getSubjects(TYPE, `${SH}NodeShape`, null)
      .map((shape) => ({
        shape,
        properties: constrainedProperties(shapes, shape),
        valid: false,
        invalid: false,
      }))
      .filter(({ properties }) => properties.length);
    const fixtureDir = join(root, "test", "fixtures", profile.sector);
    const files = existsSync(fixtureDir)
      ? readdirSync(fixtureDir)
          .filter((file) => file.endsWith(".ttl"))
          .sort()
      : [];
    if (!files.length) problems.push(`${profile.sector}: constrained sector has no fixtures`);
    let positives = 0;
    let negatives = 0;
    log(`SHACL: ${profile.sector} (${covered.length} constrained NodeShapes)`);
    for (const file of files) {
      const label = `${profile.sector}/${file}`;
      try {
        const invalid = file.endsWith(".invalid.ttl");
        const text = readFileSync(join(fixtureDir, file), "utf8");
        const expectedPath = /^# expect: (\S+)\r?$/m.exec(text.split("\n")[0])?.[1];
        if (invalid && (!expectedPath || !URL.canParse(expectedPath))) {
          throw new Error("invalid fixture must start with # expect: <absolute sh:path IRI>");
        }
        const data = parse(join(fixtureDir, file));
        const report = await new SHACLValidator(shapes).validate(data);
        const results = [
          ...new Map(
            leafResults(report.results).map((result) => [
              JSON.stringify([
                result.sourceShape,
                result.sourceConstraintComponent,
                result.focusNode,
                result.path,
                result.value,
              ]),
              result,
            ]),
          ).values(),
        ];
        if (!invalid && (!report.conforms || results.length)) {
          throw new Error(
            `expected no results, got ${results.length}: ${results.map((r) => r.path?.value ?? "(node constraint)").join(", ")}`,
          );
        }
        if (
          invalid &&
          (report.conforms || results.length !== 1 || results[0].path?.value !== expectedPath)
        ) {
          throw new Error(
            `expected exactly one constraint failure at ${expectedPath}, got ${results.length}: ${results.map((r) => r.path?.value ?? "(node constraint)").join(", ")}`,
          );
        }
        for (const entry of covered) {
          const focusNodes = targets(shapes, data, entry.shape);
          if (!invalid && focusNodes.length) entry.valid = true;
          if (
            invalid &&
            results.some(
              (result) =>
                focusNodes.some((focus) => focus.equals(result.focusNode)) &&
                entry.properties.some((property) => property.equals(result.sourceShape)),
            )
          )
            entry.invalid = true;
        }
        if (invalid) negatives += 1;
        else positives += 1;
        fixtureCount += 1;
        log(
          `  ✓ ${label}: ${invalid ? `rejected at ${expectedPath}` : "conforms without warnings"}`,
        );
      } catch (error) {
        problems.push(`${label}: ${error.message}`);
      }
    }
    if (!positives) problems.push(`${profile.sector}: no conforming positive fixture`);
    if (!negatives) problems.push(`${profile.sector}: no passing negative fixture`);
    for (const { shape, valid, invalid } of covered) {
      if (!valid)
        problems.push(`${profile.sector}: ${shape.value} has no positive fixture coverage`);
      if (!invalid)
        problems.push(`${profile.sector}: ${shape.value} has no negative fixture coverage`);
    }
  }
  if (!sectorCount) problems.push("no constrained SHACL sectors discovered");
  if (problems.length) throw new Error(problems.join("\n"));
  log(`SHACL PASSED — ${fixtureCount} fixtures across ${sectorCount} constrained sectors.`);
  return { fixtureCount, sectorCount };
}
