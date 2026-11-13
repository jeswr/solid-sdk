// AUTHORED-BY Codex GPT-6.1-Sol
// Inspect the witnessed response before bounding its returned trace sample.
import { attr, parseHtml, selectAll, text } from "./html.js";

export function responsePageError(body: string, contentType: string | undefined): boolean {
  if (!body) return false;
  if (/json/i.test(contentType ?? "")) {
    try {
      const doc = JSON.parse(body);
      return (
        doc !== null &&
        typeof doc === "object" &&
        !Array.isArray(doc) &&
        Object.entries(doc).some(
          ([key, value]) =>
            (/^(?:errors?|validationErrors|exception|redirect|ajaxRedirect)$/i.test(key) &&
              value !== false &&
              value != null &&
              value !== "" &&
              JSON.stringify(value) !== "[]") ||
            (/^(?:success|ok)$/i.test(key) && value === false) ||
            (/^status$/i.test(key) &&
              typeof value === "string" &&
              /^(?:error|failed|failure)$/i.test(value)),
        )
      );
    } catch {
      return true;
    }
  }
  if (!/html/i.test(contentType ?? "")) return false;
  const doc = parseHtml(body);
  if (selectAll(doc, 'input[type="password"], [aria-invalid="true"]').length) return true;
  return selectAll(
    doc,
    "title, h1, [role=alert], .error, .errors, .form-error-message, .form-errors, .error-message, .validation-error, .invalid-feedback, .alert-danger, .message-error",
  ).some((el) => {
    const value = text(el);
    if (!value) return false;
    return (
      /(?:^|[ _-])(?:errors?|invalid|danger|validation)(?:[ _-]|$)/i.test(
        attr(el, "class") ?? "",
      ) || /\b(error|invalid|validation|forbidden|not found|access denied)\b/i.test(value)
    );
  });
}
