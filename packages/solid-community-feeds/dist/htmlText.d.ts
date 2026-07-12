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
export declare function htmlToText(html: string): string;
//# sourceMappingURL=htmlText.d.ts.map