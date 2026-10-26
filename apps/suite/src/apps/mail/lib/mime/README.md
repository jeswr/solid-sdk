<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Mail MIME library

```ts
import { parseMimeMessage } from "./mime";

const message = await parseMimeMessage(emlBytes);
// message.text is plain text; message.html is sanitised HTML or null.
// message.attachments includes both downloadable files and inline CID parts.
```

Use original `Uint8Array` or `ArrayBuffer` bytes for unencoded legacy charsets.
String input represents UTF-8, not a binary string. The library performs no I/O,
creates no object URLs, and imports no React or hooks.

`postal-mime` handles RFC 5322 headers (including address groups, duplicate fields,
folding and RFC 2047 encoded words), the decoded multipart tree,
7bit/8bit/binary/base64/quoted-printable transfers, charset conversion and RFC 2231
attachment filenames. Headers expose both unfolded wire values and decoded text.
Absent text is `""`; absent HTML is `null`. HTML-only mail does not invent a plain
body. Encapsulated `message/rfc822` parts remain attachments. Parser errors,
including its default nesting/header/part-count limits, reject the parse promise.

The adapter selects the last available plain and HTML representations separately
inside each `multipart/alternative`, including nested alternatives. Related bodies
use the immediate child named by `start` (case-sensitive Content-ID), or the first
child when `start` is absent or unresolved, as their root. Non-root related leaves
remain attachment resources, including text/HTML, with transfer-decoded bytes and
CID metadata. Mixed parts retain document order in each actual representation.
Attached multipart groups remain single downloads with their original body bytes,
including nested boundaries. A selected related root's supported content type
takes precedence over its disposition. Attachment downloads retain transfer-decoded
octets for every media type, including calendar line endings and legacy charsets.
Selection uses a small internal-tree adapter specific to pinned `postal-mime`
4.1.4; run the regression tests when upgrading it.

`sanitizeMessageHtml` retains basic reading structure and http(s)/mailto links.
Scripts, event handlers, CSS, forms, embedded documents, SVG/MathML, automatic
resource URLs and remote image loads are removed. An image's `cid:` source becomes
inert `data-inline-cid` metadata matching an attachment's bare `contentId`. The
reader must apply its own media policy before resolving those bytes, especially
for active formats such as SVG or HTML. There is no remote-loading opt-in here.

Subjects, addresses, plain bodies, header values, filenames, MIME types and
attachment bytes remain untrusted data. Render text as text, never use filenames
as filesystem paths, and do not treat a declared MIME type as a safety check.

Synthetic fixtures live under `test/fixtures/mime/`. Run
`pnpm --filter @jeswr/app-suite run test:mime` for the directory's 100% coverage gate.
