<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CON-L1 (sst-kyf5) interpretation questions

1. **Plain object contract and unsupported properties** — 09-pure-libraries and
   07-parity-backlog §Contacts specify fields but no object schema or lossless preservation
   policy. Options: expose arbitrary content lines, or expose only the requested typed fields.
   Conservative implementation: `VCard` exposes the requested fields; repeated EMAIL/TEL/ADR
   retain parameters and Apple group identifiers. Unknown properties (including Apple labels)
   and embedded binary PHOTO are ignored. Singular fields use the last occurrence. Export is
   semantic, not byte-for-byte preservation of the source file.
2. **Invalid input and legacy encodings** — CON-L1 in tasks.json / 09-pure-libraries does not
   define recovery or charset policy. Options: silently repair incomplete cards, or reject
   invalid boundaries/versions/missing FN and invalid encodings. Conservative implementation:
   throw `SyntaxError` without echoing input values; accept LF/CRLF/CR, BOM, folded lines,
   legacy bare type parameters and v3 quoted-printable with TextDecoder-supported charsets
   (UTF-8 by default). BDAY remains a string, preserving reduced dates and exporter sentinels.
   Export writes UTF-8, CRLF and ≤75-octet folded lines; v3 export supplies an empty N when
   absent because N is required by v3. No UI or data-layer decisions are made.
