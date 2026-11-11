// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { fetchRdf } from "@jeswr/fetch-rdf";
import {
  isLegacyTarget,
  isWebId,
  type LegacyContact,
  type LegacyPlan,
  validPlan,
} from "@jeswr/pod-legacy";
import { Alert, AlertDescription, Button, Input } from "@jeswr/suite-ui";
import { Agent } from "@solid/object";
import { DataFactory } from "n3";
import { useEffect, useState } from "react";
import { useSuiteEnvironment } from "../environment";
import { folderName, grantPreview } from "../legacy/presentation";
import { useLegacy } from "../legacy/provider";
import { useAccounts } from "../session/accounts-provider";
import type { SuiteAccount } from "../session/types";
import { RequiresOnline } from "../sync/requires-online";

type Person = { name: string; webId: string };
/** The device clock when a supplied time is not a valid Date; never an Invalid Date. */
function validNow(time: Date | undefined): Date {
  return time instanceof Date && Number.isFinite(time.getTime()) ? time : new Date();
}
export function RecoveryChecklist({
  account,
  issuers,
  provider,
}: {
  account: SuiteAccount;
  issuers: string[] | null;
  provider?: string | undefined;
}) {
  return (
    <section aria-labelledby="recovery-heading">
      <h2 id="recovery-heading">Your recovery checklist</h2>
      <p>
        Keep a copy of your WebID:{" "}
        <a href={account.webId} rel="noopener noreferrer">
          {account.webId}
        </a>
      </p>
      <p>
        Sign-in provider:{" "}
        {account.issuer ??
          (account.kind === "demo" ? "Fictional demo provider" : "Not available in this session")}
      </p>
      {provider && isWebId(provider) ? (
        <a href={provider} rel="noopener noreferrer">
          Open your provider’s account page
        </a>
      ) : account.issuer && isWebId(account.issuer) ? (
        <a href={account.issuer} rel="noopener noreferrer">
          Open your sign-in provider to find account recovery
        </a>
      ) : null}
      <p>
        {issuers === null
          ? "Could not check backup sign-in providers."
          : issuers.length > 1
            ? `Your profile lists ${issuers.length} sign-in providers.`
            : "Your profile does not list a backup sign-in provider."}{" "}
        A backup provider is another identity provider authorised by your WebID profile. It can help
        you sign in if your usual provider is unavailable. Your provider must support this; this
        page does not change your profile.
      </p>
      <p>
        Last data export: no export history is available yet.{" "}
        <a href="/settings/export">Export your data</a> and keep a recent copy somewhere you can
        reach without this account.
      </p>
      <p>
        Keep your provider’s recovery details up to date. Store recovery codes securely, and tell
        someone you trust where to find your instructions.
      </p>
    </section>
  );
}
export function LegacyEditor({
  initial,
  folders,
  people,
  onSave,
  onDelete,
  now = () => new Date(),
  notice = "",
}: {
  initial: LegacyPlan;
  folders: string[];
  people: Person[];
  onSave(plan: LegacyPlan): Promise<void>;
  onDelete?: (() => Promise<void>) | undefined;
  now?: () => Date;
  /** Shown on mount, e.g. after another tab's change replaced the draft. */
  notice?: string;
}) {
  const [plan, setPlan] = useState(initial);
  const [webId, setWebId] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<LegacyContact["scope"]>("containers");
  const [targets, setTargets] = useState<string[]>([]);
  const [folderIri, setFolderIri] = useState("");
  const [message, setMessage] = useState(notice);
  const [saving, setSaving] = useState(false);
  const available = [...new Set([...folders, ...targets])].filter((target) =>
    isLegacyTarget(target, plan.storage),
  );
  const add = () => {
    const contact: LegacyContact = {
      webId,
      displayName: name.trim(),
      scope,
      mode: "read",
      targets:
        scope === "whole-pod"
          ? available.filter((target) => !target.slice(plan.storage.length, -1).includes("/"))
          : targets,
    };
    const updated = { ...plan, contacts: [...plan.contacts, contact] };
    if (!validPlan(updated)) {
      setMessage("Enter a valid HTTPS WebID, a name, and at least one folder inside your pod.");
      return;
    }
    if (plan.contacts.some((c) => c.webId === webId)) {
      setMessage("This WebID is already a legacy contact. Remove it before changing its scope.");
      return;
    }
    setPlan(updated);
    setWebId("");
    setName("");
    setTargets([]);
    setMessage("Contact added to your draft. Save the plan to keep it.");
  };
  return (
    <section aria-labelledby="legacy-heading">
      <h2 id="legacy-heading">Your legacy plan</h2>
      <Alert>
        <AlertDescription>
          Your plan records your wishes only. Nothing is shared until the plan is due AND automatic
          enforcement exists. Automatic enforcement is not available. Contacts receive read-only
          access in the preview; no grants are applied.
        </AlertDescription>
      </Alert>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={plan.enabled}
          onChange={(e) => setPlan({ ...plan, enabled: e.target.checked })}
        />
        Enable legacy plan evaluation
      </label>
      <label>
        Inactivity period
        <select
          value={plan.inactivityMonths}
          onChange={(e) => setPlan({ ...plan, inactivityMonths: Number(e.target.value) })}
        >
          {[3, 6, 12, 18].map((months) => (
            <option value={months} key={months}>
              {months} months
            </option>
          ))}
        </select>
      </label>
      <label>
        Warn me before the due date
        <select
          value={[...plan.warningDays].sort((a, b) => b - a).join(",")}
          onChange={(e) => setPlan({ ...plan, warningDays: e.target.value.split(",").map(Number) })}
        >
          <option value="30,7">30 and 7 days before</option>
          <option value="60,30,7">60, 30 and 7 days before</option>
          <option value="7,1">7 and 1 days before</option>
        </select>
      </label>
      <p>
        Warnings appear in Settings while this app is open. No background email or delivery service
        is connected.
      </p>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={plan.notifyMeBy.includes("tray")}
          onChange={(e) =>
            setPlan({ ...plan, notifyMeBy: e.target.checked ? ["settings", "tray"] : ["settings"] })
          }
        />
        Also notify me in the notification tray
      </label>
      <ul>
        {plan.contacts.map((contact) => (
          <li key={contact.webId}>
            <strong>{contact.displayName}</strong> · {contact.webId}{" "}
            <Button
              variant="outline"
              onClick={() =>
                setPlan({ ...plan, contacts: plan.contacts.filter((c) => c !== contact) })
              }
              aria-label={`Remove ${contact.displayName}`}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <fieldset>
        <legend>Add a legacy contact</legend>
        {people.length > 0 && (
          <label>
            Choose from contacts
            <select
              defaultValue=""
              onChange={(e) => {
                const person = people.find((p) => p.webId === e.target.value);
                if (person) {
                  setWebId(person.webId);
                  setName(person.name);
                }
              }}
            >
              <option value="">Choose a contact with a WebID</option>
              {people.map((person) => (
                <option key={person.webId} value={person.webId}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label htmlFor="legacy-webid">
          Legacy contact WebID
          <Input
            id="legacy-webid"
            value={webId}
            onChange={(e) => setWebId(e.target.value)}
            placeholder="https://alex.example/profile/card#me"
          />
        </label>
        <label htmlFor="legacy-name">
          Display name
          <Input id="legacy-name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Access scope
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as LegacyContact["scope"])}
          >
            <option value="containers">Pick folders</option>
            <option value="whole-pod">Whole pod except settings (listed top-level folders)</option>
          </select>
        </label>
        {scope === "containers" && (
          <fieldset>
            <legend>Folders to include</legend>
            {available.map((folder) => (
              <label className="settings-toggle" key={folder}>
                <input
                  type="checkbox"
                  checked={targets.includes(folder)}
                  onChange={(e) =>
                    setTargets(
                      e.target.checked ? [...targets, folder] : targets.filter((t) => t !== folder),
                    )
                  }
                />
                {folderName(folder)}{" "}
                <span className="legacy-folder-path">{new URL(folder).pathname}</span>
              </label>
            ))}
            <label htmlFor="legacy-folder-iri">
              Another folder IRI
              <Input
                id="legacy-folder-iri"
                value={folderIri}
                onChange={(e) => setFolderIri(e.target.value)}
              />
            </label>
            <Button
              variant="outline"
              onClick={() => {
                try {
                  if (!isLegacyTarget(folderIri, plan.storage)) throw new Error();
                  setTargets([...new Set([...targets, folderIri])]);
                  setFolderIri("");
                } catch {
                  setMessage(
                    "Enter a folder IRI inside your pod, ending with /. Settings and its contents are excluded.",
                  );
                }
              }}
            >
              Include folder IRI
            </Button>
          </fieldset>
        )}
        <Button variant="outline" onClick={add}>
          Add legacy contact
        </Button>
      </fieldset>
      <section aria-label="Proposed access preview">
        <h3>Proposed access preview</h3>
        {grantPreview(plan).map((line) => (
          <p key={line}>{line}</p>
        ))}
        {!plan.enabled && <p>Evaluation is disabled. This is a preview of your saved wishes.</p>}
      </section>
      <RequiresOnline>
        <Button
          disabled={saving}
          onClick={() => {
            setSaving(true);
            setMessage("Saving…");
            void onSave({ ...plan, modified: validNow(now()) })
              .then(
                () => setMessage("Legacy plan saved. Nothing has been shared."),
                (error: unknown) =>
                  setMessage(error instanceof Error ? error.message : "Could not save the plan."),
              )
              .finally(() => setSaving(false));
          }}
        >
          Save legacy plan
        </Button>
      </RequiresOnline>
      {onDelete && (
        <RequiresOnline>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              setMessage("Deleting…");
              void onDelete()
                .then(
                  () => setMessage("Legacy plan deleted. Nothing has been shared."),
                  (error: unknown) =>
                    setMessage(
                      error instanceof Error ? error.message : "Could not delete the plan.",
                    ),
                )
                .finally(() => setSaving(false));
            }}
          >
            Delete my legacy plan
          </Button>
        </RequiresOnline>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
export function LegacySettings() {
  const { active } = useAccounts();
  const { session, loading, error, withdraw } = useLegacy();
  const [withdrawing, setWithdrawing] = useState("");
  const env = useSuiteEnvironment();
  const [extra, setExtra] = useState<{
    account: SuiteAccount;
    issuers: string[] | null;
    folders: string[];
    people: Person[];
  } | null>(null);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const { account, storage } = session;
    void (async () => {
      const profile = await fetchRdf(account.webId, {
        fetch: session.fetch,
        maxBytes: 1024 * 1024,
      }).catch(() => null);
      let issuers: string[] | null = null;
      if (profile) {
        try {
          issuers = [...new Agent(account.webId, profile.dataset, DataFactory).oidcIssuer].filter(
            isWebId,
          );
        } catch {
          /* Unknown, never claim a backup. */
        }
      }
      const folders: string[] = [];
      try {
        for await (const entry of storage.listAll(account.storageUrl))
          if (entry.kind === "container" && !entry.url.endsWith("/settings/"))
            folders.push(entry.url);
        for (const folder of [...folders].slice(0, 50))
          for await (const entry of storage.listAll(folder))
            if (entry.kind === "container" && folders.length < 200) folders.push(entry.url);
      } catch {
        /* The explicit folder IRI field remains available. */
      }
      const people: Person[] = [];
      try {
        const { ContactsModel } = await import("@/apps/contacts/lib/model/book");
        const contacts = new ContactsModel(session.fetch, account.storageUrl);
        const book = await contacts.loadAddressBook();
        const index = await contacts.loadPeople(book);
        for (const item of index.data.slice(0, 100)) {
          const person = await contacts.loadContact(item.id);
          if (person.data.webId && isWebId(person.data.webId))
            people.push({ name: person.data.name, webId: person.data.webId });
        }
      } catch {
        /* WebID entry always works even with no address book. */
      }
      if (!cancelled) setExtra({ account, issuers, folders, people });
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);
  if (!active) return null;
  const data = extra?.account === active ? extra : null;
  const now = validNow(session?.now());
  const initial: LegacyPlan = session?.snapshot?.plan ?? {
    owner: active.webId,
    storage: active.storageUrl,
    contacts: [],
    inactivityMonths: 6,
    warningDays: [30, 7],
    notifyMeBy: ["settings", "tray"],
    lastActivity: now,
    enabled: false,
    created: now,
    modified: now,
  };
  return (
    <div className="legacy-settings">
      <RecoveryChecklist
        account={active}
        issuers={data?.issuers ?? null}
        provider={env.NEXT_PUBLIC_SUITE_IDP_ACCOUNT_URL}
      />
      {error && <p role="alert">{error}</p>}
      {withdraw && (
        <section aria-label="Delete the unverified legacy plan">
          <p>
            You can still delete the saved plan. Deleting does not share anything or change who can
            access your settings.
          </p>
          <RequiresOnline>
            <Button
              variant="outline"
              disabled={withdrawing === "Deleting…"}
              onClick={() => {
                setWithdrawing("Deleting…");
                void withdraw().then(
                  () => setWithdrawing(""),
                  (failure: unknown) =>
                    setWithdrawing(
                      failure instanceof Error ? failure.message : "Could not delete the plan.",
                    ),
                );
              }}
            >
              Delete my legacy plan
            </Button>
          </RequiresOnline>
          <p role="status" aria-live="polite">
            {withdrawing}
          </p>
        </section>
      )}
      {loading && <p role="status">Loading your private plan…</p>}
      {session?.snapshot?.invalid && (
        <Alert>
          <AlertDescription>
            Your saved legacy plan could not be read, so nothing is evaluated or shared. Save a new
            plan below to replace it, or delete it.
          </AlertDescription>
        </Alert>
      )}
      {session && (
        <LegacyEditor
          // Remount only when another tab or device changed the content. The draft's base is the
          // snapshot rendered with it, so a save from a stale draft is refused by the session.
          key={`${active.id}:${session.revision}`}
          initial={initial}
          folders={data?.folders ?? []}
          people={data?.people ?? []}
          onSave={(plan) => session.save(plan, session.snapshot)}
          onDelete={session.snapshot ? () => session.delete(session.snapshot) : undefined}
          now={session.now}
          notice={
            session.revision
              ? "Your legacy plan was changed in another tab or device. The latest saved version is shown; unsaved changes were not kept."
              : ""
          }
        />
      )}
    </div>
  );
}
