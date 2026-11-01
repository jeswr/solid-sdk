// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ErrorState,
  LoadingSkeleton,
  ProvenanceBadge,
  Toolbar,
  type TypedViewData,
  toast,
} from "@jeswr/suite-ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { typedViewData } from "../../../../components/typed-view-data";
import { decodeRef } from "../../../../lib/refs";
import { classificationForType } from "../../lib/model/classify";
import { DOMAINS, UNCATEGORISED } from "../../lib/model/domains";
import { provenanceOf } from "../../lib/model/provenance";
import { itemActions, itemHref, itemTitle, relativeTime } from "../../state/presentation";
import { domainStore } from "../../state/use-domain-items";
import { useHomeSession } from "../home-app";
import { domainHref } from "../home-sidebar";
import { type ItemRead, ItemReadError, readItem } from "./data";
import { DetailView } from "./detail-view";
import { EditForm } from "./edit-form";
import { openShare } from "./open-share";
import { itemShortcut } from "./shortcuts";
import { useItemActions } from "./use-item-actions";
import { useOnline } from "./use-online";
import { WhoCanSee } from "./who-can-see";
import "./item.css";

function reference(value: string | null): string | undefined {
  try {
    return value ? decodeRef(value) : undefined;
  } catch {
    return undefined;
  }
}
export function ItemPage({ domain, itemRef }: { domain: string; itemRef: string }) {
  const session = useHomeSession();
  const router = useRouter();
  const query = useSearchParams();
  const url = reference(itemRef);
  const subject = reference(query.get("s"));
  const contactDetails =
    query.get("view") === "contact-details" && url === session.webId.split("#")[0];
  const online = useOnline();
  const { deleteItem } = useItemActions(session);
  const entry = DOMAINS.find((candidate) => candidate.id === domain) ?? UNCATEGORISED;
  const [state, setState] = useState<{
    read?: ItemRead;
    view?: TypedViewData;
    error?: number;
    cached?: boolean;
  }>({});
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(query.get("edit") === "1");
  const [advanced, setAdvanced] = useState(false);
  const [technical, setTechnical] = useState(false);
  useEffect(() => {
    try {
      setAdvanced(localStorage.getItem("suite.settings.advanced") === "1");
    } catch {
      setAdvanced(false);
    }
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit retry reloads the resource
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setState({});
    async function load() {
      if (!url) {
        setState({ error: 404 });
        return;
      }
      try {
        const cached = domainStore(session)
          .getSnapshot()
          .items.find((item) => item.url === url && (!subject || item.subject.value === subject));
        let read: ItemRead;
        const offline = !navigator.onLine;
        if (offline && cached)
          read = { item: cached, body: "", contentType: "text/turtle", writable: false, size: 0 };
        else if (offline) {
          setState({ error: 0, cached: true });
          return;
        } else read = await readItem(session, url, subject, controller.signal);
        if (contactDetails)
          read = {
            ...read,
            item: {
              ...read.item,
              ...classificationForType("contact-details"),
              title: "Contact details",
            },
          };
        const view = await typedViewData(read.item.dataset, read.item.subject, {
          storage: session.storageUrl,
        });
        if (live)
          setState({
            read,
            view: {
              types: view.types,
              title: itemTitle(read.item),
              properties: view.properties
                .map((property) => ({
                  ...property,
                  values: property.values.filter((value) => !/http/i.test(value)),
                }))
                .filter((property) => property.values.length),
            },
            cached: offline,
          });
      } catch (error) {
        if (live) setState({ error: error instanceof ItemReadError ? error.status : 500 });
      }
    }
    void load();
    return () => {
      live = false;
      controller.abort();
    };
  }, [url, subject, session, version, contactDetails]);
  useEffect(() => {
    if (online && state.cached) setVersion((value) => value + 1);
  }, [online, state.cached]);
  const reload = useCallback(() => {
    setEditing(false);
    setVersion((value) => value + 1);
    void domainStore(session).refresh();
  }, [session]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "." && url && !editing && itemShortcut(event)) {
        event.preventDefault();
        router.push(openShare(url));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [url, editing, router]);
  const actions = useMemo(
    () =>
      state.read
        ? itemActions(state.read.item, session.storageUrl, state.read.writable, session.webId)
        : [],
    [state.read, session.storageUrl, session.webId],
  );
  useEffect(() => {
    if (state.read && window.location.hash === "#access")
      document.getElementById("access")?.scrollIntoView?.({ block: "start" });
  }, [state.read]);
  const read = state.read;
  const title = read ? itemTitle(read.item) : "Item";
  const provenance =
    read &&
    provenanceOf(read.item.dataset, read.item.subject, read.item.containerUrl, {
      storage: session.storageUrl,
      userWebId: session.webId,
    });
  const source = actions.find((action) => action.id === "source");
  const copy = async () => {
    try {
      if (read) {
        await navigator.clipboard.writeText(
          new URL(itemHref(read.item), window.location.origin).href,
        );
        toast.success("Link copied");
      }
    } catch {
      toast.error("Couldn't copy the link");
    }
  };
  return (
    <div className="hm-item-page">
      <Link href={domainHref(entry.id)} className="hm-item-back">
        {entry.label}
      </Link>
      <h1>{read ? title : state.error === 404 ? "This item isn't here any more" : "Item"}</h1>
      {state.error !== undefined ? (
        <>
          {state.error !== 404 ? (
            <ErrorState
              error="unreachable"
              actions={{ retry: () => setVersion((value) => value + 1) }}
            />
          ) : null}
          {state.cached ? <p>Reconnect to load this item.</p> : null}
        </>
      ) : !read || !state.view ? (
        <LoadingSkeleton preset="detail" label="Loading item" />
      ) : (
        <>
          {provenance?.kind === "you" ? (
            <p className="hm-you">Added by you</p>
          ) : (
            <ProvenanceBadge source={provenance?.label ?? "source"} />
          )}
          {!online || state.cached ? (
            <p role="status">Showing saved copies. Reconnect to save.</p>
          ) : null}
          <div className="hm-item-toolbar">
            <Toolbar
              label="Item actions"
              actions={[
                ...(actions.some((action) => action.id === "edit")
                  ? [
                      {
                        id: "edit",
                        label: "Edit",
                        disabled: !online || editing,
                        onSelect: () => setEditing(true),
                      },
                    ]
                  : []),
              ]}
            />
            <Button asChild variant="outline">
              <Link href={openShare(read.item.url)}>Share</Link>
            </Button>
            {source ? (
              <Button variant="outline" asChild>
                <a href={source.href} rel="noopener noreferrer" target="_blank">
                  {source.label}
                </a>
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label="More item actions">
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="hm-menu">
                {actions.some((action) => action.id === "delete") ? (
                  <DropdownMenuItem
                    disabled={!online}
                    onSelect={() =>
                      void deleteItem(read.item, () => router.push(domainHref(entry.id)))
                    }
                  >
                    Delete
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => void copy()}>Copy link</DropdownMenuItem>
                {advanced ? (
                  <DropdownMenuItem onSelect={() => setTechnical((value) => !value)}>
                    Show technical details
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="hm-item-layout">
            <div className="hm-item-content">
              {editing && read.writable && !read.binary ? (
                <EditForm
                  key={read.item.etag}
                  read={read}
                  session={session}
                  online={online}
                  onSaved={reload}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <DetailView data={state.view} />
              )}
              <WhoCanSee url={read.item.url} session={session} online={online} />
              {advanced && technical ? (
                <details className="hm-item-technical" open>
                  <summary>Technical details</summary>
                  <p>{read.item.url}</p>
                  <pre>
                    {read.binary
                      ? "File preview unavailable"
                      : typeof read.body === "string"
                        ? read.body || "Saved copy"
                        : "Saved copy"}
                  </pre>
                </details>
              ) : null}
            </div>
            <aside className="hm-item-details" aria-label="Item details">
              <h2>Details</h2>
              <dl>
                <div>
                  <dt>Location</dt>
                  <dd>
                    {entry.label} › {read.item.dataType?.label ?? "Other"}
                  </dd>
                </div>
                <div>
                  <dt>Modified</dt>
                  <dd>
                    {read.item.modified ? relativeTime(read.item.modified, Date.now()) : "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{state.cached ? "Unknown" : `${read.size.toLocaleString()} bytes`}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{provenance?.kind === "you" ? "Added by you" : provenance?.label}</dd>
                </div>
              </dl>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
