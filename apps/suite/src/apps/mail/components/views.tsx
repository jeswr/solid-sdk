// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { EmptyState, ErrorState } from "@jeswr/suite-ui";
import { useSearchParams } from "next/navigation";
import { decodeRef } from "@/lib/refs";
import { folderIriFromKey } from "../lib/client";
import { useFolders, useMail, useMailSearch, useThreads } from "../state/mail-context";
import { MailAsync, MissingFolder } from "./async";
import { NoMail, ThreadList } from "./thread-list";
import { ThreadView } from "./thread-view";

function selectedThread(ref: string | null) {
  try {
    return ref ? decodeRef(ref) : null;
  } catch {
    return null;
  }
}
function FolderContent({ folderKey }: { folderKey: string }) {
  const folders = useFolders();
  const threads = useThreads(folderKey);
  const params = useSearchParams();
  const selected = selectedThread(params.get("t"));
  return (
    <MailAsync state={folders}>
      {(data) => {
        const folder = data.find((f) => f.key === folderKey);
        if (!folder) return <MissingFolder />;
        return (
          <div className="mail-page">
            <h1 className="mail-page-title">{folder.title}</h1>
            <div className="mail-split" data-reading={!!selected}>
              <div className="mail-list-panel">
                <MailAsync state={threads}>
                  {(page) =>
                    page.items.length ? (
                      <ThreadList
                        rows={page.items}
                        title={folder.title}
                        next={page.next}
                        loadMore={threads.loadMore}
                        refresh={threads.retry}
                      />
                    ) : (
                      <NoMail title={folder.title} inbox={folderKey === "inbox"} />
                    )
                  }
                </MailAsync>
              </div>
              <div className="mail-reading-panel">
                {selected ? (
                  <ThreadView
                    key={selected}
                    iri={selected}
                    back={`/mail/${encodeURIComponent(folderKey)}`}
                  />
                ) : (
                  <EmptyState
                    title="Choose a conversation"
                    body="Open a thread to read your mail."
                  />
                )}
              </div>
            </div>
          </div>
        );
      }}
    </MailAsync>
  );
}
export function FolderPage({ folderKey }: { folderKey: string }) {
  const { client, account } = useMail();
  try {
    folderIriFromKey(client.root(account), folderKey);
  } catch {
    return <MissingFolder />;
  }
  return <FolderContent key={`${account}:${folderKey}`} folderKey={folderKey} />;
}
export function SearchPage() {
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  const state = useMailSearch(query);
  const selected = selectedThread(params.get("t"));
  return (
    <div className="mail-page">
      <h1 className="mail-page-title">Search mail</h1>
      <p className="mail-muted">
        Results for “{query}”. Searches the newest 5,000 messages in this account.
      </p>
      <div className="mail-split" data-reading={!!selected}>
        <div className="mail-list-panel">
          <MailAsync state={state}>
            {(rows) =>
              rows.length ? (
                <ThreadList title="Search" rows={rows} refresh={state.retry} />
              ) : (
                <EmptyState
                  variant="no-results"
                  query={query}
                  primaryAction={<a href="/mail/inbox">Go to Inbox</a>}
                />
              )
            }
          </MailAsync>
        </div>
        <div className="mail-reading-panel">
          {selected && (
            <ThreadView
              key={selected}
              iri={selected}
              back={`/mail/search?q=${encodeURIComponent(query)}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
export function ThreadPage({ reference }: { reference: string }) {
  const params = useSearchParams();
  const iri = selectedThread(reference);
  const requestedBack = params.get("back");
  const back =
    requestedBack?.startsWith("/mail/") && !requestedBack.includes("\\")
      ? requestedBack
      : "/mail/inbox";
  return (
    <div className="mail-page">
      {iri ? (
        <ThreadView key={iri} iri={iri} back={back} />
      ) : (
        <>
          <h1>This conversation doesn't exist</h1>
          <ErrorState error="not-found" actions={{ goToParent: "/mail/inbox" }}>
            <a href="/mail/inbox">Go to Inbox</a>
          </ErrorState>
        </>
      )}
    </div>
  );
}
