// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { safeHttpIri } from "@jeswr/rdf-serialize";
import { DataFactory as df, Store } from "n3";
import { containsCardNumber } from "./cards.js";
import { UnsupportedLiteralCharacterError, UnsupportedLiteralLexicalFormError } from "./errors.js";
import { dateTime, iri, NS, normalizeLiteral, RdfNode, validCalendarDate } from "./rdf.js";

/** Temporal bound whose datatype records its precision (KG §2.3). */
export interface TemporalValue {
  value: string;
  datatype: "date" | "dateTime" | "gYearMonth" | "gYear";
}
interface Period {
  validFrom?: TemporalValue;
  validThrough?: TemporalValue;
}

/** Clinical event time, retaining day or date-time precision. */
export type HealthTemporalValue = TemporalValue & { datatype: "date" | "dateTime" };

/** A clinical concept: the health profile requires its code, not just its identifier. */
export interface HealthCode {
  id: string;
  code: string;
  /** Coding-system entity IRI. */
  system: string;
  display?: string;
}

/** A measurement or lab result about the owner. */
export interface ObservationValue {
  id: string;
  code: HealthCode;
  value: number | string | { decimal: string };
  unitCode?: string;
  effective: HealthTemporalValue;
  /** Optional source category, represented with schema:category. */
  kind?: "measurement" | "lab";
}

/** A vaccination record referencing the administered medicinal product. */
export interface ImmunizationValue {
  id: string;
  /** A product may be uncoded; supplied coding requires both code and system. */
  vaccine: { id: string; display?: string } & (
    | { code?: never; system?: never }
    | { code: string; system: string }
  );
  occurrence: HealthTemporalValue;
}

/** A clinical encounter, with an optionally open-ended occurrence interval. */
export interface EncounterValue {
  id: string;
  period: { start: HealthTemporalValue; end?: HealthTemporalValue };
  serviceProvider?: string;
}

/** Supported structured memory facts; identifiers are caller-controlled entity IRIs. */
export type Fact =
  | { template: "email" | "phone"; value: string }
  | {
      template: "address";
      value: Period & {
        id: string;
        locality: string;
        country: string;
        street?: string;
        postalCode?: string;
        home?: boolean;
      };
    }
  | { template: "preference"; value: { propertyID: string; value: string } }
  | {
      template: "condition";
      value: Period & {
        id: string;
        name: string;
        code?: { id: string; value: string; exactMatch?: string };
      };
    }
  | { template: "allergy"; value: Period & { id: string; name: string } }
  | {
      template: "medication";
      value: Period & {
        id: string;
        medication: { id: string; name: string; atcCode?: string };
        dose?: { value: string; unit: string; frequency?: string };
      };
    }
  | { template: "observation"; value: ObservationValue }
  | { template: "immunization"; value: ImmunizationValue }
  | { template: "encounter"; value: EncounterValue }
  | {
      /**
       * A payment card on file, without its number: brand, last four digits, expiry month and
       * an optional billing-address entity. There is deliberately no field for a full card
       * number (PAN) or security code, and the card node is a blank node, so no caller-chosen
       * identifier can carry one.
       */
      template: "paymentCard";
      value: {
        brand: PaymentCardBrand;
        last4: string;
        /** Expiry month, as `gYearMonth` (for example `2027-09`). */
        expires: TemporalValue;
        /** Billing-address entity IRI: no query or fragment, at most four digits in all. */
        billingAddress?: string;
      };
    }
  | {
      template: "relationship";
      value: {
        id: string;
        person: string;
        roleName: string;
        startDate?: TemporalValue;
        endDate?: TemporalValue;
      };
    };

