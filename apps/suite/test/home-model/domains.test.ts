// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { describe, expect, it } from "vitest";
import {
  classificationForType,
  classifySubject,
  hasProfileContactDetails,
  isProfileSubject,
} from "../../src/apps/home/lib/model/classify";
import {
  BY_CLASS,
  classAliases,
  classificationForClass,
  DOMAINS,
  UNCATEGORISED,
  visibleDomains,
} from "../../src/apps/home/lib/model/domains";
import { primarySubject, subjectOf } from "../../src/apps/home/lib/model/rdf";
import { rdf, STORAGE, WEB_ID } from "./fixtures";

// Independent transcription of the spec table: catches omissions in the implementation table.
const EXPECTED: Record<string, string[]> = {
  identity: [
    "foaf:Person",
    "schema:Person",
    "vcard:Individual",
    "id:NaturalPerson",
    "id:VerifiableAttribute",
    "schema:GovernmentPermit",
  ],
  address: ["vcard:Address", "schema:PostalAddress"],
  files: ["poddrive:DriveRoot"],
  docs: ["pd:Document"],
  notes: ["schema:TextDigitalDocument", "schema:NoteDigitalDocument"],
  bookmarks: ["bookmark:Bookmark", "book:Bookmark"],
  agenda: ["schema:Event", "ical:Vevent", "sched:CalendarEvent"],
  tasks: ["wf:Task", "ical:Vtodo", "sched:Task"],
  "body-measurements": ["health:Observation", "schema:MedicalEntity", "schema:HealthValue"],
  "medical-history": ["health:Condition", "health:Immunization", "schema:MedicalCondition"],
  activity: ["schema:ExerciseAction", "health:ObservationActivity", "health:StepCountObservation"],
  vitals: ["health:VitalSign", "health:HeartRateObservation", "health:SleepObservation"],
  medication: ["health:MedicationStatement", "schema:Drug"],
  "payment-cards": ["fin:CreditAccount", "schema:PaymentCard"],
  transactions: ["fin:Transaction", "fin:Transfer", "schema:Invoice", "schema:Order"],
  stocks: ["fin:Holding", "fin:InvestmentAccount", "fin:FinancialInstrument"],
  "income-expenses": [
    "fin:FinancialAccount",
    "fin:CurrentAccount",
    "fin:SavingsAccount",
    "schema:BankAccount",
    "schema:MonetaryAmount",
  ],
  streaming: [
    "schema:WatchAction",
    "schema:VideoObject",
    "schema:Movie",
    "schema:TVSeries",
    "schema:VideoGame",
  ],
  music: [
    "schema:MusicRecording",
    "schema:MusicPlaylist",
    "mo:Track",
    "mo:Playlist",
    "mo:Record",
    "schema:ListenAction",
  ],
  books: ["schema:Book"],
  photos: ["schema:Photograph", "schema:ImageObject", "schema:ImageGallery"],
  "work-experience": [
    "schema:Organization",
    "schema:OrganizationRole",
    "schema:JobPosting",
    "schema:SoftwareSourceCode",
    "foaf:OnlineAccount",
  ],
  diplomas: ["schema:EducationalOccupationalCredential", "schema:EducationalOrganization"],
  "personality-test": ["id:AttributeAssertion", "schema:CreativeWork"],
  "drivers-licence": ["schema:GovernmentPermit", "id:IdentityDocumentNumber"],
  journeys: ["schema:TravelAction", "schema:Trip", "schema:Vehicle"],
  contacts: ["vcard:AddressBook", "vcard:Individual", "vcard:Group"],
  following: [
    "schema:SocialMediaPosting",
    "foaf:Group",
    "foaf:OnlineAccount",
    "as:Note",
    "sioc:Note",
    "schema:Message",
  ],
};
const BASES: Record<string, string> = {
  schema: NS.SCHEMA,
  foaf: NS.FOAF,
  vcard: NS.VCARD,
  id: NS.IDENTITY,
  health: NS.HEALTH,
  poddrive: NS.POD_DRIVE,
  pd: NS.POD_DOCS,
  bookmark: "http://www.w3.org/2002/01/bookmark#",
  book: NS.BOOKMARK,
  ical: NS.CAL,
  sched: NS.SCHEDULING,
  wf: NS.WF,
  fin: NS.FINANCE,
  mo: "http://purl.org/ontology/mo/",
  as: NS.AS,
  sioc: NS.SIOC,
};

