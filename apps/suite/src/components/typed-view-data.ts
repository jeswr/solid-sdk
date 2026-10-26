// AUTHORED-BY Codex GPT-6.1-Sol
import type { TypedProperty, TypedViewData } from "@jeswr/suite-ui";
import { canonicalize, NS } from "@jeswr/suite-vocab";
import type { DatasetCore, Term } from "@rdfjs/types";
import { TermAs } from "@rdfjs/wrapper";
import { Agent } from "@solid/object";
import { DataFactory } from "n3";
import { connectorForUrl } from "../apps/home/lib/model/provenance";
import { httpUrl, serializeTurtle, subjectOf } from "../apps/home/lib/model/rdf";
import { htmlToText } from "../apps/mail/lib/model/htmlText";

const field = (key: string, label: string, iris: string[]) =>
  iris.map((iri) => [iri, { key, label }] as const);
/** Unmapped predicates deliberately do not fall back to technical URI fragments. */
export const propertyLabels = new Map([
  ...field("title", "Name", [
    `${NS.SCHEMA}name`,
    `${NS.DCT}title`,
    `${NS.VCARD}fn`,
    `${NS.FOAF}name`,
    `${NS.RDFS}label`,
  ]),
  ...field("description", "Description", [
    `${NS.WF}description`,
    `${NS.SCHEMA}description`,
    `${NS.DCT}description`,
    `${NS.SCHEMA}text`,
  ]),
  ...field("email", "Email", [`${NS.VCARD}hasEmail`, `${NS.VCARD}email`, `${NS.SCHEMA}email`]),
  ...field("telephone", "Phone", [
    `${NS.VCARD}hasTelephone`,
    `${NS.VCARD}tel`,
    `${NS.SCHEMA}telephone`,
  ]),
  ...field("organization", "Organisation", [
    `${NS.VCARD}organization-name`,
    `${NS.SCHEMA}worksFor`,
  ]),
  ...field("role", "Role", [`${NS.VCARD}role`, `${NS.SCHEMA}jobTitle`]),
  ...field("artist", "Artist", [`${NS.SCHEMA}byArtist`]),
  ...field("album", "Album", [`${NS.SCHEMA}inAlbum`]),
  ...field("duration", "Duration", [`${NS.SCHEMA}duration`]),
  ...field("start", "Starts", [`${NS.SCHEMA}startDate`]),
  ...field("end", "Ends", [`${NS.SCHEMA}endDate`]),
  ...field("location", "Location", [`${NS.SCHEMA}location`]),
  ...field("due", "Due", [`${NS.WF}dateDue`, `${NS.SCHEDULING}dueTime`, `${NS.WF}due`]),
  ...field("status", "Status", [`${NS.WF}state`, `${NS.SCHEMA}actionStatus`]),
  ...field("created", "Created", [`${NS.DCT}created`, `${NS.SCHEMA}dateCreated`]),
  ...field("modified", "Modified", [`${NS.DCT}modified`, `${NS.SCHEMA}dateModified`]),
  ...field("website", "Website", [`${NS.SCHEMA}url`]),
]);
const states: Readonly<Record<string, string>> = {
  [`${NS.WF}Open`]: "Open",
  [`${NS.WF}Closed`]: "Completed",
  [`${NS.WF}InProgress`]: "In progress",
  [`${NS.SCHEMA}CompletedActionStatus`]: "Completed",
};
function attempt<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

