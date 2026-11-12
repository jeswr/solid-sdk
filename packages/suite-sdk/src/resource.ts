// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { isWithinPodScope } from "@jeswr/guarded-fetch";
import { canonicalize, NS } from "@jeswr/suite-vocab";

export const sharedApps = [
  "docs",
  "sheets",
  "notes",
  "tasks",
  "calendar",
  "photos",
  "music",
  "drive",
] as const;
export type SharedApp = (typeof sharedApps)[number];
export interface ResourceHints {
  url: string;
  name?: string;
  contentType?: string;
  rdfTypes?: readonly string[];
  parent?: string;
}
export interface ResourceResolution {
  app: SharedApp | "contacts";
  kind: string;
  group: "data" | "file" | "document" | "task" | "person";
  href: string;
}

/** Fail closed on non-direct children, including encoded separators and credentials. */
export function isDirectChild(resourceUrl: string, container: string): boolean {
  try {
    const url = new URL(resourceUrl);
    const parent = new URL(container);
    const rest = url.pathname.slice(parent.pathname.length);
    return (
      /^https?:$/.test(url.protocol) &&
      !url.username &&
      !url.password &&
      url.origin === parent.origin &&
      url.pathname.startsWith(parent.pathname) &&
      !url.search &&
      !url.hash &&
      rest.length > 0 &&
      !/[\\/]|%2f|%5c/i.test(rest)
    );
  } catch {
    return false;
  }
}

