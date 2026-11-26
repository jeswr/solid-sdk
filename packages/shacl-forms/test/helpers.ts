// AUTHORED-BY Codex (GPT-6.1 Sol)
import { Parser, Store } from "n3";
import { compileForm } from "../src/index.js";
export const EX = "https://example.org/";
export const SHAPE = `${EX}Form`;
export const SUBJECT = `${EX}response#it`;
export const PREFIXES = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix dash: <http://datashapes.org/dash#> .
@prefix ex: <https://example.org/> .
`;
export const graph = (ttl: string): Store => new Store(new Parser().parse(PREFIXES + ttl));
export const form = (property: string, extra = "") =>
  compileForm(
    graph(`ex:Form a sh:NodeShape; sh:property [ sh:path ex:value; ${property} ]. ${extra}`),
    SHAPE,
  );
export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture value");
  return value;
}
