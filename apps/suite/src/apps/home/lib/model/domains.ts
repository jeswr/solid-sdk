// AUTHORED-BY Codex GPT-6.1-Sol
// Taxonomy ported from Pod Manager categories.ts; Home spec §5.1 is authoritative.
import { canonicalize, LEGACY_NAMESPACES, NS } from "@jeswr/suite-vocab";

export interface DataType {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly classes: readonly string[];
  readonly app?: "drive" | "docs" | "tasks" | "calendar";
  readonly manualForm?: string;
  readonly container?: string;
}

export interface DataCategory {
  readonly id: string;
  readonly label: string;
  readonly assurance: string;
  readonly description: string;
  readonly tier: "common" | "other";
  readonly icon: string;
  readonly classes: readonly string[];
  readonly dataTypes: readonly DataType[];
}

/** Expand vocabulary aliases for Type Index queries without changing resource IRIs. */
export function classAliases(iri: string): string[] {
  const canonical = canonicalize(iri);
  const aliases = [canonical];
  for (const [legacy, base] of Object.entries(LEGACY_NAMESPACES)) {
    if (canonical.startsWith(base)) aliases.push(legacy + canonical.slice(base.length));
  }
  if (canonical.startsWith(NS.CAL)) {
    aliases.push(canonical.replace(NS.CAL, "http://www.w3.org/2002/12/cal/icaltzd#"));
  }
  return [...new Set(aliases)];
}

function dataType(
  id: string,
  label: string,
  description: string,
  classes: string[],
  options: Pick<DataType, "app" | "manualForm" | "container"> = {},
): DataType {
  return { id, label, description, classes: classes.flatMap(classAliases), ...options };
}

function domain(
  id: string,
  label: string,
  icon: string,
  description: string,
  dataTypes: DataType[],
): DataCategory {
  return {
    id,
    label,
    icon,
    description,
    dataTypes,
    assurance: `You choose who can access your ${label.toLowerCase()} data.`,
    tier: "common",
    classes: [...new Set(dataTypes.flatMap((type) => type.classes))],
  };
}

const schema = (...names: string[]) => names.map((name) => NS.SCHEMA + name);
const health = (...names: string[]) => names.map((name) => NS.HEALTH + name);
const finance = (...names: string[]) => names.map((name) => NS.FINANCE + name);

