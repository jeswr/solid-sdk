// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-login-panel> — the suite's keystone login surface as a framework-
// agnostic Web Component. It wraps @solid/reactive-authentication's
// authorization-code (DPoP) login flow + @jeswr/solid-session-restore's silent
// restore, behind the LoginController seam (see ../login-controller.ts).
//
// THE AUTH SEAM (load-bearing — this is auth, so read carefully):
//   - `.fetch`        — the AUTHENTICATED, session-bound fetch after login.
//   - `.publicFetch`  — the PRISTINE native fetch captured BEFORE reactive-auth
//                       patches the global. The foreign-origin / public-read
//                       boundary: it carries NO session and never upgrades on a
//                       401, so a session token can never leak cross-origin.
//   - `.webId`        — the authenticated WebID (string | null).
//   Both fetches + the WebID are RELAYED from the injected LoginController; the
//   element never builds a token, never patches the global, and never
//   authenticates a foreign-origin request itself.
//
// EVENTS:
//   - `session-change` → detail { webId: string | null, loggedIn: boolean }
//   - `login`          → detail { webId: string }
//   - `logout`         → (no detail)
//
// SILENT RESTORE (suite invariant #1): on connect (when `auto-restore` is on,
// the default) the element shows a "Restoring…" state and asks the controller to
// silently re-establish the session from the persisted DPoP-bound refresh token.
// On `restored` it lands logged-in with NO redirect/popup; on `login` (genuine
// restore failure — fail-closed) it falls back to the login prompt. It never
// flashes the prompt before the restore decision resolves.
//
// WITHOUT A CONTROLLER the element renders a clear "auth not configured" notice
// (and never claims a session) — the seam must be wired by the host (the `/auth`
// subexport's createReactiveAuthController, or a custom LoginController).
import { css, html, LitElement, nothing } from "lit";
import { tokenStyles } from "../theme-tokens.js";
/**
 * The pristine native fetch, snapshotted ONCE at MODULE LOAD — before any
 * LoginController / reactive-auth could patch `globalThis.fetch`. The no-controller
 * fallback for `.publicFetch` uses THIS, NOT a re-read of the (possibly already
 * patched) global at element CONSTRUCTION — so an unwired panel can never expose a
 * credentialed fetch as `.publicFetch` even if a controller elsewhere patched the
 * global before this element was created (the roborev finding). `globalThis.fetch`
 * may be undefined in a non-DOM build; guarded so module load never throws.
 */
const PANEL_PRISTINE_FETCH = typeof globalThis !== "undefined" && typeof globalThis.fetch === "function"
    ? globalThis.fetch.bind(globalThis)
    : undefined;
