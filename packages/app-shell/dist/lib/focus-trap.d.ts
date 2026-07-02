/**
 * The canonical selector for the shell's focusable dialog controls — the single
 * source of truth shared by the FeedbackDialog's Tab-trap and its tests (so the
 * trap and the assertions can never drift). It matches focusable candidates and
 * already excludes disabled controls and `tabindex="-1"` (e.g. the backdrop),
 * which is the full set of non-tabbable cases the dialog panel has.
 */
export declare const FOCUSABLE_SELECTOR = "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";
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
export declare function tabbableElements(root: HTMLElement, selector: string): HTMLElement[];
