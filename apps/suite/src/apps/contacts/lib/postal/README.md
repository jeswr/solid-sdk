<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Postal addresses (CON-L6)

Pure TypeScript, without I/O or runtime dependencies. Import from `./index`:

```ts
const address = fromVCardAdr(";;12 Example Lane,Fictional Annex;Exampletown;CA;12345;US");
const warnings = validatePostalAddress(address); // [] or INVALID_POSTAL_CODE warnings
formatAddressMultiline(address, "US"); // country omitted for a matching home code
formatAddressSingleLine(address, "GB"); // nonempty display lines joined with ', '
toVCardAdr(address); // seven escaped components, without ADR: or parameters
```

`PostalAddress` contains `street: readonly string[]`, `locality`, `region`, `postalCode`, and
optional `countryCode`, `countryName`, `poBox`, `extended`. Scalars may be empty. Codes must be
assigned uppercase ISO 3166-1 alpha-2 values. Named countries import into `countryName` verbatim,
without guessing a code. An empty country imports as absent. Simultaneous name/code fields are
rejected because a single ADR country value cannot preserve both.

Formatting requires an assigned uppercase `homeCountry`. A matching code suppresses the country
line; a name is displayed because its relationship to the home code is unknown. Codes display as
codes. Unknown country names and other assigned codes use the generic template. Only display
output trims outer whitespace and omits empty components; serialization preserves spelling.
`poBox` and `extended` precede street lines. The exact templates live in `format.ts`; the twelve
fixed postal regexes and their table live in `countries.ts`. Missing postal codes and countries
without a regex produce no warning. A nonempty malformed postal code produces a warning from
`validatePostalAddress`, and remains usable for formatting and ADR conversion.

ADR uses six unescaped semicolons, with comma-separated street values. Literal `;`, `,`, and `\`
are escaped with `\` in every field. Empty optional fields are omitted on import; one empty
street value becomes `[]`, while empty positions in a multi-value street list are preserved.
The existing contacts vCard parser/serializer uses the same street-list representation. The
library rejects multi-value scalar components, unknown/dangling escapes, embedded controls or
line breaks (including escaped `\n`), and wrong field types rather than flattening data. Full
vCards, property headers, parameters and transport encodings belong to the vCard library.

All failures are `PostalAddressError` with `code`:

| Code | Meaning |
| --- | --- |
| `ADDRESS_TOO_LARGE` | More than `MAX_STREET_LINES` (8), or a scalar/street line longer than `MAX_ADDRESS_COMPONENT_LENGTH` (256 UTF-16 code units), or raw ADR longer than `MAX_ADR_VALUE_LENGTH` (7181). |
| `INVALID_COUNTRY` | Invalid code (including lowercase, reserved and unknown codes), a code-shaped countryName, or conflicting country representations. |
| `INVALID_ADDRESS` | Wrong address shape/types or unsupported controls/line breaks. |
| `INVALID_ADR` | Wrong ADR type, component count, unsupported lists or malformed/unsupported escaping. |

Structured validation checks the street count and all string lengths before scanning or copying
text. ADR checks the raw length before parsing, then enforces decoded field and street counts
incrementally. `MAX_ADR_VALUE_LENGTH` follows from fourteen maximally escaped 256-unit values
(eight street lines plus six scalar ADR fields), six semicolons and seven commas. Error messages
exclude caller address data. Tests exercise both exact bounds and bound+1.

See root `QUESTIONS.md` for conservative interpretations of underspecified cases.