/** Card networks a payment-card fact may name. */
export const PAYMENT_CARD_BRANDS = Object.freeze([
  "visa",
  "mastercard",
  "amex",
  "discover",
  "diners",
  "jcb",
  "unionpay",
  "maestro",
  "other",
] as const);
/** A card network name from {@link PAYMENT_CARD_BRANDS}. */
export type PaymentCardBrand = (typeof PAYMENT_CARD_BRANDS)[number];
/** Private copy, so validation never depends on the exported array. */
const CARD_BRANDS: ReadonlySet<string> = new Set(PAYMENT_CARD_BRANDS);
const CARD_KEYS = new Set(["brand", "last4", "expires", "billingAddress"]);

interface PaymentCardSnapshot {
  brand: PaymentCardBrand;
  last4: string;
  expires: { value: string; datatype: "gYearMonth" };
  billingAddress: string | undefined;
}

/** An own property's value; inherited (possibly polluted) properties read as absent. */
function own(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * Read each field exactly once into a plain snapshot and check that, so a getter or proxy
 * cannot pass validation and then return a card number when the RDF is written.
 */
function paymentCardSnapshot(value: unknown): PaymentCardSnapshot | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const card = value as Record<string, unknown>;
  if (Object.keys(card).some((key) => !CARD_KEYS.has(key))) return undefined;
  const brand = own(card, "brand");
  const last4 = own(card, "last4");
  const expires = own(card, "expires");
  const billingAddress = own(card, "billingAddress");
  if (typeof brand !== "string" || !CARD_BRANDS.has(brand)) return undefined;
  if (typeof last4 !== "string" || !/^[0-9]{4}$/.test(last4)) return undefined;
  if (typeof expires !== "object" || expires === null) return undefined;
  const bound = expires as Record<string, unknown>;
  if (Object.keys(bound).some((key) => key !== "value" && key !== "datatype")) return undefined;
  const month = own(bound, "value");
  const datatype = own(bound, "datatype");
  if (datatype !== "gYearMonth" || typeof month !== "string" || !/^\d{4}-\d\d$/.test(month))
    return undefined;
  if (billingAddress !== undefined && !safeBillingAddress(billingAddress)) return undefined;
  return {
    brand: brand as PaymentCardBrand,
    last4,
    expires: { value: month, datatype },
    // Always an own property, so an absent address can never come from a polluted prototype.
    billingAddress: billingAddress as string | undefined,
  };
}

/**
 * A billing-address IRI may not hide card data: no query or fragment, and at most four digits
 * in all (any Unicode number form) once percent-decoded and NFKC-normalised. That leaves room
 * for a house or flat number, not a useful share of a card number.
 */
