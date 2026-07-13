<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-dav-bridge

Import CalDAV calendars and CardDAV address books into owner-private Solid RDF resources.

iCalendar events map to `schema:Event` plus RDF-iCal terms; vCards map to the suite's shared SolidOS
contact model.

> Import-only and experimental. Keep DAV credentials secret and use an owner-private target
> container.

## Install

```sh
npm install github:jeswr/solid-dav-bridge#main @rdfjs/types
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import { importAddressBook, importCalendar } from "@jeswr/solid-dav-bridge";

const calendar = await importCalendar({
  icsText,
  writeFetch: authenticatedFetch,
  container: "https://alice.example/imports/calendar/",
});

const contacts = await importAddressBook({
  vcfText,
  writeFetch: authenticatedFetch,
  container: "https://alice.example/contacts/",
});
```

Pass `davUrl` and `davAuth` instead of in-hand text to retrieve a remote DAV endpoint through the
package's bounded SSRF guard.

## Key API

- Import: `importCalendar`, `importAddressBook`, `fetchDav`.
- Pure mapping: `veventToEvent`, `vcardToContact`.
- Parsing: `parseComponents`, `findComponents`, `getProperty`, `parseContentLine`, `unfoldLines`.
- Dates and names: `parseICalDate`, `defaultEventSlug`, `defaultContactSlug`.
- Errors: `DavFetchError` never includes the supplied credential.

## Links

- [Source](https://github.com/jeswr/solid-dav-bridge)
- [Issues](https://github.com/jeswr/solid-dav-bridge/issues)
- [RFC 4791: CalDAV](https://www.rfc-editor.org/rfc/rfc4791)
- [RFC 6352: CardDAV](https://www.rfc-editor.org/rfc/rfc6352)

## License

[MIT](./LICENSE) © Jesse Wright
