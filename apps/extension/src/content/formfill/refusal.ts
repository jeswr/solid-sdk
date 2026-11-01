// AUTHORED-BY Codex GPT-6.1-Sol
import { isValidClientIdUrl } from '../../background/core/origin-policy';
import { type DetectedField, type FieldCategory, fieldRefusalReason } from './detect';

export interface RefusalInputs {
  /** Real frame metadata, supplied by the extension, never by page messages. */
  readonly url: string;
  readonly isTopFrame: boolean;
  readonly frameOrigin: string;
  readonly topOrigin: string;
  readonly field: DetectedField;
  readonly consentedCategories: ReadonlySet<FieldCategory>;
}

/** Pure policy check. Invocation requires a user gesture, enforced by the future caller. */
export function refusalReason(inputs: RefusalInputs): string | null {
  const { url, frameOrigin, topOrigin, isTopFrame, field, consentedCategories } = inputs;
  let page: URL;
  let frame: URL;
  let top: URL;
  try {
    page = new URL(url);
    frame = new URL(frameOrigin);
    top = new URL(topOrigin);
  } catch {
    return 'invalid-url';
  }
  if (![page, frame, top].every((value) => isValidClientIdUrl(value.href))) {
    return 'insecure-page';
  }
  if (page.origin !== frame.origin || (isTopFrame && frame.origin !== top.origin)) {
    return 'origin-mismatch';
  }
  if (!isTopFrame && frame.origin !== top.origin) return 'cross-origin-frame';
  const reason = fieldRefusalReason(field.element);
  if (reason) return reason;
  if (!consentedCategories.has(field.category)) return 'category-not-consented';
  return null;
}
