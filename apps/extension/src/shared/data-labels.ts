// AUTHORED-BY Codex GPT-6.1-Sol
/** Display copy only. Class identifiers and modes sent to the worker remain unchanged. */
const CLASSES: Readonly<Record<string, { label: string; description: string }>> = {
  'https://schema.org/TextDigitalDocument': {
    label: 'Documents',
    description: 'Text documents and notes in your pod.',
  },
  'https://schema.org/NoteDigitalDocument': {
    label: 'Notes',
    description: 'Notes saved in your pod.',
  },
  'https://schema.org/Person': {
    label: 'Contacts',
    description: 'Names and contact information saved in your pod.',
  },
  'http://www.w3.org/2006/vcard/ns#Individual': {
    label: 'Contacts',
    description: 'Names and contact information saved in your pod.',
  },
  'http://www.w3.org/2006/vcard/ns#AddressBook': {
    label: 'Contacts',
    description: 'Your address book and its contacts.',
  },
  'https://schema.org/PostalAddress': {
    label: 'Addresses',
    description: 'Postal addresses saved in your pod.',
  },
  'http://www.w3.org/2006/vcard/ns#Address': {
    label: 'Addresses',
    description: 'Postal addresses saved in your pod.',
  },
  'http://www.w3.org/2002/12/cal/ical#Vevent': {
    label: 'Calendar events',
    description: 'Events and appointments in your pod.',
  },
  'https://schema.org/Event': {
    label: 'Calendar events',
    description: 'Events and appointments in your pod.',
  },
  'http://www.w3.org/ns/pim/meeting#LongChat': {
    label: 'Chats',
    description: 'Conversations and messages in your pod.',
  },
};

export function dataClassCopy(value: string): { label: string; description: string } {
  const known = CLASSES[value.replace(/^http:\/\/schema.org\//, 'https://schema.org/')];
  if (known) return known;
  try {
    const url = new URL(value);
    const local = decodeURIComponent(url.hash.slice(1) || url.pathname.split('/').pop() || '');
    return {
      label: local.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ') || 'Other data',
      description: 'Only the items listed below are included in this request.',
    };
  } catch {
    return { label: 'Other data', description: 'Only the items listed below are included.' };
  }
}

export function accessModeLabel(mode: string): string {
  return (
    ({ read: 'Read', append: 'Add', write: 'Edit and delete' } as Record<string, string>)[mode] ??
    'Other access'
  );
}