function safeBillingAddress(value: unknown): boolean {
  if (typeof value !== "string" || /[?#]/.test(value)) return false;
  let text = value;
  for (let round = 0; round < 4; round += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(text);
    } catch {
      return false;
    }
    if (decoded === text) break;
    text = decoded;
  }
  if (/[%?#]/.test(text)) return false;
  return (text.normalize("NFKC").match(/\p{N}/gu)?.length ?? 0) <= 4;
}

/** Each reader owns its refusal message and the distinct identifiers of one fact. */
class HealthInput {
  private readonly identifiers: Set<string>;

  constructor(
    private readonly template: "observation" | "immunization" | "encounter",
    owner: string,
  ) {
    this.identifiers = new Set();
    this.iri(owner);
  }

  invalid(): never {
    throw new Error(`Invalid ${this.template}`);
  }

  /** Only caller property access is caught: getters/proxies must not leak their errors. */
  own(value: object, key: string): unknown {
    try {
      return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
    } catch {
      return this.invalid();
    }
  }

  /** Read own fields once; also reject unknown non-enumerable and symbol keys. */
  snapshot(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (typeof value !== "object" || value === null) return this.invalid();
    let ownKeys: PropertyKey[];
    try {
      ownKeys = Reflect.ownKeys(value);
    } catch {
      return this.invalid();
    }
    if (ownKeys.some((key) => !keys.includes(key as string))) return this.invalid();
    return Object.fromEntries(keys.map((key) => [key, this.own(value, key)]));
  }

  iri(value: unknown, clinicalCode = false): string {
    const identifier = safeHttpIri(value);
    if (identifier === undefined || identifier !== value) return this.invalid();
    if (clinicalCode && snomedIri(identifier)) return this.distinct(identifier);
    let text = identifier.normalize("NFKC");
    for (let round = 0; round < 4; round += 1) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(text).normalize("NFKC");
      } catch {
        return this.invalid();
      }
      if (decoded === text) break;
      text = decoded;
    }
    // Residual escapes can hide another decoding layer; refuse instead of storing it.
    if (text.includes("%") || containsCardNumber(text)) return this.invalid();
    return this.distinct(identifier);
  }

  private distinct(identifier: string): string {
    if (this.identifiers.has(identifier)) return this.invalid();
    this.identifiers.add(identifier);
    return identifier;
  }

  literal(value: unknown, datatype: "string" | "decimal"): string {
    if (typeof value !== "string" || containsCardNumber(value)) return this.invalid();
    try {
      return normalizeLiteral(df.literal(value, df.namedNode(NS.xsd + datatype))).value;
    } catch (error) {
      if (
        error instanceof UnsupportedLiteralCharacterError ||
        error instanceof UnsupportedLiteralLexicalFormError
      )
        return this.invalid();
      throw error;
    }
  }

  optionalText(value: unknown): string | undefined {
    return value === undefined ? undefined : this.literal(value, "string");
  }

  temporal(value: unknown): HealthTemporalValue {
    const bound = this.snapshot(value, ["value", "datatype"]);
    const text = bound.value;
    const datatype = bound.datatype;
    if (
      typeof text !== "string" ||
      (datatype !== "date" && datatype !== "dateTime") ||
      text.startsWith("0000")
    )
      return this.invalid();
    if (datatype === "date") {
      const match = /^(\d{4})-(\d\d)-(\d\d)(?![\s\S])/.exec(text);
      if (!match || !validCalendarDate(Number(match[1]), Number(match[2]), Number(match[3])))
        return this.invalid();
      return { value: text, datatype };
    }
    try {
      return { value: dateTime(text), datatype };
    } catch (error) {
      if (error instanceof Error && error.message === "Invalid dateTime") return this.invalid();
      throw error;
    }
  }

  code(value: unknown): ImmunizationValue["vaccine"] {
    const code = this.snapshot(value, ["id", "system", "code", "display"]);
    const display = this.optionalText(code.display);
    if (code.code === undefined && code.system === undefined)
      return { id: this.iri(code.id), display };
    const system = this.iri(code.system);
    const snomed = system.startsWith(SNOMED_PREFIX);
    const id = this.iri(code.id, snomed);
    const codeId =
      typeof code.code === "string"
        ? sctid(code.code)
          ? code.code
          : snomedIri(code.code)
        : undefined;
    const iriId = snomedIri(id);
    // A SNOMED concept IRI and its supplied code must identify the same concept.
    if (id.startsWith(NS.sct) && (iriId === undefined || iriId !== codeId)) return this.invalid();
    // Only checksum-valid concept identifiers receive the clinical-code exemption.
    if (snomed) {
      if (codeId === undefined) return this.invalid();
      return { id, display, code: code.code as string, system };
    }
    return { id, display, code: this.literal(code.code, "string"), system };
  }

  requiredCode(value: unknown): HealthCode {
    const code = this.code(value);
    if (code.code === undefined) return this.invalid();
    return code;
  }

  measurement(value: unknown): { value: string; datatype: "string" | "decimal" } {
    if (typeof value === "string")
      return { value: this.literal(value, "string"), datatype: "string" };
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return this.invalid();
      return { value: this.literal(healthDecimal(value), "decimal"), datatype: "decimal" };
    }
    const decimal = this.snapshot(value, ["decimal"]);
    return { value: this.literal(decimal.decimal, "decimal"), datatype: "decimal" };
  }
}

