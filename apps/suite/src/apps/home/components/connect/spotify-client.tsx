// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { OAUTH_CALLBACK_PATH } from "@jeswr/pod-connectors/oauth";
import { createTypeIndex } from "@jeswr/pod-type-index";
import { createPodClient } from "@jeswr/storage-client";
import { createPreferences, type PreferencesHook } from "@jeswr/suite-sdk/preferences";
import { useEffect, useState } from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { fetchWithSignal } from "./import-service";

export const spotifyClientSchema = {
  parse(value: unknown): string {
    if (typeof value !== "string" || (value !== "" && !/^[a-fA-F0-9]{32}$/.test(value)))
      throw new Error("Enter the 32 hexadecimal characters of your Spotify Client ID.");
    // Spotify issues lower-case Client IDs; store and use that canonical spelling.
    return value.toLowerCase();
  },
};

/** Own one SDK preferences store for this authenticated session; revoke every old transport. */
export function SpotifyClientSettings({
  session,
  onClientId,
}: {
  session: PodSession;
  onClientId: (id: string) => void;
}) {
  const [opened, setOpened] = useState<{ session: PodSession; usePreferences: PreferencesHook }>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let preferences: PreferencesHook | undefined;
    setFailed(false);
    const fetch = fetchWithSignal(session.fetch, controller.signal);
    void createPodClient({ storage: session.storageUrl, fetch, signal: controller.signal })
      .then(({ storage, features }) => {
        controller.signal.throwIfAborted();
        preferences = createPreferences({
          storage,
          webId: session.webId,
          typeIndex: createTypeIndex({ storage, features, profile: session.webId, fetch }),
        });
        setOpened({ session, usePreferences: preferences });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      preferences?.dispose();
    };
  }, [session]);
  return opened?.session === session ? (
    <SpotifyClientForm
      key={session.webId + session.storageUrl}
      usePreferences={opened.usePreferences}
      onClientId={onClientId}
    />
  ) : (
    <p role="status">
      {failed
        ? "Couldn't open pod preferences. Import a history file or reopen Connect to retry."
        : "Opening pod preferences…"}
    </p>
  );
}

export function SpotifyClientForm({
  usePreferences,
  onClientId,
}: {
  usePreferences: PreferencesHook;
  onClientId: (id: string) => void;
}) {
  const preference = usePreferences("connect.spotify-client-id", spotifyClientSchema, "");
  const [draft, setDraft] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const value = draft ?? preference.value;
  const normalized = value.trim().toLowerCase();
  const valid = /^[a-f0-9]{32}$/.test(normalized);
  const [redirect, setRedirect] = useState("");
  useEffect(() => {
    setRedirect(new URL(OAUTH_CALLBACK_PATH, window.location.href).href);
  }, []);
  useEffect(() => {
    onClientId(
      !preference.loading &&
        !preference.pending &&
        !preference.error &&
        normalized === preference.value
        ? preference.value
        : "",
    );
  }, [
    normalized,
    preference.value,
    preference.loading,
    preference.pending,
    preference.error,
    onClientId,
  ]);
  return (
    <div>
      <p>
        Connect with your own Spotify app. A Spotify Premium account may be required for
        development-mode API access; Spotify's account and user limits still apply.
      </p>
      <ol>
        <li>
          Open the{" "}
          <a
            href="https://developer.spotify.com/dashboard"
            target="_blank"
            rel="noopener noreferrer"
          >
            Spotify Developer Dashboard
          </a>
          , sign in and choose Create app.
        </li>
        <li>
          Enter an app name and description, select Web API, and register this exact Redirect URI:{" "}
          <code>{redirect}</code>.
        </li>
        <li>
          Save the app. In Settings, copy its Client ID and paste it below. If connecting another
          account, add it under User Management.
        </li>
      </ol>
      <p>
        This uses PKCE. Only the public Client ID is saved in your pod preferences. Never paste a
        client secret.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          void preference.set(normalized).catch(() => setInvalid(true));
        }}
      >
        <label htmlFor="spotify-client-id">Spotify Client ID</label>
        <input
          id="spotify-client-id"
          value={value}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby="spotify-client-help"
          onChange={(event) => {
            setDraft(event.target.value);
            setInvalid(false);
          }}
        />
        <p id="spotify-client-help">32 hexadecimal characters (0–9 and a–f).</p>
        {invalid && <p role="alert">Enter a valid 32-character Spotify Client ID.</p>}
        <button
          type="submit"
          className="hm-connect-button"
          disabled={preference.loading || (preference.pending && !preference.error)}
        >
          Save Client ID
        </button>
      </form>
      <p role="status">
        {preference.error
          ? preference.pending
            ? "Couldn't save to your pod. Your change is queued; save again to retry."
            : "Couldn't read pod preferences. Save a Client ID to retry."
          : preference.pending
            ? "Saving Client ID…"
            : normalized !== preference.value
              ? "Save this Client ID before continuing."
              : preference.value
                ? "Client ID saved in your pod."
                : ""}
      </p>
    </div>
  );
}
