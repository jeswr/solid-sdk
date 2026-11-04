// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
/** Webpack emits the local templates as assets; tests inject a file reader at this boundary. */
export const TEMPLATE_URLS: Readonly<Record<string, URL>> = {
  "http://www.w3.org/2006/vcard/ns#Address": new URL("./Address.ttl", import.meta.url),
  "https://schema.org/TextDigitalDocument": new URL("./TextDigitalDocument.ttl", import.meta.url),
  "http://www.w3.org/2002/01/bookmark#Bookmark": new URL("./Bookmark.ttl", import.meta.url),
  "https://schema.org/Event": new URL("./Event.ttl", import.meta.url),
  "https://jeswr.org/ns/sectors/health#Observation": new URL("./Observation.ttl", import.meta.url),
  "https://jeswr.org/ns/sectors/health#Condition": new URL("./Condition.ttl", import.meta.url),
  "https://jeswr.org/ns/sectors/health#VitalSign": new URL("./VitalSign.ttl", import.meta.url),
  "https://jeswr.org/ns/sectors/health#MedicationStatement": new URL(
    "./MedicationStatement.ttl",
    import.meta.url,
  ),
  "https://schema.org/Book": new URL("./Book.ttl", import.meta.url),
  "https://schema.org/OrganizationRole": new URL("./OrganizationRole.ttl", import.meta.url),
  "https://schema.org/EducationalOccupationalCredential": new URL(
    "./EducationalOccupationalCredential.ttl",
    import.meta.url,
  ),
  "http://www.w3.org/2006/vcard/ns#Individual": new URL("./Individual.ttl", import.meta.url),
};
export async function loadTemplate(
  classIri: string,
  resourceUrl: string,
  fetchTemplate: typeof fetch = globalThis.fetch,
) {
  const url = TEMPLATE_URLS[classIri];
  if (!url) throw new Error("This data type can't be added manually");
  const response = await fetchTemplate(url);
  if (!response.ok) throw new Error("Couldn't load the form. Please try again.");
  return parseRdf(await response.text(), "text/turtle", { baseIRI: resourceUrl });
}
