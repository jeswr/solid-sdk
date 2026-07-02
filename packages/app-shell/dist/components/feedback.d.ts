import type * as React from "react";
import { type FeedbackPayload, type FeedbackSubmitResult } from "../lib/feedback-core.js";
import { type ButtonProps } from "./primitives.js";
export interface FeedbackDialogProps {
    /** REQUIRED: the OWNER/REPO the issue is filed against (each app passes its OWN). */
    repo: string;
    /** This app's human name, attached to diagnostics + used in the dialog copy. */
    appName: string;
    /** Optional build SHA / version, attached to diagnostics. */
    appVersion?: string;
    /** The signed-in user's WebID. Attached ONLY if the consent box is ticked. */
    webId?: string | null;
    /**
     * Optional proxy hook. When provided it is called instead of the prefill flow;
     * it should create the issue server-side and resolve with its URL + number.
     */
    submit?: (payload: FeedbackPayload) => Promise<FeedbackSubmitResult>;
    /** Controls dialog visibility. */
    open: boolean;
    /** Called when the dialog requests to close (backdrop / Escape / Close). */
    onOpenChange: (open: boolean) => void;
}
/**
 * The feedback modal: category selector, description, an optional WebID-consent
 * checkbox (default OFF), a diagnostics note, and submit. Self-contained (no
 * Radix Dialog dependency) — a focus-trapped, Escape-closable overlay built on
 * the suite's token classes so it themes with the rest of the shell.
 */
export declare function FeedbackDialog({ repo, appName, appVersion, webId, submit, open, onOpenChange, }: FeedbackDialogProps): React.JSX.Element | null;
export interface FeedbackButtonProps {
    /** REQUIRED: the OWNER/REPO the issue is filed against (each app passes its OWN). */
    repo: string;
    /** This app's human name, attached to diagnostics + used in the dialog copy. */
    appName: string;
    /** Optional build SHA / version, attached to diagnostics. */
    appVersion?: string;
    /** The signed-in user's WebID. Attached ONLY if the consent box is ticked. */
    webId?: string | null;
    /** Optional proxy hook (see FeedbackDialog) — create the issue server-side. */
    submit?: (payload: FeedbackPayload) => Promise<FeedbackSubmitResult>;
    /** The trigger Button variant (default "ghost"). */
    triggerVariant?: ButtonProps["variant"];
    /** Extra classes for the trigger, for placement. */
    className?: string;
    /** Trigger label (default "Feedback"). */
    label?: string;
}
/**
 * The header-level "Feedback" trigger. Renders a button (icon + label) that
 * opens the FeedbackDialog. Pass your OWN `repo`. Everything else is optional.
 */
export declare function FeedbackButton({ repo, appName, appVersion, webId, submit, triggerVariant, className, label, }: FeedbackButtonProps): React.JSX.Element;