function observationSnapshot(fact: Fact, owner: string) {
  const input = new HealthInput("observation", owner);
  const v = input.snapshot(input.own(fact, "value"), [
    "id",
    "code",
    "value",
    "unitCode",
    "effective",
    "kind",
  ]);
  if (v.kind !== undefined && v.kind !== "measurement" && v.kind !== "lab") return input.invalid();
  return {
    id: input.iri(v.id),
    code: input.requiredCode(v.code),
    value: input.measurement(v.value),
    unitCode: input.optionalText(v.unitCode),
    effective: input.temporal(v.effective),
    kind: v.kind,
  };
}

function immunizationSnapshot(fact: Fact, owner: string): ImmunizationValue {
  const input = new HealthInput("immunization", owner);
  const v = input.snapshot(input.own(fact, "value"), ["id", "vaccine", "occurrence"]);
  return {
    id: input.iri(v.id),
    vaccine: input.code(v.vaccine),
    occurrence: input.temporal(v.occurrence),
  };
}

/** Microseconds in UTC; a date-only end includes its entire calendar day. */
const MICROS_PER_HOUR = 3_600_000_000n;

/**
 * Earliest and latest instant (microseconds) a bound can denote. A date-only bound has no
 * timezone, so following XSD it may fall in any zone from -14:00 to +14:00.
 */
function healthTimeRange(value: HealthTemporalValue): [bigint, bigint] {
  if (value.datatype === "date") {
    const midnight = BigInt(Date.parse(`${value.value}T00:00:00Z`)) * 1000n;
    return [midnight - 14n * MICROS_PER_HOUR, midnight + 38n * MICROS_PER_HOUR - 1n];
  }
  const fraction = /\.(\d+)/.exec(value.value)?.[1] ?? "";
  const instant =
    BigInt(Date.parse(value.value)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3, 6));
  return [instant, instant];
}

const SNOMED_PREFIX = "http://snomed.info/";

/** Verhoeff check (ISO 7064-like dihedral scheme) used by SNOMED CT identifiers. */
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 8, 7, 6, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/**
 * A SNOMED CT concept identifier: 6-18 ASCII digits, no leading zero, partition 00
 * or 10, and a valid Verhoeff check digit. Extension concepts (10) also require
 * an item identifier and the seven-digit namespace, hence at least 11 digits.
 */
function sctid(text: string): boolean {
  if (!/^[1-9][0-9]{5,17}(?![\s\S])/.test(text)) return false;
  const partition = text.slice(-3, -1);
  if (partition !== "00" && (partition !== "10" || text.length < 11)) return false;
  let check = 0;
  for (let i = 0; i < text.length; i += 1) {
    const digit = text.charCodeAt(text.length - 1 - i) - 48;
    check = (VERHOEFF_D[check] as number[])[
      (VERHOEFF_P[i % 8] as number[])[digit] as number
    ] as number;
  }
  return check === 0;
}

/** `http://snomed.info/id/<sctid>`, exactly. */
function snomedIri(text: string): string | undefined {
  const match = /^http:\/\/snomed\.info\/id\/([0-9]+)(?![\s\S])/.exec(text);
  return match !== null && sctid(match[1] as string) ? match[1] : undefined;
}

function encounterSnapshot(fact: Fact, owner: string): EncounterValue {
  const input = new HealthInput("encounter", owner);
  const v = input.snapshot(input.own(fact, "value"), ["id", "period", "serviceProvider"]);
  const bounds = input.snapshot(v.period, ["start", "end"]);
  const start = input.temporal(bounds.start);
  const end = bounds.end === undefined ? undefined : input.temporal(bounds.end);
  // Dates share a calendar ordering. Widen only a date compared with a zoned date-time.
  if (
    end !== undefined &&
    (start.datatype === "date" && end.datatype === "date"
      ? end.value < start.value
      : healthTimeRange(end)[1] < healthTimeRange(start)[0])
  )
    return input.invalid();
  return {
    id: input.iri(v.id),
    period: { start, end },
    serviceProvider: v.serviceProvider === undefined ? undefined : input.iri(v.serviceProvider),
  };
}