export async function typedViewData(
  dataset: DatasetCore,
  subject: string | Term,
  options: { locale?: string; timeZone?: string; storage?: string } = {},
): Promise<TypedViewData> {
  const node = subjectOf(dataset, subject);
  const predicates = [
    ...new Set(
      [...dataset.match(TermAs.term(node))].map((quad) => canonicalize(quad.predicate.value)),
    ),
  ];
  const properties: TypedProperty[] = [];
  for (const predicate of predicates) {
    if (
      [
        `${NS.RDF}type`,
        `${NS.SCHEMA}image`,
        `${NS.SCHEMA}contentUrl`,
        `${NS.VCARD}hasPhoto`,
        `${NS.POD_DOCS}body`,
      ].includes(predicate)
    )
      continue;
    const descriptor = propertyLabels.get(predicate) ?? { key: predicate, label: "Other detail" };
    const values = node.objects(predicate).map((term): string => {
      if (term.termType === "Literal") {
        if (["start", "end", "due", "created", "modified"].includes(descriptor.key)) {
          const dateOnly =
            term.datatype.value === "http://www.w3.org/2001/XMLSchema#date" ||
            /^\d{4}-\d{2}-\d{2}$/.test(term.value);
          // Calendar dates retain their lexical day; only instants use the display time zone.
          const date = new Date(dateOnly ? `${term.value.slice(0, 10)}T00:00:00Z` : term.value);
          return Number.isFinite(date.getTime())
            ? new Intl.DateTimeFormat(options.locale ?? "en", {
                dateStyle: "medium",
                ...(!dateOnly && term.value.includes("T") ? { timeStyle: "short" as const } : {}),
                timeZone: dateOnly ? "UTC" : (options.timeZone ?? "UTC"),
              }).format(date)
            : "Date unavailable";
        }
        if (descriptor.key === "duration")
          return term.value.replace(
            /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/,
            (_, hours, minutes, seconds) =>
              [hours && `${hours} hr`, minutes && `${minutes} min`, seconds && `${seconds} sec`]
                .filter(Boolean)
                .join(" "),
          );
        return term.value;
      }
      if (["email", "telephone"].includes(descriptor.key) && /^(mailto:|tel:)/i.test(term.value))
        return term.value.replace(/^(mailto:|tel:)/i, "");
      if (term.termType === "NamedNode" && states[canonicalize(term.value)])
        return states[canonicalize(term.value)] as string;
      const linked = subjectOf(dataset, term);
      // Both vCard forms wrap mailto/tel IRIs or literal contact values.
      const contact = [
        ...linked.objects(`${NS.VCARD}value`),
        ...linked.objects(`${NS.VCARD}hasValue`),
      ].find(
        (value) => value.termType === "Literal" || /^(mailto:|tel:)/i.test(value.value),
      )?.value;
      return linked.name ?? contact?.replace(/^(mailto:|tel:)/i, "") ?? "Linked item";
    });
    if (values.length) {
      const previous = properties.find((property) => property.key === descriptor.key);
      if (previous) previous.values = [...new Set([...previous.values, ...values])];
      else properties.push({ ...descriptor, values });
    }
  }
  const typeStates = node.types
    .map(canonicalize)
    .flatMap((type) => (states[type] ? [states[type]] : []));
  if (typeStates.length) {
    const status = properties.find((property) => property.key === "status");
    if (status) status.values = [...new Set([...status.values, ...typeStates])];
    else properties.push({ key: "status", label: "Status", values: [...new Set(typeStates)] });
  }
  if (
    node.types.map(canonicalize).includes(`${NS.POD_DOCS}Document`) &&
    !properties.some((property) => property.key === "description")
  ) {
    const body = node.texts(`${NS.POD_DOCS}body`)[0];
    const format = node.texts(`${NS.POD_DOCS}format`)[0] ?? "text/html";
    if (body && ["text/html", "text/plain", "text/markdown"].includes(format)) {
      const excerpt = (format === "text/html" ? htmlToText(body) : body).slice(0, 500);
      if (excerpt) properties.push({ key: "description", label: "Description", values: [excerpt] });
    }
  }
  const contact = node.types.includes(`${NS.VCARD}Individual`)
    ? new Agent(TermAs.term(node), dataset, DataFactory)
    : undefined;
  const title = node.name ?? (contact && attempt(() => contact.vcardFn));
  const imageTerm = [
    ...node.objects(`${NS.SCHEMA}image`),
    ...node.objects(`${NS.VCARD}hasPhoto`),
    ...node.objects(`${NS.SCHEMA}contentUrl`),
  ].find((term) => term.termType === "NamedNode" || term.termType === "BlankNode");
  const imageNode = imageTerm && subjectOf(dataset, imageTerm);
  const image =
    imageTerm &&
    (imageNode?.iris(`${NS.SCHEMA}contentUrl`)[0] ??
      (imageTerm.termType === "NamedNode" ? imageTerm.value : undefined));
  const source = node.sourceUrls.find(
    (value) =>
      httpUrl(value) && (!options.storage || new URL(value).host !== new URL(options.storage).host),
  );
  return {
    types: node.types.map(canonicalize),
    ...(title ? { title } : {}),
    properties,
    ...(image && httpUrl(image) ? { image: { src: image, alt: title ?? "" } } : {}),
    ...(source
      ? { source: { label: connectorForUrl(source)?.label ?? "source", url: source } }
      : {}),
    rawData: await serializeTurtle(dataset),
  };
}