export class JeswrLoginPanel extends LitElement {
    static properties = {
        // The injected auth controller (JS property, never an attribute). The
        // element is inert (renders the "not configured" notice) until this is set.
        controller: { attribute: false },
        // Optional pre-filled WebID for the input (e.g. a deep-link).
        initialWebId: { type: String, attribute: "initial-webid" },
        // Whether to attempt silent restore on connect. Default TRUE (the suite
        // invariant). A custom converter (NOT the plain Boolean type) so the attribute
        // behaves intuitively for HTML authors: `auto-restore="false"` (or "0"/"off")
        // disables it; any other present value (or `auto-restore` bare) enables it;
        // and the ABSENT attribute leaves the default (true) — unlike a plain boolean
        // attribute, whose mere presence is always true and which can never be set to
        // false from markup. React/JS hosts can also just set the `.autoRestore` prop.
        autoRestore: {
            attribute: "auto-restore",
            reflect: true,
            converter: {
                fromAttribute: (value) => {
                    if (value === null)
                        return true; // absent → default on
                    const v = value.trim().toLowerCase();
                    return !(v === "false" || v === "0" || v === "off" || v === "no");
                },
                toAttribute: (value) => (value ? null : "false"),
            },
        },
        // Optional heading shown above the prompt.
        heading: { type: String },
        _phase: { state: true },
        _webIdInput: { state: true },
        _error: { state: true },
        _showInput: { state: true },
    };
    /**
     * The fallback `.publicFetch` source until a controller is wired (after which
     * `.publicFetch` relays the controller's own pristine snapshot). Uses the
     * MODULE-LOAD snapshot (taken before any patching), NOT a construction-time re-read
     * of the global — so an unwired panel never exposes a patched/credentialed global
     * as the pristine fetch.
     */
    #nativeFetch = PANEL_PRISTINE_FETCH;
    /** Single-flight guard so StrictMode / re-connect runs restore once. */
    #restoreStarted = false;
    /**
     * Whether the user has TYPED in the WebID input. While false, the input tracks the
     * `initial-webid` property (so changing `initial-webid` after connect updates the
     * field); once the user edits, their input is preserved.
     */
    #webIdEdited = false;
    /** Incremented on disconnect / new login so a stale async result is ignored. */
    #generation = 0;
    // ── The auth seam: read-only JS accessors that RELAY the controller ────────
    // None of these expose a setter; the host reads them after a `session-change`.
    /**
     * The AUTHENTICATED, session-bound fetch (after login). Before a session
     * exists — or with no controller — this is the pristine native fetch, so it is
     * always safe to call and never null. Use for the user's OWN origin(s).
     */
    get fetch() {
        return this.controller?.authenticatedFetch ?? this.#publicFetchFallback();
    }
    /**
     * The PRISTINE native fetch (the foreign-origin / public-read boundary). NEVER
     * carries the session and never upgrades on a 401, so a session token cannot
     * leak cross-origin. Prefers the controller's own pre-patch snapshot; falls
     * back to the element's construction-time snapshot.
     */
    get publicFetch() {
        return this.controller?.publicFetch ?? this.#publicFetchFallback();
    }
    /** The authenticated WebID, or null when logged out / no controller. */
    get webId() {
        return this.controller?.webId ?? null;
    }
    #publicFetchFallback() {
        if (this.#nativeFetch)
            return this.#nativeFetch;
        // Last resort (non-DOM/test env without fetch): a function that rejects,
        // rather than silently returning the (possibly patched) global — we must
        // never hand back something that could carry a session as "publicFetch".
        return (() => Promise.reject(new Error("No fetch available in this environment")));
    }
    static styles = [
        tokenStyles,
        css `
      :host {
        display: block;
      }
      .panel {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        width: 100%;
        max-width: 26rem;
        padding: 1.5rem;
        border: 1px solid var(--jeswr-border);
        border-radius: var(--jeswr-radius);
        background: var(--jeswr-popover);
        color: var(--jeswr-popover-fg);
      }
      h2 {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 600;
      }
      .subtle {
        margin: 0;
        font-size: 0.875rem;
        color: var(--jeswr-muted-fg);
      }
      .restoring {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        font-size: 0.9375rem;
        color: var(--jeswr-muted-fg);
      }
      .spinner {
        width: 1.125rem;
        height: 1.125rem;
        border: 2px solid var(--jeswr-border);
        border-top-color: var(--jeswr-primary);
        border-radius: 9999px;
        animation: spin 0.7s linear infinite;
        flex: none;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .spinner {
          animation-duration: 2s;
        }
      }
      .accounts {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .account {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        width: 100%;
        padding: 0.5rem 0.625rem;
        border: 1px solid var(--jeswr-border);
        border-radius: calc(var(--jeswr-radius) - 0.25rem);
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .account:hover:not(:disabled) {
        background: var(--jeswr-accent);
        color: var(--jeswr-accent-fg);
      }
      .account:focus-visible {
        outline: 2px solid var(--jeswr-ring);
        outline-offset: 2px;
      }
      .account:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .avatar {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: 9999px;
        background: var(--jeswr-accent);
        color: var(--jeswr-accent-fg);
        font-size: 0.8125rem;
        font-weight: 600;
        overflow: hidden;
        flex: none;
      }
      .avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .account-text {
        display: flex;
        flex-direction: column;
        gap: 0.0625rem;
        min-width: 0;
      }
      .account-name {
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .account-webid {
        font-size: 0.75rem;
        color: var(--jeswr-muted-fg);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      label.field {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        font-size: 0.875rem;
        font-weight: 500;
      }
      input[type="url"] {
        height: 2.5rem;
        padding: 0 0.75rem;
        border: 1px solid var(--jeswr-border);
        border-radius: calc(var(--jeswr-radius) - 0.25rem);
        background: var(--jeswr-bg);
        color: var(--jeswr-fg);
        font: inherit;
        font-size: 0.9375rem;
      }
      input[type="url"]:focus-visible {
        outline: 2px solid var(--jeswr-ring);
        outline-offset: 0;
      }
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        height: 2.5rem;
        padding: 0 1rem;
        border: 1px solid transparent;
        border-radius: calc(var(--jeswr-radius) - 0.25rem);
        background: var(--jeswr-primary);
        color: var(--jeswr-primary-fg);
        font: inherit;
        font-size: 0.9375rem;
        font-weight: 500;
        cursor: pointer;
      }
      .btn.secondary {
        background: transparent;
        color: inherit;
        border-color: var(--jeswr-border);
      }
      .btn:hover:not(:disabled) {
        filter: brightness(0.96);
      }
      .btn.secondary:hover:not(:disabled) {
        background: var(--jeswr-accent);
        color: var(--jeswr-accent-fg);
        filter: none;
      }
      .btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .btn:focus-visible {
        outline: 2px solid var(--jeswr-ring);
        outline-offset: 2px;
      }
      .linkish {
        align-self: flex-start;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--jeswr-primary);
        font: inherit;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
      }
      .linkish:focus-visible {
        outline: 2px solid var(--jeswr-ring);
        outline-offset: 2px;
      }
      .err {
        margin: 0;
        color: var(--jeswr-destructive);
        font-size: 0.875rem;
      }
      .signed-in {
        display: flex;
        flex-direction: column;
        gap: 0.875rem;
      }
      .identity {
        display: flex;
        align-items: center;
        gap: 0.625rem;
      }
      .identity .account-webid {
        word-break: break-all;
        white-space: normal;
      }
    `,
    ];
    constructor() {
        super();
        this.initialWebId = "";
        this.autoRestore = true;
        this.heading = "Sign in";
        this._phase = "idle";
        this._webIdInput = "";
        this._error = null;
        this._showInput = false;
    }
    connectedCallback() {
        super.connectedCallback();
        // Only adopt initialWebId on connect if the user hasn't edited the field — a
        // detach/reattach of the SAME element instance must not discard typed input
        // (mirrors the #webIdEdited guard on the initialWebId reactive setter — roborev finding).
        if (!this.#webIdEdited) {
            this._webIdInput = this.initialWebId || "";
        }
        // RECONCILE the UI to the controller's ACTUAL session first — so a re-attach (or
        // a re-attach after an interrupted login/logout) reflects reality (signed-in iff
        // controller.webId), never a stale transient phase — then kick the one-time
        // restore if still needed.
        this.#reconcilePhase();
        this.#maybeStartRestore();
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        // Invalidate any in-flight async result so it cannot mutate a detached element's
        // state or emit after disconnect.
        this.#generation++;
        // If ANY async auth work (restore OR an interactive login/logout) was in flight
        // when we detached, its result is now discarded (the generation bump) — clear the
        // single-flight guard so a later RE-attach re-reconciles + re-runs restore as
        // needed, instead of being stuck on the abandoned attempt with stale UI. A SETTLED
        // state (idle / authenticated reflecting the controller) leaves the guard set so a
        // plain detach/re-attach does not pointlessly re-run a finished restore.
        if (this._phase === "restoring" || this._phase === "authenticating") {
            this.#restoreStarted = false;
        }
    }
    /**
     * Sync `_phase` to the controller's CURRENT session: authenticated iff
     * `controller.webId`, else leave a restore-in-flight as-is, else the prompt. Cheap,
     * idempotent, no async — run on connect so the UI never shows a phase that
     * contradicts the controller (e.g. a stale "authenticated"/"authenticating" left by
     * an interrupted login when the controller actually has no session).
     */
    #reconcilePhase() {
        const controller = this.controller;
        if (!controller)
            return;
        if (controller.webId) {
            this._phase = "authenticated";
        }
        else if (this._phase === "authenticated" || this._phase === "authenticating") {
            // The controller has NO session but the UI claims one (interrupted login/logout)
            // — drop back to the prompt (restore, if applicable, is (re)kicked separately).
            this._phase = "idle";
        }
    }
    willUpdate(changed) {
        // Keep the WebID input in sync with `initial-webid` until the user edits it — so
        // setting/changing the attribute AFTER connect updates the field (not just at
        // connectedCallback). Once the user types, their input is preserved.
        if (changed.has("initialWebId") && !this.#webIdEdited) {
            this._webIdInput = this.initialWebId || "";
        }
        if (!changed.has("controller"))
            return;
        const previous = changed.get("controller");
        // The controller was wired (undefined → controller) OR SWAPPED for a different
        // instance / REMOVED (controller → undefined). A swap must NOT inherit the old
        // controller's UI/state: invalidate any in-flight async result (the generation
        // bump), clear the single-flight restore guard + the prompt state, and re-run the
        // authenticated/restore/idle decision against the NEW controller — otherwise a
        // fresh, session-less controller could keep showing the previous controller's
        // signed-in view.
        if (previous && previous !== this.controller) {
            // The EXPOSED webId before the swap (the OLD controller's session) vs after (the
            // new controller's, or null when removed). If it dropped to a LOGGED-OUT exposure,
            // consumers relying on `session-change` must be told — otherwise they keep stale
            // session state / fetch handles after a swap to a logged-out (or removed) controller
            // (the roborev finding). We emit the logged-out transition HERE; the AUTHENTICATED
            // transitions (new controller already signed in, or its restore succeeding) are
            // emitted by #maybeStartRestore below, so we don't double-emit the same session.
            const previousWebId = previous.webId ?? null;
            this.#generation++; // discard the old controller's in-flight restore/login
            this.#restoreStarted = false;
            this._phase = "idle";
            this._error = null;
            this._showInput = false;
            if (previousWebId !== null && this.webId === null) {
                this.#emitSessionChange();
            }
        }
        // Kick off restore the first time a controller appears, and after a swap (the
        // reset above cleared the guard so this runs again for the new controller).
        this.#maybeStartRestore();
    }
    /**
     * Begin the on-load silent restore exactly once, when a controller is present
     * and auto-restore is on. If already logged in (controller has a webId), reflect
     * that immediately. Fail-closed: any restore error → the login prompt.
     */
    #maybeStartRestore() {
        if (this.#restoreStarted)
            return;
        const controller = this.controller;
        if (!controller)
            return; // inert until wired
        this.#restoreStarted = true;
        // Already authenticated (e.g. controller restored before mount): reflect it.
        if (controller.webId) {
            this._phase = "authenticated";
            this.#emitSessionChange();
            return;
        }
        if (!this.autoRestore) {
            this._phase = "idle";
            return;
        }
        const generation = this.#generation;
        this._phase = "restoring";
        this._error = null;
        void controller
            .restore()
            .then((result) => {
            if (generation !== this.#generation)
                return; // superseded (disconnect/relogin)
            if (result.outcome === "restored") {
                this._phase = "authenticated";
                this.#emitSessionChange();
            }
            else {
                this._phase = "idle";
            }
        })
            .catch(() => {
            // The controller contract is fail-closed (restore never throws), but
            // defend anyway: any error → fall back to the login prompt, never a
            // falsely-asserted session.
            if (generation !== this.#generation)
                return;
            this._phase = "idle";
        });
    }
    /** Run interactive login for a specific WebID (or undefined → re-login). */
    #doLogin = async (webId) => {
        const controller = this.controller;
        if (!controller)
            return;
        // FENCE: bump the generation so THIS login supersedes any earlier in-flight
        // login/restore. A superseded earlier attempt then sees its captured id is no
        // longer current and BAILS (the guards below) — so it can't flip `_phase` back
        // to "idle"/error after a later login has already authenticated, which would
        // leave the panel showing the prompt while the controller holds a session.
        const generation = ++this.#generation;
        this._error = null;
        this._phase = "authenticating";
        try {
            const result = await controller.login(webId);
            if (generation !== this.#generation)
                return;
            this._phase = "authenticated";
            this.dispatchEvent(new CustomEvent("login", {
                detail: { webId: result.webId },
                bubbles: true,
                composed: true,
            }));
            this.#emitSessionChange();
        }
        catch (err) {
            if (generation !== this.#generation)
                return;
            // Cancellation (AbortError / CodeRequestCancelledError) is not a failure
            // to shout about; show a gentle message and return to the prompt.
            const aborted = (err instanceof DOMException && err.name === "AbortError") ||
                (err instanceof Error && /cancel/i.test(err.name + err.message));
            this._error = aborted
                ? null
                : err instanceof Error
                    ? err.message
                    : "Could not sign in. Please try again.";
            this._phase = "idle";
        }
    };
    #onSubmit = (e) => {
        e.preventDefault();
        const webId = this._webIdInput.trim();
        if (!webId)
            return;
        void this.#doLogin(webId);
    };
    #onLogout = async () => {
        const controller = this.controller;
        if (!controller)
            return;
        const generation = this.#generation;
        let error;
        try {
            await controller.logout();
        }
        catch (e) {
            error = e;
        }
        // Superseded (a login/restore raced in) — leave the UI to the winner.
        if (generation !== this.#generation)
            return;
        // RECONCILE against the controller's ACTUAL state — do NOT assume logged-out from
        // a `finally` (a rejecting controller.logout that left a live session would
        // otherwise show an idle prompt while still authenticated). Report logout +
        // logged-out ONLY when the controller truly has no session; otherwise stay
        // authenticated and surface the error.
        this.#generation++;
        if (controller.webId === null) {
            // The session IS gone locally → transition to logged-out (idle), emit logout +
            // session-change so consumers drop their session/fetch handles. BUT if logout()
            // REJECTED (the controller now rejects when the DURABLE credential delete failed,
            // even though local teardown succeeded), SURFACE that error rather than clearing it —
            // the persisted credential may linger, and hiding it would falsely report a fully
            // complete logout (the roborev finding).
            this._phase = "idle";
            this._showInput = false;
            this._error =
                error === undefined
                    ? null
                    : error instanceof Error
                        ? `Signed out, but couldn't fully clear stored credentials: ${error.message}`
                        : "Signed out, but couldn't fully clear stored credentials.";
            this.dispatchEvent(new CustomEvent("logout", { bubbles: true, composed: true }));
            this.#emitSessionChange();
        }
        else {
            // logout failed and a session is still live — keep the signed-in UI, show why.
            this._phase = "authenticated";
            this._error =
                error instanceof Error ? `Could not sign out: ${error.message}` : "Could not sign out.";
        }
    };
    /** Emit `session-change` reflecting the CURRENT controller session. */
    #emitSessionChange() {
        const webId = this.webId;
        this.dispatchEvent(new CustomEvent("session-change", {
            detail: { webId, loggedIn: webId !== null },
            bubbles: true,
            composed: true,
        }));
    }
    renderAccount(account) {
        const label = account.displayName || account.webId;
        return html `
      <button
        part="account"
        class="account"
        type="button"
        ?disabled=${this._phase === "authenticating"}
        @click=${() => void this.#doLogin(account.webId)}
      >
        <span part="avatar" class="avatar" aria-hidden="true">
          ${account.avatarUrl ? html `<img src=${account.avatarUrl} alt="" />` : initialsOf(label)}
        </span>
        <span class="account-text">
          <span class="account-name">${label}</span>
          <span class="account-webid">${account.webId}</span>
        </span>
      </button>
    `;
    }
    renderPrompt() {
        const accounts = this.controller?.recentAccounts() ?? [];
        const busy = this._phase === "authenticating";
        // Show the WebID input when: the host opted to (`_showInput`), there are no recent
        // accounts to pick, OR an initial/typed WebID is present (so a provided
        // `initial-webid` is visible + usable even alongside a recent-accounts list).
        const showInput = this._showInput || accounts.length === 0 || this._webIdInput.trim().length > 0;
        return html `
      <h2 part="heading">${this.heading}</h2>
      <p class="subtle">Sign in with your Solid identity (WebID).</p>
      ${accounts.length > 0
            ? html `
              <div part="accounts" class="accounts" role="group" aria-label="Recent accounts">
                ${accounts.map((a) => this.renderAccount(a))}
              </div>
            `
            : nothing}
      ${accounts.length > 0 && !showInput
            ? html `
              <button
                part="add-account"
                class="linkish"
                type="button"
                ?disabled=${busy}
                @click=${() => {
                this._showInput = true;
            }}
              >
                Use a different WebID
              </button>
            `
            : nothing}
      ${showInput
            ? html `
              <form part="form" @submit=${this.#onSubmit}>
                <label class="field">
                  Your WebID
                  <input
                    part="webid-input"
                    type="url"
                    inputmode="url"
                    autocomplete="url"
                    placeholder="https://you.example/profile/card#me"
                    .value=${this._webIdInput}
                    ?disabled=${busy}
                    required
                    @input=${(ev) => {
                this.#webIdEdited = true;
                this._webIdInput = ev.target.value;
            }}
                  />
                </label>
                <button
                  part="login-button"
                  class="btn"
                  type="submit"
                  ?disabled=${busy || !this._webIdInput.trim()}
                >
                  ${busy ? "Signing in…" : "Sign in"}
                </button>
              </form>
            `
            : nothing}
      ${this._error ? html `<p part="error" class="err" role="alert">${this._error}</p>` : nothing}
    `;
    }
    renderAuthenticated() {
        const webId = this.webId;
        return html `
      <div part="signed-in" class="signed-in">
        <h2 part="heading">Signed in</h2>
        <div class="identity">
          <span part="avatar" class="avatar" aria-hidden="true">${initialsOf(webId ?? "?")}</span>
          <span class="account-text">
            <span class="account-name">Your Solid account</span>
            ${webId ? html `<span part="webid" class="account-webid">${webId}</span>` : nothing}
          </span>
        </div>
        <slot></slot>
        ${this._error ? html `<p part="error" class="err" role="alert">${this._error}</p>` : nothing}
        <button
          part="logout-button"
          class="btn secondary"
          type="button"
          @click=${() => void this.#onLogout()}
        >
          Sign out
        </button>
      </div>
    `;
    }
    render() {
        if (!this.controller) {
            return html `
        <div part="panel" class="panel">
          <p class="subtle" part="not-configured">
            Login is not configured: set the <code>.controller</code> property
            (e.g. <code>createReactiveAuthController()</code> from
            <code>@jeswr/solid-elements/auth</code>).
          </p>
        </div>
      `;
        }
        let body;
        if (this._phase === "restoring") {
            body = html `
        <div part="restoring" class="restoring" role="status" aria-live="polite">
          <span class="spinner" aria-hidden="true"></span>
          <span>Restoring your session…</span>
        </div>
      `;
        }
        else if (this._phase === "authenticated") {
            body = this.renderAuthenticated();
        }
        else {
            body = this.renderPrompt();
        }
        return html `<div part="panel" class="panel">${body}</div>`;
    }
}
/** Avatar-fallback initials from a display name or a WebID. Exported for tests. */
export function initialsOf(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return "?";
    // If it looks like a URL/WebID, derive from the host's first letters.
    try {
        const url = new URL(trimmed);
        const host = url.hostname.replace(/^www\./, "");
        const seg = host.split(".").filter(Boolean)[0] ?? host;
        return (seg.slice(0, 2) || "?").toUpperCase();
    }
    catch {
        // Not a URL: treat as a name.
    }
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 0)
        return "?";
    if (parts.length === 1)
        return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
if (typeof customElements !== "undefined" && !customElements.get("jeswr-login-panel")) {
    customElements.define("jeswr-login-panel", JeswrLoginPanel);
}