export const DOMAINS: readonly DataCategory[] = [
  domain("personal", "Personal", "user-round", "Your identity and contact details.", [
    dataType("identity", "Identity", "Your name, photo and profile.", [
      `${NS.FOAF}Person`,
      ...schema("Person", "GovernmentPermit"),
      `${NS.VCARD}Individual`,
      `${NS.IDENTITY}NaturalPerson`,
      `${NS.IDENTITY}VerifiableAttribute`,
    ]),
    dataType(
      "address",
      "Address",
      "Your postal addresses.",
      [`${NS.VCARD}Address`, ...schema("PostalAddress")],
      { manualForm: `${NS.VCARD}Address`, container: "personal/" },
    ),
    dataType(
      "contact-details",
      "Contact details",
      "Email and telephone details from your profile.",
      [],
    ),
  ]),
  domain("documents", "Documents", "file-text", "Your files, documents, notes and bookmarks.", [
    dataType("files", "Files", "Files in your Drive.", [`${NS.POD_DRIVE}DriveRoot`], {
      app: "drive",
      container: "drive/",
    }),
    dataType("docs", "Documents", "Documents you can edit in Docs.", [`${NS.POD_DOCS}Document`], {
      app: "docs",
      container: "docs/",
    }),
    dataType(
      "notes",
      "Notes",
      "Short notes and text documents.",
      schema("TextDigitalDocument", "NoteDigitalDocument"),
      { manualForm: `${NS.SCHEMA}TextDigitalDocument`, container: "notes/" },
    ),
    dataType(
      "bookmarks",
      "Bookmarks",
      "Links you have saved.",
      ["http://www.w3.org/2002/01/bookmark#Bookmark", `${NS.BOOKMARK}Bookmark`],
      { manualForm: "http://www.w3.org/2002/01/bookmark#Bookmark", container: "bookmarks/" },
    ),
  ]),
  domain("calendar", "Calendar", "calendar", "Events and things to do.", [
    dataType(
      "agenda",
      "Agenda",
      "Your events and appointments.",
      [...schema("Event"), `${NS.CAL}Vevent`, `${NS.SCHEDULING}CalendarEvent`],
      { app: "calendar", manualForm: `${NS.SCHEMA}Event`, container: "calendar/" },
    ),
    dataType(
      "tasks",
      "Tasks",
      "Things you plan to do.",
      [`${NS.WF}Task`, `${NS.CAL}Vtodo`, `${NS.SCHEDULING}Task`],
      { app: "tasks", container: "tasks/" },
    ),
  ]),
  domain(
    "body-health",
    "Body & Health",
    "heart-pulse",
    "Your measurements, activity and health history.",
    [
      dataType(
        "body-measurements",
        "Body measurements",
        "Measurements of your body.",
        [...health("Observation"), ...schema("MedicalEntity", "HealthValue")],
        { manualForm: `${NS.HEALTH}Observation`, container: "health/" },
      ),
      dataType(
        "medical-history",
        "Medical history",
        "Conditions and immunisations.",
        [...health("Condition", "Immunization"), ...schema("MedicalCondition")],
        { manualForm: `${NS.HEALTH}Condition`, container: "health/" },
      ),
      dataType("activity", "Activity", "Exercise and step counts.", [
        ...schema("ExerciseAction"),
        ...health("ObservationActivity", "StepCountObservation"),
      ]),
      dataType(
        "vitals",
        "Vitals",
        "Heart rate, sleep and vital signs.",
        health("VitalSign", "HeartRateObservation", "SleepObservation"),
        { manualForm: `${NS.HEALTH}VitalSign`, container: "health/" },
      ),
      dataType(
        "medication",
        "Medication",
        "Medicines you take.",
        [...health("MedicationStatement"), ...schema("Drug")],
        { manualForm: `${NS.HEALTH}MedicationStatement`, container: "health/" },
      ),
    ],
  ),
  domain("financial", "Financial", "wallet", "Your accounts, transactions and investments.", [
    dataType("payment-cards", "Payment cards", "Your payment cards.", [
      ...finance("CreditAccount"),
      ...schema("PaymentCard"),
    ]),
    dataType("transactions", "Transactions", "Payments, transfers and orders.", [
      ...finance("Transaction", "Transfer"),
      ...schema("Invoice", "Order"),
    ]),
    dataType(
      "stocks",
      "Stocks",
      "Your holdings and investments.",
      finance("Holding", "InvestmentAccount", "FinancialInstrument"),
    ),
    dataType("income-expenses", "Income/expenses", "Account balances and amounts.", [
      ...finance("FinancialAccount", "CurrentAccount", "SavingsAccount"),
      ...schema("BankAccount", "MonetaryAmount"),
    ]),
  ]),
  domain("media", "Media", "image", "Your music, books, photos and viewing history.", [
    dataType(
      "streaming",
      "Streaming",
      "Films, series, videos and games.",
      schema("WatchAction", "VideoObject", "Movie", "TVSeries", "VideoGame"),
    ),
    dataType("music", "Music", "Recordings, playlists and listening history.", [
      ...schema("MusicRecording", "MusicPlaylist", "ListenAction"),
      ...["Track", "Playlist", "Record"].map((name) => `http://purl.org/ontology/mo/${name}`),
    ]),
    dataType("books", "Books", "Your reading library.", schema("Book"), {
      manualForm: `${NS.SCHEMA}Book`,
      container: "media/books/",
    }),
    dataType(
      "photos",
      "Photos",
      "Images and galleries.",
      schema("Photograph", "ImageObject", "ImageGallery"),
    ),
  ]),
  domain(
    "work-study",
    "Work & Study",
    "briefcase",
    "Your work, qualifications and personal attributes.",
    [
      dataType(
        "work-experience",
        "Work experience",
        "Roles, organisations and work accounts.",
        [
          ...schema("Organization", "OrganizationRole", "JobPosting", "SoftwareSourceCode"),
          `${NS.FOAF}OnlineAccount`,
        ],
        { manualForm: `${NS.SCHEMA}OrganizationRole`, container: "work/" },
      ),
      dataType(
        "diplomas",
        "Diplomas",
        "Your qualifications and places of study.",
        schema("EducationalOccupationalCredential", "EducationalOrganization"),
        { manualForm: `${NS.SCHEMA}EducationalOccupationalCredential`, container: "work/" },
      ),
      dataType("personality-test", "Personality test", "Your personality test results.", [
        `${NS.IDENTITY}AttributeAssertion`,
        ...schema("CreativeWork"),
      ]),
    ],
  ),
  domain("mobility", "Mobility", "car-front", "Your licence, vehicles and journeys.", [
    dataType("drivers-licence", "Driver's licence", "Your driving licence.", [
      ...schema("GovernmentPermit"),
      `${NS.IDENTITY}IdentityDocumentNumber`,
    ]),
    dataType(
      "journeys",
      "Journeys",
      "Travel and vehicles.",
      schema("TravelAction", "Trip", "Vehicle"),
    ),
  ]),
  domain("socials", "Socials", "message-circle", "Your contacts and communities.", [
    dataType(
      "contacts",
      "Contacts",
      "People, groups and address books.",
      [`${NS.VCARD}AddressBook`, `${NS.VCARD}Individual`, `${NS.VCARD}Group`],
      { manualForm: `${NS.VCARD}Individual`, container: "contacts/" },
    ),
    dataType("following", "Following", "Posts, messages and social accounts.", [
      ...schema("SocialMediaPosting", "Message"),
      `${NS.FOAF}Group`,
      `${NS.FOAF}OnlineAccount`,
      `${NS.AS}Note`,
      `${NS.SIOC}Note`,
    ]),
  ]),
];

export const UNCATEGORISED: DataCategory = {
  id: "other",
  label: "Other",
  description: "Other data in your pod.",
  assurance: "You choose who can access this data.",
  tier: "other",
  icon: "boxes",
  classes: [],
  dataTypes: [],
};

export interface Classification {
  domain: DataCategory;
  dataType?: DataType;
}

/** First claim wins; subject-level predicate disambiguation is applied by classifySubject. */
export const BY_CLASS: ReadonlyMap<string, Classification> = (() => {
  const map = new Map<string, Classification>();
  for (const domain of DOMAINS) {
    for (const dataType of domain.dataTypes) {
      for (const iri of dataType.classes) {
        if (!map.has(iri)) map.set(iri, { domain, dataType });
      }
    }
  }
  return map;
})();

export function classificationForClass(iri: string): Classification {
  return BY_CLASS.get(iri) ?? BY_CLASS.get(canonicalize(iri)) ?? { domain: UNCATEGORISED };
}

/** The Other tab exists only when at least one discovered item belongs to it. */
export function visibleDomains(items: readonly Classification[]): readonly DataCategory[] {
  return items.some((item) => item.domain.id === UNCATEGORISED.id)
    ? [...DOMAINS, UNCATEGORISED]
    : DOMAINS;
}
