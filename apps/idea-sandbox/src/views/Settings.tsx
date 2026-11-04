// AUTHORED-BY Claude Opus 5.5
// The visitor's Claude key and who decides each action.
import { KeyRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ModePicker, type Shared } from "../App.js";

export function Settings({ shared, onClose }: { shared: Shared; onClose(): void }) {
  const [draft, setDraft] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    }
  }, []);
  return (
    <dialog
      ref={dialog}
      className="sheet settings-sheet"
      aria-labelledby="settings-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="sheet-head">
        <span className="sheet-icon">
          <KeyRound size={20} aria-hidden="true" />
        </span>
        <div>
          <h2 id="settings-title">Settings</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="sheet-body">
        <h3>Claude</h3>
        <p className="hint">
          With your own Anthropic API key, Claude writes each automation from your words, runs the
          AI rules, and acts as the AI judge. The key stays in this browser tab and is sent only to
          api.anthropic.com. Without it, built-in examples and a labelled keyword check stand in.
        </p>
        {shared.apiKey ? (
          <div className="controls">
            <span>Key added.</span>
            <button type="button" onClick={() => shared.setApiKey("")}>
              Remove key
            </button>
          </div>
        ) : (
          <form
            className="controls"
            onSubmit={(e) => {
              e.preventDefault();
              shared.setApiKey(draft.trim());
              setDraft("");
            }}
          >
            <input
              type="password"
              autoComplete="off"
              placeholder="sk-ant-…"
              aria-label="Anthropic API key"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="primary" disabled={!draft.trim()}>
              Use key
            </button>
          </form>
        )}
        <h3>Oversight</h3>
        <ModePicker shared={shared} />
      </div>
      <footer className="sheet-foot">
        <button type="button" className="primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </dialog>
  );
}
