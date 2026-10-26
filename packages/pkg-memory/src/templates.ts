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
      template: "relationship";
      value: {
        id: string;
        person: string;
        roleName: string;
        startDate?: TemporalValue;
        endDate?: TemporalValue;
      };
    };

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
