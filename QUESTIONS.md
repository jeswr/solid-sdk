<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CON-L5 conservative interpretations

1. Which regions and number classes must be supported? CON-L5 in `specs/apps/tasks.json`
   and `specs/apps/13-pure-libraries-5.md` require a documented set but do not enumerate it.
   Options: a full global numbering database, or a bounded bundled subset. This lane uses
   US/CA (shared NANP syntax; no country inference), GB (London geographic and UK mobile
   numbers only), and AU (geographic and mobile numbers only). Other classes and calling
   codes fail closed. The supplied default region is explicit, never inferred from locale.
2. How do typed rejection and verbatim preservation coexist? CON-L5 requires both.
   Options: throw only, or expose strict parsing plus a preserving result wrapper. This
   lane supplies both: strict parsing/formatting/equality throw `PhoneNumberError`;
   normalisation returns a discriminated failure containing the exact original and error.
   Rejected values never receive an E.164 value or a duplicate key.
3. Should extensions be ignored during duplicate detection? CON-L5 specifies extension
   handling and equality without a matching policy. Options: compare base numbers only,
   or require equal base numbers and extensions. This lane takes the latter: an absent
   extension differs from a present one, and leading extension zeroes remain significant.
4. Should IDD prefixes and optional trunk notation be reinterpreted? CON-L5 says never
   guess. Options: region-specific dialling rules or an explicit `+` for international
   input. This lane requires `+`; `00`, `011`, `0011`, optional `(0)` after a calling code,
   local-only numbers, vanity letters and unsupported telephone URI parameters fail closed.
