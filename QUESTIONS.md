<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DRV-L2 conservative interpretations

1. Drive §4.1.3 specifies 180 “chars” and a “full extension chain” without defining
   either precisely. Options: UTF-16 units, Unicode code points, or encoded bytes;
   known compound extensions only, or every suffix after the first non-leading dot.
   This lane counts NFC Unicode code points and preserves every suffix after the
   first non-leading dot (including `.tar.gz`). An extension that leaves no room
   for a stem or conflict suffix is rejected with a typed error.
2. Pure libraries §10 / DRV-L2 requests byte sniffing but gives no precedence or
   unsupported-format policy. Options: trust extensions, trust signatures, or reject
   all mismatches. This lane uses recognized binary signatures first, then the
   extension table, then strict UTF-8 text, then the explicit
   `application/octet-stream` fallback from Drive §4.1.4. Signatures are hints,
   not full-file validation; unsupported signatures return `undefined` from the
   sniffing API. No active text format is inferred from text content alone.
3. Drive §2.2 / DRV-L2 does not specify breadcrumb shape or size rounding. Options:
   include a UI-labelled root crumb or return relative segments; decimal or binary
   units. This lane returns relative `{ label, url }` segments (root = `[]`), uses
   decimal SI units with at most one locale-formatted decimal, and leaves root copy
   to the UI. Container IRIs must be absolute HTTP(S), slash-terminated, without
   credentials, query, fragment, traversal, empty interior segments, or encoded
   separators. Unsupported ambiguous IRIs are rejected, never normalized into a
   different path. Existing names are compared case-sensitively after NFC only.
