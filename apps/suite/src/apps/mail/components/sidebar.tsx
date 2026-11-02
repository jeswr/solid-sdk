// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  CountBadge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@jeswr/suite-ui";
import {
  Archive,
  File,
  Inbox,
  Mail,
  Pencil,
  Plus,
  Send,
  ShieldAlert,
  Star,
  Tag,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useId, useState } from "react";
import { mailErrorMessage } from "../lib/client";
import { useAccounts, useFolders, useMail } from "../state/mail-context";
import { MailAsync } from "./async";

const ICONS = {
  inbox: Inbox,
  starred: Star,
  sent: Send,
  drafts: File,
  archive: Archive,
  spam: ShieldAlert,
  trash: Trash2,
};
export function MailSidebar() {
  const folders = useFolders();
  const accounts = useAccounts();
  const { account, setAccount, client, invalidate } = useMail();
  const pathname = usePathname();
  const router = useRouter();
  const reasonId = useId();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <div className="mail-sidebar">
      <div>
        <Button asChild aria-describedby={reasonId}>
          <Link href="/mail/compose">
            <Pencil size={18} aria-hidden="true" />
            Compose
          </Link>
        </Button>
        <p id={reasonId} className="mail-muted">
          Drafts save to your pod. Sending needs a connected mail account.
        </p>
      </div>
      {accounts.status === "error" ? (
        <Button variant="ghost" onClick={accounts.retry}>
          Retry accounts
        </Button>
      ) : (
        accounts.data &&
        accounts.data.length > 1 && (
          <Select
            value={account}
            onValueChange={(value) => {
              setAccount(value);
              router.push("/mail/inbox");
            }}
          >
            <SelectTrigger aria-label="Mail account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts.data.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      )}
      <nav aria-label="Mail">
        <MailAsync state={folders}>
          {(data) => (
            <>
              <ul>
                {data
                  .filter((f) => f.system)
                  .map((folder) => {
                    const Icon = ICONS[folder.key as keyof typeof ICONS] ?? Mail;
                    return (
                      <li key={folder.iri}>
                        <Link
                          className="mail-nav-item"
                          href={`/mail/${encodeURIComponent(folder.key)}`}
                          aria-current={pathname === `/mail/${folder.key}` ? "page" : undefined}
                        >
                          <Icon size={18} aria-hidden="true" />
                          <span>{folder.title}</span>
                          {folder.unread > 0 && <CountBadge count={folder.unread} />}
                        </Link>
                      </li>
                    );
                  })}
              </ul>
              <div className="mail-label-heading">
                <h2>Labels</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOpen(true);
                    setError("");
                  }}
                >
                  <Plus size={16} aria-hidden="true" />
                  New label
                </Button>
              </div>
              <ul>
                {data
                  .filter((f) => !f.system)
                  .map((folder) => (
                    <li key={folder.iri}>
                      <Link
                        className="mail-nav-item"
                        href={`/mail/${encodeURIComponent(folder.key)}`}
                        aria-current={
                          decodeURIComponent(pathname) === `/mail/${folder.key}`
                            ? "page"
                            : undefined
                        }
                      >
                        <Tag size={18} aria-hidden="true" />
                        <span>{folder.title}</span>
                        {folder.unread > 0 && <CountBadge count={folder.unread} />}
                      </Link>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </MailAsync>
      </nav>
      <Link
        className="mail-nav-item mail-sidebar-bottom"
        href="/mail/import"
        aria-current={pathname === "/mail/import" ? "page" : undefined}
      >
        <Upload size={18} aria-hidden="true" />
        Import mail
      </Link>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>New label</DialogTitle>
          <DialogDescription>Organise messages with a label in this account.</DialogDescription>
          <form
            className="mail-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setSaving(true);
              setError("");
              try {
                await client.createLabel(account, title);
                invalidate();
                setOpen(false);
                setTitle("");
              } catch (cause) {
                setError(mailErrorMessage(cause));
                toast.error(mailErrorMessage(cause));
              } finally {
                setSaving(false);
              }
            }}
          >
            <label htmlFor={titleId}>Label name</label>
            <Input
              id={titleId}
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={100}
              aria-invalid={!!error}
              aria-describedby={error ? `${titleId}-error` : undefined}
            />
            {error && (
              <p id={`${titleId}-error`} role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving ? "Creating…" : "Create label"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
