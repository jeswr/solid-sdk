// AUTHORED-BY Codex GPT-6.1-Sol
/** People API v1 shapes, limited to the requested fields. All fixture data is synthetic. */
import type { FixtureRoute } from "../core/types.js";

export const PEOPLE_API = "https://people.googleapis.com/v1/people/me/connections";
export interface GoogleFieldMetadata {
  primary?: boolean;
}
export interface GoogleName {
  metadata?: GoogleFieldMetadata;
  displayName?: string;
  givenName?: string;
  familyName?: string;
  middleName?: string;
  honorificPrefix?: string;
  honorificSuffix?: string;
}
export interface GoogleContactValue {
  value?: string;
  type?: string;
}
export interface GooglePhone extends GoogleContactValue {
  canonicalForm?: string;
}
export interface GoogleAddress {
  type?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}
export interface GoogleOrganization {
  name?: string;
  title?: string;
  jobDescription?: string;
}
export interface GoogleBirthday {
  date?: { year?: number; month?: number; day?: number };
}
export interface GooglePerson {
  resourceName?: string;
  metadata?: { deleted?: boolean };
  names?: GoogleName[];
  emailAddresses?: GoogleContactValue[];
  phoneNumbers?: GooglePhone[];
  addresses?: GoogleAddress[];
  organizations?: GoogleOrganization[];
  birthdays?: GoogleBirthday[];
}
export interface GoogleConnectionsList {
  connections?: GooglePerson[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export const PEOPLE: GooglePerson[] = [
  {
    resourceName: "people/c101",
    names: [
      {
        metadata: { primary: true },
        displayName: "Dr Alex Morgan Example Jr",
        givenName: "Alex",
        middleName: "Morgan",
        familyName: "Example",
        honorificPrefix: "Dr",
        honorificSuffix: "Jr",
      },
    ],
    emailAddresses: [
      { value: "alex@example.test", type: "home" },
      { value: "alex@work.example.test", type: "work" },
      { value: "alex@club.example.test", type: "custom" },
    ],
    phoneNumbers: [
      { value: "+1 (202) 555-0101", canonicalForm: "+12025550101", type: "home" },
      { value: "+12025550102", type: "work" },
      { value: "ask reception, extension 42", type: "other" },
    ],
    addresses: [
      {
        type: "home",
        streetAddress: "10 Synthetic Street\nUnit 2",
        city: "Exampleton",
        region: "Example County",
        postalCode: "EX1 2AB",
        country: "Exampleland",
      },
    ],
    organizations: [
      { name: "Example Workshop", title: "Engineer", jobDescription: "Volunteer coordinator" },
    ],
    birthdays: [{ date: { year: 1990, month: 6, day: 11 } }],
  },
  {
    resourceName: "people/c102",
    names: [{ displayName: "Sam Example", givenName: "Sam", familyName: "Example" }],
    birthdays: [{ date: { month: 2, day: 29 } }],
  },
];
export const CONNECTIONS: GoogleConnectionsList = {
  connections: PEOPLE,
  nextSyncToken: "synthetic-sync-1",
};
export const GOOGLE_CONTACTS_FIXTURES: readonly FixtureRoute[] = [
  { url: PEOPLE_API, json: CONNECTIONS },
];