/** Use the package's decimal literal guard, expanding JS's extreme-magnitude exponents. */
function healthDecimal(value: number): string {
  const text = Object.is(value, -0) ? "-0" : String(value);
  const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!match) return text;
  const [, sign, whole, fraction = "", exponent] = match;
  const digits = whole + fraction;
  const point = Number(exponent) + 1;
  // JS scientific notation occurs only below 1e-6 or at/above 1e21: the point
  // is always outside the significand, whose length is at most 17 digits.
  return sign + (point > 0 ? digits.padEnd(point, "0") : `0.${"0".repeat(-point)}${digits}`);
}

function writeHealthCode(concept: RdfNode, value: Omit<HealthCode, "id">): void {
  concept
    .link(`${NS.rdf}type`, `${NS.health}CodeableConcept`)
    .link(`${NS.rdf}type`, `${NS.core}Identifier`)
    .text(`${NS.core}value`, value.code);
  concept.link(`${NS.core}inScheme`, value.system);
  new RdfNode(value.system, concept.dataset).link(`${NS.rdf}type`, `${NS.core}IdentifierScheme`);
  if (value.display !== undefined) concept.text(`${NS.schema}name`, value.display);
}

function healthInstant(node: RdfNode, predicate: string, value: HealthTemporalValue): void {
  const instant = df.blankNode();
  node.add(predicate, instant);
  const time = new RdfNode(instant, node.dataset)
    .link(`${NS.rdf}type`, `${NS.time}Instant`)
    .link(`${NS.rdf}type`, `${NS.time}TemporalEntity`);
  time.text(
    NS.time + (value.datatype === "date" ? "inXSDDate" : "inXSDDateTime"),
    value.value,
    NS.xsd + value.datatype,
  );
}

