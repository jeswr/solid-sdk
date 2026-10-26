<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Chat link preview metadata

`extractPreviewMetadata(html, pageUrl)` returns HTML, OpenGraph and Twitter metadata separately.
`createLinkPreview(html, pageUrl)` extracts and chooses a card. Both are synchronous and pure;
neither reads a DOM nor makes network requests. All output strings are untrusted plain text,
never safe HTML. The caller decides whether to load the returned image/icon URLs.

The page URL must be absolute HTTP(S). Relative, root-relative, query, fragment and protocol-relative
metadata URLs resolve against that page URL. After trimming surrounding whitespace, recognized
URL values must also be HTTP(S), without
credentials, controls or backslashes. Invalid candidates throw even if another candidate wins.
No base URL, favicon path or image URL is guessed.

Fields use the first nonempty value, after one entity decode and whitespace normalization for text.
Title/description prefer OpenGraph, Twitter, then HTML. Title finally defaults to the page hostname;
description/image default to null. Image prefers `og:image` (including `og:image:url`), then
`twitter:image` (including `twitter:image:src`). Site name prefers `og:site_name`, `twitter:site`,
then page hostname. Card URL prefers canonical, `og:url`, then page URL. Icon uses the first
`icon`/`shortcut icon`/`apple-touch-icon` link, independently of the content image. Twitter card
type is retained in metadata. Unknown metadata keys and unrelated links are ignored.

The parser accepts metadata-only fragments or documents with explicit, balanced `html`, `head`
and `body` tags (the html wrapper is optional). Only title/meta/link/script/style are accepted
outside the body. Body tags must also be explicitly balanced, except HTML void elements. Body
metadata is ignored. Names and rel tokens are ASCII case insensitive. Attributes may be quoted,
unquoted or boolean, but duplicate attributes and conflicting name/property keys are rejected.
Self-closing syntax is accepted only on void tags. Comments and an initial HTML doctype are
supported. Script/style/textarea contents are opaque; title is RCDATA, so embedded markup is text.

This is an explicit subset rather than HTML5 error recovery. Base elements, foreign content,
templates, noscript, obsolete raw-text elements, escaped/double-escaped script states, malformed
comments/tags, omitted closing tags, malformed Unicode, and unsupported character references in
extracted values throw `PreviewError` with code `invalid-html`. Named references are limited to
amp, quot, apos, lt, gt and nbsp (case sensitive); numeric references require a semicolon and valid
Unicode scalar value (no NUL, disallowed controls, surrogate or C1 replacement cases).

Limits are exported: 512 KiB UTF-8 input and 4,096 markup tokens (including closing tags, comments
and doctype). Exceeding either rejects the entire input with `input-too-large`/`too-many-tags`;
there is no truncation or partial result. Invalid URLs use `invalid-url`. Error messages never
echo input. Some valid HTML is intentionally rejected; callers can show a plain link on error.
