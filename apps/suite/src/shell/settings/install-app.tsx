// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { isNativeApp } from "@jeswr/suite-native";
import { installPrompt, useInstallPrompt } from "@jeswr/suite-sdk/pwa";
import { Button } from "@jeswr/suite-ui";
import { useEffect, useRef, useState } from "react";

export function InstallApp() {
  const { status } = useInstallPrompt();
  const [message, setMessage] = useState("");
  // Stays mounted from the click on, so the status region survives the status change.
  const [attempted, setAttempted] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const hadButton = useRef(false);
  const canInstall = status === "available" || status === "prompting";
  // The Install button disappears once the outcome is known; keep keyboard focus in the section.
  useEffect(() => {
    if (hadButton.current && !canInstall) heading.current?.focus();
    hadButton.current = canInstall;
  }, [canInstall]);
  // The native app is already installed; Capacitor's remote mode loads this same web build.
  if (isNativeApp()) return null;
  if (!canInstall && status !== "ios" && !attempted) return null;
  return (
    <section aria-labelledby="install-app-heading">
      <h2 id="install-app-heading" ref={heading} tabIndex={-1}>
        Install app
      </h2>
      {status === "ios" ? (
        <p>Use Share, then Add to Home Screen</p>
      ) : (
        canInstall && <p>Open Solid Suite from your home screen or desktop, even when offline.</p>
      )}
      {canInstall && (
        <Button
          className="justify-self-start"
          variant="outline"
          disabled={status === "prompting"}
          onClick={() => {
            setMessage("");
            setAttempted(true);
            void installPrompt
              .install()
              .then((outcome) => {
                if (outcome === "accepted") setMessage("Solid Suite is installed.");
                if (outcome === "dismissed")
                  setMessage(
                    "Installation dismissed. You can install later from your browser's menu.",
                  );
              })
              .catch(() =>
                setMessage("Installation couldn't start. Try again from your browser's menu."),
              );
          }}
        >
          {status === "prompting" ? "Installing…" : "Install"}
        </Button>
      )}
      {/* One persistent live region, so a change in its text is announced. */}
      <p role="status">{message}</p>
    </section>
  );
}
