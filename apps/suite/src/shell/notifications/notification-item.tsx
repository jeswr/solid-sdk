// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DurationChips,
  IconButton,
  RoleSelect,
  type SharingDuration,
} from "@jeswr/suite-ui";
import { useCapabilities } from "@jeswr/suite-ui/sync";
import {
  Bell,
  CheckCheck,
  HardDrive,
  MessageCircle,
  Share2,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import {
  type AccessDecision,
  type NotificationKind,
  type SuiteNotification,
  UNDATED,
} from "../lib/notifications-model";
import styles from "./notifications.module.css";

const icons = {
  shared: Share2,
  "access-request": ShieldCheck,
  comment: MessageCircle,
  task: CheckCheck,
  "sync-conflict": TriangleAlert,
  storage: HardDrive,
  system: Bell,
} satisfies Record<NotificationKind, typeof Bell>;
const durations = ["until-revoked", "day", "month", "year"] as const;
export interface NotificationItemProps {
  item: SuiteNotification;
  onMarkRead: (id: string) => Promise<void>;
  onDismiss: (id: string) => void;
  onDecide: (id: string, decision: AccessDecision) => Promise<void>;
  onOpenSync?: (() => void) | undefined;
}
/** Shared by the shell tray, notification history and the Permissions requests inbox. */
export function NotificationItem({
  item,
  onMarkRead,
  onDismiss,
  onDecide,
  onOpenSync,
}: NotificationItemProps) {
  const caps = useCapabilities();
  const id = useId();
  const [role, setRole] = useState(item.request?.roles[0] ?? "viewer");
  const [duration, setDuration] = useState<SharingDuration>("until-revoked");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastDecision = useRef<AccessDecision>({ approve: false });
  const submitting = useRef(false);
  const Icon = icons[item.kind];
  const decide = async (decision: AccessDecision) => {
    if (submitting.current) return;
    submitting.current = true;
    lastDecision.current = decision;
    setPending(true);
    setError(null);
    try {
      await onDecide(item.id, decision);
    } catch {
      setError("Couldn't save this decision. Try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  const markRead = () => {
    void onMarkRead(item.id);
  };
  return (
    <li
      id={`notification-${item.id}`}
      className={styles.item}
      data-unread={!item.read}
      aria-labelledby={`${id}-title`}
    >
      <span aria-hidden="true" className={styles.leading}>
        {item.actor ? (
          <Avatar>
            {item.actor.photoUrl && <AvatarImage src={item.actor.photoUrl} alt="" />}
            <AvatarFallback>
              {item.actor.name
                .split(/\s+/u)
                .map((word) => word[0])
                .slice(0, 2)
                .join("")}
            </AvatarFallback>
          </Avatar>
        ) : (
          <Icon size={20} strokeWidth={1.75} />
        )}
      </span>
      <div className={styles.content}>
        <p id={`${id}-title`} className={styles.title}>
          {item.title}
          {!item.read && <span className="suite-sr-only">, unread</span>}
        </p>
        {item.body && <p className={styles.muted}>{item.body}</p>}
        {item.createdAt.getTime() !== UNDATED && (
          <time className={styles.muted} dateTime={item.createdAt.toISOString()}>
            {new Intl.DateTimeFormat(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }).format(item.createdAt)}
          </time>
        )}
        {item.request?.purpose && <p className={styles.muted}>{item.request.purpose}</p>}
        {item.outcome ? (
          <p role="status">{item.outcome}</p>
        ) : item.kind === "access-request" && item.request ? (
          <div className={styles.request} aria-busy={pending}>
            <fieldset className="su-fieldset" disabled={pending}>
              <RoleSelect
                label={`Role for ${item.request.resourceName}`}
                value={role}
                onChange={(next) => {
                  if (next !== "manager" && item.request?.roles.includes(next)) setRole(next);
                }}
                options={{
                  viewer: item.request.roles.includes("viewer")
                    ? {}
                    : { disabled: true, reason: "Not requested" },
                  commenter: item.request.roles.includes("commenter")
                    ? {}
                    : { disabled: true, reason: "Not requested" },
                  editor: item.request.roles.includes("editor")
                    ? {}
                    : { disabled: true, reason: "Not requested" },
                  manager: { disabled: true, reason: "Not available for access requests" },
                }}
              />
            </fieldset>
            <DurationChips
              value={duration}
              onChange={setDuration}
              durations={durations}
              {...(!caps.grantExpiry
                ? { disabled: true, reason: "Not available on this storage" }
                : pending
                  ? { disabled: true, reason: "Saving decision…" }
                  : {})}
            />
            {!caps.grantExpiry && <a href="/settings/storage">Learn what your storage supports</a>}
            <div className={styles.actions}>
              <Button
                variant="outline"
                disabled={pending || !item.request.roles.length}
                onClick={() =>
                  void decide({
                    approve: true,
                    role,
                    duration:
                      caps.grantExpiry && duration !== "until-revoked" && duration !== "custom"
                        ? duration
                        : "forever",
                  })
                }
              >
                Approve<span className="suite-sr-only"> access to {item.request.resourceName}</span>
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void decide({ approve: false })}
              >
                Deny<span className="suite-sr-only"> access to {item.request.resourceName}</span>
              </Button>
            </div>
            {pending && <p role="status">Saving decision…</p>}
            {error && (
              <div role="alert">
                <p>{error}</p>
                <Button variant="outline" onClick={() => void decide(lastDecision.current)}>
                  Retry
                </Button>
              </div>
            )}
          </div>
        ) : item.kind === "sync-conflict" ? (
          <Button
            variant="outline"
            onClick={() => {
              markRead();
              onOpenSync?.();
            }}
            disabled={!onOpenSync}
          >
            Open sync details
          </Button>
        ) : item.kind === "system" ? (
          <Button
            variant="outline"
            onClick={() => {
              markRead();
              window.location.reload();
            }}
          >
            Reload
          </Button>
        ) : (
          <a
            className={styles.open}
            href={item.kind === "storage" ? "/settings/storage" : (item.href ?? "/notifications")}
            rel="noopener noreferrer"
            onClick={markRead}
          >
            {item.kind === "storage" ? "Manage storage" : "Open"}
            <span className="suite-sr-only"> {item.request?.resourceName ?? item.title}</span>
          </a>
        )}
      </div>
      <IconButton
        variant="ghost"
        size="icon-sm"
        label={`Dismiss ${item.title}`}
        onClick={() => onDismiss(item.id)}
      >
        <X size={16} aria-hidden="true" />
      </IconButton>
    </li>
  );
}
