// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalize, NS } from "@jeswr/suite-vocab";
import { type Classification, classificationForClass, DOMAINS, UNCATEGORISED } from "./domains";
import { type HomeSubject, httpUrl } from "./rdf";

export function classificationForType(id: string): Classification {
  for (const domain of DOMAINS) {
    const dataType = domain.dataTypes.find((type) => type.id === id);
    if (dataType) return { domain, dataType };
  }
  return { domain: UNCATEGORISED };
}

export function isProfileSubject(subject: HomeSubject, webId?: string): boolean {
  return (
    subject.termType === "NamedNode" &&
    webId !== undefined &&
    subject.value.split("#")[0] === webId.split("#")[0]
  );
}

/** Subject-level rules precede the first-claim class table, independent of triple order. */
export function classifySubject(subject: HomeSubject, webId?: string): Classification {
  const types = subject.types.map(canonicalize);
  if (types.includes(`${NS.HEALTH}Observation`)) {
    if (types.includes(`${NS.HEALTH}VitalSign`)) return classificationForType("vitals");
    if (types.includes(`${NS.HEALTH}ObservationActivity`)) return classificationForType("activity");
  }
  if (types.includes(`${NS.FOAF}OnlineAccount`)) {
    const urls = [...subject.sourceUrls, ...subject.iris(`${NS.FOAF}accountServiceHomepage`)];
    const work = urls.some((value) => {
      const host = httpUrl(value)?.hostname;
      return (
        host !== undefined &&
        ["github.com", "slack.com"].some((base) => host === base || host.endsWith(`.${base}`))
      );
    });
    return classificationForType(work ? "work-experience" : "following");
  }
  if (types.includes(`${NS.VCARD}Individual`)) {
    return classificationForType(isProfileSubject(subject, webId) ? "identity" : "contacts");
  }
  if (types.includes(`${NS.SCHEMA}GovernmentPermit`)) {
    return classificationForType(
      subject.texts(`${NS.SCHEMA}name`).some((name) => /licen[cs]e/i.test(name))
        ? "drivers-licence"
        : "identity",
    );
  }
  if (
    types.includes(`${NS.SCHEMA}CreativeWork`) &&
    subject
      .iris(`${NS.SCHEMA}additionalType`)
      .some((iri) => canonicalize(iri) === `${NS.IDENTITY}AttributeAssertion`)
  ) {
    return classificationForType("personality-test");
  }
  for (const type of types) {
    if (type === `${NS.SCHEMA}CreativeWork`) continue;
    const classification = classificationForClass(type);
    if (classification.dataType) return classification;
  }
  return { domain: UNCATEGORISED };
}

/** One aggregate contact-details card, only from linked nodes on the WebID profile. */
export function hasProfileContactDetails(subject: HomeSubject, webId?: string): boolean {
  return (
    isProfileSubject(subject, webId) &&
    ["hasEmail", "hasTelephone"].some((name) =>
      subject
        .objects(NS.VCARD + name)
        .some((term) => term.termType === "NamedNode" || term.termType === "BlankNode"),
    )
  );
}
