// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  expiryStatus,
  filterItems,
  groupItems,
  ITEM_KINDS,
  KIND_LABELS,
  sortItems,
  type WalletRecord,
  WalletUnsupportedError,
} from "@jeswr/solid-wallet";
import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Label,
  LoadingSkeleton,
} from "@jeswr/suite-ui";
import { FileCheck2, FileText, Plus, Star } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { AppHeading } from "@/shell/app-frame";
import { useConnectionState } from "@/shell/sync/connection-state";
import { useWallet } from "../state/wallet-context";
import { ItemDetail } from "./item-detail";
import { ItemForm } from "./item-form";
import { WalletUnsupported } from "./wallet-unsupported";

/** A credential's expiry is its own unverified claim until a detail view checks it. */
const claimed = (item: WalletRecord) => !!item.credential || item.kind === "verifiable-credential";
export function WalletHome() {
  const { state, session, snapshot } = useWallet();
  const connection = useConnectionState();
  const controls = useId();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<string>();
  const [form, setForm] = useState<{ mode: "manual" | "credential"; item?: WalletRecord }>();
  const [undo, setUndo] = useState<{ run: () => void; token: number }>();
  const today = new Date();
  const matches = filterItems(snapshot.items, query, kind);
  const expiring = sortItems(
    snapshot.items.filter((item) => expiryStatus(item, today) === "expiring-soon"),
    "expiry",
  );
  const detail = snapshot.items.find((item) => item.url === selected);
  const online = connection === "online" || session.mode === "demo";
  function remove(item: WalletRecord) {
    const run = state.remove(item);
    setUndo({ run, token: state.getSnapshot().undo?.token ?? 0 });
    setSelected(undefined);
  }
  useEffect(() => {
    if (!undo || undo.token !== snapshot.undo?.token) return;
    const handleUndo = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key.toLowerCase() !== "z" ||
        !(event.ctrlKey || event.metaKey) ||
        event.shiftKey ||
        event.altKey
      )
        return;
      if (
        target instanceof HTMLElement &&
        (target.closest("input, textarea, select") || target.isContentEditable)
      )
        return;
      event.preventDefault();
      undo.run();
      setUndo(undefined);
    };
    document.addEventListener("keydown", handleUndo);
    return () => document.removeEventListener("keydown", handleUndo);
  }, [undo, snapshot.undo?.token]);
  return (
    <>
      <header className="wallet-header">
        <div>
          <p className="wallet-eyebrow">DOCUMENTS & CREDENTIALS</p>
          <AppHeading>Your wallet</AppHeading>
          <p className="wallet-muted">Important things, close at hand.</p>
        </div>
        <div className="wallet-actions">
          <Button
            variant="outline"
            onClick={() => setForm({ mode: "credential" })}
            disabled={!online}
          >
            <FileText size={17} aria-hidden="true" /> Add credential
          </Button>
          <Button onClick={() => setForm({ mode: "manual" })} disabled={!online}>
            <Plus size={17} aria-hidden="true" /> Add document
          </Button>
        </div>
      </header>
      {session.mode === "demo" && (
        <p className="wallet-notice">
          Demo wallet · fictional documents for Rowan Meadow. The demo credential is signed with a
          throwaway key.
        </p>
      )}
      {!online && (
        <p role="status" className="wallet-notice">
          You're offline. Loaded details remain available. Reconnect before saving or deleting
          documents.
        </p>
      )}
      {!!snapshot.skippedRecords && (
        <p role="status" className="wallet-notice">
          {snapshot.skippedRecords} unreadable{" "}
          {snapshot.skippedRecords === 1 ? "document" : "documents"} skipped. Other documents are
          shown below.
        </p>
      )}
      <div className="wallet-stat">
        <FileCheck2 aria-hidden="true" size={24} />
        <div>
          <strong>{snapshot.items.length} documents</strong>
          <p>Stored in your pod. Private access checked before saving.</p>
        </div>
      </div>
      {expiring.length > 0 && (
        <section aria-label="Expiring soon" className="wallet-expiring">
          <h2>Expiring soon</h2>
          <p>Check these before your next trip or renewal.</p>
          <div className="wallet-expiry-items">
            {expiring.map((item) => (
              <Button key={item.url} variant="outline" onClick={() => setSelected(item.url)}>
                {item.name} · {claimed(item) ? "claims to expire " : ""}
                {item.expires?.toISOString().slice(0, 10)}
              </Button>
            ))}
          </div>
        </section>
      )}
      <div className="wallet-toolbar">
        <div>
          <Label htmlFor={`${controls}-search`}>Search wallet</Label>
          <Input
            id={`${controls}-search`}
            type="search"
            placeholder="Name, number, issuer or tag"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`${controls}-kind`}>Filter by kind</Label>
          <select
            id={`${controls}-kind`}
            className="wallet-select"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="all">All kinds</option>
            {ITEM_KINDS.map((value) => (
              <option key={value} value={value}>
                {KIND_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {snapshot.phase === "loading" ? (
        <LoadingSkeleton preset="grid" label="Loading wallet documents" />
      ) : snapshot.phase === "error" && snapshot.error instanceof WalletUnsupportedError ? (
        <WalletUnsupported />
      ) : snapshot.phase === "error" ? (
        <ErrorState
          error="unreachable"
          actions={{
            retry: () => {
              void state.refresh();
            },
          }}
        >
          <p>
            Couldn't read all your documents or confirm private access. Check Wallet permissions and
            try again.
          </p>
        </ErrorState>
      ) : matches.length === 0 ? (
        <EmptyState
          variant={snapshot.items.length ? "filtered-empty" : "first-use"}
          title={
            snapshot.items.length ? "No matching documents" : "Your important documents belong here"
          }
          body={
            snapshot.items.length
              ? "Try a different name, number or kind."
              : "Add an ID, an insurance card or a credential to get started."
          }
          onClearFilters={() => {
            setQuery("");
            setKind("all");
          }}
          primaryAction={
            snapshot.items.length ? undefined : (
              <Button onClick={() => setForm({ mode: "manual" })} disabled={!online}>
                Add your first document
              </Button>
            )
          }
        />
      ) : (
        <div className="wallet-groups">
          {groupItems(matches).map((group) => (
            <section key={group.kind} aria-label={KIND_LABELS[group.kind]}>
              <h2>
                {KIND_LABELS[group.kind]} <span className="wallet-muted">{group.items.length}</span>
              </h2>
              <div className="wallet-grid">
                {group.items.map((item) => {
                  const status = expiryStatus(item, today);
                  const busy = snapshot.busy.includes(item.url);
                  return (
                    <article className="wallet-card" key={item.url}>
                      <div className="wallet-card-top">
                        <span className="wallet-card-icon">
                          <FileText size={24} aria-hidden="true" />
                        </span>
                        <IconButton
                          label={
                            item.favourite
                              ? `Remove ${item.name} from favourites`
                              : `Favourite ${item.name}`
                          }
                          variant="ghost"
                          disabled={busy || !online}
                          onClick={() => {
                            void state
                              .save(
                                { ...item, favourite: !item.favourite, modified: new Date() },
                                item,
                              )
                              .catch(() => {});
                          }}
                        >
                          <Star
                            size={18}
                            aria-hidden="true"
                            fill={item.favourite ? "currentColor" : "none"}
                          />
                        </IconButton>
                      </div>
                      <h3>
                        <button
                          type="button"
                          className="wallet-card-open"
                          onClick={() => setSelected(item.url)}
                        >
                          {item.name}
                        </button>
                      </h3>
                      <p className="wallet-muted">{item.issuerName ?? "Personal document"}</p>
                      <p>{item.identifier ? `•••• ${item.identifier.slice(-4)}` : ""}</p>
                      <div className="wallet-card-bottom">
                        <span data-expiry={status}>
                          {claimed(item)
                            ? item.expires
                              ? `Expires ${item.expires.toISOString().slice(0, 10)}`
                              : "No expiry date"
                            : status === "expiring-soon"
                              ? "Expiring soon"
                              : status === "no-expiry"
                                ? "No expiry date"
                                : status === "expired"
                                  ? "Expired"
                                  : "Valid"}
                        </span>
                        <span>
                          {busy
                            ? "Saving…"
                            : claimed(item)
                              ? "Unverified claims"
                              : item.expires?.toISOString().slice(0, 10)}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <div role="status" aria-live="polite" className="wallet-save-status">
        {snapshot.busy.length ? "Saving changes to your pod…" : ""}
      </div>
      {snapshot.undo && undo?.token === snapshot.undo.token && (
        <div role="status" className="wallet-undo">
          <span>Document deleted</span>
          <Button
            size="sm"
            aria-keyshortcuts="Control+Z Meta+Z"
            variant="outline"
            onClick={() => {
              undo.run();
              setUndo(undefined);
            }}
          >
            Undo
          </Button>
          <span className="wallet-muted">Ctrl/⌘ Z</span>
        </div>
      )}
      {detail && (
        <ItemDetail
          key={detail.url}
          item={detail}
          close={() => setSelected(undefined)}
          edit={() => {
            setForm({ mode: "manual", item: detail });
            setSelected(undefined);
          }}
          remove={() => {
            if (online) remove(detail);
          }}
        />
      )}
      {form && (
        <ItemForm key={form.item?.url ?? form.mode} {...form} close={() => setForm(undefined)} />
      )}
    </>
  );
}
