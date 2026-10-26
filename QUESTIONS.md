<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-lurx interpretation questions

1. CHT-L4 / specs/apps/13-pure-libraries-5.md does not specify parser limits or an HTML grammar.
   Options: a full HTML5 parser dependency, or a bounded, explicit subset. Conservative choice:
   no new dependency; accept explicitly balanced HTML documents or metadata fragments, with a
   512 KiB UTF-8 input limit and 4,096 markup tokens (including closing tags, comments and doctype).
   Reject malformed markup and unsupported browser parsing contexts (base, foreign content,
   templates, noscript, obsolete raw-text elements and script escape states) with typed errors.
   Decode six common named entities and valid numeric references; reject unsupported references
   in extracted values. This intentionally rejects some valid HTML instead of guessing.

2. CHT-L4 does not specify duplicate handling or preview precedence. Options: first/last value,
   OpenGraph/Twitter/HTML order, and absent-field defaults. Conservative choice: first nonempty
   value per field; OpenGraph then Twitter then HTML for title/description, hostname for the final
   title/site fallback, null for absent description/image. Site name uses og:site_name, then
   twitter:site, then page hostname. Card URL uses canonical, then og:url, then the page URL.
   Icon is extracted separately and never substituted for a content image. Invalid or non-http(s)
   recognized URL values reject the input, even when a higher-priority value exists.
