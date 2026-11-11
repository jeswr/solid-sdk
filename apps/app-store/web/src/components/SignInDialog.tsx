// AUTHORED-BY GPT-6.1 Sol
// Preserve the public catalog's native modal while the shared card owns sign-in choices.
import { LoginScreen, useSession } from "@jeswr/app-session/react";
import { useEffect, useRef } from "react";
import { APP_NAME } from "../auth/pod-auth";

export interface SignInDialogProps {
  open: boolean;
  onClose(): void;
}

export function SignInDialog({ open, onClose }: SignInDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { pending } = useSession();
  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="signin-dialog"
      aria-label="Sign in to App Store"
      onClose={onClose}
      onCancel={(event) => {
        if (pending) event.preventDefault();
        else onClose();
      }}
    >
      {/* Mount when opened, after remembered accounts are available to the card. */}
      {open ? (
        <LoginScreen
          appName={APP_NAME}
          knownProviders={import.meta.env.VITE_KNOWN_PROVIDERS}
          homeIdp={import.meta.env.VITE_HOME_IDP}
          homeIdpName={import.meta.env.VITE_HOME_IDP_NAME}
          dev={import.meta.env.DEV}
        />
      ) : null}
      <div className="signin-actions">
        <button type="button" className="signin-cancel" onClick={onClose} disabled={!!pending}>
          Close
        </button>
      </div>
    </dialog>
  );
}
