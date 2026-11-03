// AUTHORED-BY Codex GPT-6.1-Sol
import { safeHttpIri } from "@jeswr/rdf-serialize";
import { DataFactory as df, Store } from "n3";
import { dateTime, iri, NS, RdfNode, validCalendarDate } from "./rdf.js";

/** Temporal bound whose datatype records its precision (KG §2.3). */
export interface TemporalValue {
  value: string;
  datatype: "date" | "dateTime" | "gYearMonth" | "gYear";
}
interface Period {
  validFrom?: TemporalValue;
  validThrough?: TemporalValue;
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
