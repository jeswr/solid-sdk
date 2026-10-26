// AUTHORED-BY Codex GPT-6.1-Sol
import { Calendar, CheckSquare2, ContactRound, FileText, Image, Music2 } from "lucide-react";
import type { ComponentType } from "react";
import { plainText, SurfaceFeedback, type SurfaceState, safeLink } from "./content.js";

export interface TypedProperty {
  key: string;
  label: string;
  values: readonly string[];
}
/** A read-only projection from typed RDF accessors; rawData is serialized by the caller. */
export interface TypedViewData {
  types: readonly string[];
  title?: string;
  properties: readonly TypedProperty[];
  image?: { src: string; alt: string };
  source?: { label: string; url: string };
  rawData?: string;
}
export interface TypedRendererProps {
  data: TypedViewData;
}
export type TypedViewRegistry = ReadonlyMap<string, ComponentType<TypedRendererProps>>;

function Properties({ data, keys }: TypedRendererProps & { keys?: readonly string[] }) {
  const properties = data.properties.filter((property) => !keys || keys.includes(property.key));
  return properties.length ? (
    <dl className="suite-metadata">
      {properties.map((property) => (
        <div key={property.key}>
          <dt>{plainText(property.label)}</dt>
          <dd>{property.values.map(plainText).join(" · ")}</dd>
        </div>
      ))}
    </dl>
  ) : (
    <p className="suite-muted">No additional details</p>
  );
}
function Picture({ data, photo = false }: TypedRendererProps & { photo?: boolean }) {
  const src =
    data.image &&
    (data.image.src.startsWith("/") && !data.image.src.startsWith("//")
      ? data.image.src
      : safeLink(data.image.src));
  // Native image preserves authenticated/local artwork URLs without a remote image proxy.
  return src ? (
    // biome-ignore lint/performance/noImgElement: preserve local/authenticated artwork without a proxy
    <img
      className={photo ? "suite-photo" : "suite-artwork"}
      src={src}
      alt={plainText(data.image?.alt ?? "")}
      loading="lazy"
    />
  ) : null;
}
function Title({ data, fallback }: TypedRendererProps & { fallback: string }) {
  return <h3>{plainText(data.title?.trim() || fallback)}</h3>;
}
export function ContactRenderer({ data }: TypedRendererProps) {
  return (
    <>
      <div className="suite-content-row">
        <Picture data={data} />
        <div>
          <ContactRound aria-hidden="true" size={24} strokeWidth={1.5} />
          <Title data={data} fallback="Contact" />
        </div>
      </div>
      <Properties data={data} keys={["email", "telephone", "organization", "role"]} />
    </>
  );
}
export function TrackRenderer({ data }: TypedRendererProps) {
  const artist = data.properties.find((property) => property.key === "artist")?.values.join(" · ");
  const album = data.properties.find((property) => property.key === "album")?.values.join(" · ");
  const duration = data.properties
    .find((property) => property.key === "duration")
    ?.values.join(" · ");
  const hasArtwork =
    data.image &&
    (safeLink(data.image.src) ||
      (data.image.src.startsWith("/") && !data.image.src.startsWith("//")));
  return (
    <div className="suite-track">
      {hasArtwork ? (
        <Picture data={data} />
      ) : (
        <span className="suite-track-placeholder">
          <Music2 aria-hidden="true" size={20} strokeWidth={1.75} />
        </span>
      )}
      <div className="suite-grow">
        <Title data={data} fallback="Track" />
        <p className="suite-muted">
          {[artist, album]
            .filter(Boolean)
            .map((value) => plainText(value ?? ""))
            .join(" · ")}
        </p>
      </div>
      <div className="suite-track-actions">
        {duration && <span className="suite-muted">{plainText(duration)}</span>}
        <SourceLink data={data} />
      </div>
    </div>
  );
}
export function EventRenderer({ data }: TypedRendererProps) {
  return (
    <>
      <Calendar aria-hidden="true" size={24} strokeWidth={1.5} />
      <Title data={data} fallback="Event" />
      <Properties data={data} keys={["start", "end", "location", "description"]} />
    </>
  );
}
export function TaskRenderer({ data }: TypedRendererProps) {
  return (
    <>
      <CheckSquare2 aria-hidden="true" size={24} strokeWidth={1.5} />
      <Title data={data} fallback="Task" />
      <Properties data={data} keys={["status", "due", "description"]} />
    </>
  );
}
export function DocumentRenderer({ data }: TypedRendererProps) {
  const excerpt = data.properties.find((p) => p.key === "description")?.values[0];
  return (
    <>
      <FileText aria-hidden="true" size={24} strokeWidth={1.5} />
      <Title data={data} fallback="Document" />
      {excerpt && <p className="suite-excerpt">{plainText(excerpt)}</p>}
    </>
  );
}
export function PhotoRenderer({ data }: TypedRendererProps) {
  return (
    <>
      <Image aria-hidden="true" size={24} strokeWidth={1.5} />
      <Title data={data} fallback="Photo" />
      <Picture data={data} photo />
      <Properties data={data} keys={["description", "created", "location"]} />
    </>
  );
}
export function GenericRenderer({ data }: TypedRendererProps) {
  return (
    <>
      <Title data={data} fallback="Item" />
      <Properties data={data} />
    </>
  );
}
function SourceLink({ data }: TypedRendererProps) {
  const url = data.source && safeLink(data.source.url);
  return url && data.source ? (
    <a href={url} rel="noopener noreferrer">
      Open in {plainText(data.source.label)}
    </a>
  ) : null;
}
const schema = (name: string) => [`https://schema.org/${name}`, `http://schema.org/${name}`];
export const typedViewRegistry: TypedViewRegistry = new Map([
  ["http://www.w3.org/2006/vcard/ns#Individual", ContactRenderer],
  ...schema("MusicRecording").map((type) => [type, TrackRenderer] as const),
  ...schema("Event").map((type) => [type, EventRenderer] as const),
  ["http://www.w3.org/2005/01/wf/flow#Task", TaskRenderer],
  ["https://jeswr.org/ns/pod-docs#Document", DocumentRenderer],
  ["https://w3id.org/jeswr/pod-docs#Document", DocumentRenderer],
  ...["Photograph", "ImageObject"].flatMap((name) =>
    schema(name).map((type) => [type, PhotoRenderer] as const),
  ),
]);

export function TypedView({
  data,
  registry = typedViewRegistry,
  showTechnicalDetails = false,
  state,
}: {
  data?: TypedViewData;
  registry?: TypedViewRegistry;
  /** Value of Settings › Advanced › Show technical details. Defaults closed. */
  showTechnicalDetails?: boolean;
  state?: SurfaceState;
}) {
  const Renderer = data?.types.map((type) => registry.get(type)).find(Boolean) ?? GenericRenderer;
  const ready = (!state || state.status === "ready") && data;
  return (
    <article className="suite-typed-view">
      {ready ? <Renderer data={data} /> : <SurfaceFeedback state={state ?? { status: "empty" }} />}
      {ready && showTechnicalDetails && data.rawData && (
        <details className="suite-raw-data">
          <summary>Show technical details</summary>
          <pre>{data.rawData}</pre>
        </details>
      )}
    </article>
  );
}
