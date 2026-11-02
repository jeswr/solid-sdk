// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DurationChips,
  FileTypeIcon,
  Input,
  Label,
  LoadingSkeleton,
  PeoplePicker,
  RoleSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type SharingDuration,
  type SharingPerson,
  type SharingProfile,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Toaster,
  TooltipProvider,
  toast,
} from "@jeswr/suite-ui";
import { useEffect, useId, useRef, useState } from "react";
import {
  generalAccessOptions,
  grantExpires,
  shareRoleOptions,
  shareSubtitle,
} from "../lib/share-options";
import { useSyncSnapshot } from "../sync/online";
import styles from "./share.module.css";
import {
  type ShareCapabilities,
  ShareError,
  type ShareKind,
  type SharePerson,
  type ShareRole,
  type SharingAdapter,
  type SharingState,
} from "./types";

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  name: string;
  kind: ShareKind;
  adapter: SharingAdapter;
  caps: ShareCapabilities;
  suiteHref: string;
  contacts?: SharingPerson[];
  onPeopleAdded?: (count: number) => void;
  useProfile?: (webId: string) => SharingProfile;
}
const emptyProfile = () => ({ loading: false });

export function ShareDialog(props: ShareDialogProps) {
  // Reset account-scoped rows before committing a render with a replacement adapter.
  const [session, setSession] = useState({ adapter: props.adapter, serial: 0 });
  if (session.adapter !== props.adapter)
    setSession({ adapter: props.adapter, serial: session.serial + 1 });
  const [mobile, setMobile] = useState(false);
  const restoreFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const query = matchMedia("(max-width: 767px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (props.open)
      restoreFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [props.open]);
  const Root = mobile ? Sheet : Dialog;
  const Content = mobile ? SheetContent : DialogContent;
  return (
    <TooltipProvider>
      <Root open={props.open} onOpenChange={props.onOpenChange}>
        <Content
          {...(mobile ? { side: "bottom" as const } : {})}
          className={styles.dialog}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus.current?.focus();
          }}
        >
          {props.open && (
            <SharingContent key={`${session.serial}:${props.url}`} {...props} mobile={mobile} />
          )}
        </Content>
      </Root>
    </TooltipProvider>
  );
}
function SharingContent({
  url,
  name,
  kind,
  adapter,
  caps,
  suiteHref,
  onOpenChange,
  onPeopleAdded,
  contacts = [],
  useProfile = emptyProfile,
  mobile,
}: ShareDialogProps & { mobile: boolean }) {
  const id = useId();
  const online = useSyncSnapshot().online;
  const [state, setState] = useState<SharingState>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SharingPerson[]>([]);
  const [role, setRole] = useState<ShareRole>("viewer");
  const [notify, setNotify] = useState(caps.notifyAgents);
  const [message, setMessage] = useState("");
  const [purpose, setPurpose] = useState("");
  const [duration, setDuration] = useState<SharingDuration>("until-revoked");
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState("");
  const [expiryRevision, setExpiryRevision] = useState(0);
  const [copied, setCopied] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const toasts = useRef<(string | number)[]>([]);
  const current = useRef(state);
  current.current = state;
  // biome-ignore lint/correctness/useExhaustiveDependencies: A retry explicitly reloads the same resource.
  useEffect(() => {
    alive.current = true;
    generation.current += 1;
    busy.current = false;
    setSaving("");
    setSelected([]);
    const controller = new AbortController();
    setState(undefined);
    setError("");
    void adapter.load(url, controller.signal).then(
      (loaded) => {
        if (!controller.signal.aborted) setState(loaded);
      },
      (cause) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof ShareError &&
            (cause.code === "forbidden" || cause.code === "unsupported")
            ? cause.message
            : "Can't load sharing. Try again.",
        );
      },
    );
    return () => {
      alive.current = false;
      controller.abort();
      for (const toastId of toasts.current) toast.dismiss(toastId);
    };
  }, [adapter, url, attempt]);
  const readOnly = !online || state?.readOnly || !state?.canManage;
  const disabled = !!readOnly || !!saving;
  const roles = shareRoleOptions(kind, caps, !!state?.canManage, adapter.supportsCommenter);
  const generalAllowed = generalAccessOptions(caps).some(
    (option) => option.value === state?.general.mode && !option.disabled,
  );
  const Title = mobile ? SheetTitle : DialogTitle;
  const Description = mobile ? SheetDescription : DialogDescription;

  async function act(row: string, write: () => Promise<void>, success?: () => void) {
    if (
      busy.current ||
      !alive.current ||
      !navigator.onLine ||
      !online ||
      !current.current?.canManage ||
      current.current.readOnly
    )
      return;
    const epoch = generation.current;
    const active = () => alive.current && generation.current === epoch;
    busy.current = true;
    setSaving(row);
    setError("");
    try {
      await write();
      const loaded = await adapter.load(url, new AbortController().signal);
      if (!active()) return;
      setState(loaded);
      if (loaded.readOnly)
        throw new ShareError(loaded.readOnly === "forbidden" ? "forbidden" : "network");
      success?.();
    } catch (cause) {
      if (!active()) return;
      setError(cause instanceof ShareError ? cause.message : "Couldn't change sharing. Try again.");
      if (cause instanceof ShareError && cause.code === "forbidden")
        setState((before) => before && { ...before, readOnly: "forbidden" });
      else {
        try {
          const loaded = await adapter.load(url, new AbortController().signal);
          if (active()) setState(loaded);
        } catch {
          /* Keep last confirmed access visible. */
        }
      }
    } finally {
      if (active()) {
        busy.current = false;
        setSaving("");
      }
    }
  }
  function remove(person: SharePerson) {
    if (person.role === "owner" || person.inherited) return;
    const previousRole = person.role;
    void act(
      person.webId,
      () => adapter.setPerson(url, person.webId, null),
      () => {
        toasts.current.push(
          toast(`Removed access for ${person.name ?? person.webId}`, {
            duration: 8000,
            action: {
              label: "Undo",
              onClick: () => {
                // Undo must not overwrite a newer role, owner grant or inherited permission.
                if (current.current?.people.some((entry) => entry.webId === person.webId)) return;
                void act(person.webId, () =>
                  adapter.setPerson(
                    url,
                    person.webId,
                    previousRole,
                    person.expires ? { expires: person.expires } : {},
                  ),
                );
              },
            },
          }),
        );
      },
    );
  }
  async function add() {
    const newRole = roles.includes(role) ? role : "viewer";
    let expires: Date | undefined;
    try {
      expires = caps.grantExpiry ? grantExpires(duration, custom, new Date()) : undefined;
    } catch {
      setError("Choose a future end date");
      return;
    }
    const epoch = generation.current;
    const active = () => alive.current && generation.current === epoch;
    const added: string[] = [];
    await act(
      "add",
      async () => {
        for (const person of selected) {
          // Adding a contact never changes an existing person's role implicitly.
          if (current.current?.people.some((entry) => entry.webId === person.webId))
            throw new Error("Already shared");
          await adapter.setPerson(url, person.webId, newRole, {
            ...(expires ? { expires } : {}),
            ...(caps.grantPurpose && purpose.trim() ? { purpose: purpose.trim() } : {}),
          });
          added.push(person.webId);
          if (active())
            setSelected((before) => before.filter((entry) => entry.webId !== person.webId));
        }
      },
      () => {
        if (added.length) onPeopleAdded?.(added.length);
        if (notify && caps.notifyAgents && adapter.notify)
          void adapter.notify(url, added, message || undefined).catch(() => {
            if (active())
              setError(
                "Access was saved, but people couldn't be notified. Try notifying them separately.",
              );
          });
      },
    );
  }
  return (
    <>
      <header className={styles.header}>
        <FileTypeIcon
          name={name}
          contentType={kind === "folder" ? "folder" : kind === "document" ? "pd:document" : ""}
        />
        <div>
          <Title>Share {name}</Title>
          <Description>
            {state ? shareSubtitle(state) : error ? "Sharing unavailable" : "Loading sharing…"}
          </Description>
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      {!state ? (
        error ? (
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </Button>
        ) : (
          <LoadingSkeleton preset="list" />
        )
      ) : (
        <>
          {!online || state.readOnly === "offline" ? (
            <p role="status">Reconnect to change sharing</p>
          ) : (
            (state.readOnly === "forbidden" || !state.canManage) && (
              <p role="status">You can't change who has access to this</p>
            )
          )}
          <section aria-label="Add people" className={styles.section}>
            <fieldset disabled={disabled} className={styles.section}>
              <legend className="sr-only">Add people</legend>
              <PeoplePicker
                contacts={{
                  people: contacts.filter(
                    (person) => !state.people.some((existing) => existing.webId === person.webId),
                  ),
                  state: { kind: "ready" },
                }}
                value={selected}
                onChange={setSelected}
                query={query}
                onQueryChange={setQuery}
                useProfile={useProfile}
              />
              <RoleSelect
                label="New person's role"
                value={roles.includes(role) ? role : "viewer"}
                roles={roles}
                onChange={setRole}
                disabled={disabled}
              />
              {caps.notifyAgents && (
                <>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={notify}
                      onChange={(event) => setNotify(event.target.checked)}
                    />
                    Notify people
                  </label>
                  {notify && (
                    <>
                      <Label htmlFor={`${id}-message`}>Message</Label>
                      <Input
                        id={`${id}-message`}
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                      />
                    </>
                  )}
                </>
              )}
              <Button disabled={disabled || !selected.length} onClick={() => void add()}>
                Add
              </Button>
              {saving === "add" && <span role="status">Saving access…</span>}
            </fieldset>
          </section>
          <section className={styles.section} aria-label="People with access">
            <h2>People with access</h2>
            <ul className={styles.people}>
              {[...state.people]
                .sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"))
                .map((person) => (
                  <li
                    key={person.webId}
                    className={styles.person}
                    aria-label={person.name ?? person.webId}
                  >
                    <Avatar>
                      <AvatarImage src={person.photoUrl} alt="" />
                      <AvatarFallback>
                        {(person.name ?? person.webId).slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className={styles.identity}>
                      <strong>{person.name ?? person.webId}</strong>
                      <span className={styles.account}>Account ID: {person.webId}</span>
                      {person.inherited && (
                        <a href={person.inherited.from} rel="noopener noreferrer">
                          Inherited from {person.inherited.fromName}
                        </a>
                      )}
                      {person.expires && (
                        <Badge variant="secondary">
                          Expires{" "}
                          {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                            person.expires,
                          )}
                        </Badge>
                      )}
                      {person.role !== "owner" && !person.inherited && caps.grantExpiry && (
                        <label htmlFor={`${id}-expiry-${person.webId}`}>
                          Access ends on
                          <Input
                            type="date"
                            id={`${id}-expiry-${person.webId}`}
                            aria-label={`Access ends for ${person.name ?? person.webId}`}
                            // Uncontrolled and committed on blur: typing a date must not
                            // save each keystroke (a second save while busy is dropped), and
                            // clearing the field never silently makes the grant permanent.
                            // Remount after every attempt so a failed save shows the stored date.
                            key={`${person.expires?.getTime() ?? "none"}:${expiryRevision}`}
                            defaultValue={
                              person.expires
                                ? `${person.expires.getFullYear()}-${String(person.expires.getMonth() + 1).padStart(2, "0")}-${String(person.expires.getDate()).padStart(2, "0")}`
                                : ""
                            }
                            disabled={disabled}
                            onBlur={(event) => {
                              const value = event.target.value;
                              const remount = () => setExpiryRevision((value) => value + 1);
                              if (value === event.target.defaultValue) return;
                              // A cleared field shows the stored date again; removing the end
                              // date is the explicit "Remove end date" action.
                              if (!value) return remount();
                              try {
                                const expires = grantExpires("custom", value, new Date());
                                if (!expires) return remount();
                                void act(person.webId, () =>
                                  adapter.setPerson(url, person.webId, person.role as ShareRole, {
                                    expires,
                                  }),
                                ).finally(remount);
                              } catch {
                                setError("Choose a future end date");
                                remount();
                              }
                            }}
                          />
                        </label>
                      )}
                      {person.role !== "owner" &&
                        !person.inherited &&
                        caps.grantExpiry &&
                        person.expires && (
                          <Button
                            variant="link"
                            disabled={disabled}
                            onClick={(event) => {
                              const button = event.currentTarget;
                              void act(person.webId, () =>
                                adapter.setPerson(url, person.webId, person.role as ShareRole, {}),
                              ).then(() =>
                                // On success this button unmounts (and the dialog's focus trap
                                // would park focus on the dialog); keep focus in the row.
                                requestAnimationFrame(() => {
                                  if (button.isConnected) return;
                                  document.getElementById(`${id}-expiry-${person.webId}`)?.focus();
                                }),
                              );
                            }}
                          >
                            Remove end date
                            <span className="suite-sr-only">
                              {" "}
                              for {person.name ?? person.webId}
                            </span>
                          </Button>
                        )}
                    </div>
                    {person.role === "owner" ? (
                      <span>Owner</span>
                    ) : (
                      <RoleSelect
                        label={`Role for ${person.name ?? person.webId}`}
                        value={person.role}
                        roles={roles}
                        disabled={disabled || !!person.inherited}
                        onChange={(next) => {
                          if (roles.includes(next))
                            void act(person.webId, () =>
                              adapter.setPerson(
                                url,
                                person.webId,
                                next,
                                person.expires ? { expires: person.expires } : {},
                              ),
                            );
                        }}
                        {...(person.inherited ? {} : { onRemove: () => remove(person) })}
                      />
                    )}
                    {saving === person.webId && <span role="status">Saving access…</span>}
                  </li>
                ))}
            </ul>
          </section>
          <section className={styles.section} aria-label="General access">
            <Label htmlFor={`${id}-general`}>General access</Label>
            <Select
              value={state.general.mode}
              disabled={disabled}
              onValueChange={(mode) => {
                const option = generalAccessOptions(caps).find((entry) => entry.value === mode);
                if (option && !option.disabled)
                  void act("general", () =>
                    adapter.setGeneral(url, {
                      mode: option.value,
                      ...(option.value === "restricted" ? {} : { role: "viewer" as const }),
                    }),
                  );
              }}
            >
              <SelectTrigger id={`${id}-general`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* A disabled option says why in the note under the field: a tooltip
                    wrapper inside the listbox breaks its required-children structure. */}
                {generalAccessOptions(caps).map((option) => (
                  <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {generalAccessOptions(caps).some((option) => option.disabled) && (
              <p className="text-sm text-muted-foreground" id={`${id}-general-note`}>
                Link sharing isn't available on this storage.
              </p>
            )}
            {state.general.mode !== "restricted" && (
              <RoleSelect
                label="General access role"
                roles={roles.filter(
                  (entry) =>
                    entry !== "manager" &&
                    (entry !== "commenter" || adapter.supportsGeneralCommenter !== false),
                )}
                value={state.general.role ?? "viewer"}
                disabled={disabled || !generalAllowed}
                onChange={(next) => {
                  if (next !== "manager" && generalAllowed && roles.includes(next))
                    void act("general", () =>
                      adapter.setGeneral(url, { ...state.general, role: next }),
                    );
                }}
              />
            )}
            {saving === "general" && <span role="status">Saving general access…</span>}
          </section>
          <DurationChips
            value={duration}
            onChange={setDuration}
            customDate={custom}
            onCustomDateChange={setCustom}
            {...(!caps.grantExpiry
              ? { disabled: true, reason: "Not available on this storage" }
              : disabled
                ? { disabled: true, reason: "Reconnect or ask the owner to change sharing" }
                : {})}
          />
          {!caps.grantExpiry && <a href="/settings/storage">Learn what your storage supports</a>}
          {caps.grantPurpose && (
            <div className={styles.section}>
              <Label htmlFor={`${id}-purpose`}>What is this for?</Label>
              <Input
                id={`${id}-purpose`}
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                disabled={disabled}
              />
            </div>
          )}
        </>
      )}
      <footer className={styles.footer}>
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(suiteHref);
              if (alive.current) setCopied(true);
            } catch {
              if (alive.current) setError("Couldn't copy the link. Try again.");
            }
          }}
        >
          Copy link
        </Button>
        <span role="status">{copied ? "Link copied" : ""}</span>
        <Button onClick={() => onOpenChange(false)}>Done</Button>
      </footer>
      <Toaster />
    </>
  );
}
