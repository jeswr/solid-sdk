// AUTHORED-BY Codex GPT-6.1-Sol
// Exercise the gate with deliberately broken copies; never mutate the real fixtures.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Parser, Store, Writer } from "n3";
import { validateSectorFixtures } from "./shacl-fixtures.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "sst-ild3-shacl-"));
const quiet = () => {};
const check = () => validateSectorFixtures(scratch, quiet);
function copySector(source, target = source) {
  mkdirSync(join(scratch, "sectors", target), { recursive: true });
  for (const file of [`${source}.ttl`, `${source}.shacl.ttl`]) {
    cpSync(join(ROOT, "sectors", source, file), join(scratch, "sectors", target, file));
  }
  cpSync(join(ROOT, "test", "fixtures", source), join(scratch, "test", "fixtures", target), {
    recursive: true,
  });
}
function iriProperties(store, subject, properties) {
  const resource = new TermWrapper(subject, store, DataFactory);
  for (const [predicate, value] of Object.entries(properties)) {
    SetFrom.subjectPredicate(resource, predicate, NamedNodeAs.string, NamedNodeFrom.string).add(
      value,
    );
  }
}
const writeRdf = (file, store) => writeFileSync(file, new Writer().quadsToString([...store]));

try {
  copySector("core");
  copySector("bookmarks");
  assert.equal((await check()).sectorCount, 2);
  const negative = join(scratch, "test", "fixtures", "bookmarks", "bookmark.invalid.ttl");
  const original = readFileSync(negative, "utf8");
  const positive = join(scratch, "test", "fixtures", "bookmarks", "valid.ttl");
  const valid = readFileSync(positive, "utf8");

  writeFileSync(negative, original.replace(/^# expect: .+/, "# expect: https://example.org/wrong"));
  await assert.rejects(
    check,
    /expected exactly one constraint failure at https:\/\/example.org\/wrong/,
  );
  console.log("✓ Wrong # expect path is rejected by the fixture gate.");

  writeFileSync(negative, original.replace(/^# expect: .+\n/, ""));
  await assert.rejects(check, /invalid fixture must start with # expect:/);
  writeFileSync(negative, `${original.split("\n")[0]}\n${valid}`);
  await assert.rejects(check, /expected exactly one constraint failure.*got 0/);
  writeFileSync(negative, original + original.replaceAll("/fixtures/", "/second-fixture/"));
  await assert.rejects(check, /expected exactly one constraint failure.*got 2/);
  writeFileSync(negative, original);
  console.log("✓ Missing expectations, conforming negatives and multiple failures are rejected.");

  writeFileSync(positive, original);
  await assert.rejects(check, /bookmarks\/valid.ttl: expected no results/);
  writeFileSync(positive, valid);
  const person = join(scratch, "test", "fixtures", "core", "person.invalid.ttl");
  const personText = readFileSync(person, "utf8");
  const imported = join(scratch, "test", "fixtures", "bookmarks", "imported-core.ttl");
  writeFileSync(imported, personText);
  await assert.rejects(check, /bookmarks\/imported-core.ttl: expected no results/);
  rmSync(imported);
  rmSync(person);
  await assert.rejects(check, /PersonShape has no negative fixture coverage/);
  writeFileSync(person, personText);
  console.log(
    "✓ Invalid positives, imported Core failures and missing NodeShape negatives are rejected.",
  );

  // One nested failure covers its parent property and its independently targeted helper.
  copySector("collectibles");
  const valuation = join(scratch, "test", "fixtures", "collectibles", "valuation.invalid.ttl");
  const valuationText = readFileSync(valuation, "utf8");
  const valuationData = new Store(new Parser().parse(valuationText));
  const amount = "https://example.org/fixtures/collectibles/support-5";
  iriProperties(valuationData, "https://example.org/fixtures/collectibles/Valuation-4", {
    "https://jeswr.org/ns/sectors/collectibles#amount": amount,
  });
  const amountValue = SetFrom.subjectPredicate(
    new TermWrapper(amount, valuationData, DataFactory),
    "http://schema.org/value",
    (term) => term,
    (term) => term,
  );
  const [value] = amountValue;
  amountValue.delete(value);
  const writeValuation = () => {
    writeRdf(valuation, valuationData);
    writeFileSync(
      valuation,
      `# expect: http://schema.org/value\n${readFileSync(valuation, "utf8")}`,
    );
  };
  const monetary = join(scratch, "test", "fixtures", "collectibles", "monetary-amount.invalid.ttl");
  const monetaryText = readFileSync(monetary, "utf8");
  rmSync(monetary);
  writeValuation();
  assert.equal((await check()).sectorCount, 3);

  // The helper must also be covered exclusively through its callers' property paths.
  const collectiblesShapesFile = join(scratch, "sectors", "collectibles", "collectibles.shacl.ttl");
  const collectiblesShapesText = readFileSync(collectiblesShapesFile, "utf8");
  const collectiblesShapes = new Store(new Parser().parse(collectiblesShapesText));
  SetFrom.subjectPredicate(
    new TermWrapper(
      "https://jeswr.org/ns/sectors/collectibles/shapes#MonetaryAmountShape",
      collectiblesShapes,
      DataFactory,
    ),
    "http://www.w3.org/ns/shacl#targetClass",
    NamedNodeAs.string,
    NamedNodeFrom.string,
  ).clear();
  writeRdf(collectiblesShapesFile, collectiblesShapes);
  assert.equal((await check()).sectorCount, 3);

  // The unlinked amount still exists, but the helper never validates it.
  writeFileSync(valuation, valuationText);
  await assert.rejects(check, /MonetaryAmountShape has no negative fixture coverage/);
  writeValuation();

  const collectiblesPositive = join(scratch, "test", "fixtures", "collectibles", "valid.ttl");
  const collectiblesValid = readFileSync(collectiblesPositive, "utf8");
  const unlinkedData = new Store(new Parser().parse(collectiblesValid));
  for (const type of ["Valuation", "Appraisal", "InsurancePolicy"]) {
    const classIri = `https://jeswr.org/ns/sectors/collectibles#${type}`;
    for (const subject of unlinkedData.getSubjects(
      DataFactory.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
      DataFactory.namedNode(classIri),
      null,
    )) {
      SetFrom.subjectPredicate(
        new TermWrapper(subject, unlinkedData, DataFactory),
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        NamedNodeAs.string,
        NamedNodeFrom.string,
      ).delete(classIri);
    }
  }
  writeRdf(collectiblesPositive, unlinkedData);
  await assert.rejects(check, /MonetaryAmountShape has no positive fixture coverage/);
  writeFileSync(collectiblesPositive, collectiblesValid);
  writeFileSync(collectiblesShapesFile, collectiblesShapesText);
  console.log("✓ Untargeted helpers receive positive and negative coverage through properties.");

  // Wrapper paths cannot replace the expected leaf path, or hide a second failure.
  writeFileSync(
    valuation,
    readFileSync(valuation, "utf8").replace(
      /^# expect: .+/,
      "# expect: https://jeswr.org/ns/sectors/collectibles#amount",
    ),
  );
  await assert.rejects(
    check,
    /expected exactly one constraint failure.*got 1: http:\/\/schema.org\/value/,
  );
  writeValuation();
  SetFrom.subjectPredicate(
    new TermWrapper(amount, valuationData, DataFactory),
    "http://schema.org/currency",
    (term) => term,
    (term) => term,
  ).clear();
  writeValuation();
  await assert.rejects(check, /expected exactly one constraint failure.*got 2/);

  // An unrelated helper failure must not cover a conforming Valuation instance.
  writeFileSync(
    valuation,
    monetaryText.replaceAll("/fixtures/", "/unrelated-fixture/") +
      readFileSync(join(scratch, "test", "fixtures", "collectibles", "valid.ttl"), "utf8"),
  );
  await assert.rejects(check, /ValuationShape has no negative fixture coverage/);
  writeFileSync(valuation, valuationText);
  writeFileSync(monetary, monetaryText);
  assert.equal((await check()).sectorCount, 3);
  rmSync(join(scratch, "sectors", "collectibles"), { recursive: true });
  rmSync(join(scratch, "test", "fixtures", "collectibles"), { recursive: true });
  console.log("✓ Nested failures cover parent and helper shapes while counting distinct leaves.");

  // A sector can inherit all its enforceable properties from an imported profile.
  const SH = "http://www.w3.org/ns/shacl#";
  const OWL = "http://www.w3.org/2002/07/owl#";
  const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const CORE = "https://jeswr.org/ns/core#";
  const sectorDir = join(scratch, "sectors", "inherited");
  mkdirSync(sectorDir);
  const ontology = new Store();
  iriProperties(ontology, "https://example.org/inherited", {
    [TYPE]: `${OWL}Ontology`,
    [`${OWL}imports`]: "https://jeswr.org/ns/core",
  });
  writeRdf(join(sectorDir, "inherited.ttl"), ontology);
  const inheritedShapes = new Store();
  iriProperties(inheritedShapes, "https://example.org/InheritedAccountShape", {
    [TYPE]: `${SH}NodeShape`,
    [`${SH}targetClass`]: "https://example.org/InheritedAccount",
  });
  writeRdf(join(sectorDir, "inherited.shacl.ttl"), inheritedShapes);
  assert.equal((await check()).sectorCount, 2);
  iriProperties(inheritedShapes, "https://example.org/InheritedAccountShape", {
    [`${SH}node`]: `${CORE}AccountShape`,
  });
  writeRdf(join(sectorDir, "inherited.shacl.ttl"), inheritedShapes);
  await assert.rejects(check, /inherited: constrained sector has no fixtures/);

  const fixtureDir = join(scratch, "test", "fixtures", "inherited");
  mkdirSync(fixtureDir);
  const account = "https://example.org/account";
  const data = new Store();
  iriProperties(data, account, {
    [TYPE]: "https://example.org/InheritedAccount",
    [`${CORE}hasAccountHolder`]: "https://example.org/holder",
    [`${CORE}hasAccountProvider`]: "https://example.org/provider",
  });
  iriProperties(data, "https://example.org/holder", { [TYPE]: `${CORE}AccountHolder` });
  iriProperties(data, "https://example.org/provider", { [TYPE]: `${CORE}AccountProvider` });
  writeRdf(join(fixtureDir, "valid.ttl"), data);
  await assert.rejects(check, /InheritedAccountShape has no negative fixture coverage/);
  SetFrom.subjectPredicate(
    new TermWrapper(account, data, DataFactory),
    `${CORE}hasAccountHolder`,
    NamedNodeAs.string,
    NamedNodeFrom.string,
  ).delete("https://example.org/holder");
  const inheritedNegative = join(fixtureDir, "account.invalid.ttl");
  writeRdf(inheritedNegative, data);
  writeFileSync(
    inheritedNegative,
    `# expect: ${CORE}hasAccountHolder\n${readFileSync(inheritedNegative, "utf8")}`,
  );
  assert.equal((await check()).sectorCount, 3);
  rmSync(sectorDir, { recursive: true });
  rmSync(fixtureDir, { recursive: true });
  console.log("✓ Inherited-only constraints require fixtures and enforce NodeShape coverage.");

  // Class targets include instances of subclasses declared in each fixture's data graph.
  const bookmarkClass = "https://jeswr.org/ns/sectors/bookmarks#Bookmark";
  const subclass = "https://example.org/SpecialBookmark";
  const intermediate = "https://example.org/IntermediateBookmark";
  const subClassOf = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
  for (const parent of [bookmarkClass, intermediate]) {
    for (const [file, text] of [
      [positive, valid],
      [negative, original],
    ]) {
      const subclassData = new Store(new Parser().parse(text));
      for (const subject of subclassData.getSubjects(TYPE, bookmarkClass, null)) {
        const types = SetFrom.subjectPredicate(
          new TermWrapper(subject, subclassData, DataFactory),
          TYPE,
          NamedNodeAs.string,
          NamedNodeFrom.string,
        );
        types.delete(bookmarkClass);
        types.add(subclass);
      }
      iriProperties(subclassData, subclass, { [subClassOf]: parent });
      if (parent === intermediate) {
        iriProperties(subclassData, intermediate, { [subClassOf]: bookmarkClass });
      }
      writeRdf(file, subclassData);
      if (file === negative) {
        writeFileSync(file, `${original.split("\n")[0]}\n${readFileSync(file, "utf8")}`);
      }
    }
    assert.equal((await check()).sectorCount, 2);
  }
  for (const file of [positive, negative]) {
    writeFileSync(
      file,
      readFileSync(file, "utf8").replaceAll(bookmarkClass, "https://example.org/UnrelatedClass"),
    );
  }
  await assert.rejects(check, (error) => {
    assert.match(error.message, /BookmarkShape has no positive fixture coverage/);
    assert.match(error.message, /BookmarkShape has no negative fixture coverage/);
    assert.match(error.message, /expected exactly one constraint failure.*got 0/);
    return true;
  });
  writeFileSync(positive, valid);
  writeFileSync(negative, original);
  console.log("✓ Direct and transitive subclasses count as targets; unrelated classes do not.");

  // New nested profiles must be found without changing any sector inventory.
  copySector("drawing", "nested/drawing");
  assert.equal((await check()).sectorCount, 3);
  rmSync(join(scratch, "test", "fixtures", "nested", "drawing"), { recursive: true });
  await assert.rejects(check, /nested\/drawing: constrained sector has no fixtures/);
  console.log("✓ Newly discovered nested sectors require fixtures automatically.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
