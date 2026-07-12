// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// CHARACTERIZATION (golden-master) test for the RDF EMISSION of `selfDescribe`. It
// pins the exact set of triples produced for a representative registration, as
// CANONICAL N-Triples. This guards the `fedapp:` vocabulary IRIs / predicates /
// classes and the emitted RDF shape against any accidental change during a structural
// refactor: if a predicate IRI, a class IRI, or the triple set shifts, this snapshot
// goes red.
//
// Canonicalisation preserves blank-node IDENTITY (roborev finding): n3 mints
// non-deterministic blank-node labels, so we relabel each DISTINCT raw label to a
// stable `_:bN` in order of first appearance, THEN sort. Collapsing every blank node
// to one token would hide a regression that linked a SectorUse from one blank node but
// emitted its properties on another — so the two SectorUse blocks below (with disjoint
// sectors/access/consumes/produces) exercise that identity. Do NOT `--update` to make a
// red test green — that would launder an RDF-output change.

import { describe, expect, it } from "vitest";
import type { AppRegistration } from "../src/index.js";
import { selfDescribe } from "../src/index.js";

const APP: AppRegistration = {
  id: "https://app.example/clientid",
  sectors: ["https://w3id.org/jeswr/sectors/identity"],
  access: ["Read", "Write"],
  consumes: ["https://w3id.org/jeswr/sectors/identity#Profile"],
  produces: ["https://w3id.org/jeswr/sectors/identity#Profile"],
  declaresShape: ["https://app.example/shapes/Profile#shape"],
  sectorUse: [
    {
      sector: "https://w3id.org/jeswr/sectors/health",
      access: ["Read"],
      consumes: ["https://w3id.org/jeswr/sectors/health#Observation"],
    },
    {
      sector: "https://w3id.org/jeswr/sectors/finance",
      access: ["Write"],
      produces: ["https://w3id.org/jeswr/sectors/finance#Ledger"],
    },
  ],
};

/**
 * Canonicalise N-Triples while PRESERVING blank-node identity: relabel each distinct
 * raw `_:label` to a stable `_:bN` in order of first appearance (across the unsorted
 * lines), then sort. So a triple that hangs a property off the WRONG blank node shows
 * up as a different canonical string than the expected one.
 */
function canonicalNTriples(nt: string): string[] {
  const labels = new Map<string, string>();
  const relabel = (raw: string): string => {
    let mapped = labels.get(raw);
    if (mapped === undefined) {
      mapped = `_:b${labels.size}`;
      labels.set(raw, mapped);
    }
    return mapped;
  };
  return nt
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => l.replace(/_:[A-Za-z0-9-]+/g, (m) => relabel(m)))
    .sort();
}

// Pinned as the EXACT canonical output of the pre-refactor code, blank nodes relabelled
// in first-appearance order (the column is the observed verdict — see the file header
// on not laundering snapshot changes). `_:b0` = the health SectorUse, `_:b1` = finance.
const EXPECTED: readonly string[] = [
  "<https://app.example/clientid> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://w3id.org/jeswr/fed#App> .",
  "<https://app.example/clientid> <https://w3id.org/jeswr/fed#access> <http://www.w3.org/ns/auth/acl#Read> .",
  "<https://app.example/clientid> <https://w3id.org/jeswr/fed#access> <http://www.w3.org/ns/auth/acl#Write> .",
  "<https://app.example/clientid> <https://w3id.org/jeswr/fed#consumes> <https://w3id.org/jeswr/sectors/identity#Profile> .",
  "<https://app.example/clientid> <https://w3id.org/jeswr/fed#declaresShape> <https://app.example/shapes/Profile#shape> .",
  "<https://app.example/clientid> <https://w3id.org/jeswr/fed#produces> <https://w3id.org/jeswr/sectors/identity#Profile> .",
  "<https://app.example/clientid> <https://w3id.org/jeswr/fed#sector> <https://w3id.org/jeswr/sectors/identity> .",
  "<https://app.example/clientid> <https://w3id.org/jeswr/fed#sectorUse> _:b0 .",
  "<https://app.example/clientid> <https://w3id.org/jeswr/fed#sectorUse> _:b1 .",
  "_:b0 <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://w3id.org/jeswr/fed#SectorUse> .",
  "_:b0 <https://w3id.org/jeswr/fed#access> <http://www.w3.org/ns/auth/acl#Read> .",
  "_:b0 <https://w3id.org/jeswr/fed#consumes> <https://w3id.org/jeswr/sectors/health#Observation> .",
  "_:b0 <https://w3id.org/jeswr/fed#sector> <https://w3id.org/jeswr/sectors/health> .",
  "_:b1 <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://w3id.org/jeswr/fed#SectorUse> .",
  "_:b1 <https://w3id.org/jeswr/fed#access> <http://www.w3.org/ns/auth/acl#Write> .",
  "_:b1 <https://w3id.org/jeswr/fed#produces> <https://w3id.org/jeswr/sectors/finance#Ledger> .",
  "_:b1 <https://w3id.org/jeswr/fed#sector> <https://w3id.org/jeswr/sectors/finance> .",
];

describe("selfDescribe — RDF emission characterization (golden master)", () => {
  it("emits exactly the pinned canonical N-Triples (blank-node identity preserved)", async () => {
    const nt = await selfDescribe(APP).toString("application/n-triples");
    expect(canonicalNTriples(nt)).toEqual([...EXPECTED]);
  });
});
