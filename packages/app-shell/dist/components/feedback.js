import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// FeedbackButton / FeedbackDialog — the suite's shared "report issue / give
// feedback / request help" control. Every Solid suite app (and every future
// `create-solid-app` scaffold) drops this in once and inherits ONE consistent
// way to file an issue against THAT APP's OWN repo.
//
// DECOUPLED BY DESIGN (same as AccountMenu): everything is a prop. The host
// passes its own `repo` (e.g. "jeswr/pod-mail"), `appName`, build `appVersion`,
// and the signed-in `webId`. There is no app-specific session/router coupling.
//
// TWO MECHANISMS (graceful degradation):
//   1. A `submit` hook (the future "feedback proxy") — creates the issue
//      SERVER-SIDE so the reporter needs NO GitHub account. On success we show
//      the returned issue link.
//   2. ELSE (default, zero-infra) — open GitHub's prefilled new-issue page in a
//      new tab (`window.open`). The reporter (who has a GitHub account) submits.
//
// PRIVACY: the WebID is attached ONLY when the reporter ticks the consent box
// (default OFF). Basic diagnostics (app name + version + current page URL + UA)
// are always attached and disclosed in the dialog. Never include tokens/secrets.
import { Bug, HelpCircle, Lightbulb, MessageSquarePlus } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "./primitives.js";
/** Per-category presentation: the GitHub label is the category id itself. */
const CATEGORIES = [
    { value: "bug", label: "Bug", emoji: "🐛", titlePrefix: "[Bug]", icon: Bug },
    {
        value: "feedback",
        label: "Feedback",
        emoji: "💡",
        titlePrefix: "[Feedback]",
        icon: Lightbulb,
    },
    { value: "help", label: "Help", emoji: "❓", titlePrefix: "[Help]", icon: HelpCircle },
];
// ── Pure, unit-testable helpers ────────────────────────────────────────────────
/**
 * Build the GitHub prefilled new-issue URL. PURE + exported so the URL encoding
 * is unit-testable without a DOM. GitHub reads `title`, `body`, and a
 * comma-separated `labels` query param on `/issues/new`.
 */
export function buildIssueUrl(args) {
    const { repo, title, body, labels } = args;
    const params = new URLSearchParams();
    params.set("title", title);
    params.set("body", body);
    if (labels.length > 0)
        params.set("labels", labels.join(","));
    return `https://github.com/${repo}/issues/new?${params.toString()}`;
}
/**
 * Compose the issue body: the user's description, then a diagnostics block. The
 * WebID line is emitted ONLY when `diagnostics.webId` is set (i.e. consent was
 * given). PURE + exported for unit tests. Never include tokens/secrets here.
 */
