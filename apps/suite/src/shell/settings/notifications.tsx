// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Input } from "@jeswr/suite-ui";
import { useEffect, useId, useState } from "react";
import { usePreferences } from "./preferences";

/** The kinds that may pop up on the desktop (02-§7); the tray always lists every kind. */
const kinds = [
  ["shared", "Shared with you"],
  ["requests", "Access requests"],
  ["tasks", "Task reminders"],
] as const;

export function NotificationSettings() {
  const fromId = useId();
  const untilId = useId();
  const notifications = usePreferences("notifications");
  const quiet = usePreferences("quietHours");
  const desktop = usePreferences("desktop");
  const [permission, setPermission] = useState("Checking…");
  const [error, setError] = useState("");
  useEffect(() => {
    const sync = () =>
      setPermission("Notification" in window ? Notification.permission : "unavailable");
    sync();
    addEventListener("focus", sync);
    return () => removeEventListener("focus", sync);
  }, []);
  return (
    <>
      <p>
        Every notification appears in the tray. These settings choose which ones also pop up on your
        desktop.
      </p>
      <fieldset>
        <legend>Pop up on the desktop for</legend>
        {kinds.map(([key, label]) => (
          <label key={key} className="settings-toggle">
            <input
              type="checkbox"
              checked={notifications.value[key]}
              onChange={(event) =>
                notifications.update({ ...notifications.value, [key]: event.target.checked })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <section aria-labelledby="desktop-notifications">
        <h2 id="desktop-notifications">Desktop notifications</h2>
        <p role="status">Permission: {permission}</p>
        <Button
          className="justify-self-start"
          variant="outline"
          disabled={permission !== "default"}
          onClick={async () => {
            setError("");
            try {
              const granted = await Notification.requestPermission();
              setPermission(granted);
              if (granted === "granted") desktop.update(true);
            } catch {
              setError("Couldn't ask for notification permission. Check your browser settings.");
            }
          }}
        >
          Enable desktop notifications
        </Button>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={desktop.value && permission === "granted"}
            disabled={permission !== "granted"}
            onChange={(event) => desktop.update(event.target.checked)}
          />
          Show desktop notifications for this account
        </label>
        {permission === "denied" && (
          <p>Allow notifications in your browser settings to enable them here.</p>
        )}
        {permission === "unavailable" && <p>This browser doesn't support desktop notifications.</p>}
        {error && <p role="alert">{error}</p>}
      </section>
      <fieldset>
        <legend>Quiet hours (no desktop pop-ups)</legend>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={quiet.value.enabled}
            onChange={(event) => quiet.update({ ...quiet.value, enabled: event.target.checked })}
          />
          Use quiet hours
        </label>
        <div className="settings-choice-row">
          <label htmlFor={fromId}>
            From
            <Input
              type="time"
              id={fromId}
              value={quiet.value.start}
              disabled={!quiet.value.enabled}
              onChange={(event) => quiet.update({ ...quiet.value, start: event.target.value })}
            />
          </label>
          <label htmlFor={untilId}>
            Until
            <Input
              type="time"
              id={untilId}
              value={quiet.value.end}
              disabled={!quiet.value.enabled}
              onChange={(event) => quiet.update({ ...quiet.value, end: event.target.value })}
            />
          </label>
        </div>
      </fieldset>
    </>
  );
}
