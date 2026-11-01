// AUTHORED-BY Codex GPT-6.1-Sol
import { parseResource } from "../apps/home/lib/model/rdf";
import { typedViewData } from "./typed-view-data";

const prefixes = `@prefix schema: <https://schema.org/> .
@prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
@prefix pd: <https://jeswr.org/ns/pod-docs#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`;
/** Real RDF datasets, parsed through the same sanctioned path as stored resources. */
export const typedDatasets = [
  {
    id: "contact",
    label: "Contact",
    turtle: `<#it> a vcard:Individual; vcard:fn "Mira Osei"; vcard:hasEmail [vcard:hasValue <mailto:mira@example.test>]; vcard:hasTelephone <tel:+441234567890>; vcard:organization-name "Open Studio"; vcard:role "Designer" .`,
  },
  {
    id: "track",
    label: "Music with artwork",
    turtle: `<#it> a schema:MusicRecording; schema:name "Paper planes"; schema:byArtist [schema:name "The Quiet Hours"]; schema:inAlbum [schema:name "Small beginnings"]; schema:duration "PT3M42S"; schema:image <https://pod.example/cover.svg>; schema:url <https://open.spotify.com/track/paper-planes> .`,
  },
  {
    id: "track-no-artwork",
    label: "Music without artwork",
    turtle: `<#it> a schema:MusicRecording; schema:name "A slower morning"; schema:byArtist [schema:name "The Quiet Hours"]; schema:url <https://open.spotify.com/track/a-slower-morning> .`,
  },
  {
    id: "event",
    label: "Event",
    turtle: `<#it> a schema:Event; schema:name "Design review"; schema:startDate "2026-10-26T10:00:00Z"^^xsd:dateTime; schema:endDate "2026-10-26T11:00:00Z"^^xsd:dateTime; schema:location [schema:name "Studio room"]; schema:description "Bring the latest sketches." .`,
  },
  {
    id: "task",
    label: "Task",
    turtle: `<#it> a wf:Task; dct:title "Review the quarterly plan"; wf:state wf:Open; wf:due "2026-10-28"^^xsd:date; dct:description "Share feedback with the team." .`,
  },
  {
    id: "document",
    label: "Document",
    turtle: `<#it> a pd:Document; dct:title "A calmer workspace"; pd:body "<p>A professional suite where your documents, plans and ideas stay in your pod.</p><p>This plan brings the essentials together in one place.</p>"; pd:format "text/html" .`,
  },
  {
    id: "photograph",
    label: "Photograph",
    turtle: `<#it> a schema:Photograph; schema:name "A quiet afternoon"; schema:contentUrl <https://pod.example/photo.svg>; schema:description "Light across the studio."; schema:dateCreated "2026-09-14"^^xsd:date .`,
  },
  {
    id: "image",
    label: "Image",
    turtle: `<#it> a schema:ImageObject; schema:name "Album artwork"; schema:contentUrl <https://pod.example/image.svg>; schema:description "A study in line and shape." .`,
  },
  {
    id: "generic",
    label: "Other data",
    turtle: `<#it> a <https://example.test/UnfamiliarType>; schema:name "Studio notes"; schema:description "A few things to remember."; <https://example.test/colour> "Warm paper"; <https://example.test/reference> <https://pod.example/linked-resource>; schema:url <https://example.test/source> .`,
  },
] as const;

export async function typedFixtureData() {
  return Promise.all(
    typedDatasets.map(async (fixture) => {
      const url = `https://pod.example/${fixture.id}`;
      const dataset = await parseResource(`${prefixes}\n${fixture.turtle}`, "text/turtle", url);
      const data = await typedViewData(dataset, `${url}#it`, { storage: "https://pod.example/" });
      if (data.image) data.image.src = "/dev/components/artwork";
      return { id: fixture.id, label: fixture.label, data };
    }),
  );
}
