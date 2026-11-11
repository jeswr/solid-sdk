// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { type createRegistry, fileAdapterById } from "@jeswr/pod-connectors";
import { NS } from "@jeswr/suite-vocab";
import { classificationForSourceClass } from "../model/classify";

export { DEMO_CONNECTOR } from "@jeswr/suite-vocab";

export interface ConnectorEntry {
  id: string;
  name: string;
  whatYouGet: string;
  domains: string[];
  tier: "A" | "B" | "C";
  status: "connect" | "demo" | "import" | "soon";
  logoId: string;
}

// IntegrationMetadata exposes categories, not classes. Keep this host-side bridge
// beside Home's taxonomy; these are the classes written by the current adapters.
const schema = (...names: string[]) => names.map((name) => NS.SCHEMA + name);
const classes: Readonly<Record<string, readonly string[]>> = {
  spotify: schema("MusicRecording", "MusicPlaylist", "ListenAction"),
  github: [...schema("SoftwareSourceCode"), `${NS.FOAF}OnlineAccount`],
  strava: schema("ExerciseAction", "TravelAction"),
  reddit: [...schema("SocialMediaPosting"), `${NS.FOAF}Group`],
  discord: [`${NS.FOAF}OnlineAccount`, `${NS.FOAF}Group`],
  twitch: schema("WatchAction"),
  notion: schema("TextDigitalDocument", "Dataset"),
  dropbox: schema("DigitalDocument"),
  "google-calendar": schema("Event"),
  "google-contacts": [`${NS.VCARD}AddressBook`],
  "google-drive": schema("DigitalDocument"),
  "google-photos": schema("ImageObject"),
  gmail: ["http://schema.org/EmailMessage"],
  youtube: schema("VideoObject", "MusicPlaylist"),
  fitbit: schema("ExerciseAction"),
  garmin: schema("ExerciseAction", "TravelAction"),
  instagram: schema("ImageObject", "SocialMediaPosting"),
  facebook: [...schema("SocialMediaPosting"), `${NS.FOAF}Group`],
  tiktok: schema("VideoObject", "SocialMediaPosting"),
  linkedin: schema("Organization"),
  "x-twitter": schema("SocialMediaPosting"),
  slack: schema("Organization"),
  pinterest: schema("ImageObject", "SocialMediaPosting"),
  netflix: schema("WatchAction"),
  "amazon-orders": schema("Invoice"),
  uber: schema("TravelAction", "Invoice"),
  "apple-health": schema("ExerciseAction"),
  whatsapp: schema("Message"),
  goodreads: schema("Book"),
  steam: [...schema("VideoGame"), `${NS.FOAF}OnlineAccount`],
  chatgpt: schema("TextDigitalDocument"),
  "bank-statements": schema("Invoice"),
  "google-takeout": [
    ...schema(
      "TextDigitalDocument",
      "WatchAction",
      "Event",
      "DigitalDocument",
      "TravelAction",
      "ExerciseAction",
    ),
    `${NS.VCARD}AddressBook`,
    "http://schema.org/EmailMessage",
  ],
};

const accountSources: Readonly<Record<string, readonly string[]>> = {
  github: ["https://github.com/"],
  discord: ["https://discord.com/"],
  steam: ["https://steamcommunity.com/"],
};

export function destinationsFor(id: string): { domain: string; label: string }[] {
  const destinations = new Map<string, { domain: string; label: string }>();
  for (const iri of classes[id] ?? ["unknown"]) {
    const { domain, dataType } = classificationForSourceClass(iri, accountSources[id] ?? []);
    const label = dataType ? `${domain.label} › ${dataType.label}` : domain.label;
    destinations.set(label, { domain: domain.id, label });
  }
  return [...destinations.values()];
}

export function catalogue(
  registry: ReturnType<typeof createRegistry>,
  showComingSoon = false,
): ConnectorEntry[] {
  return registry
    .allCatalogEntries()
    .filter((entry) => entry.tier !== "B" || showComingSoon)
    .map((entry) => {
      const metadata = entry.tier === "C" ? (fileAdapterById(entry.id)?.metadata ?? entry) : entry;
      const status = registry.statusOf(entry);
      return {
        id: metadata.id,
        name: metadata.name,
        whatYouGet: metadata.whatYouGet,
        domains: [...new Set(destinationsFor(metadata.id).map(({ domain }) => domain))],
        tier: metadata.tier,
        status:
          status === "live"
            ? "connect"
            : status === "demo"
              ? "demo"
              : status === "export-file"
                ? "import"
                : "soon",
        logoId: metadata.id,
      };
    });
}

export function filterCatalogue(
  entries: readonly ConnectorEntry[],
  domains: readonly string[],
  search: string,
): ConnectorEntry[] {
  const query = search.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      (!domains.length || domains.some((id) => entry.domains.includes(id))) &&
      `${entry.name} ${entry.whatYouGet}`.toLowerCase().includes(query),
  );
}