function temporal(node: RdfNode, predicate: string, bound: TemporalValue): void {
  const patterns = {
    date: /^\d{4}-\d\d-\d\d$/,
    gYearMonth: /^\d{4}-\d\d$/,
    gYear: /^\d{4}$/,
    dateTime: /^[\s\S]+$/,
  };
  if (
    !Object.hasOwn(patterns, bound.datatype) ||
    patterns[bound.datatype].exec(bound.value)?.[0] !== bound.value
  )
    throw new Error("Invalid temporal bound");
  if (bound.datatype !== "dateTime") {
    const [year, month, day] = bound.value.split("-").map(Number);
    if (!validCalendarDate(year as number, month, day)) throw new Error("Invalid temporal bound");
  }
  node.text(
    predicate,
    bound.datatype === "dateTime" ? dateTime(bound.value, false) : bound.value,
    NS.xsd + bound.datatype,
  );
}
function period(node: RdfNode, value: Period): void {
  if (value.validFrom) temporal(node, `${NS.schema}validFrom`, value.validFrom);
  if (value.validThrough) temporal(node, `${NS.schema}validThrough`, value.validThrough);
}
/** Build a fact assertion using the vocabulary patterns from KG §2.2. */
export function createFactAssertion(about: string, fact: Fact): Store {
  const owner = safeHttpIri(about);
  if (owner === undefined) throw new Error("Expected owner WebID");
  let template: Fact["template"];
  try {
    template = fact.template;
  } catch {
    throw new Error("Invalid fact template");
  }
  if (template === "observation" || template === "immunization" || template === "encounter") {
    const input = new HealthInput(template, owner);
    try {
      if (!Object.hasOwn(fact, "template")) return input.invalid();
    } catch {
      return input.invalid();
    }
    // Dispatch and the health readers share this header snapshot, reading caller fields once.
    fact = { template, value: input.own(fact, "value") } as Fact;
  } else {
    const original = fact;
    fact = {
      template,
      get value() {
        return original.value;
      },
    } as Fact;
  }
  const store = new Store();
  const person = new RdfNode(owner, store);
  const type = `${NS.rdf}type`;
  switch (fact.template) {
    case "email":
    case "phone": {
      const scheme = fact.template === "email" ? "mailto:" : "tel:";
      const target = fact.value.startsWith(scheme) ? fact.value : scheme + fact.value;
      if (
        fact.template === "email"
          ? !/^mailto:[^@\s<>]+@[^@\s<>]+$/.test(target)
          : !/^tel:\+?[\d(). -]+$/.test(target)
      )
        throw new Error("Invalid contact point");
      person.link(NS.vcard + (fact.template === "email" ? "hasEmail" : "hasTelephone"), target);
      break;
    }
    case "address": {
      const v = fact.value;
      person.link(`${NS.vcard}hasAddress`, v.id);
      const address = new RdfNode(v.id, store).link(type, `${NS.vcard}Address`);
      if (v.home) address.link(type, `${NS.vcard}Home`);
      address.text(`${NS.vcard}locality`, v.locality).text(`${NS.vcard}country-name`, v.country);
      if (v.street !== undefined) address.text(`${NS.vcard}street-address`, v.street);
      if (v.postalCode !== undefined) address.text(`${NS.vcard}postal-code`, v.postalCode);
      period(address, v);
      break;
    }
    case "preference": {
      const property = df.blankNode();
      person.add(`${NS.schema}additionalProperty`, property);
      new RdfNode(property, store)
        .link(type, `${NS.schema}PropertyValue`)
        .text(`${NS.schema}propertyID`, fact.value.propertyID)
        .text(`${NS.schema}value`, fact.value.value);
      break;
    }
    case "condition":
    case "allergy": {
      const v = fact.value;
      const condition = new RdfNode(v.id, store)
        .link(
          type,
          fact.template === "condition" ? `${NS.health}Condition` : `${NS.fhir}AllergyIntolerance`,
        )
        .link(`${NS.health}patient`, owner)
        .text(`${NS.schema}name`, v.name);
      if (fact.template === "condition") {
        condition.link(type, `${NS.schema}MedicalCondition`);
        if (fact.value.code) {
          const code = fact.value.code;
          condition.link(`${NS.health}hasCode`, code.id);
          const concept = new RdfNode(code.id, store)
            .link(type, `${NS.health}CodeableConcept`)
            .text(`${NS.core}value`, code.value);
          if (code.exactMatch !== undefined) concept.link(`${NS.skos}exactMatch`, code.exactMatch);
        }
      }
      period(condition, v);
      break;
    }
    case "medication": {
      const v = fact.value;
      const statement = new RdfNode(v.id, store)
        .link(type, `${NS.health}MedicationStatement`)
        .link(`${NS.health}patient`, owner)
        .link(`${NS.health}medication`, v.medication.id);
      const product = new RdfNode(v.medication.id, store)
        .link(type, `${NS.health}MedicinalProduct`)
        .link(type, `${NS.schema}Drug`)
        .text(`${NS.schema}name`, v.medication.name);
      if (v.medication.atcCode !== undefined) {
        const code = df.blankNode();
        product.add(`${NS.schema}code`, code);
        new RdfNode(code, store)
          .link(type, `${NS.schema}MedicalCode`)
          .text(`${NS.schema}codeValue`, v.medication.atcCode)
          .text(`${NS.schema}codingSystem`, "ATC");
      }
      if (v.dose) {
        const dose = df.blankNode();
        statement.add(`${NS.schema}doseSchedule`, dose);
        const schedule = new RdfNode(dose, store)
          .link(type, `${NS.schema}DoseSchedule`)
          .text(`${NS.schema}doseValue`, v.dose.value, `${NS.xsd}decimal`)
          .text(`${NS.schema}doseUnit`, v.dose.unit);
        if (v.dose.frequency !== undefined)
          schedule.text(`${NS.schema}frequency`, v.dose.frequency);
      }
      period(statement, v);
      break;
    }
    case "observation": {
      const v = observationSnapshot(fact, owner);
      person.link(type, `${NS.core}Person`);
      const observation = new RdfNode(v.id, store)
        .link(type, `${NS.health}Observation`)
        .link(`${NS.health}patient`, owner)
        .link(`${NS.health}hasCode`, v.code.id)
        .text(`${NS.health}value`, v.value.value, NS.xsd + v.value.datatype);
      writeHealthCode(new RdfNode(v.code.id, store), v.code);
      if (v.unitCode !== undefined) observation.text(`${NS.health}unitCode`, v.unitCode);
      if (v.kind !== undefined) observation.text(`${NS.schema}category`, v.kind);
      healthInstant(observation, `${NS.health}effectiveTime`, v.effective);
      break;
    }
    case "immunization": {
      const v = immunizationSnapshot(fact, owner);
      person.link(type, `${NS.core}Person`);
      const immunization = new RdfNode(v.id, store)
        .link(type, `${NS.health}Immunization`)
        .link(`${NS.health}patient`, owner)
        .link(`${NS.health}medication`, v.vaccine.id);
      const vaccine = new RdfNode(v.vaccine.id, store).link(type, `${NS.health}MedicinalProduct`);
      if (v.vaccine.display !== undefined) vaccine.text(`${NS.schema}name`, v.vaccine.display);
      if (v.vaccine.code !== undefined) {
        const code = df.blankNode();
        vaccine.add(`${NS.core}identifiedBy`, code);
        writeHealthCode(new RdfNode(code, store), v.vaccine);
      }
      healthInstant(immunization, `${NS.core}atTime`, v.occurrence);
      break;
    }
    case "encounter": {
      const v = encounterSnapshot(fact, owner);
      person.link(type, `${NS.core}Person`);
      const encounter = new RdfNode(v.id, store)
        .link(type, `${NS.health}Encounter`)
        .link(`${NS.health}patient`, owner);
      const interval = df.blankNode();
      encounter.add(`${NS.core}atTime`, interval);
      const time = new RdfNode(interval, store)
        .link(type, `${NS.time}Interval`)
        .link(type, `${NS.time}TemporalEntity`);
      healthInstant(time, `${NS.time}hasBeginning`, v.period.start);
      if (v.period.end !== undefined) healthInstant(time, `${NS.time}hasEnd`, v.period.end);
      if (v.serviceProvider !== undefined)
        encounter.link(`${NS.health}careProvider`, v.serviceProvider);
      break;
    }
    case "paymentCard": {
      const v = paymentCardSnapshot(fact.value);
      if (!v) throw new Error("Invalid payment card");
      const node = df.blankNode();
      person.add(`${NS.schema}owns`, node);
      const card = new RdfNode(node, store)
        .link(type, `${NS.schema}PaymentCard`)
        .text(`${NS.schema}brand`, v.brand);
      const last4 = df.blankNode();
      card.add(`${NS.schema}identifier`, last4);
      new RdfNode(last4, store)
        .link(type, `${NS.schema}PropertyValue`)
        .text(`${NS.schema}propertyID`, "last4")
        .text(`${NS.schema}value`, v.last4);
      temporal(card, `${NS.schema}validThrough`, v.expires);
      if (v.billingAddress !== undefined) card.link(`${NS.schema}address`, v.billingAddress);
      break;
    }
    case "relationship": {
      const v = fact.value;
      person.link(`${NS.schema}knows`, v.id);
      const role = new RdfNode(v.id, store)
        .link(type, `${NS.schema}Role`)
        .text(`${NS.schema}roleName`, v.roleName)
        .link(`${NS.schema}knows`, iri(v.person));
      if (v.startDate) temporal(role, `${NS.schema}startDate`, v.startDate);
      if (v.endDate) temporal(role, `${NS.schema}endDate`, v.endDate);
      break;
    }
    default:
      throw new Error("Unknown fact template");
  }
  return store;
}
