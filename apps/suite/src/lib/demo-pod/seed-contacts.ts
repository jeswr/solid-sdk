// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import {
  buildAddressBook,
  buildGroup,
  buildPerson,
  Contact,
  ContactBook,
  ContactGroup,
} from "@jeswr/solid-task-model/contacts";
import { NamedNodeAs, NamedNodeFrom, SetFrom } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { TypeRegistration } from "../../apps/contacts/lib/model/discovery";
import type { DemoSeedFile } from "./pod";

const ROOT = "https://alice.demo.pod/";
const BOOK = `${ROOT}contacts/book.ttl`;
const names = [
  "Ada Fern",
  "Amir Vale",
  "Bea Linden",
  "Bob Meadow",
  "Cleo Moss",
  "Dara Finch",
  "Eli Rowan",
  "Élodie Brook",
  "Farah Reed",
  "Felix Bay",
  "Gia Elm",
  "Hana Cove",
  "Idris Oak",
  "Inez Sky",
  "Jae Willow",
  "Jules Wren",
  "Kai Ash",
  "Lena Frost",
  "Mira Quill",
  "Noah Lake",
  "Nora Bloom",
  "Omar Pine",
  "L. Frost",
  "Pia Dawn",
  "Quinn Cedar",
  "Rae Maple",
  "Remy Coast",
  "Theodore Sage",
  "Rory Grove",
  "Sam Briar",
  "Sana Hill",
  "Tali Ember",
  "Theo Sage",
  "Omar Pine",
  "Vera Snow",
  "Wren Stone",
  "Xavi Clay",
  "Yara Birch",
  "Zara Cloud",
  "Zoe River",
];
// Deliberate duplicates for Merge duplicates: L. Frost shares Lena Frost's phone, Theodore Sage
// shares Theo Sage's email (spelt with capitals) and the second Omar Pine has the same email.
const duplicateEmails: Record<number, string[]> = {
  27: ["mailto:Theo.Sage@example.org", "mailto:theodore.sage@example.org"],
};
const duplicatePhones: Record<number, string[]> = { 22: ["tel:+12025550117"] };
function turtle(dataset: Store | ReturnType<typeof buildPerson>): Promise<string> {
  const writer = new Writer({ format: "text/turtle" });
  writer.addQuads([...dataset]);
  return new Promise((resolve, reject) =>
    writer.end((error, text) => (error ? reject(error) : resolve(text))),
  );
}

/** Appends the Contacts fixtures while preserving every other app's Type Index entries. */
export async function seedContacts(
  files: DemoSeedFile[],
  now: number,
  count = 40,
): Promise<DemoSeedFile[]> {
  // Only development fixture builds inspect the URL. Production always uses the small seed.
  if (process.env.NEXT_PUBLIC_DEV_FIXTURES === "1" && typeof window !== "undefined") {
    const fixture = new URLSearchParams(window.location.search).get("seed");
    if (fixture === "contacts-200") count = 200;
    if (fixture === "contacts-empty") count = 0;
    if (fixture === "contacts-no-book") return files;
  }
  const indexFile = files.find((file) => file.path === "settings/privateTypeIndex.ttl");
  const indexUrl = `${ROOT}settings/privateTypeIndex.ttl`;
  const index = new Store(
    indexFile
      ? [...(await parseRdf(String(indexFile.body), "text/turtle", { baseIRI: indexUrl }))]
      : [],
  );
  for (const [suffix, kind, location] of [
    ["book", "AddressBook", `${BOOK}#this`],
    ["pm", "Individual", `${ROOT}contacts-pm/`],
  ] as const) {
    const registration = new TypeRegistration(`${indexUrl}#contacts-${suffix}`, index, DataFactory);
    registration.types.add("http://www.w3.org/ns/solid/terms#TypeRegistration");
    registration.classes.add(`http://www.w3.org/2006/vcard/ns#${kind}`);
    if (suffix === "book") registration.instance = location;
    else registration.container = location;
  }
  const added: DemoSeedFile[] = [];
  const add = async (path: string, dataset: Store | ReturnType<typeof buildPerson>) => {
    added.push({ path, body: await turtle(dataset), contentType: "text/turtle", modified: now });
  };
  await add(
    "contacts/book.ttl",
    buildAddressBook(BOOK, { title: "Contacts", owner: `${ROOT}profile/card#me` }),
  );
  const people = new Store();
  const groups = new Store();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const name =
      i < names.length ? (names[i] as string) : `Zora Example ${String(i - 39).padStart(3, "0")}`;
    const slug = `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    const path = `contacts/people/${slug}.ttl`;
    const url = `${ROOT}${path}`;
    const id = `${url}#this`;
    ids.push(id);
    const email = `${name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, ".")}@example.org`;
    const personDataset = buildPerson(url, {
      name,
      emails: duplicateEmails[i] ?? [`mailto:${email}`],
      ...(i % 5
        ? {
            phones: duplicatePhones[i] ?? [
              `tel:+1202555${String(100 + (i % 100)).padStart(4, "0")}`,
            ],
          }
        : {}),
      ...(i % 3 === 0
        ? {
            organization: "Fictional Observatory",
            note: "Met at the community garden. Loves sharing stories and good books.",
          }
        : {}),
      ...(i === 3 ? { webId: "https://bob.demo.pod/profile/card#me" } : {}),
      inAddressBook: `${BOOK}#this`,
      created: new Date("2026-01-01T00:00:00Z"),
    });
    new Contact(id, personDataset, DataFactory).uid = `urn:uuid:${slug}`;
    await add(path, personDataset);
    const entry = new Contact(id, people, DataFactory);
    entry.name = name;
    entry.inAddressBook = `${BOOK}#this`;
  }
  for (const [i, name] of ["Family", "Work", "Book club"].entries()) {
    const url = `${ROOT}contacts/groups/label-${i}.ttl`;
    const members = ids.filter((_, position) => position % 3 === i);
    await add(
      `contacts/groups/label-${i}.ttl`,
      buildGroup(url, { name, members, inAddressBook: `${BOOK}#this` }),
    );
    new ContactBook(`${BOOK}#this`, groups, DataFactory).includesGroup.add(`${url}#this`);
    new ContactGroup(`${url}#this`, groups, DataFactory).name = name;
  }
  await add("contacts/people.ttl", people);
  await add("contacts/groups.ttl", groups);
  // Legacy PM contacts use direct IRIs, exactly the subset that can migrate losslessly.
  const Vcard = "http://www.w3.org/2006/vcard/ns#";
  for (const [i, name] of ["Pax Orchard", "Tess Harbor"].entries()) {
    const dataset = new Store();
    const person = new Contact(
      `${ROOT}contacts-pm/person-${i}.ttl#it`,
      dataset,
      DataFactory,
    ).mark();
    person.name = name;
    person.organization = "Fictional Bookshop";
    person.note = "A friend from Pod Manager.";
    // Typed direct-IRI accessors retain PM's flat shape (the normal setters build value nodes).
    SetFrom.subjectPredicate(
      person,
      `${Vcard}hasEmail`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    ).add(`mailto:legacy${i}@example.org`);
    SetFrom.subjectPredicate(
      person,
      `${Vcard}hasTelephone`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    ).add("tel:+442079460123");
    await add(`contacts-pm/person-${i}.ttl`, dataset);
  }
  return [
    ...files.filter((file) => file.path !== "settings/privateTypeIndex.ttl"),
    {
      path: "settings/privateTypeIndex.ttl",
      body: await turtle(index),
      contentType: "text/turtle",
      modified: now,
    },
    ...added,
  ];
}
