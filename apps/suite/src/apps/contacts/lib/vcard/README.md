<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# vCard subset (CON-L1)

`parseVCards(text): VCard[]` and `serializeVCards(cards): string` are pure TypeScript.
Import them and their types from `./index`. They use platform `TextEncoder` / `TextDecoder`,
without React, hooks, filesystem access, network access or third-party dependencies.

```ts
import { parseVCards, serializeVCards, type VCard } from "./index";

const person: VCard = {
  version: "4.0",
  fn: "Rowan Example",
  emails: [{ value: "rowan@example.org", parameters: { TYPE: ["home"] } }],
  tels: [{ value: "tel:+1-202-555-0142", parameters: { TYPE: ["cell"], VALUE: ["uri"] } }],
  addresses: [],
  categories: ["Example friends"],
};
const contacts = parseVCards(serializeVCards([person]));
```

The object properties map to FN (`fn`), N (`n`), EMAIL (`emails`), TEL (`tels`), ADR
(`addresses`), ORG (`org`), TITLE (`title`), BDAY (`bday`), NOTE (`note`), PHOTO URI (`photo`)
and CATEGORIES (`categories`). Names and addresses use arrays per component so escaped
commas and multiple component values remain distinct. Organization components are an ordered
array. All values are strings, including birthdays; dates are never converted through `Date`.
The optional `bdayValueType` preserves an explicit BDAY VALUE parameter (lowercase), including
`"text"` for freeform birthdays; omit it to use the version's default birthday type.
Repeated categories accumulate; repeated singular properties use their last value.

EMAIL, TEL and ADR carry uppercase parameter names (TYPE values lowercase) and optional Apple
property groups. TYPE lists, PREF, quoted delimiters and v4 RFC 6868 caret escaping survive
semantic round trips. TEL defaults to text; set `VALUE: ["uri"]` for URI handling in either
version. v4 PHOTO and URI TEL values escape commas on export and decode escaped commas on
import; v3 URI punctuation is preserved literally. Other TEXT escapes do not apply to URIs.

Import accepts multiple mixed-version cards, BOM, CRLF/LF/CR, space/tab line folding, Google
repeated TYPE parameters, Apple grouped fields and birthday sentinels, plus v3 legacy
quoted-printable text with soft breaks and declared TextDecoder-supported charsets. UTF-8 is
the default. Structural delimiters are interpreted after transport decoding and before TEXT
unescaping. Unknown properties, vendor extensions and embedded binary photos are discarded.
Photo URIs are preserved without fetching or choosing a rendering policy.

Export writes UTF-8 text, CRLF and lines of at most 75 octets, never splitting a codepoint.
It preserves each card's version and emits plain Unicode instead of quoted-printable/CHARSET.
v3 requires N; when omitted, export adds `N:;;;;`, which parses to five empty components.
Absent optional properties remain absent; explicit empty values remain present. Empty arrays
in a structured component serialize as empty components and parse as `[""]`.

Malformed envelopes, unsupported/missing versions, missing FN, invalid structured arity and
invalid encodings throw `SyntaxError` without including contact data. Serialization rejects
invalid header tokens, invalid URI values and v3 parameter quotes/newlines it cannot represent.
The API is a supported-field converter, not a lossless file editor or full vCard validator.

References: [v3 (RFC 2426)](https://www.rfc-editor.org/rfc/rfc2426),
[v4 (RFC 6350)](https://www.rfc-editor.org/rfc/rfc6350),
[parameter escaping (RFC 6868)](https://www.rfc-editor.org/rfc/rfc6868).
Synthetic fixtures live in `test/fixtures/vcard/exports.ts`; the app's default test command
requires 100% statements, branches, functions and lines for every source file in this directory.
