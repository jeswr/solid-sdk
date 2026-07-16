// AUTHORED-BY GPT-5.6 Sol via codex

import type { BlankNode, DatasetCore, Literal, NamedNode, Quad, Term } from "@rdfjs/types";
import { DataFactory, Store, Writer } from "n3";
import { compareTerms, hasTarget, type ParsedNodeShape, parseNodeShapes } from "./constraints.js";
import {
  generatePatternWithLength,
  MAX_PATTERN_MATCH_INPUT,
  MAX_PATTERN_OUTPUT,
  validatePatternSyntax,
} from "./pattern.js";
import { coordinateStream } from "./prng.js";
import type {
  GeneratedInstance,
  PropertyConstraints,
  ShapeOverride,
  SyntheticRdfResult,
  SyntheticRdfUncheckedOptions,
  TurtleOptions,
} from "./types.js";
import { DEFAULT_PREFIXES, RDF, RDFS, XSD } from "./vocab.js";

const { blankNode, literal, namedNode, quad } = DataFactory;
const DEFAULT_BASE = "urn:synthetic:";
const DEFAULT_MAX_DEPTH = 3;
const MAX_TARGET_COUNT = 1_024;
const STRING_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const ABSOLUTE_IRI = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const IRIREF_PUNCTUATION = /[<>"{}|^`\\]/;
const INTEGER_DATATYPES = new Set<string>([
  XSD.integer.value,
  XSD.byte.value,
  XSD.int.value,
  XSD.long.value,
  XSD.short.value,
  XSD.unsignedLong.value,
  XSD.unsignedInt.value,
  XSD.unsignedShort.value,
  XSD.unsignedByte.value,
  XSD.positiveInteger.value,
  XSD.nonNegativeInteger.value,
  XSD.negativeInteger.value,
  XSD.nonPositiveInteger.value,
]);
const DECIMAL_DATATYPES = new Set<string>([XSD.decimal.value, XSD.double.value, XSD.float.value]);
const INTEGER_RANGES = new Map<string, readonly [number, number]>([
  [XSD.integer.value, [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]],
  [XSD.long.value, [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]],
  [XSD.int.value, [-2_147_483_648, 2_147_483_647]],
  [XSD.short.value, [-32_768, 32_767]],
  [XSD.byte.value, [-128, 127]],
  [XSD.unsignedLong.value, [0, Number.MAX_SAFE_INTEGER]],
  [XSD.unsignedInt.value, [0, 4_294_967_295]],
  [XSD.unsignedShort.value, [0, 65_535]],
  [XSD.unsignedByte.value, [0, 255]],
  [XSD.positiveInteger.value, [1, Number.MAX_SAFE_INTEGER]],
  [XSD.nonNegativeInteger.value, [0, Number.MAX_SAFE_INTEGER]],
  [XSD.negativeInteger.value, [-Number.MAX_SAFE_INTEGER, -1]],
  [XSD.nonPositiveInteger.value, [-Number.MAX_SAFE_INTEGER, 0]],
]);
const INTEGER_VALUE_RANGES = new Map<string, readonly [bigint, bigint]>([
  [XSD.long.value, [-9_223_372_036_854_775_808n, 9_223_372_036_854_775_807n]],
  [XSD.int.value, [-2_147_483_648n, 2_147_483_647n]],
  [XSD.short.value, [-32_768n, 32_767n]],
  [XSD.byte.value, [-128n, 127n]],
  [XSD.unsignedLong.value, [0n, 18_446_744_073_709_551_615n]],
  [XSD.unsignedInt.value, [0n, 4_294_967_295n]],
  [XSD.unsignedShort.value, [0n, 65_535n]],
  [XSD.unsignedByte.value, [0n, 255n]],
]);

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface Allocation {
  shape: ParsedNodeShape;
  index: number;
  focus: NamedNode;
  automaticTargetClasses: readonly NamedNode[];
  override?: ShapeOverride;
}

interface RootState {
  quads: Quad[];
}

interface GenerationState {
  options: SyntheticRdfUncheckedOptions;
  shapes: Map<string, ParsedNodeShape>;
  allocations: Allocation[];
  byShape: Map<string, Allocation[]>;
  byClass: Map<string, Allocation[]>;
  dataset: Store;
  blankIds: Set<string>;
  base: string;
  maxDepth: number;
}

function superClasses(state: GenerationState, initial: NamedNode): NamedNode[] {
  const result: NamedNode[] = [];
  const queue = [initial];
  const visited = new Set<string>();
  const datasets = [
    state.dataset,
    ...(state.options.ontology === undefined ? [] : [state.options.ontology]),
  ];
  while (queue.length > 0) {
    const current = queue.shift() as NamedNode;
    if (visited.has(current.value)) continue;
    visited.add(current.value);
    result.push(current);
    for (const dataset of datasets) {
      for (const value of dataset.match(current as never, RDFS.subClassOf as never, null, null)) {
        if (value.object.termType === "NamedNode") {
          queue.push(value.object as unknown as NamedNode);
        }
      }
    }
  }
  return result;
}

function termHasClass(state: GenerationState, value: Term, requiredClass: NamedNode): boolean {
  if (value.termType !== "NamedNode" && value.termType !== "BlankNode") return false;
  const datasets = [
    state.dataset,
    ...(state.options.ontology === undefined ? [] : [state.options.ontology]),
  ];
  for (const dataset of datasets) {
    for (const type of dataset.match(value as never, RDF.type as never, null, null)) {
      if (
        type.object.termType === "NamedNode" &&
        superClasses(state, type.object as unknown as NamedNode).some((candidate) =>
          candidate.equals(requiredClass),
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function slug(shapeIri: string): string {
  const candidate = shapeIri.split(/[/#:]/).filter(Boolean).at(-1) ?? "instance";
  const withoutShape = candidate.replace(/Shape$/i, "");
  const normalized = withoutShape
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return normalized || "instance";
}

function iriHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function defaultMintIri(shape: NamedNode, index: number, base: string): NamedNode {
  return namedNode(`${base}${slug(shape.value)}-${iriHash(shape.value)}/${index}`);
}

function isSafeAbsoluteIri(value: string): boolean {
  return (
    ABSOLUTE_IRI.test(value) &&
    !IRIREF_PUNCTUATION.test(value) &&
    ![...value].some((character) => (character.codePointAt(0) ?? 0) <= 0x20)
  );
}

function quadKey(value: Quad): string {
  const key = (term: Term): string => {
    if (term.termType === "Literal") {
      return `L:${term.value}:${term.language}:${term.datatype.value}`;
    }
    return `${term.termType}:${term.value}`;
  };
  return [key(value.subject), key(value.predicate), key(value.object), key(value.graph)].join(
    "\u0000",
  );
}

function sortedQuads(dataset: DatasetCore): Quad[] {
  return [...dataset].sort((left, right) => compareStrings(quadKey(left), quadKey(right)));
}

function canonicalTurtle(dataset: DatasetCore, options?: TurtleOptions): string {
  const suppliedPrefixes = Object.entries(options?.prefixes ?? {}).sort(([left], [right]) =>
    compareStrings(left, right),
  );
  const prefixes = Object.fromEntries([
    ...Object.entries(DEFAULT_PREFIXES),
    ...suppliedPrefixes.filter(([key]) => !(key in DEFAULT_PREFIXES)),
  ]);
  let output: string | undefined;
  let failure: Error | undefined;
  const writer = new Writer({
    format: "text/turtle",
    prefixes,
    ...(options?.baseIri === undefined ? {} : { baseIRI: options.baseIri }),
  });
  writer.addQuads(sortedQuads(dataset));
  writer.end((error, result) => {
    if (error) failure = error;
    else output = result;
  });
  if (failure !== undefined) throw failure;
  if (output === undefined) {
    throw new Error("n3.Writer did not complete synchronously; cannot satisfy toTurtle() contract");
  }
  return output;
}

function termsEqual(left: Term, right: Term): boolean {
  return left.equals(right);
}

function asTerms(value: Term | readonly Term[]): readonly Term[] {
  return Array.isArray(value) ? value : [value as Term];
}

function uniqueTerms(values: readonly Term[]): Term[] {
  return values.filter(
    (value, index) => values.findIndex((candidate) => termsEqual(candidate, value)) === index,
  );
}

function pickWithoutReplacement(
  state: GenerationState,
  shape: ParsedNodeShape,
  allocation: Allocation,
  coordinatePath: string,
  candidates: readonly Term[],
  count: number,
  strategy: string,
  occurrenceOffset = 0,
): Term[] {
  const remaining = uniqueTerms(candidates);
  if (count > remaining.length) {
    throw new Error(
      `${strategy} on ${coordinatePath} has ${remaining.length} distinct value(s), fewer than required cardinality ${count}`,
    );
  }
  const selected: Term[] = [];
  for (let occurrence = 0; occurrence < count; occurrence += 1) {
    const value = coordinateStream(
      state.options.seed,
      shape.term.value,
      allocation.index,
      coordinatePath,
      occurrence + occurrenceOffset,
    ).pick(remaining);
    selected.push(value);
    remaining.splice(
      remaining.findIndex((candidate) => termsEqual(candidate, value)),
      1,
    );
  }
  return selected;
}

function shapeOverrideKey(shape: string, index: number): string {
  return `${shape}\u0000${index}`;
}

function validateOverrideCoordinates(
  options: SyntheticRdfUncheckedOptions,
  shapes: Map<string, ParsedNodeShape>,
): Map<string, ShapeOverride> {
  const overrides = new Map<string, ShapeOverride>();
  for (const override of options.overrides ?? []) {
    const index = override.index ?? 0;
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new Error(`Override index for ${override.shape.value} must be a non-negative integer`);
    }
    const shape = shapes.get(override.shape.value);
    if (shape === undefined)
      throw new Error(`Override names unknown shape ${override.shape.value}`);
    const allowedPaths = new Set(shape.properties.map((property) => property.path.value));
    for (const path of Object.keys(override.values ?? {})) {
      if (!allowedPaths.has(path)) {
        throw new Error(`Override names out-of-shape property ${path} on ${override.shape.value}`);
      }
    }
    const key = shapeOverrideKey(override.shape.value, index);
    if (overrides.has(key))
      throw new Error(`Duplicate override for ${override.shape.value}[${index}]`);
    overrides.set(key, override);
  }
  return overrides;
}

function resolveFocus(
  shape: ParsedNodeShape,
  index: number,
  override: ShapeOverride | undefined,
  options: SyntheticRdfUncheckedOptions,
  base: string,
): NamedNode {
  const minted = (options.mintIri ?? defaultMintIri)(shape.term, index, base);
  if (minted.termType !== "NamedNode") {
    throw new Error(`mintIri must return a NamedNode for ${shape.term.value}[${index}]`);
  }
  if (!isSafeAbsoluteIri(minted.value)) {
    throw new Error(`mintIri must return a safe absolute IRI for ${shape.term.value}[${index}]`);
  }
  if (override?.id === undefined) return minted;
  if ("fragment" in override.id) {
    if (minted.value.includes("#")) {
      throw new Error(
        `mintIri must return a fragment-free IRI when using a {fragment} identity pin`,
      );
    }
    const fragment = override.id.fragment;
    const hasControlCharacter = [...fragment].some((character) => character.charCodeAt(0) <= 31);
    if (
      fragment.length === 0 ||
      /[\s#]/.test(fragment) ||
      hasControlCharacter ||
      IRIREF_PUNCTUATION.test(fragment)
    ) {
      throw new Error(`Invalid destination-relative identity fragment ${JSON.stringify(fragment)}`);
    }
    return namedNode(`${minted.value}#${fragment}`);
  }
  const external = override.id.external;
  if (!isSafeAbsoluteIri(external.value)) {
    throw new Error(`External identity pin is not a safe absolute IRI: ${external.value}`);
  }
  if (external.value.startsWith(base)) {
    throw new Error(`External identity pin may not use the placeholder base ${base}`);
  }
  if (!(options.allowedExternalIris ?? new Set()).has(external.value)) {
    throw new Error(
      `External identity pin is not exact-listed in allowedExternalIris: ${external.value}`,
    );
  }
  return external;
}

function allocate(state: GenerationState, overrides: Map<string, ShapeOverride>): void {
  const requested =
    state.options.targets === undefined
      ? [...state.shapes.values()]
          .filter((shape) => hasTarget(state.options.shapes, shape.term))
          .map((shape) => ({ shape: shape.term, count: 1 }))
      : [...state.options.targets];
  requested.sort((left, right) => compareTerms(left.shape, right.shape));
  const seenTargets = new Set<string>();
  const seenFocuses = new Set<string>();
  for (const target of requested) {
    if (seenTargets.has(target.shape.value)) {
      throw new Error(`Duplicate target specification for ${target.shape.value}`);
    }
    seenTargets.add(target.shape.value);
    if (
      !Number.isSafeInteger(target.count) ||
      target.count < 0 ||
      target.count > MAX_TARGET_COUNT
    ) {
      throw new Error(
        `Target count for ${target.shape.value} must be a non-negative integer no greater than ${MAX_TARGET_COUNT}`,
      );
    }
    const shape = state.shapes.get(target.shape.value);
    if (shape === undefined)
      throw new Error(`Target names unknown node shape ${target.shape.value}`);
    for (let index = 0; index < target.count; index += 1) {
      const override = overrides.get(shapeOverrideKey(shape.term.value, index));
      const focus = resolveFocus(shape, index, override, state.options, state.base);
      if (seenFocuses.has(focus.value)) {
        throw new Error(
          `Multiple generated instances resolve to the same focus IRI ${focus.value}`,
        );
      }
      seenFocuses.add(focus.value);
      const allocation: Allocation = {
        shape,
        index,
        focus,
        automaticTargetClasses: [],
        ...(override === undefined ? {} : { override }),
      };
      const overriddenTypes = override?.values?.[RDF.type.value];
      if (overriddenTypes === undefined && shape.targetClasses.length > 0) {
        const typeProperty = shape.properties.find((property) => property.path.equals(RDF.type));
        const candidates = shape.targetClasses.filter((targetClass) => {
          if (typeProperty === undefined) return true;
          const required = uniqueTerms([...typeProperty.hasValue, targetClass]);
          return (
            valueConforms(targetClass, typeProperty) &&
            (typeProperty.maxCount === undefined || required.length <= typeProperty.maxCount)
          );
        });
        if (candidates.length === 0) {
          throw new Error(
            `No sh:targetClass on ${shape.term.value} satisfies its rdf:type property constraints`,
          );
        }
        allocation.automaticTargetClasses = [
          coordinateStream(state.options.seed, shape.term.value, index, RDF.type.value, "count")
            .fork("targetClass")
            .pick(candidates),
        ];
      }
      const assertedClasses =
        overriddenTypes === undefined
          ? allocation.automaticTargetClasses
          : asTerms(overriddenTypes).filter(
              (value): value is NamedNode => value.termType === "NamedNode",
            );
      state.allocations.push(allocation);
      const sameShape = state.byShape.get(shape.term.value) ?? [];
      sameShape.push(allocation);
      state.byShape.set(shape.term.value, sameShape);
      for (const targetClass of assertedClasses.flatMap((value) => superClasses(state, value))) {
        const sameClass = state.byClass.get(targetClass.value) ?? [];
        if (!sameClass.includes(allocation)) sameClass.push(allocation);
        state.byClass.set(targetClass.value, sameClass);
      }
    }
  }
  for (const key of overrides.keys()) {
    if (
      !state.allocations.some(
        (allocation) => shapeOverrideKey(allocation.shape.term.value, allocation.index) === key,
      )
    ) {
      const [shape, index] = key.split("\u0000");
      throw new Error(`Override names non-generated instance ${shape}[${index}]`);
    }
  }
}

function addQuad(state: GenerationState, root: RootState, value: Quad): void {
  state.dataset.add(value);
  if (!root.quads.some((existing) => existing.equals(value))) root.quads.push(value);
}

function makeQuad(subject: Term, predicate: NamedNode, object: Term): Quad {
  if (
    subject.termType === "Literal" ||
    subject.termType === "DefaultGraph" ||
    subject.termType === "Quad"
  ) {
    throw new Error(`Invalid generated RDF subject term ${subject.termType}`);
  }
  if (object.termType === "DefaultGraph" || object.termType === "Quad") {
    throw new Error(`Invalid generated RDF object term ${object.termType}`);
  }
  return quad(subject as never, predicate as never, object as never) as unknown as Quad;
}

function requestedCount(
  options: SyntheticRdfUncheckedOptions,
  shape: ParsedNodeShape,
  index: number,
  property: PropertyConstraints,
  coordinatePath: string = property.path.value,
): number {
  if (property.maxCount === 0) return 0;
  if (property.minCount === 0 && property.maxCount === undefined) return 1;
  const minimum = property.minCount;
  const maximum = Math.min(property.maxCount ?? minimum + 2, minimum + 2);
  return coordinateStream(options.seed, shape.term.value, index, coordinatePath, "count").int(
    minimum,
    maximum,
  );
}

function integerBounds(
  property: PropertyConstraints,
  defaults: readonly [number, number] = [0, 999],
  intrinsic: readonly [number, number] = [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
): [number, number] {
  const parse = (value: Literal | undefined): number | undefined => {
    if (value === undefined) return undefined;
    const parsed = Number(value.value);
    if (!Number.isFinite(parsed))
      throw new Error(`Non-finite numeric facet on ${property.path.value}`);
    return parsed;
  };
  const lowerInclusive = parse(property.minInclusive);
  const lowerExclusive = parse(property.minExclusive);
  const upperInclusive = parse(property.maxInclusive);
  const upperExclusive = parse(property.maxExclusive);
  const explicitLowers = [
    ...(lowerInclusive === undefined ? [] : [Math.ceil(lowerInclusive)]),
    ...(lowerExclusive === undefined ? [] : [Math.floor(lowerExclusive) + 1]),
  ];
  const explicitUppers = [
    ...(upperInclusive === undefined ? [] : [Math.floor(upperInclusive)]),
    ...(upperExclusive === undefined ? [] : [Math.ceil(upperExclusive) - 1]),
  ];
  const span = defaults[1] - defaults[0];
  let lower: number;
  let upper: number;
  if (explicitLowers.length > 0 && explicitUppers.length > 0) {
    lower = Math.max(intrinsic[0], ...explicitLowers);
    upper = Math.min(intrinsic[1], ...explicitUppers);
  } else if (explicitLowers.length > 0) {
    lower = Math.max(intrinsic[0], ...explicitLowers);
    upper = Math.min(intrinsic[1], lower + span);
  } else if (explicitUppers.length > 0) {
    upper = Math.min(intrinsic[1], ...explicitUppers);
    lower = Math.max(intrinsic[0], upper - span);
  } else {
    lower = Math.max(intrinsic[0], defaults[0]);
    upper = Math.min(intrinsic[1], defaults[1]);
  }
  if (!Number.isSafeInteger(lower) || !Number.isSafeInteger(upper) || lower > upper) {
    throw new Error(`Unsatisfiable or unsafe numeric bounds on ${property.path.value}`);
  }
  return [lower, upper];
}

function decimalPrecision(property: PropertyConstraints): number {
  let precision = 2;
  for (const facet of [
    property.minInclusive,
    property.minExclusive,
    property.maxInclusive,
    property.maxExclusive,
  ]) {
    if (facet === undefined) continue;
    const [mantissa = "", exponentText = "0"] = facet.value.toLowerCase().split("e");
    const fractionalDigits = mantissa.split(".")[1]?.length ?? 0;
    const exponent = Number(exponentText);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1_024) {
      throw new Error(`Unsafe numeric facet exponent on ${property.path.value}`);
    }
    precision = Math.max(precision, fractionalDigits - exponent);
  }
  if (precision > 6) {
    throw new Error(
      `Numeric facet precision above 6 places is unsupported on ${property.path.value}`,
    );
  }
  return Math.max(0, precision);
}

function scaledNumericLexical(value: string, precision: number, path: NamedNode): number {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value);
  if (match === null) throw new Error(`Invalid numeric facet ${value} on ${path.value}`);
  const sign = match[1] === "-" ? -1n : 1n;
  const integerDigits = match[2] ?? "0";
  const fractionalDigits = match[3] ?? match[4] ?? "";
  const exponent = Number(match[5] ?? "0");
  if (!Number.isSafeInteger(exponent)) {
    throw new Error(`Unsafe numeric facet exponent on ${path.value}`);
  }
  const shift = precision + exponent - fractionalDigits.length;
  if (shift < 0 || shift > 1_024) {
    throw new Error(`Numeric facet exceeds the supported exponent range on ${path.value}`);
  }
  const digits = BigInt(`${integerDigits}${fractionalDigits}` || "0");
  const scaled = sign * digits * 10n ** BigInt(shift);
  const result = Number(scaled);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`Unsatisfiable or unsafe numeric bounds on ${path.value}`);
  }
  return result;
}

function scaledDecimalBounds(property: PropertyConstraints, precision: number): [number, number] {
  const parse = (value: Literal | undefined): number | undefined =>
    value === undefined ? undefined : scaledNumericLexical(value.value, precision, property.path);
  const lowerInclusive = parse(property.minInclusive);
  const lowerExclusive = parse(property.minExclusive);
  const upperInclusive = parse(property.maxInclusive);
  const upperExclusive = parse(property.maxExclusive);
  const explicitLowers = [
    ...(lowerInclusive === undefined ? [] : [lowerInclusive]),
    ...(lowerExclusive === undefined ? [] : [lowerExclusive + 1]),
  ];
  const explicitUppers = [
    ...(upperInclusive === undefined ? [] : [upperInclusive]),
    ...(upperExclusive === undefined ? [] : [upperExclusive - 1]),
  ];
  const scale = 10 ** precision;
  const span = 999 * scale;
  let lower: number;
  let upper: number;
  if (explicitLowers.length > 0 && explicitUppers.length > 0) {
    lower = Math.max(...explicitLowers);
    upper = Math.min(...explicitUppers);
  } else if (explicitLowers.length > 0) {
    lower = Math.max(...explicitLowers);
    upper = lower + span;
  } else if (explicitUppers.length > 0) {
    upper = Math.min(...explicitUppers);
    lower = upper - span;
  } else {
    lower = 0;
    upper = span;
  }
  if (!Number.isSafeInteger(lower) || !Number.isSafeInteger(upper) || lower > upper) {
    throw new Error(`Unsatisfiable or unsafe numeric bounds on ${property.path.value}`);
  }
  return [lower, upper];
}

function scaledDecimalLexical(value: number, precision: number): string {
  if (precision === 0) return String(value);
  const sign = value < 0 ? "-" : "";
  const digits = String(Math.abs(value)).padStart(precision + 1, "0");
  return `${sign}${digits.slice(0, -precision)}.${digits.slice(-precision)}`;
}

function datatypeFor(property: PropertyConstraints): NamedNode | undefined {
  return (
    property.datatype ??
    property.minInclusive?.datatype ??
    property.minExclusive?.datatype ??
    property.maxInclusive?.datatype ??
    property.maxExclusive?.datatype
  );
}

function generatedScalar(
  state: GenerationState,
  allocation: Allocation,
  shape: ParsedNodeShape,
  property: PropertyConstraints,
  occurrence: number,
  coordinatePath: string,
  attempt = 0,
): Term {
  const occurrenceStream = coordinateStream(
    state.options.seed,
    shape.term.value,
    allocation.index,
    coordinatePath,
    occurrence,
  );
  const random = attempt === 0 ? occurrenceStream : occurrenceStream.fork(`retry:${attempt}`);
  const datatype = datatypeFor(property);
  if (property.pattern !== undefined && (datatype === undefined || datatype.equals(XSD.string))) {
    const lexical = generatePatternWithLength(
      property.pattern,
      random,
      property.minLength ?? 0,
      property.maxLength ?? MAX_PATTERN_OUTPUT,
    );
    return property.language === "en"
      ? literal(lexical, "en")
      : literal(lexical, property.datatype ?? XSD.string);
  }
  if (datatype !== undefined && INTEGER_DATATYPES.has(datatype.value)) {
    const intrinsic = INTEGER_RANGES.get(datatype.value);
    if (intrinsic === undefined) {
      throw new Error(`Missing intrinsic integer bounds for ${datatype.value}`);
    }
    const defaults: readonly [number, number] =
      datatype.equals(XSD.negativeInteger) || datatype.equals(XSD.nonPositiveInteger)
        ? [-999, datatype.equals(XSD.negativeInteger) ? -1 : 0]
        : [0, 999];
    const [minimum, maximum] = integerBounds(property, defaults, intrinsic);
    return literal(String(random.int(minimum, maximum)), datatype);
  }
  if (datatype !== undefined && DECIMAL_DATATYPES.has(datatype.value)) {
    const precision = decimalPrecision(property);
    const [minimum, maximum] = scaledDecimalBounds(property, precision);
    return literal(scaledDecimalLexical(random.int(minimum, maximum), precision), datatype);
  }
  if (datatype?.equals(XSD.boolean)) {
    return literal(random.pick(["false", "true"]), XSD.boolean);
  }
  if (datatype?.equals(XSD.date) || datatype?.equals(XSD.dateTime)) {
    if (state.options.now === undefined) {
      throw new Error(`Explicit now is required for temporal default ${property.path.value}`);
    }
    const anchor = state.options.now.getTime();
    if (!Number.isFinite(anchor)) throw new Error("Explicit now must be a valid Date");
    const offsetDays = random.int(-365, 365);
    const value = new Date(anchor + offsetDays * 86_400_000);
    return datatype.equals(XSD.date)
      ? literal(value.toISOString().slice(0, 10), XSD.date)
      : literal(value.toISOString(), XSD.dateTime);
  }
  if (datatype !== undefined && !datatype.equals(XSD.string)) {
    throw new Error(`Unsupported datatype default ${datatype.value} on ${property.path.value}`);
  }
  const minimum = property.minLength ?? (property.maxLength === undefined ? 3 : 0);
  const maximum = property.maxLength ?? Math.max(minimum, 12);
  if (maximum < minimum)
    throw new Error(`Unsatisfiable string length facets on ${property.path.value}`);
  const length = Math.min(maximum, Math.max(minimum, 8));
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += random.fork(`string:${index}`).pick([...STRING_ALPHABET]);
  }
  return property.language === "en" ? literal(value, "en") : literal(value, datatype ?? XSD.string);
}

function generateNested(
  state: GenerationState,
  allocation: Allocation,
  shape: ParsedNodeShape,
  property: PropertyConstraints,
  occurrence: number,
  coordinatePath: string,
  scope: string,
  depth: number,
  stack: readonly string[],
  root: RootState,
  allowPool = true,
): Term {
  const random = coordinateStream(
    state.options.seed,
    shape.term.value,
    allocation.index,
    coordinatePath,
    occurrence,
  );
  if (property.node !== undefined) {
    if (stack.includes(property.node.value)) {
      throw new Error(
        `Recursive sh:node cycle detected: ${[...stack, property.node.value].join(" -> ")}`,
      );
    }
    const pooled = allowPool ? state.byShape.get(property.node.value) : undefined;
    const conformingPooled = pooled?.filter((candidate) =>
      relationalValueConforms(state, candidate.focus, property, stack),
    );
    if (conformingPooled !== undefined && conformingPooled.length > 0) {
      return random.pick(conformingPooled).focus;
    }
    if (depth >= state.maxDepth) {
      throw new Error(`sh:node depth cap ${state.maxDepth} exceeded at ${property.path.value}`);
    }
    const nestedShape = state.shapes.get(property.node.value);
    if (nestedShape === undefined)
      throw new Error(`sh:node references unknown shape ${property.node.value}`);
    const blankCoordinate = [
      allocation.shape.term.value,
      String(allocation.index),
      coordinatePath,
      String(occurrence),
    ].join("\u0000");
    const blankId = `i${iriHash(`a\u0000${blankCoordinate}`)}${iriHash(`b\u0000${blankCoordinate}`)}`;
    if (state.blankIds.has(blankId)) {
      throw new Error(`Deterministic blank-node coordinate collision at ${coordinatePath}`);
    }
    state.blankIds.add(blankId);
    const focus = blankNode(blankId);
    const nestedScope = [scope, shape.term.value, property.path.value, String(occurrence)]
      .filter((part) => part.length > 0)
      .join("\u0000");
    generateNode(
      state,
      allocation,
      nestedShape,
      focus,
      depth + 1,
      [...stack, nestedShape.term.value],
      root,
      nestedScope,
    );
    if (property.class !== undefined)
      addQuad(state, root, makeQuad(focus, RDF.type, property.class));
    return focus;
  }
  if (property.class !== undefined) {
    const pooled = allowPool ? state.byClass.get(property.class.value) : undefined;
    if (pooled !== undefined && pooled.length > 0) {
      return random.pick(pooled).focus;
    }
    const blankCoordinate = [
      allocation.shape.term.value,
      String(allocation.index),
      coordinatePath,
      String(occurrence),
      property.class.value,
    ].join("\u0000");
    const blankId = `i${iriHash(`c\u0000${blankCoordinate}`)}${iriHash(`d\u0000${blankCoordinate}`)}`;
    if (state.blankIds.has(blankId)) {
      throw new Error(`Deterministic blank-node coordinate collision at ${coordinatePath}`);
    }
    state.blankIds.add(blankId);
    const focus = blankNode(blankId);
    addQuad(state, root, makeQuad(focus, RDF.type, property.class));
    return focus;
  }
  throw new Error("Internal nested-generation dispatch error");
}

function generateValues(
  state: GenerationState,
  allocation: Allocation,
  shape: ParsedNodeShape,
  focus: NamedNode | BlankNode,
  property: PropertyConstraints,
  scope: string,
  depth: number,
  stack: readonly string[],
  root: RootState,
): readonly Term[] {
  const coordinatePath =
    scope.length === 0 ? property.path.value : `${scope}\u0000${property.path.value}`;
  if (property.pattern !== undefined) {
    validatePatternSyntax(property.pattern);
  }
  const pinned = shape.term.equals(allocation.shape.term)
    ? allocation.override?.values?.[property.path.value]
    : undefined;
  const existingValues = uniqueTerms(valuesAt(state, focus, property.path));
  if (pinned !== undefined) return uniqueTerms(asTerms(pinned));
  const requiredValues = uniqueTerms([...existingValues, ...property.hasValue]);
  let count = Math.max(
    requestedCount(state.options, shape, allocation.index, property, coordinatePath),
    requiredValues.length,
  );
  if (property.uniqueLang && property.language === "en") {
    if (property.minCount > 1 || requiredValues.length > 1) {
      throw new Error(
        `sh:uniqueLang on ${property.path.value} cannot satisfy mandatory cardinality with only language "en"`,
      );
    }
    count = Math.min(count, 1);
  }
  const additionalCount = count - requiredValues.length;
  if (additionalCount === 0) return requiredValues;
  const minimumAdditional = Math.max(0, property.minCount - requiredValues.length);
  if (property.inSpecified) {
    if (property.in.length === 0) {
      if (minimumAdditional === 0) return requiredValues;
      throw new Error(
        `Cannot generate ${additionalCount} additional value(s) from empty sh:in on ${property.path.value}`,
      );
    }
    const candidates = property.in.filter(
      (value) =>
        valueConforms(value, property) &&
        relationalValueConforms(state, value, property, stack) &&
        !requiredValues.some((required) => termsEqual(required, value)),
    );
    const available = uniqueTerms(candidates).length;
    if (minimumAdditional > available) {
      throw new Error(
        `sh:in on ${property.path.value} has ${available} additional distinct value(s), fewer than required cardinality ${property.minCount}`,
      );
    }
    return [
      ...requiredValues,
      ...pickWithoutReplacement(
        state,
        shape,
        allocation,
        coordinatePath,
        candidates,
        Math.min(additionalCount, available),
        "sh:in",
        requiredValues.length,
      ),
    ];
  }
  if (property.node !== undefined || property.class !== undefined) {
    let candidates: Term[] = [];
    if (property.node !== undefined) {
      if (stack.includes(property.node.value)) {
        throw new Error(
          `Recursive sh:node cycle detected: ${[...stack, property.node.value].join(" -> ")}`,
        );
      }
      const pooled = state.byShape.get(property.node.value);
      if (pooled !== undefined && pooled.length > 0) {
        candidates = pooled
          .map((candidate) => candidate.focus)
          .filter(
            (candidate) =>
              !requiredValues.some((required) => termsEqual(required, candidate)) &&
              relationalValueConforms(state, candidate, property, stack),
          );
      }
    } else if (property.class !== undefined) {
      const pooled = state.byClass.get(property.class.value);
      if (pooled !== undefined && pooled.length > 0) {
        candidates = pooled
          .map((candidate) => candidate.focus)
          .filter(
            (candidate) => !requiredValues.some((required) => termsEqual(required, candidate)),
          );
      }
    }
    const uniqueCandidates = uniqueTerms(candidates);
    const selectedPooled = pickWithoutReplacement(
      state,
      shape,
      allocation,
      coordinatePath,
      uniqueCandidates,
      Math.min(additionalCount, uniqueCandidates.length),
      property.node === undefined ? "sh:class instance pool" : "sh:node instance pool",
      requiredValues.length,
    );
    const remainingCount = additionalCount - selectedPooled.length;
    return [
      ...requiredValues,
      ...selectedPooled,
      ...Array.from({ length: remainingCount }, (_, occurrence) =>
        generateNested(
          state,
          allocation,
          shape,
          property,
          occurrence + requiredValues.length + selectedPooled.length,
          coordinatePath,
          scope,
          depth,
          stack,
          root,
          false,
        ),
      ),
    ];
  }
  const hasDrivingFacets =
    property.minInclusive !== undefined ||
    property.maxInclusive !== undefined ||
    property.minExclusive !== undefined ||
    property.maxExclusive !== undefined ||
    property.minLength !== undefined ||
    property.maxLength !== undefined ||
    property.pattern !== undefined;
  if (!hasDrivingFacets) {
    for (const plugin of state.options.plugins ?? []) {
      const generated = plugin.generate({
        shape: shape.term,
        index: allocation.index,
        focus,
        property,
        random: coordinateStream(
          state.options.seed,
          shape.term.value,
          allocation.index,
          coordinatePath,
          0,
        ).fork("plugin"),
        ...(state.options.now === undefined ? {} : { now: state.options.now }),
        ...(state.options.ontology === undefined ? {} : { ontology: state.options.ontology }),
      });
      if (generated !== undefined) return uniqueTerms([...requiredValues, ...generated]);
    }
  }
  const values: Term[] = [...requiredValues];
  for (let occurrence = requiredValues.length; occurrence < count; occurrence += 1) {
    let generated: Term | undefined;
    for (let attempt = 0; attempt < 256; attempt += 1) {
      const candidate = generatedScalar(
        state,
        allocation,
        shape,
        property,
        occurrence,
        coordinatePath,
        attempt,
      );
      if (
        valueConforms(candidate, property) &&
        !values.some((value) => termsEqual(value, candidate))
      ) {
        generated = candidate;
        break;
      }
    }
    if (generated === undefined) {
      if (values.length >= property.minCount) break;
      throw new Error(
        `Could not generate ${count} distinct values for ${property.path.value} within the bounded retry budget`,
      );
    }
    values.push(generated);
  }
  return values;
}

function relationalValueConforms(
  state: GenerationState,
  value: Term,
  property: PropertyConstraints,
  stack: readonly string[],
): boolean {
  if (property.class !== undefined) {
    const generatedClassMember = state.byClass
      .get(property.class.value)
      ?.some((allocation) => termsEqual(allocation.focus, value));
    const assertedClassMember = termHasClass(state, value, property.class);
    if (!generatedClassMember && !assertedClassMember) return false;
  }
  if (property.node !== undefined) {
    if (
      (value.termType !== "NamedNode" && value.termType !== "BlankNode") ||
      stack.includes(property.node.value)
    ) {
      return false;
    }
    const generatedNode = state.byShape
      .get(property.node.value)
      ?.some((allocation) => termsEqual(allocation.focus, value));
    if (!generatedNode) {
      const nestedShape = state.shapes.get(property.node.value);
      if (nestedShape === undefined) return false;
      try {
        assertShapeConformance(state, value, nestedShape, [...stack, nestedShape.term.value]);
      } catch {
        return false;
      }
    }
  }
  return true;
}

function assertNumericFacets(term: Term, property: PropertyConstraints): void {
  const facets = [
    [property.minInclusive, (comparison: number) => comparison >= 0, "minInclusive"],
    [property.maxInclusive, (comparison: number) => comparison <= 0, "maxInclusive"],
    [property.minExclusive, (comparison: number) => comparison > 0, "minExclusive"],
    [property.maxExclusive, (comparison: number) => comparison < 0, "maxExclusive"],
  ] as const;
  for (const [facet, accepts, name] of facets) {
    if (facet === undefined) continue;
    const numericDatatype =
      term.termType === "Literal" &&
      (INTEGER_DATATYPES.has(term.datatype.value) || DECIMAL_DATATYPES.has(term.datatype.value));
    if (!numericDatatype || !accepts(compareExactNumeric(term.value, facet.value))) {
      throw new Error(`Value ${term.value} violates sh:${name} on ${property.path.value}`);
    }
  }
}

interface ExactNumeric {
  coefficient: bigint;
  scale: number;
}

function parseExactNumeric(value: string): ExactNumeric {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value);
  if (match === null) throw new Error(`Invalid numeric lexical value ${value}`);
  const integerDigits = match[2] ?? "0";
  const fractionalDigits = match[3] ?? match[4] ?? "";
  const exponent = Number(match[5] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1_024) {
    throw new Error(`Unsupported numeric exponent in ${value}`);
  }
  const coefficient = BigInt(`${integerDigits}${fractionalDigits}` || "0");
  return {
    coefficient: match[1] === "-" ? -coefficient : coefficient,
    scale: fractionalDigits.length - exponent,
  };
}

function compareExactNumeric(left: string, right: string): number {
  const leftExact = parseExactNumeric(left);
  const rightExact = parseExactNumeric(right);
  const commonScale = Math.max(leftExact.scale, rightExact.scale);
  const leftCoefficient = leftExact.coefficient * 10n ** BigInt(commonScale - leftExact.scale);
  const rightCoefficient = rightExact.coefficient * 10n ** BigInt(commonScale - rightExact.scale);
  return leftCoefficient < rightCoefficient ? -1 : leftCoefficient > rightCoefficient ? 1 : 0;
}

function validTimezone(value: string | undefined): boolean {
  if (value === undefined || value === "Z") return true;
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  return hour <= 14 && minute <= 59 && (hour < 14 || minute === 0);
}

function validCalendarDate(yearText: string, monthText: string, dayText: string): boolean {
  const year = BigInt(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}

function validXsdDate(value: string): boolean {
  const match = /^-?(\d{4,})-(\d{2})-(\d{2})(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  return (
    match !== null &&
    validCalendarDate(match[1] as string, match[2] as string, match[3] as string) &&
    validTimezone(match[4])
  );
}

function validXsdDateTime(value: string): boolean {
  const match =
    /^-?(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/.exec(
      value,
    );
  if (
    match === null ||
    !validCalendarDate(match[1] as string, match[2] as string, match[3] as string) ||
    !validTimezone(match[8])
  ) {
    return false;
  }
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour === 24) return minute === 0 && second === 0 && !/[1-9]/.test(match[7] ?? "");
  return hour <= 23 && minute <= 59 && second <= 59;
}

function assertSupportedDatatypeValue(value: Term, property: PropertyConstraints): void {
  if (value.termType !== "Literal") return;
  const datatype = value.datatype.value;
  if (INTEGER_DATATYPES.has(datatype)) {
    if (!/^[+-]?\d+$/.test(value.value)) {
      throw new Error(
        `Value ${value.value} is invalid for datatype ${datatype} on ${property.path.value}`,
      );
    }
    const parsed = BigInt(value.value);
    const intrinsic = INTEGER_VALUE_RANGES.get(datatype);
    const violatesDerivedRange =
      (datatype === XSD.positiveInteger.value && parsed <= 0n) ||
      (datatype === XSD.nonNegativeInteger.value && parsed < 0n) ||
      (datatype === XSD.negativeInteger.value && parsed >= 0n) ||
      (datatype === XSD.nonPositiveInteger.value && parsed > 0n);
    if (
      violatesDerivedRange ||
      (intrinsic !== undefined && (parsed < intrinsic[0] || parsed > intrinsic[1]))
    ) {
      throw new Error(
        `Value ${value.value} is invalid for datatype ${datatype} on ${property.path.value}`,
      );
    }
    return;
  }
  if (DECIMAL_DATATYPES.has(datatype)) {
    if (
      (datatype === XSD.float.value || datatype === XSD.double.value) &&
      /^(?:INF|-INF|NaN)$/.test(value.value)
    ) {
      return;
    }
    const lexical =
      datatype === XSD.decimal.value
        ? /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))$/
        : /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;
    if (
      !lexical.test(value.value) ||
      (datatype !== XSD.decimal.value && !Number.isFinite(Number(value.value)))
    ) {
      throw new Error(
        `Value ${value.value} is invalid for datatype ${datatype} on ${property.path.value}`,
      );
    }
    return;
  }
  if (datatype === XSD.boolean.value && !/^(?:true|false|0|1)$/.test(value.value)) {
    throw new Error(
      `Value ${value.value} is invalid for datatype ${datatype} on ${property.path.value}`,
    );
  }
  if (datatype === XSD.date.value && !validXsdDate(value.value)) {
    throw new Error(
      `Value ${value.value} is invalid for datatype ${datatype} on ${property.path.value}`,
    );
  }
  if (datatype === XSD.dateTime.value && !validXsdDateTime(value.value)) {
    throw new Error(
      `Value ${value.value} is invalid for datatype ${datatype} on ${property.path.value}`,
    );
  }
}

function assertValueConstraints(value: Term, property: PropertyConstraints): void {
  if (property.inSpecified && !property.in.some((allowed) => termsEqual(value, allowed))) {
    throw new Error(`Value ${value.value} violates sh:in on ${property.path.value}`);
  }
  if (
    property.datatype !== undefined &&
    (value.termType !== "Literal" || !value.datatype.equals(property.datatype))
  ) {
    throw new Error(`Value ${value.value} violates sh:datatype on ${property.path.value}`);
  }
  assertSupportedDatatypeValue(value, property);
  assertNumericFacets(value, property);
  if (property.minLength !== undefined && [...value.value].length < property.minLength) {
    throw new Error(`Value ${value.value} violates sh:minLength on ${property.path.value}`);
  }
  if (property.maxLength !== undefined && [...value.value].length > property.maxLength) {
    throw new Error(`Value ${value.value} violates sh:maxLength on ${property.path.value}`);
  }
  if (property.pattern !== undefined) {
    if ([...value.value].length > MAX_PATTERN_MATCH_INPUT) {
      throw new Error(
        `Value on ${property.path.value} exceeds the bounded SHACL pattern match input`,
      );
    }
    if (!new RegExp(property.pattern, "u").test(value.value)) {
      throw new Error(`Value ${value.value} violates sh:pattern on ${property.path.value}`);
    }
  }
  if (property.language === "en" && (value.termType !== "Literal" || value.language !== "en")) {
    throw new Error(`Value ${value.value} violates sh:languageIn on ${property.path.value}`);
  }
}

function valueConforms(value: Term, property: PropertyConstraints): boolean {
  try {
    assertValueConstraints(value, property);
    return true;
  } catch {
    return false;
  }
}

function assertConjunctiveConstraints(
  values: readonly Term[],
  property: PropertyConstraints,
): void {
  if (
    values.length < property.minCount ||
    (property.maxCount !== undefined && values.length > property.maxCount)
  ) {
    throw new Error(`Value count ${values.length} violates cardinality on ${property.path.value}`);
  }
  for (const expected of property.hasValue) {
    if (!values.some((value) => termsEqual(value, expected))) {
      throw new Error(`Values violate sh:hasValue on ${property.path.value}`);
    }
  }
  if (property.uniqueLang) {
    const languages = values
      .filter((value): value is Literal => value.termType === "Literal" && value.language !== "")
      .map((value) => value.language.toLowerCase());
    if (new Set(languages).size !== languages.length) {
      throw new Error(`Values violate sh:uniqueLang on ${property.path.value}`);
    }
  }
  for (const value of values) {
    assertValueConstraints(value, property);
  }
}

function generateNode(
  state: GenerationState,
  allocation: Allocation,
  shape: ParsedNodeShape,
  focus: NamedNode | BlankNode,
  depth: number,
  stack: readonly string[],
  root: RootState,
  scope: string,
): void {
  const allowedPaths = new Set(shape.properties.map((property) => property.path.value));
  const automaticTargetClasses = shape.term.equals(allocation.shape.term)
    ? allocation.automaticTargetClasses
    : [];
  if (
    shape.closed &&
    automaticTargetClasses.length > 0 &&
    !allowedPaths.has(RDF.type.value) &&
    !shape.ignoredProperties.some((property) => property.equals(RDF.type))
  ) {
    throw new Error(`Closed shape ${shape.term.value} must allow or ignore rdf:type`);
  }
  for (const targetClass of automaticTargetClasses) {
    addQuad(state, root, makeQuad(focus, RDF.type, targetClass));
  }
  for (const property of shape.properties) {
    const values = generateValues(
      state,
      allocation,
      shape,
      focus,
      property,
      scope,
      depth,
      stack,
      root,
    );
    assertConjunctiveConstraints(values, property);
    for (const value of values) addQuad(state, root, makeQuad(focus, property.path, value));
  }
}

function valuesAt(state: GenerationState, focus: NamedNode | BlankNode, path: NamedNode): Term[] {
  return [...state.dataset.match(focus as never, path as never, null, null)].map(
    (value) => value.object as unknown as Term,
  );
}

function assertShapeConformance(
  state: GenerationState,
  focus: NamedNode | BlankNode,
  shape: ParsedNodeShape,
  stack: readonly string[],
): void {
  if (shape.closed) {
    const allowedPaths = new Set(shape.properties.map((property) => property.path.value));
    for (const value of state.dataset.match(focus as never, null, null, null)) {
      const predicate = value.predicate as unknown as NamedNode;
      if (
        !allowedPaths.has(predicate.value) &&
        !shape.ignoredProperties.some((ignored) => ignored.equals(predicate))
      ) {
        throw new Error(`Predicate ${predicate.value} violates sh:closed on ${shape.term.value}`);
      }
    }
  }
  for (const property of shape.properties) {
    const values = valuesAt(state, focus, property.path);
    assertConjunctiveConstraints(values, property);
    for (const value of values) {
      if (property.class !== undefined && !termHasClass(state, value, property.class)) {
        throw new Error(`Value ${value.value} violates sh:class on ${property.path.value}`);
      }
      if (property.node === undefined) continue;
      if (value.termType !== "NamedNode" && value.termType !== "BlankNode") {
        throw new Error(`Value ${value.value} violates sh:node on ${property.path.value}`);
      }
      if (stack.includes(property.node.value)) {
        throw new Error(
          `Recursive sh:node cycle detected: ${[...stack, property.node.value].join(" -> ")}`,
        );
      }
      const nestedShape = state.shapes.get(property.node.value);
      if (nestedShape === undefined) {
        throw new Error(`sh:node references unknown shape ${property.node.value}`);
      }
      assertShapeConformance(state, value, nestedShape, [...stack, nestedShape.term.value]);
    }
  }
}

export function generateCore(options: SyntheticRdfUncheckedOptions): SyntheticRdfResult {
  if (options.seed.length === 0) throw new Error("seed must be a non-empty explicit string");
  const base = options.base ?? DEFAULT_BASE;
  if (!isSafeAbsoluteIri(base)) throw new Error(`base must be a safe absolute IRI: ${base}`);
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
    throw new Error("maxDepth must be a non-negative integer");
  }
  const shapes = parseNodeShapes(options.shapes);
  const state: GenerationState = {
    options,
    shapes,
    allocations: [],
    byShape: new Map(),
    byClass: new Map(),
    dataset: new Store(),
    blankIds: new Set(),
    base,
    maxDepth,
  };
  const overrides = validateOverrideCoordinates(options, shapes);
  allocate(state, overrides);
  const instances: GeneratedInstance[] = [];
  for (const allocation of state.allocations) {
    const root: RootState = { quads: [] };
    generateNode(
      state,
      allocation,
      allocation.shape,
      allocation.focus,
      0,
      [allocation.shape.term.value],
      root,
      "",
    );
    instances.push({
      shape: allocation.shape.term,
      index: allocation.index,
      focus: allocation.focus,
      quads: root.quads.sort((left, right) => compareStrings(quadKey(left), quadKey(right))),
    });
  }
  for (const allocation of state.allocations) {
    assertShapeConformance(state, allocation.focus, allocation.shape, [
      allocation.shape.term.value,
    ]);
  }
  return {
    dataset: state.dataset,
    instances,
    toTurtle: (turtleOptions) => canonicalTurtle(state.dataset, turtleOptions),
  };
}