describe("Home spec §5.1", () => {
  it("keeps the nine ordered domains and hides Other until populated", () => {
    expect(DOMAINS.map((domain) => domain.id)).toEqual([
      "personal",
      "documents",
      "calendar",
      "body-health",
      "financial",
      "media",
      "work-study",
      "mobility",
      "socials",
    ]);
    expect(visibleDomains([])).toBe(DOMAINS);
    expect(visibleDomains([classificationForClass(`${NS.SCHEMA}Book`)])).toBe(DOMAINS);
    expect(visibleDomains([{ domain: UNCATEGORISED }])).toEqual([...DOMAINS, UNCATEGORISED]);
    expect(classificationForType("missing")).toEqual({ domain: UNCATEGORISED });
    expect(classificationForClass("https://unknown.example/Type")).toEqual({
      domain: UNCATEGORISED,
    });
  });

  for (const [expected, classes] of Object.entries(EXPECTED)) {
    for (const compact of classes) {
      it(`${compact} and all read aliases map to ${expected}`, async () => {
        const [prefix, local] = compact.split(":");
        const iri = `${BASES[prefix as string]}${local}`;
        for (const alias of classAliases(iri)) {
          const extra =
            expected === "work-experience" && local === "OnlineAccount"
              ? " ; schema:url <https://github.com/alice>"
              : expected === "drivers-licence" && local === "GovernmentPermit"
                ? ' ; schema:name "Driving Licence"'
                : local === "CreativeWork"
                  ? " ; schema:additionalType id:AttributeAssertion"
                  : "";
          const dataset = await rdf(`<#it> a <${alias}>${extra} .`);
          const node = primarySubject(dataset, `${STORAGE}item.ttl`);
          expect(node).toBeDefined();
          const profile = expected === "identity" ? `${STORAGE}item.ttl#me` : WEB_ID;
          expect(classifySubject(node as NonNullable<typeof node>, profile).dataType?.id).toBe(
            expected,
          );
          expect(classificationForType(expected).dataType?.classes).toContain(alias);
          expect(BY_CLASS.has(alias)).toBe(true);
        }
      });
    }
  }

  it.each([
    ["https://github.com/alice", "work-experience"],
    ["https://team.slack.com/", "work-experience"],
    ["https://github.com.evil.example/", "following"],
    ["https://social.example/alice", "following"],
    ["javascript:alert(1)", "following"],
    ["not a URL", "following"],
  ])("disambiguates OnlineAccount %s", async (url, expected) => {
    const node = subjectOf(
      await rdf(
        `<#it> a foaf:OnlineAccount ; foaf:accountServiceHomepage <${url.replaceAll(" ", "%20")}> .`,
      ),
      `${STORAGE}item.ttl#it`,
    );
    expect(classifySubject(node).dataType?.id).toBe(expected);
  });

  it("defaults missing account hosts to Following", async () => {
    expect(
      classifySubject(subjectOf(await rdf("<> a foaf:OnlineAccount ."), `${STORAGE}item.ttl`))
        .dataType?.id,
    ).toBe("following");
  });

  it.each([
    "Driving licence",
    "DRIVER'S LICENSE",
    "Permit to park",
  ])("tests all permit names: %s", async (name) => {
    const node = subjectOf(
      await rdf(`<> a old:GovernmentPermit ; old:name <https://bad.example/>, "${name}" .`),
      `${STORAGE}item.ttl`,
    );
    expect(classifySubject(node).dataType?.id).toBe(
      name.includes("park") ? "identity" : "drivers-licence",
    );
  });

  it("uses first-claim table defaults but predicate disambiguation for actual subjects", async () => {
    expect(classificationForClass(`${NS.FOAF}OnlineAccount`).dataType?.id).toBe("work-experience");
    expect(classificationForClass(`${NS.VCARD}Individual`).dataType?.id).toBe("identity");
    expect(classificationForClass(`${NS.SCHEMA}GovernmentPermit`).dataType?.id).toBe("identity");
    for (const [body, expected] of [
      ["<> a health:Observation, health:VitalSign .", "vitals"],
      ["<> a health:Observation, health:ObservationActivity .", "activity"],
      ["<> a schema:CreativeWork .", undefined],
      ["<> a schema:CreativeWork ; schema:additionalType id:NaturalPerson .", undefined],
      ["<> a <https://unknown.example/X>, schema:Book .", "books"],
      ["<> a schema:Book, schema:Movie .", "books"],
    ] as const) {
      const node = subjectOf(await rdf(body), `${STORAGE}item.ttl`);
      expect(classifySubject(node).dataType?.id).toBe(expected);
    }
  });

  it("distinguishes profile Individuals and aggregates profile contact-detail links", async () => {
    const dataset = await rdf(
      '<#me> a vcard:Individual ; vcard:hasEmail "malformed", [ vcard:hasValue <mailto:alice@example.com> ] ; vcard:hasTelephone <tel:+123> .',
      WEB_ID,
    );
    const node = subjectOf(dataset, WEB_ID);
    expect(classifySubject(node, WEB_ID).dataType?.id).toBe("identity");
    expect(classifySubject(node).dataType?.id).toBe("contacts");
    expect(classifySubject(node, `${STORAGE}elsewhere#me`).dataType?.id).toBe("contacts");
    expect(hasProfileContactDetails(node, WEB_ID)).toBe(true);
    expect(hasProfileContactDetails(node)).toBe(false);
    expect(
      hasProfileContactDetails(
        subjectOf(
          await rdf('<#me> vcard:hasEmail "bad" ; vcard:hasTelephone <tel:123> .', WEB_ID),
          WEB_ID,
        ),
        WEB_ID,
      ),
    ).toBe(true);
    expect(
      hasProfileContactDetails(
        subjectOf(await rdf('<#me> vcard:hasEmail "bad" .', WEB_ID), WEB_ID),
        WEB_ID,
      ),
    ).toBe(false);
    const blank = primarySubject(await rdf("[] a vcard:Individual ."), `${STORAGE}item.ttl`);
    expect(isProfileSubject(blank as NonNullable<typeof blank>, WEB_ID)).toBe(false);
  });

  it("keeps manual forms, suite folder slugs and app links within the specified surface", () => {
    expect(classificationForType("photos").dataType?.app).toBeUndefined();
    expect(classificationForType("tasks").dataType).toMatchObject({
      app: "tasks",
      container: "tasks/",
    });
    expect(classificationForType("books").dataType).toMatchObject({
      manualForm: `${NS.SCHEMA}Book`,
      container: "media/books/",
    });
    expect(classificationForType("contact-details").dataType?.classes).toEqual([]);
    expect(classAliases("http://schema.org/Book")).toContain(`${NS.SCHEMA}Book`);
  });
});
