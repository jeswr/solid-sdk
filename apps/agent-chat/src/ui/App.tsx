// AUTHORED-BY Claude Opus 5.5
import { useState, useSyncExternalStore } from "react";
import type { Session } from "../engine/session.js";
import type { ProductView } from "../engine/types.js";
import { AGENT_NAME, PERSONAS } from "../engine/world.js";
import { ApprovalSheet, HoldToConfirm } from "./approval.js";
import { Icon } from "./art.js";
import { Composer, Conversation } from "./chat.js";
import { Accounts, Activity, CanDo, Glance } from "./screens.js";

type View = "chat" | "can-do" | "activity" | "accounts";
const NAV: { id: View; label: string; icon: "chat" | "shield" | "activity" | "key" }[] = [
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "can-do", label: "Can do", icon: "shield" },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "accounts", label: "Accounts", icon: "key" },
];

export function App({ session }: { session: Session }) {
  const engine = session.engine;
  const state = useSyncExternalStore(
    (fn) => engine.subscribe(fn),
    () => engine.getState(),
  );
  const [view, setView] = useState<View>("chat");
  const [record, setRecord] = useState<string>();
  const [sheetHidden, setSheetHidden] = useState(false);
  const [resuming, setResuming] = useState(false);
  const chat = state.chats.find((c) => c.id === state.activeChat);
  const products: ProductView[] = state.chats.flatMap((c) =>
    c.messages.flatMap((m) => (m.type === "products" ? m.items : [])),
  );
  const pending = state.pending;
  const showSheet =
    pending && !sheetHidden && pending.chatId === state.activeChat && view === "chat";
  const openRecord = (id?: string) => {
    setRecord(id);
    setView("activity");
  };
  const go = (v: View) => {
    setView(v);
    if (v !== "activity") setRecord(undefined);
  };
  const title =
    view === "chat" ? (chat?.title ?? "New chat") : NAV.find((n) => n.id === view)?.label;

  return (
    <div className={`shell ${view === "chat" ? "" : "no-glance"}`}>
      <nav className="rail" aria-label="Main">
        <div className="wordmark">
          <span>
            {AGENT_NAME}
            <small>an Answerable agent</small>
          </span>
        </div>
        <button
          type="button"
          className="btn new"
          onClick={() => {
            engine.newChat();
            go("chat");
          }}
        >
          <Icon name="plus" size={18} /> New chat
        </button>
        <h6>Chats</h6>
        {state.chats.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`rail-item ${view === "chat" && c.id === state.activeChat ? "active" : ""}`}
            onClick={() => {
              engine.openChat(c.id);
              go("chat");
            }}
          >
            {c.title}
            {pending?.chatId === c.id && <span className="badge">1</span>}
          </button>
        ))}
        <h6>You</h6>
        {NAV.slice(1).map((n) => (
          <button
            key={n.id}
            type="button"
            className={`rail-item ${view === n.id ? "active" : ""}`}
            onClick={() => go(n.id)}
          >
            <Icon name={n.icon} size={18} /> {n.label === "Can do" ? "What it can do" : n.label}
          </button>
        ))}
        <div className="spacer" />
        <div className="rail-item" style={{ cursor: "default" }}>
          <Icon name="user" size={18} /> Sam{" "}
          <span className="persona-chip">{PERSONAS[0]?.name}</span>
        </div>
      </nav>

      <header className="topbar">
        <button
          type="button"
          className="icon-btn menu"
          aria-label="New chat"
          onClick={() => {
            engine.newChat();
            go("chat");
          }}
        >
          <Icon name="plus" />
        </button>
        <div className="title">{title}</div>
        <button
          type="button"
          className={`stop-pill ${state.working ? "working" : ""}`}
          onClick={() => engine.stop()}
          disabled={state.stopped}
          aria-label={`Stop ${AGENT_NAME}`}
        >
          <span className="dot" /> {state.stopped ? "Stopped" : "Stop"}
        </button>
      </header>

      <main className="main">
        {state.stopped && (
          <div className="stopped-banner" role="status">
            <Icon name="pause" size={16} />
            <span>Stopped. {AGENT_NAME} will take no action until you resume.</span>
            {resuming ? (
              <div style={{ width: 170 }}>
                <HoldToConfirm
                  label="Hold to resume"
                  onConfirm={() => {
                    setResuming(false);
                    engine.resume();
                  }}
                />
              </div>
            ) : (
              <button type="button" className="btn" onClick={() => setResuming(true)}>
                Resume
              </button>
            )}
          </div>
        )}
        {view === "chat" && (
          <>
            <Conversation
              session={session}
              state={state}
              onWhy={openRecord}
              onOpenApproval={() => setSheetHidden(false)}
            />
            <Composer session={session} state={state} />
          </>
        )}
        {view === "can-do" && (
          <CanDo session={session} state={state} onStop={() => engine.stop()} />
        )}
        {view === "activity" && <Activity state={state} open={record} onOpen={setRecord} />}
        {view === "accounts" && <Accounts />}
      </main>

      {view === "chat" && <Glance state={state} onOpenActivity={openRecord} />}

      <nav className="tabbar" aria-label="Sections">
        {NAV.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`tab ${view === n.id ? "active" : ""}`}
            onClick={() => go(n.id)}
          >
            <Icon name={n.icon} />
            {n.label}
            {n.id === "chat" && pending && <span className="badge">1</span>}
          </button>
        ))}
      </nav>

      {showSheet && pending && (
        <ApprovalSheet
          key={pending.request.id}
          request={pending.request}
          kid={state.deviceKid}
          products={products}
          onRespond={(r) => engine.respond(r)}
          onClose={() => setSheetHidden(true)}
        />
      )}
    </div>
  );
}
