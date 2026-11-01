<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Phone number normalisation (CON-L5)

Pure TypeScript, with a bundled calling-code table and no dependencies or I/O. Import from
`./index`. This is a deliberately bounded structural parser, not an allocation database,
reachability check, full libphonenumber replacement or dialler. No country is inferred from
shared calling codes, area codes, the device locale or punctuation.

```ts
import {
  parsePhoneNumber, normalisePhoneNumber, formatPhoneNumber, phoneNumbersEqual,
} from "./index";

parsePhoneNumber("020 7946 0123 ext. 0042", "GB");
// { e164: "+442079460123", callingCode: "44", nationalNumber: "2079460123", extension: "0042" }
formatPhoneNumber("+442079460123", "national"); // "020 7946 0123"
formatPhoneNumber("020 7946 0123", "international", "GB"); // "+44 20 7946 0123"
phoneNumbersEqual("020 7946 0123 x0042", "+442079460123;ext=0042", "GB"); // true
normalisePhoneNumber("  local switchboard  ", "GB");
// { ok: false, original: "  local switchboard  ", error: PhoneNumberError }
```

## Supported subset

| Default region | Calling code | Accepted national numbers | National display | International display |
| --- | --- | --- | --- | --- |
| US, CA | 1 (shared NANP) | 10 digits `NXX NXX XXXX`, N = 2–9, X = 0–9; optional domestic `1` prefix | `(202) 555-0101` | `+1 202 555 0101` |
| GB | 44 | London `020` + 8 digits; UK mobile `07` + second digit 1–5 or 7–9 + 8 digits | `020 7946 0123`; `07700 900123` | `+44 20 7946 0123`; `+44 7700 900123` |
| AU | 61 | Geographic `02/03/07/08` + 8 digits; mobile `04` + 8 digits | `(02) 5550 1234`; `0491 570 006` | `+61 2 5550 1234`; `+61 491 570 006` |

GB/AU national input requires its domestic `0`; international `+` input must omit it.
US/CA use one shared syntax, including international `+1` input from any NANP territory;
results expose the calling code, never a guessed country. Matching the structural pattern
means neither that a range is allocated nor that an individual number is in service.
The GB subset excludes other cities, personal `070`, paging `076`, and special services;
AU excludes freephone/local-rate and other special services. Other calling codes fail closed.
The maximum accepted base length is 12 digits, within E.164's 15-digit limit.

- International input **must** start with `+`. National input needs an explicit uppercase
  `PhoneRegion` (`US`, `CA`, `GB`, `AU`); there is no implicit default. An explicit invalid
  region is rejected even with international input. International format determines its own
  calling plan and ignores a valid default region.
- Only ASCII digits, spaces, dots, hyphens and balanced, non-nested digit parentheses are
  accepted in the base. Separators belong between digit groups. ASCII surrounding spaces
  are allowed. Empty input, controls (including newline/tab), Unicode whitespace/digits,
  malformed UTF-16, over 256 UTF-16 code units, misplaced `+`, trailing separators and
  unbalanced parentheses are rejected without coercion or Unicode rewriting.
- An optional suffix `ext 123`, `ext. 123`, `x123` or `;ext=123` is case-insensitive and
  contains 1–10 ASCII digits. Surrounding ASCII spaces and spaces after `ext`/`x` are allowed;
  `;ext=` is contiguous. Only one extension is allowed. Leading zeroes remain significant.
  E.164 excludes the extension; both display formats append ` ext. <digits>`.
- Local-only numbers, emergency/short codes, IDD (`00`/`011`/`0011`), optional international
  `(0)`, vanity letters, `tel:` URIs, phone-context and other URI parameters are unsupported.
  Digits are never discarded to make an unsupported number fit a plan.
- Strict parse/format/equality calls throw `PhoneNumberError` with a stable typed `code`:
  `invalid-input`, `invalid-region`, `missing-region`, `invalid-format`, `invalid-extension`,
  or `unsupported-number`. Messages never echo input. Invalid extension/letter/URI syntax
  is reported as `invalid-extension`. Unexpected implementation errors propagate.
- `normalisePhoneNumber` returns `{ ok: true, original, number }` or
  `{ ok: false, original, error }`. The latter flags unusable strings and preserves them
  **verbatim**, including blank, overlong or malformed text, with no number or duplicate key.
  Non-string runtime inputs throw `invalid-input` because no verbatim string exists.
- Equality parses both operands and compares E.164 **and** extension exactly. No extension
  differs from any extension; `001` differs from `1`. Invalid values throw, even if the raw
  strings match. A match is a duplicate hint, not permission to merge contacts automatically.
  Callers comparing numbers with different regional defaults can first supply explicit `+`
  numbers. The existing contacts dedupe helper remains unchanged in this lane.

Numbering references: [NANPA plan](https://www.nanpa.com/about),
[Ofcom numbering plan](https://www.ofcom.org.uk/phones-and-broadband/phone-numbers/numbering),
[ACMA number types](https://www.acma.gov.au/choose-your-phone-number).
Synthetic fixtures use [NANPA's reserved 555-0100–0199 numbers](https://nanpa.com/numbering/555-line-numbers),
[Ofcom drama ranges](https://www.ofcom.org.uk/phones-and-broadband/phone-numbers/numbers-for-drama)
and [ACMA fiction numbers](https://www.acma.gov.au/phone-numbers-use-tv-shows-films-and-creative-works).
The code table is a local supported subset, not downloaded metadata. New plans require explicit
rules, round-trip/rejection fixtures and renewed review. Root `QUESTIONS.md` records the scope
choices. Vitest enforces 100% statements, branches, functions and lines per file, including the
barrel, through the phone directory's coverage glob.
