// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// focus-trap — the PURE tab-order core of the modal focus trap.
//
// This is ESSENTIAL a11y complexity (the modal keyboard-containment contract),
// so it lives in a small module a reviewer can read + the test suite can pin
// exhaustively, free of React. It reaches for NO browser global: it operates
// only on the DOM nodes passed in (`root.querySelectorAll`), so it is pure
// (DOM in, array out) and unit-testable without a component.
/**
 * The canonical selector for the shell's focusable dialog controls — the single
 * source of truth shared by the FeedbackDialog's Tab-trap and its tests (so the
 * trap and the assertions can never drift). It matches focusable candidates and
 * already excludes disabled controls and `tabindex="-1"` (e.g. the backdrop),
 * which is the full set of non-tabbable cases the dialog panel has.
 */
export const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
/**
 * The full Tab-key containment decision for a modal: given the dialog, the
 * currently-focused element, and the Tab direction, return the element focus
 * must MOVE to (caller then `preventDefault()`s + focuses it) — or `null` when
 * the browser's native tab order already stays inside the dialog.
 *
 * The three cases (ESSENTIAL a11y logic — the `aria-modal="true"` keyboard
 * containment contract; do not collapse them):
 *  1. nothing tabbable in the panel → the dialog itself (park focus there);
 *  2. Tab from the LAST tabbable (or from outside the dialog — focus escaped)
 *     → wrap to the FIRST; Shift+Tab from the FIRST (or outside) → the LAST;
 *  3. otherwise → `null` (native order is correct; do not intervene).
 *
 * PURE (DOM in, element out): no browser global, unit-testable without React.
 */
export function tabTrapTarget(dialog, active, shiftKey) {
    const focusable = tabbableElements(dialog, FOCUSABLE_SELECTOR);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined)
        return dialog; // case 1
    const escaped = !dialog.contains(active);
    if (shiftKey)
        return active === first || escaped ? last : null; // case 2/3 (backward)
    return active === last || escaped ? first : null; // case 2/3 (forward)
}
/**
 * The list of ACTUALLY tabbable elements inside `root`, in DOM order, mirroring
 * the browser's real Tab sequence. `selector` matches focusable candidates
 * (already excluding disabled / `tabindex=-1`); the one nuance the raw selector
 * misses is the **radio group**: native tab order visits only ONE radio per
 * named group — the CHECKED radio, or the FIRST radio if none in the group is
 * checked — never every radio. We therefore drop the non-tabbable members of
 * each radio group. PURE (DOM in, array out) + exported for unit tests.
 *
 * Radios without a `name` are NOT grouped (each is its own control), matching
 * the platform. Radios in a `<form>` group by (form, name); loose radios group
 * by name within the document — for a single modal panel, grouping by `name`
 * alone is the correct, sufficient model.
 */
export function tabbableElements(root, selector) {
    const candidates = Array.from(root.querySelectorAll(selector));
    // Per radio-group name, find the single member that participates in tab order:
    // the checked radio always wins; otherwise the first-seen (DOM order) radio.
    const groupTabbable = new Map();
    for (const el of candidates) {
        if (el instanceof HTMLInputElement && el.type === "radio" && el.name) {
            const existing = groupTabbable.get(el.name);
            if (existing === undefined || el.checked)
                groupTabbable.set(el.name, el);
        }
    }
    return candidates.filter((el) => {
        if (el instanceof HTMLInputElement && el.type === "radio" && el.name) {
            return groupTabbable.get(el.name) === el;
        }
        return true;
    });
}
