// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// SignInDialog — the store's OWN Solid login. WebID-first (the reactive-auth UX
// spec): ONE input, the user's WebID URL; the issuer is resolved from the profile, so
// no identity-provider dropdown. Signing in here only teaches the store your WebID so
// the Launch buttons can carry it into the target apps — the store stores no pod data
// of its own. Errors bubble up from the session layer.
//
// Uses the native <dialog> element for accessible modal semantics (focus trap +
// Escape close are provided by the platform); rendered as a controlled component.
import { type FormEvent, useEffect, useRef, useState } from "react";

const HOME_IDP = import.meta.env.VITE_HOME_IDP ?? "https://idp.solid-test.jeswr.org";

export interface SignInDialogProps {
  open: boolean;
  onClose: () => void;
  login: (webId: string) => Promise<void>;
  loggingIn: boolean;
  ready: boolean;
  error: string | null;
}

export function SignInDialog({ open, onClose, login, loggingIn, ready, error }: SignInDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [webIdInput, setWebIdInput] = useState("");

  // Open/close the native <dialog> in step with the `open` prop. showModal() gives the
  // platform focus-trap + backdrop; close() tears it down.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const id = webIdInput.trim();
    if (!id) return;
    try {
      await login(id);
      // A successful login flips webId in the session context; the parent closes the
      // dialog by re-rendering with the AccountMenu. We also close optimistically.
      onClose();
    } catch {
      // The error is surfaced via the session context's `error`.
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="signin-dialog"
      aria-labelledby="signin-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <form className="signin-form" onSubmit={submit}>
        <h2 id="signin-title">Sign in to Solid</h2>
        <p className="signin-sub">
          Enter your WebID — the URL that identifies you across Solid. Signing in lets the store
          launch every app already logged in.
        </p>
        <label htmlFor="signin-webid">WebID</label>
        <input
          id="signin-webid"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://you.solid-test.jeswr.org/profile/card#me"
          value={webIdInput}
          onChange={(ev) => setWebIdInput(ev.target.value)}
          disabled={loggingIn}
        />
        {error ? (
          <p className="signin-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="signin-actions">
          <button type="button" className="signin-cancel" onClick={onClose} disabled={loggingIn}>
            Cancel
          </button>
          <button type="submit" disabled={loggingIn || !ready || !webIdInput.trim()}>
            {loggingIn ? "Signing in…" : ready ? "Sign in" : "Loading…"}
          </button>
        </div>
        <p className="signin-hint">
          New to Solid? Get a pod and WebID from{" "}
          <a href={HOME_IDP} target="_blank" rel="noopener noreferrer">
            {new URL(HOME_IDP).host}
          </a>
          .
        </p>
      </form>
    </dialog>
  );
}
