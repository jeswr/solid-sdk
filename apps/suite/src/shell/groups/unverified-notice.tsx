// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  type GroupFolder,
  SECURING_INTERRUPTED,
  type UnverifiedContent,
  type UnverifiedFolder,
} from "@jeswr/suite-groups";
import { Button } from "@jeswr/suite-ui";
import { useEffect, useRef, useState } from "react";

type Decision = "keep" | "discard";
const TITLE: Record<GroupFolder, string> = {
  groups: "Group files changed",
  settings: "Group settings changed",
};
const SUMMARY: Record<GroupFolder, (count: number) => string> = {
  groups: (count) =>
    `${count} group ${count === 1 ? "file was" : "files were"} changed outside the suite. Review them, then keep or remove them.`,
  settings: () =>
    "Your group sharing settings were changed outside the suite. Review them, then keep or remove them.",
};
const REMOVE: Record<GroupFolder, string> = {
  groups:
    "Remove these group files from your pod? Every share made through these groups ends. This can't be undone.",
  settings: "Remove these group settings from your pod? This can't be undone.",
};
/** What the owner is told the outcome was, announced once the folder is resolved. */
export const RESOLVED: Record<GroupFolder, Record<Decision, string>> = {
  groups: { keep: "Group files kept.", discard: "Group files removed." },
  settings: { keep: "Group settings kept.", discard: "Group settings removed." },
};

/** One unverified document, as the directory read it: shown to decide with, never trusted. */
function Content({ content, family }: { content: UnverifiedContent; family(id: string): string }) {
  const own = content.inherits ? null : (
    <p>This file has its own access settings, so it can't be kept.</p>
  );
  if (content.kind === "unreadable")
    return (
      <li>
        <span className="su-account-id">{content.url}</span>
        <p>This file can't be read, so it can't be kept.</p>
        {own}
      </li>
    );
  if (content.kind === "group")
    return (
      <li>
        <strong>{content.name || "Unnamed group"}</strong>
        {content.members.length ? (
          <ul aria-label={`Members of ${content.name || "Unnamed group"}`}>
            {content.members.map((member) => (
              <li key={member} className="su-account-id">
                {member}
              </li>
            ))}
          </ul>
        ) : (
          <p>No members</p>
        )}
        {own}
      </li>
    );
  return (
    <li>
      <p>Family group: {content.family === null ? "none" : family(content.family)}</p>
      {content.spaces.length ? (
        <>
          <p>Spaces your Family group would be given access to:</p>
          <ul aria-label="Family spaces">
            {content.spaces.map((space) => (
              <li key={space} className="su-account-id">
                {space}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>No Family spaces</p>
      )}
      {own}
    </li>
  );
}

/**
 * The owner's decision on a folder whose files were written while it was unverified. Remove is
 * offered first; Keep (offered only when every file can be kept) and Remove both open a
 * confirmation, which takes focus, and Cancel returns focus to the button that opened it.
 */
export function UnverifiedNotice({
  folder,
  busy,
  family,
  resolve,
}: {
  folder: UnverifiedFolder;
  busy: boolean;
  /** The name to show for a Family group id. */
  family(id: string): string;
  resolve(decision: Decision): void;
}) {
  const [confirm, setConfirm] = useState<Decision>();
  const opener = useRef<Decision>(undefined);
  const keepButton = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (confirm) dialog.current?.focus();
    else if (opener.current)
      (opener.current === "keep" ? keepButton : removeButton).current?.focus();
  }, [confirm]);
  const open = (decision: Decision) => {
    opener.current = decision;
    setConfirm(decision);
  };
  const heading = `unverified-${folder.folder}`;
  const unseen = folder.documents.length - folder.contents.length;
  const groups = folder.contents.flatMap((content) =>
    content.kind === "group" ? [content.name || "Unnamed group"] : [],
  );
  const spaces = [
    ...new Set(
      folder.contents.flatMap((content) => (content.kind === "settings" ? content.spaces : [])),
    ),
  ];
  return (
    <section aria-labelledby={heading}>
      <h2 id={heading}>{TITLE[folder.folder]}</h2>
      <p>{SUMMARY[folder.folder](folder.documents.length)}</p>
      <ul aria-label={`Changed ${folder.folder === "groups" ? "group files" : "settings"}`}>
        {folder.contents.map((content) => (
          <Content key={content.url} content={content} family={family} />
        ))}
      </ul>
      {unseen > 0 && (
        <p>
          {unseen === 1
            ? "1 more file isn't shown, so it can't be kept."
            : `${unseen} more files aren't shown, so they can't be kept.`}
        </p>
      )}
      {folder.planted ? (
        <p>{SECURING_INTERRUPTED}.</p>
      ) : folder.keepable ? (
        <p>
          Keeping trusts these files as they are: anyone who could change this folder before could
          have written them.
          {folder.folder === "settings" &&
            " Kept settings can give your Family group access to the spaces listed."}
        </p>
      ) : (
        <p>Some of these files can't be kept. Remove them to continue.</p>
      )}
      {confirm ? (
        <fieldset ref={dialog} tabIndex={-1} disabled={busy}>
          <legend>
            {confirm === "discard"
              ? REMOVE[folder.folder]
              : folder.folder === "groups"
                ? groups.length === 1
                  ? "Keep this group and its members as they are?"
                  : `Keep these ${groups.length} groups and their members as they are?`
                : "Keep these group settings as they are?"}
          </legend>
          {confirm === "keep" &&
            (folder.folder === "groups" ? (
              <p>Groups you keep: {groups.join(", ")}.</p>
            ) : (
              <p>
                {spaces.length
                  ? `Your Family group can be given access to: ${spaces.join(", ")}.`
                  : "These settings list no Family spaces."}
              </p>
            ))}
          <div className="settings-choice-row">
            {confirm === "discard" ? (
              <Button variant="destructive" onClick={() => resolve("discard")}>
                Remove files
              </Button>
            ) : (
              <Button onClick={() => resolve("keep")}>Keep files</Button>
            )}
            <Button variant="outline" onClick={() => setConfirm(undefined)}>
              Cancel
            </Button>
          </div>
        </fieldset>
      ) : (
        <div className="settings-choice-row">
          <Button ref={removeButton} disabled={busy} onClick={() => open("discard")}>
            Remove
          </Button>
          {folder.keepable && (
            <Button ref={keepButton} variant="outline" disabled={busy} onClick={() => open("keep")}>
              Keep
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
