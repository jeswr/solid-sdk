// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see prod-solid-server docs/MODEL-PROVENANCE.md
/**
 * Minimal, dependency-free HTML → plain-text reduction for the unified body.
 *
 * Discourse posts arrive as `cooked` HTML and Matrix messages may carry an
 * HTML `formatted_body`. The unified `CommunityMessage.body` is plain text; the
 * original HTML is preserved separately in `bodyHtml`. This is NOT a sanitiser
 * (the caller must sanitise `bodyHtml` before rendering it as HTML); it only
 * derives a readable text snippet for list views.
 *
 * Deliberately simple + non-recursive (no parser dependency): strip tags, decode
 * the handful of common entities, collapse whitespace. Block-level tags become
 * newlines so paragraphs/line breaks survive as text.
 */
const BLOCK_BOUNDARY = /<\/?(p|div|br|li|tr|h[1-6]|blockquote|pre)[^>]*>/gi;
const ENTITIES = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
};
export function htmlToText(html) {
    if (html === "") {
        return "";
    }
    // Drop script/style content entirely.
    let s = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
    // Block boundaries → newlines.
    s = s.replace(BLOCK_BOUNDARY, "\n");
    // Remaining tags → removed.
    s = s.replace(/<[^>]+>/g, "");
    // Named/simple entities.
    s = s.replace(/&[a-zA-Z]+;|&#39;/g, (m) => ENTITIES[m] ?? m);
    // Numeric entities (decimal + hex).
    s = s.replace(/&#(\d+);/g, (_m, d) => safeFromCodePoint(Number.parseInt(d, 10)));
    s = s.replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => safeFromCodePoint(Number.parseInt(h, 16)));
    // Collapse runs of blank lines + trim trailing whitespace per line.
    s = s
        .split("\n")
        .map((line) => line.replace(/[ \t ]+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return s;
}
function safeFromCodePoint(cp) {
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) {
        return "";
    }
    try {
        return String.fromCodePoint(cp);
    }
    catch {
        return "";
    }
}
//# sourceMappingURL=htmlText.js.map