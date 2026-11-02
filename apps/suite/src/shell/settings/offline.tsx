// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  formatBytes,
} from "@jeswr/suite-ui";
import { useCallback, useEffect, useState } from "react";
import { clearSavedCopies } from "../lib/settings-offline";
import { usePreferences } from "./preferences";

export function OfflineSettings() {
  const offline = usePreferences("offline");
  const [size, setSize] = useState("Calculating…");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState(false);
  const [open, setOpen] = useState(false);
  const estimate = useCallback(async () => {
    try {
      if (!navigator.storage?.estimate) {
        setSize("Cache size isn't available in this browser.");
        return;
      }
      const result = await navigator.storage.estimate();
      setSize(
        result.usage === undefined
          ? "Cache size isn't available in this browser."
          : `${formatBytes(result.usage)} saved in this browser`,
      );
    } catch {
      setSize("Couldn't calculate cache size.");
    }
  }, []);
  useEffect(() => {
    void estimate();
  }, [estimate]);
  return (
    <>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={offline.value}
          onChange={(event) => offline.update(event.target.checked)}
        />
        Keep my recent items available offline
      </label>
      <section aria-labelledby="saved-copies">
        <h2 id="saved-copies">Saved copies</h2>
        <p role="status">{size}</p>
        <p>Browser storage usage includes saved copies and other local app data.</p>
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="justify-self-start">
              Clear saved copies
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Clear saved copies?</AlertDialogTitle>
            <AlertDialogDescription>
              Saved copies on this device will be removed. Your original files stay in your storage.
              Close other Solid Suite tabs before continuing.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={clearing}
                onClick={async (event) => {
                  event.preventDefault();
                  setClearing(true);
                  setError("");
                  setMessage("");
                  try {
                    await clearSavedCopies({
                      ...("caches" in window ? { cacheStorage: caches } : {}),
                      ...("indexedDB" in window ? { databaseFactory: indexedDB } : {}),
                    });
                    setMessage("Saved copies cleared");
                    setOpen(false);
                    await estimate();
                  } catch {
                    setError(
                      "Couldn't clear all saved copies. Close other Solid Suite tabs and try again.",
                    );
                  } finally {
                    setClearing(false);
                  }
                }}
              >
                {clearing ? "Clearing…" : "Clear saved copies"}
              </AlertDialogAction>
            </AlertDialogFooter>
            {error && <p role="alert">{error}</p>}
          </AlertDialogContent>
        </AlertDialog>
        <p role="status">{message}</p>
      </section>
    </>
  );
}
