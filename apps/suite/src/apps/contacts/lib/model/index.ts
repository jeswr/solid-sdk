// AUTHORED-BY Codex GPT-6.1-Sol
export {
  type AddressBookData,
  buildAddressBook,
  buildGroup,
  buildPerson,
  Contact,
  ContactBook,
  type ContactData,
  ContactGroup,
  type ContactGroupData,
  parseAddressBook,
  parseAddressBookTtl,
  parseGroup,
  parseGroupTtl,
  parsePerson,
  parsePersonTtl,
  serializeAddressBook,
  serializeGroup,
  serializeGroupsIndex,
  serializePeopleIndex,
  serializePerson,
} from "@jeswr/solid-task-model/contacts";
export { ContactsModel } from "./book";
export {
  BOOK_CLASS,
  CONTACT_CLASS,
  ContactsDataset,
  contactData,
  documentUrl,
  flatContacts,
  GROUP_CLASS,
  type IndexEntry,
  readGroupsIndex,
  readPeopleIndex,
  sortedSections,
  VCARD,
  validateContact,
} from "./data";
export {
  discoverContacts,
  registerAddressBook,
  TypeIndexDataset,
  TypeRegistration,
} from "./discovery";
export { importVcards, parseVcards } from "./import";
export { ContactsWriteError, PartialWriteError, type Snapshot } from "./transport";
