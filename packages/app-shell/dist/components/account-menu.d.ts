import type * as React from "react";
/** Initials from a display name, for the avatar fallback. Exported for tests. */
export declare function initials(name: string): string;
export interface AccountMenuProps {
    /** The authenticated user's WebID (shown under the name; the canonical id). */
    webId?: string | null;
    /** Human display name (foaf:name). Falls back to the WebID, then "Account". */
    displayName?: string | null;
    /** Avatar image URL (foaf:img / vcard:hasPhoto). Falls back to initials. */
    avatarUrl?: string | null;
    /** Sign-out callback (required — the menu always offers Sign out). */
    onSignOut: () => void;
    /** Optional: open the profile. Renders a "Profile" item when provided. */
    onProfile?: () => void;
    /** Optional: open settings. Renders a "Settings" item when provided. */
    onSettings?: () => void;
    /** Optional extra menu items rendered above Sign out (e.g. app-specific links). */
    children?: React.ReactNode;
}
/** Header account control: avatar + name, with WebID, optional nav, and sign-out. */
export declare function AccountMenu({ webId, displayName, avatarUrl, onSignOut, onProfile, onSettings, children, }: AccountMenuProps): React.JSX.Element;