const types: readonly [string, ResourceResolution["app"], string, ResourceResolution["group"]][] = [
  [`${NS.WF}Task`, "tasks", "task", "task"],
  [`${NS.WF}Tracker`, "tasks", "task-list", "task"],
  [`${NS.SCHEMA}SpreadsheetDigitalDocument`, "sheets", "spreadsheet", "document"],
  [`${NS.SCHEMA}TextDigitalDocument`, "notes", "note", "document"],
  [`${NS.POD_DOCS}Document`, "docs", "document", "document"],
  [`${NS.SCHEMA}DigitalDocument`, "docs", "document", "document"],
  ...[`${NS.VCARD}Individual`, `${NS.FOAF}Person`, `${NS.SCHEMA}Person`].map(
    (type): [string, ResourceResolution["app"], string, ResourceResolution["group"]] => [
      type,
      "contacts",
      "person",
      "person",
    ],
  ),
  [`${NS.CAL}Vevent`, "calendar", "event", "data"],
  [`${NS.SCHEMA}Event`, "calendar", "event", "data"],
  [`${NS.CAL}Vcalendar`, "calendar", "calendar", "data"],
  [`${NS.SCHEMA}ImageObject`, "photos", "photo", "file"],
  [`${NS.SCHEMA}Photograph`, "photos", "photo", "file"],
  [`${NS.SCHEMA}PhotoAlbum`, "photos", "album", "data"],
  [`${NS.SCHEMA}MusicRecording`, "music", "audio", "file"],
  [`${NS.SCHEMA}AudioObject`, "music", "audio", "file"],
  [`${NS.SCHEMA}MusicAlbum`, "music", "album", "data"],
  [`${NS.SCHEMA}MusicPlaylist`, "music", "playlist", "data"],
  [`${NS.LDP}Container`, "drive", "folder", "file"],
  [`${NS.LDP}BasicContainer`, "drive", "folder", "file"],
];
const hints: readonly [SharedApp, string, RegExp, RegExp, RegExp][] = [
  [
    "sheets",
    "spreadsheet",
    /(?:spreadsheet|excel|text\/csv)/,
    /\.(?:csv|xlsx?|ods)$/,
    /\/(?:sheets|pod-sheets)\//,
  ],
  ["notes", "note", /^application\/vnd\.jeswr\.note$/, /\.note$/, /\/(?:notes|pod-notes)\//],
  [
    "tasks",
    "task-list",
    /^application\/vnd\.jeswr\.tasks$/,
    /\.(?:todo|vtodo)$/,
    /\/(?:tasks|pod-tasks)\//,
  ],
  ["calendar", "calendar", /^text\/calendar$/, /\.ics$/, /\/(?:calendar|calendars|pod-calendar)\//],
  [
    "photos",
    "photo",
    /^image\//,
    /\.(?:avif|gif|heic|jpe?g|png|svg|webp)$/,
    /\/(?:photos|pod-photos)\//,
  ],
  ["music", "audio", /^audio\//, /\.(?:aac|flac|m4a|mp3|ogg|opus|wav)$/, /\/(?:music|pod-music)\//],
  [
    "docs",
    "document",
    /^(?:text\/(?:plain|markdown|html)|application\/(?:msword|rtf|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|vnd\.oasis\.opendocument\.text))$/,
    /\.(?:docx?|md|markdown|odt|rtf|txt|html?)$/,
    /\/(?:docs|pod-docs)\//,
  ],
];

const sheetsWorkbook = /\/(?:sheets|pod-sheets)\/[^/]+\/$/;

/** One resource-to-app mapping. Shared links require a native format and a capable router. */
export function resolveSuiteResource(
  resource: ResourceHints,
  options: {
    encodeRef: (url: string) => string;
    encodeContactRef?: (book: string, document: string) => string;
    shared?: boolean;
    storageUrl?: string;
    previewOnly?: boolean;
    /** False keeps search's rule: only RDF types choose an app; untyped rows stay in Drive. */
    hints?: boolean;
  },
): ResourceResolution {
  const document = new URL(resource.url);
  if (!/^https?:$/.test(document.protocol) || document.username || document.password)
    throw new TypeError("Expected an HTTP resource without credentials");
  document.hash = "";
  const ref = options.encodeRef(document.href);
  const container = document.pathname.endsWith("/");
  // Drive's own convention: folders navigate, files preview.
  const preview = container ? `/drive/f/${ref}` : `/drive/p/${ref}`;
  const rdfTypes = resource.rdfTypes?.map(canonicalize) ?? [];
  const typed = types.find(([type]) => rdfTypes.includes(type));
  const mime = resource.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  let path = document.pathname.toLowerCase();
  try {
    path = decodeURIComponent(path);
  } catch {
    /* Keep malformed encodings opaque. */
  }
  const name = (resource.name ?? path).toLowerCase();
  // A hint never turns a container into a file; Sheets' native workbook container is the
  // only container layout a hint may route.
  const hinted =
    options.hints === false
      ? undefined
      : container
        ? hints.find(([app]) => app === "sheets" && sheetsWorkbook.test(path))
        : (hints.find(([, , mimeRule]) => mimeRule.test(mime)) ??
          hints.find(([, , , extension]) => extension.test(name) || extension.test(path)) ??
          hints.find(([, , , , pathRule]) => pathRule.test(path)));
  let app: ResourceResolution["app"] = typed?.[1] ?? hinted?.[0] ?? "drive";
  let kind = typed?.[2] ?? hinted?.[1] ?? (container ? "folder" : "file");
  if (rdfTypes.includes(`${NS.POD_DOCS}Document`) && /\/(?:notes|pod-notes)\//.test(path)) {
    app = "notes";
    kind = "note";
  }
  const generic =
    !rdfTypes.length ||
    rdfTypes.some(
      (type) =>
        type === `${NS.LDP}Resource` ||
        type === `${NS.LDP}NonRDFSource` ||
        type.startsWith("http://www.w3.org/ns/iana/media-types/"),
    );
  const group =
    typed?.[3] ??
    (kind === "folder"
      ? "file"
      : generic && !/(?:turtle|ld\+json|n-triples|n-quads|trig|rdf\+xml)/i.test(mime)
        ? "file"
        : "data");
  let href = preview;
  // The pod boundary, not the origin: path-based hosts serve many pods on one origin.
  const ownStorage =
    options.storageUrl !== undefined && isWithinPodScope(options.storageUrl, document.href);
  const nativeLocation = !document.search && !/%2f|%5c/i.test(document.pathname);
  const nativeRdf =
    !mime || /^(?:text\/turtle|application\/(?:ld\+json|n-triples|rdf\+xml))$/.test(mime);
  // Untyped trackers must sit in Tasks' projects/ container; other tasks/ files are previews.
  const nativeTrackerPath = /^projects\/[^/]+\.ttl$/.test(
    path.split(/\/(?:tasks|pod-tasks)\//)[1] ?? "",
  );
  switch (app) {
    case "tasks":
      if (kind === "task") {
        if (!options.shared) href = `/tasks/inbox?task=${options.encodeRef(resource.url)}`;
      } else if (
        document.protocol === "https:" &&
        nativeLocation &&
        nativeRdf &&
        /\.ttl$/.test(path) &&
        (rdfTypes.includes(`${NS.WF}Tracker`) || nativeTrackerPath)
      )
        href = `/tasks/p/${ref}`;
      break;
    case "docs":
      if (
        (!options.shared || ownStorage) &&
        nativeLocation &&
        nativeRdf &&
        /\.ttl$/.test(path) &&
        (rdfTypes.includes(`${NS.POD_DOCS}Document`) ||
          (!options.shared && rdfTypes.includes(`${NS.SCHEMA}DigitalDocument`)) ||
          /\/(?:docs|pod-docs)\/[^/]+\.ttl$/.test(path))
      )
        href = `/docs/d/${ref}`;
      break;
    case "sheets":
      if (
        (!options.shared || ownStorage) &&
        nativeLocation &&
        container &&
        (rdfTypes.includes(`${NS.SCHEMA}SpreadsheetDigitalDocument`) || sheetsWorkbook.test(path))
      )
        href = `/sheets/s/${ref}`;
      break;
    case "notes":
      if (!options.shared && nativeLocation && nativeRdf && /\.ttl$/.test(path))
        href = `/notes/n/${ref}`;
      break;
    case "calendar":
      if (!options.shared && kind === "event" && nativeLocation && nativeRdf && /\.ttl$/.test(path))
        href = `/calendar/e/${ref}`;
      break;
    case "contacts":
      if (!options.shared) {
        href = "/contacts";
        if (options.encodeContactRef && /\/contacts\/(?:people\/)?[^/]+$/.test(document.pathname)) {
          try {
            const book = new URL(
              document.pathname.includes("/people/") ? "../" : "./",
              resource.parent,
            );
            href = `/contacts/c/${options.encodeContactRef(book.href, document.href)}`;
          } catch {
            /* Keep the app link when Contacts cannot represent the document. */
          }
        }
      }
      break;
    case "drive":
      if (kind === "folder") href = `/drive/f/${ref}`;
      break;
    case "photos":
    case "music":
      break;
  }
  return { app, kind, group, href: options.previewOnly ? preview : href };
}
