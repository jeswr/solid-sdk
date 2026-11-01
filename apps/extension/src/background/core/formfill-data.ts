// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Parser, type Quad_Object, termToId } from 'n3';
import {
  type CommunicationKind,
  communicationValue,
  MAX_FORM_FILL_VALUE_LENGTH,
} from '../../shared/formfill-values';

const VCARD = 'http://www.w3.org/2006/vcard/ns#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const schema = (property: string): string[] => [
  `http://schema.org/${property}`,
  `https://schema.org/${property}`,
];

export interface FormFillData {
  readonly contact: {
    readonly name: string | null;
    readonly givenName: string | null;
    readonly familyName: string | null;
    readonly email: string | null;
    readonly tel: string | null;
    readonly organization: string | null;
  };
  /** Vocabulary-shaped parts; extendedAddress supplies address-line2. */
  readonly address: {
    readonly streetAddress: string | null;
    readonly extendedAddress: string | null;
    readonly locality: string | null;
    readonly region: string | null;
    readonly postalCode: string | null;
    readonly countryName: string | null;
  };
}

/**
 * Read only the bound WebID subject and its explicitly linked components. The caller
 * supplies fetched Turtle and its document URL (including for an address-book document).
 * Malformed Turtle throws; missing values are null. No requests or document-wide person search.
 * vCard precedes schema.org; lowest positive vcard:pref wins, ties use document order.
 */
export function readFormFillData(webId: string, turtle: string, baseUrl: string): FormFillData {
  const quads = new Parser({ baseIRI: baseUrl, format: 'text/turtle' }).parse(turtle);
  const person = DataFactory.namedNode(webId);
  const index = new Map<string, Map<string, Quad_Object[]>>();
  const preferenceRanks = new Map<string, number>();

  // Index once, keeping each property's parser order for deterministic preference ties.
  for (const { subject, predicate, object } of quads) {
    const key = termToId(subject);
    let predicates = index.get(key);
    if (!predicates) {
      predicates = new Map();
      index.set(key, predicates);
    }
    let values = predicates.get(predicate.value);
    if (!values) {
      values = [];
      predicates.set(predicate.value, values);
    }
    values.push(object);
  }

  function objects(subject: Quad_Object | undefined, predicate: string): Quad_Object[] {
    if (!subject || subject.termType === 'Literal') return [];
    return index.get(termToId(subject))?.get(predicate) ?? [];
  }

  function preference(node: Quad_Object): number {
    const key = termToId(node);
    const cached = preferenceRanks.get(key);
    if (cached !== undefined) return cached;
    let rank = Number.POSITIVE_INFINITY;
    for (const pref of objects(node, `${VCARD}pref`)) {
      const value = pref.value.toLowerCase();
      const number = value === 'true' ? 1 : Number(value);
      if (number > 0) rank = Math.min(rank, number);
    }
    if (objects(node, RDF_TYPE).some((type) => type.value === `${VCARD}Pref`)) {
      rank = Math.min(rank, 1);
    }
    preferenceRanks.set(key, rank);
    return rank;
  }

  function ordered(subject: Quad_Object | undefined, predicate: string): Quad_Object[] {
    return [...objects(subject, predicate)].sort((a, b) => preference(a) - preference(b));
  }

  function reference(subject: Quad_Object, predicates: string[]): Quad_Object | undefined {
    for (const predicate of predicates) {
      const node = ordered(subject, predicate).find(
        (value) => value.termType === 'NamedNode' || value.termType === 'BlankNode',
      );
      if (node) return node;
    }
    return undefined;
  }

  function text(subject: Quad_Object | undefined, predicates: string[]): string | null {
    for (const predicate of predicates) {
      for (const value of ordered(subject, predicate)) {
        if (value.termType !== 'Literal') continue;
        const result = value.value.trim();
        if (result && result.length <= MAX_FORM_FILL_VALUE_LENGTH) return result;
      }
    }
    return null;
  }

  function communication(predicates: string[], kind: CommunicationKind): string | null {
    const scheme = kind === 'email' ? 'mailto:' : 'tel:';
    function scalar(node: Quad_Object): string | null {
      if (node.termType !== 'Literal' && node.termType !== 'NamedNode') return null;
      const value = node.value.trim();
      if (node.termType === 'NamedNode' && !value.toLowerCase().startsWith(scheme)) return null;
      return communicationValue(value, kind);
    }
    for (const predicate of predicates) {
      for (const node of ordered(person, predicate)) {
        // Typed nodes use hasValue; older Solid address books also use vcard:value.
        for (const value of [
          ...ordered(node, `${VCARD}hasValue`),
          ...ordered(node, `${VCARD}value`),
          node,
        ]) {
          const result = scalar(value);
          if (result) return result;
        }
      }
    }
    return null;
  }

  const name = reference(person, [`${VCARD}hasName`]);
  const organization = reference(person, [`${VCARD}hasOrganization`]);
  const vcardAddress = reference(person, [`${VCARD}hasAddress`]);
  const schemaAddress = reference(person, schema('address'));
  function addressPart(vcard: string, schemaProperty: string): string | null {
    return text(vcardAddress, [`${VCARD}${vcard}`]) ?? text(schemaAddress, schema(schemaProperty));
  }

  return {
    contact: {
      name: text(person, [`${VCARD}fn`, ...schema('name')]),
      givenName:
        text(person, [`${VCARD}given-name`]) ??
        text(name, [`${VCARD}given-name`]) ??
        text(person, schema('givenName')),
      familyName:
        text(person, [`${VCARD}family-name`]) ??
        text(name, [`${VCARD}family-name`]) ??
        text(person, schema('familyName')),
      email: communication([`${VCARD}hasEmail`, ...schema('email')], 'email'),
      tel: communication([`${VCARD}hasTelephone`, ...schema('telephone')], 'tel'),
      organization:
        text(person, [`${VCARD}organization-name`]) ??
        text(organization, [`${VCARD}organization-name`]),
    },
    address: {
      streetAddress: addressPart('street-address', 'streetAddress'),
      extendedAddress: text(vcardAddress, [`${VCARD}extended-address`]),
      locality: addressPart('locality', 'addressLocality'),
      region: addressPart('region', 'addressRegion'),
      postalCode: addressPart('postal-code', 'postalCode'),
      countryName: addressPart('country-name', 'addressCountry'),
    },
  };
}
