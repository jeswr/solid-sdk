<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Mail composition (MAI-L3)

Pure TypeScript; import from `./index`. No transport, React, ambient clock or ambient random source.

```ts
const message = composeMessage(
  {
    from: { email: "alice@example.org", name: "Alice Example" },
    to: [{ email: "bob@example.org", name: "Bob Example" }],
    subject: "Hello",
    text: "A plain text version.",
    html: "<p>A rich text version.</p>",
    attachments: [{ filename: "note.txt", contentType: "text/plain", charset: "utf-8", data: bytes }],
  },
  { clock: () => new Date(), randomBytes, messageIdDomain: "example.org" },
);
// Deliver message.raw to message.envelope.to through a separately authorized transport.
```

`randomBytes(length)` must return exactly `length` bytes; the composer requests 16. Production
callers must inject a cryptographically secure source and a domain they control for Message-ID
uniqueness. Tests can inject fixed bytes/time. The returned `date` is a copy. Inputs are not mutated.

The serializer emits ASCII with CRLF line endings. UTF-8 base64 encoded-words preserve Unicode
subjects/display names, split at code-point boundaries (≤75 characters per encoded-word).
ASCII display names are quoted with escaped quotes/backslashes; encoded-words appear outside
quotes. Whitespace-sensitive, long and literal encoded-word-looking subjects are also encoded.
Headers fold at address/encoded-word/identifier boundaries. Long indivisible tokens may exceed
the recommended 78 characters; the RFC 5322 hard limit of 998 is enforced. Fields containing
encoded-words use the mandatory 76-character line limit, including the field name and continuation
whitespace; indivisible tokens that cannot fit that limit are rejected.

Plain text is required, HTML optional (no HTML-to-text conversion or sanitization). Text line
endings are canonicalized to CRLF before UTF-8 encoding. Both text and binary attachments use
base64 lines of at most 76 columns. HTML creates `multipart/alternative` with plain text first;
attachments create an outer `multipart/mixed`. Separate boundary prefixes and base64 leaf parts
prevent delimiter collisions even with deterministic random bytes. Unicode filenames use RFC 2231
UTF-8 continuation parameters. Bcc appears only in the delivery envelope. Envelope recipients are
deduplicated, preserving first occurrence and local-part case, ignoring domain case.

`reply(original, identities)` and `replyAll(original, identities)` return plain text drafts; supply
all own email addresses/aliases to remove self. Reply-To overrides From. For a self-sent message,
To becomes the fallback target. Reply-all additionally includes original To/Cc, with To taking
precedence. Both quote each original line after a UTC date/author attribution and add Re: unless
already present (case-insensitive). References preserves the supplied chain (or a single
In-Reply-To fallback), deduplicates it, then appends the parent's Message-ID. A source lacking a
Message-ID retains known ancestry in References and omits In-Reply-To. `forward(original)` starts an unthreaded, recipient-free Fwd:
draft with attribution; callers explicitly choose recipients and attachments. Decoded Unicode
names remain readable in forward text. Returned recipients are copies.

Unsupported inputs throw `ComposeError` with `code` and a safe `field`, without echoing input:

- `invalid-input`: malformed values, control characters in headers, lone Unicode surrogates,
  invalid dates (supported years 1900–9999), invalid metadata or missing recipients.
- `unsupported-address`: anything outside structured ASCII dot-atom local parts and DNS domains.
  Quoted locals, groups, comments, domain literals and SMTPUTF8 require another implementation.
  Local parts are limited to 64 characters, total mailboxes to 254, domain labels to 63.
- `invalid-source`: injected clock/random function missing or throwing.

Message-ID inputs and generated IDs use the same dot-atom/DNS subset (≤254 characters inside
angle brackets); excessively long generation domains are rejected rather than emitting an ID
that the reply helpers could not accept.
Empty supplied Reply-To is rejected. Attachment media types must be bare leaf `type/subtype`
(no inline parameters, multipart or message types). Text attachments accept an optional `charset`
containing a nonempty ASCII MIME token, serialized as a Content-Type parameter. Callers must
encode `data` in that charset; attachment bytes are preserved without transcoding or newline
conversion. Text attachment data must already use canonical CRLF octet pairs: bare CR or LF
is rejected with `ComposeError` (`invalid-input`, field `attachment.data`), regardless of charset
or text subtype. Binary attachments preserve arbitrary bytes. No charset is inferred when omitted;
set `charset: "utf-8"` for UTF-8 text bytes.
Charsets on non-text attachments are rejected. Filenames must be nonempty, ≤180 UTF-8 bytes, and
contain neither control characters nor path separators. Dates and byte-source results outside
the documented contract are rejected. Error fields never include user content.

Standards: [RFC 5322](https://www.rfc-editor.org/rfc/rfc5322),
[RFC 2047](https://www.rfc-editor.org/rfc/rfc2047),
[RFC 2045](https://www.rfc-editor.org/rfc/rfc2045),
[RFC 2231](https://www.rfc-editor.org/rfc/rfc2231).