export function composeIssueBody(description, diagnostics) {
    const lines = [];
    lines.push(description.trim());
    lines.push("");
    lines.push("---");
    const version = diagnostics.appVersion ? ` ${diagnostics.appVersion}` : "";
    lines.push(`App: ${diagnostics.appName}${version}`);
    if (diagnostics.pageUrl)
        lines.push(`Page: ${diagnostics.pageUrl}`);
    if (diagnostics.userAgent)
        lines.push(`UA: ${diagnostics.userAgent}`);
    // PRIVACY: only present when the reporter consented (caller sets webId only then).
    if (diagnostics.webId)
        lines.push(`Reporter WebID: ${diagnostics.webId}`);
    return lines.join("\n");
}
/** The category-prefixed title: "<prefix> <first non-empty line of description>". */
export function composeIssueTitle(category, description) {
    const meta = CATEGORIES.find((c) => c.value === category) ?? CATEGORIES[0];
    const firstLine = description
        .split("\n")
        .map((l) => l.trim())
        .find(Boolean) ?? "";
    const MAX = 80;
    const trimmed = firstLine.length > MAX ? `${firstLine.slice(0, MAX - 1)}…` : firstLine;
    return trimmed ? `${meta.titlePrefix} ${trimmed}` : meta.titlePrefix;
}
/** The GitHub labels for a category: always `user-feedback` + the category id. */
export function feedbackLabels(category) {
    return ["user-feedback", category];
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
/**
 * The feedback modal: category selector, description, an optional WebID-consent
 * checkbox (default OFF), a diagnostics note, and submit. Self-contained (no
 * Radix Dialog dependency) — a focus-trapped, Escape-closable overlay built on
 * the suite's token classes so it themes with the rest of the shell.
 */
export function FeedbackDialog({ repo, appName, appVersion, webId, submit, open, onOpenChange, }) {
    const [category, setCategory] = useState("bug");
    const [description, setDescription] = useState("");
    const [includeWebId, setIncludeWebId] = useState(false); // PRIVACY: default OFF.
    const [phase, setPhase] = useState("idle");
    const [result, setResult] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);
    const titleId = useId();
    const descId = useId();
    const consentId = useId();
    const dialogRef = useRef(null);
    const textareaRef = useRef(null);
    // Reset to a clean slate each time the dialog opens (the state setters are
    // stable, so `open` is the only dependency).
    useEffect(() => {
        if (open) {
            setCategory("bug");
            setDescription("");
            setIncludeWebId(false);
            setPhase("idle");
            setResult(null);
            setErrorMessage(null);
        }
    }, [open]);
    // Modal focus management: while open, (1) move focus into the dialog, (2) trap
    // Tab/Shift+Tab within it so keyboard users cannot reach the background page
    // (which `aria-modal="true"` promises), and (3) restore focus to the previously
    // focused element (the trigger) on close. Escape closes the dialog.
    useEffect(() => {
        if (!open)
            return;
        const previouslyFocused = (typeof document !== "undefined" ? document.activeElement : null);
        // Focus the description after the dialog has mounted.
        const focusTimer = setTimeout(() => textareaRef.current?.focus(), 0);
        const focusableSelector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const onKeyDown = (e) => {
            if (e.key === "Escape") {
                onOpenChange(false);
                return;
            }
            if (e.key !== "Tab")
                return;
            const dialog = dialogRef.current;
            if (!dialog)
                return;
            // The selector already excludes disabled controls and tabindex=-1 (the
            // backdrop), which is the full set of non-tabbable cases the panel has —
            // so no layout-based visibility filter is needed (and none would work
            // under jsdom, which does no layout). `sr-only` radios stay tabbable.
            //
            // BUT a radio GROUP is special: native browser tab order includes only ONE
            // member per group — the CHECKED radio (or the first radio if none is
            // checked) — never every radio. If we treated all three category radios as
            // tabbable, selecting a non-default category (Feedback/Help) would make the
            // checked radio differ from `first`, so Shift+Tab from it would NOT wrap and
            // focus would escape the modal. Collapse each radio group to its single
            // tabbable member to mirror the browser's real tab order.
            const focusable = tabbableElements(dialog, focusableSelector);
            if (focusable.length === 0) {
                // Nothing focusable in the panel — keep focus on the dialog itself.
                e.preventDefault();
                dialog.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            // Wrap focus, and pull focus back in if it has escaped the dialog.
            if (e.shiftKey) {
                if (active === first || !dialog.contains(active)) {
                    e.preventDefault();
                    last.focus();
                }
            }
            else if (active === last || !dialog.contains(active)) {
                e.preventDefault();
                first.focus();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => {
            clearTimeout(focusTimer);
            document.removeEventListener("keydown", onKeyDown);
            // Restore focus to whatever was focused before the dialog opened.
            previouslyFocused?.focus?.();
        };
    }, [open, onOpenChange]);
    const buildPayload = useCallback(() => {
        const diagnostics = {
            appName,
            appVersion,
            pageUrl: typeof location !== "undefined" ? location.href : undefined,
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
            // PRIVACY: only attach the WebID when the reporter consented.
            webId: includeWebId && webId ? webId : undefined,
        };
        const title = composeIssueTitle(category, description);
        const body = composeIssueBody(description, diagnostics);
        return {
            repo,
            category,
            title,
            body,
            labels: feedbackLabels(category),
            description,
            diagnostics,
        };
    }, [appName, appVersion, webId, includeWebId, category, description, repo]);
    const handleSubmit = useCallback(async (e) => {
        e.preventDefault();
        if (!description.trim())
            return;
        const payload = buildPayload();
        if (submit) {
            // MECHANISM 1: the proxy hook creates the issue server-side.
            setPhase("submitting");
            setErrorMessage(null);
            try {
                const res = await submit(payload);
                setResult(res);
                setPhase("success");
            }
            catch (err) {
                setErrorMessage(err instanceof Error ? err.message : "Could not submit feedback.");
                setPhase("error");
            }
            return;
        }
        // MECHANISM 2 (default, zero-infra): open GitHub's prefilled new-issue page.
        const url = buildIssueUrl({
            repo: payload.repo,
            title: payload.title,
            body: payload.body,
            labels: payload.labels,
        });
        if (typeof window !== "undefined") {
            window.open(url, "_blank", "noopener,noreferrer");
        }
        onOpenChange(false);
    }, [description, buildPayload, submit, onOpenChange]);
    if (!open)
        return null;
    const versionLabel = appVersion ? ` ${appVersion}` : "";
    return (_jsxs("div", { className: "fixed inset-0 z-50 flex items-center justify-center p-4", children: [_jsx("button", { type: "button", "aria-label": "Close feedback dialog", tabIndex: -1, className: "absolute inset-0 cursor-default bg-black/50", onClick: () => onOpenChange(false) }), _jsxs("div", { ref: dialogRef, role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabIndex: -1, className: "relative w-full max-w-md rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-md outline-none", children: [_jsx("h2", { id: titleId, className: "text-base font-semibold", children: phase === "success" ? "Thanks for the feedback" : `Feedback on ${appName}` }), phase === "success" && result ? (_jsxs("div", { className: "mt-3 flex flex-col gap-3 text-sm", children: [_jsxs("p", { children: ["Thanks \u2014 tracked as", " ", _jsxs("a", { href: result.url, target: "_blank", rel: "noopener noreferrer", className: "font-medium underline", children: ["#", result.number] }), "."] }), _jsx("div", { className: "flex justify-end", children: _jsx(Button, { variant: "outline", onClick: () => onOpenChange(false), children: "Close" }) })] })) : (_jsxs("form", { className: "mt-3 flex flex-col gap-4", onSubmit: handleSubmit, children: [_jsxs("fieldset", { className: "flex flex-col gap-2 border-0 p-0", children: [_jsx("legend", { className: "mb-2 text-sm font-medium", children: "What is this about?" }), _jsx("div", { className: "flex gap-2", children: CATEGORIES.map(({ value, label, emoji, icon: Icon }) => {
                                            const selected = category === value;
                                            const id = `${descId}-cat-${value}`;
                                            return (_jsxs("label", { htmlFor: id, className: [
                                                    "flex flex-1 cursor-pointer flex-col items-center gap-1 rounded-md border px-2 py-2 text-sm",
                                                    "transition-colors focus-within:ring-2 focus-within:ring-ring",
                                                    selected
                                                        ? "border-ring bg-accent text-accent-foreground"
                                                        : "border-border hover:bg-accent hover:text-accent-foreground",
                                                ].join(" "), children: [_jsx("input", { id: id, type: "radio", name: `${descId}-category`, value: value, checked: selected, onChange: () => setCategory(value), className: "sr-only" }), _jsx(Icon, { className: "size-4", "aria-hidden": "true" }), _jsxs("span", { children: [_jsx("span", { "aria-hidden": "true", children: emoji }), " ", label] })] }, value));
                                        }) })] }), _jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("label", { htmlFor: descId, className: "text-sm font-medium", children: "Tell us more" }), _jsx("textarea", { id: descId, ref: textareaRef, required: true, value: description, onChange: (e) => setDescription(e.target.value), rows: 4, placeholder: "Describe the bug, idea, or question\u2026", className: "resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" })] }), webId ? (_jsxs("label", { htmlFor: consentId, className: "flex items-start gap-2 text-sm", children: [_jsx("input", { id: consentId, type: "checkbox", checked: includeWebId, onChange: (e) => setIncludeWebId(e.target.checked), className: "mt-0.5" }), _jsx("span", { children: "Include my WebID so the maintainer can follow up" })] })) : null, _jsxs("p", { className: "text-xs text-muted-foreground", children: ["We attach basic diagnostics: app name + version (", appName, versionLabel, ") and the current page URL."] }), phase === "error" && errorMessage ? (_jsx("p", { role: "alert", className: "text-sm text-destructive", children: errorMessage })) : null, _jsxs("div", { className: "flex justify-end gap-2", children: [_jsx(Button, { variant: "ghost", onClick: () => onOpenChange(false), disabled: phase === "submitting", children: "Cancel" }), _jsx(Button, { variant: "outline", type: "submit", disabled: !description.trim() || phase === "submitting", children: phase === "submitting"
                                            ? "Sending…"
                                            : submit
                                                ? "Send feedback"
                                                : "Open issue on GitHub" })] })] }))] })] }));
}
/**
 * The header-level "Feedback" trigger. Renders a button (icon + label) that
 * opens the FeedbackDialog. Pass your OWN `repo`. Everything else is optional.
 */
export function FeedbackButton({ repo, appName, appVersion, webId, submit, triggerVariant = "ghost", className, label = "Feedback", }) {
    const [open, setOpen] = useState(false);
    return (_jsxs(_Fragment, { children: [_jsxs(Button, { variant: triggerVariant, className: className, onClick: () => setOpen(true), "aria-label": label, children: [_jsx(MessageSquarePlus, { className: "size-4", "aria-hidden": "true" }), _jsx("span", { className: "hidden sm:inline", children: label })] }), _jsx(FeedbackDialog, { repo: repo, appName: appName, appVersion: appVersion, webId: webId, submit: submit, open: open, onOpenChange: setOpen })] }));
}
