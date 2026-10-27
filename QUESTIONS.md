<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CON-L6 conservative interpretations

1. **Country names and missing countries** — CON-L6, ADR conversion and home-country rule;
   specs/apps/14-pure-libraries-6.md. Options: infer a code from a name, require a code on
   import, or preserve names/absence. Chosen: preserve `countryName` verbatim, allow an absent
   country, and use the generic template. Never infer a code. Reject simultaneous code/name
   values because the single ADR country component cannot preserve both. Formatting takes a
   required ISO home code; a named country is displayed because domestic equality is unknown.
   Country codes display as codes, without introducing a country-name translation table.
2. **Street values and component limits** — CON-L6, seven-component ADR and size limits.
   Options: comma-separated street values, embedded newlines, or both. Chosen: RFC 6350
   comma-separated street values (also used by the existing vCard library), each limited to
   256 UTF-16 code units, like each scalar field. Reject embedded line breaks and multi-value
   non-street components rather than flattening or discarding data. Require exactly seven ADR
   components; reject malformed/unknown escapes. Bound raw ADR length by the largest possible
   escaped representation of eight street lines and six scalar components before parsing.
3. **Exact formatting/regex spellings** — CON-L6 names twelve templates but supplies no table.
   Options: introduce a postal metadata dependency, discard unusual region fields, or use
   fixed explicit templates. Chosen: hand-written source tables, preserve any supplied region,
   use Latin-script order for JP, and perform syntax-only postal checks. Missing postal codes
   produce no warning; a nonempty invalid code yields `INVALID_POSTAL_CODE`, never an error.
