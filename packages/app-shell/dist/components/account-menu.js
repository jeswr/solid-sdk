import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// AccountMenu — the top-right account control: avatar + display name, opening a
// dropdown with the WebID, optional Profile / Settings entries, and Sign out.
//
// DECOUPLED BY DESIGN: unlike PM's version (which read `useSession()` and called
// `toast`), this takes everything as PROPS — `webId`, `displayName`, `avatarUrl`,
// and the `onSignOut` / `onProfile` / `onSettings` callbacks — so it has no
// app-specific coupling and works in any app (Vite or Next). The host wires its
// own session + navigation + toast in the callbacks. Profile/Settings entries
// render ONLY when their callback (or href) is supplied.
import { LogOut, Settings, UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, } from "./primitives.js";
/** Initials from a display name, for the avatar fallback. Exported for tests. */
export function initials(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const first = parts[0];
    if (first === undefined)
        return "?";
    if (parts.length === 1)
        return first.slice(0, 2).toUpperCase();
    // length >= 2 here, so the last element exists; `?? first` is an unreachable
    // type-narrowing fallback (keeps the access provably safe without changing
    // behaviour — the runtime always has a distinct last part).
    const last = parts[parts.length - 1] ?? first;
    return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}
/** Header account control: avatar + name, with WebID, optional nav, and sign-out. */
export function AccountMenu({ webId, displayName, avatarUrl, onSignOut, onProfile, onSettings, children, }) {
    const name = displayName || webId || "Account";
    const hasIdentity = Boolean(displayName || webId);
    return (_jsxs(DropdownMenu, { children: [_jsx(DropdownMenuTrigger, { asChild: true, children: _jsxs(Button, { variant: "ghost", className: "h-auto gap-2 px-2 py-1.5", "aria-label": "Account menu", children: [_jsxs(Avatar, { className: "size-7", children: [avatarUrl ? _jsx(AvatarImage, { src: avatarUrl, alt: "" }) : null, _jsx(AvatarFallback, { children: hasIdentity ? initials(name) : _jsx(UserRound, { className: "size-4", "aria-hidden": "true" }) })] }), _jsx("span", { className: "hidden max-w-32 truncate text-sm font-medium sm:inline", children: displayName || "Signed in" })] }) }), _jsxs(DropdownMenuContent, { align: "end", className: "w-64", children: [_jsxs(DropdownMenuLabel, { className: "flex flex-col gap-0.5", children: [_jsx("span", { className: "truncate font-medium", children: name }), webId ? (_jsx("span", { className: "truncate text-xs font-normal text-as-muted-foreground", children: webId })) : null] }), _jsx(DropdownMenuSeparator, {}), onProfile ? (_jsxs(DropdownMenuItem, { onClick: onProfile, children: [_jsx(UserRound, { className: "size-4", "aria-hidden": "true" }), "Profile"] })) : null, onSettings ? (_jsxs(DropdownMenuItem, { onClick: onSettings, children: [_jsx(Settings, { className: "size-4", "aria-hidden": "true" }), "Settings"] })) : null, children, onProfile || onSettings || children ? _jsx(DropdownMenuSeparator, {}) : null, _jsxs(DropdownMenuItem, { onClick: onSignOut, children: [_jsx(LogOut, { className: "size-4", "aria-hidden": "true" }), "Sign out"] })] })] }));
}
