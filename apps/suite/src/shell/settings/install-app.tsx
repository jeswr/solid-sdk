// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { installPrompt, useInstallPrompt } from "@jeswr/suite-sdk/pwa";
import { Button } from "@jeswr/suite-ui";
import { useState } from "react";

export function InstallApp() {
  const { status } = useInstallPrompt();
  const [message, setMessage] = useState("");
  if (status === "installed" || (status === "unavailable" && !message)) return null;
  return (
    <section aria-labelledby="install-app-heading">
      <h2 id="install-app-heading">Install app</h2>
      {status === "ios" ? (
        <p>Use Share, then Add to Home Screen</p>
      ) : (
        <>
          <p>Open Solid Suite from your home screen or desktop, even when offline.</p>
          {(status === "available" || status === "prompting") && (
            <Button
              className="justify-self-start"
              variant="outline"
              disabled={status === "prompting"}
              onClick={() => {
                setMessage("");
                void installPrompt
                  .install()
                  .then((outcome) => {
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
          <p role="status">{message}</p>
        </>
      )}
    </section>
  );
}
