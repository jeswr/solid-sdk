// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import type { AppSlug } from "@jeswr/suite-ui";
import {
  AppGlyph,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Label,
  LoadingSkeleton,
  Switch,
  Textarea,
  Toaster,
  toast,
} from "@jeswr/suite-ui";
import { ArrowUp, BookOpen, LockKeyhole, MessageCircleQuestionMark } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type PodSession, PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppHeading, AppSessionGuard } from "@/shell/app-frame";
import { useConnectionState } from "@/shell/sync/connection-state";
import { ensureAskSample } from "../demo/sample";
import { hostedAnswerModel } from "../lib/model";
import { type AskPassage, openAskRetrieval } from "../lib/retrieval";
import { AskContext, useAsk } from "../state/ask-context";
import { AskController } from "../state/controller";

const suggestions = [
  "When does my passport expire?",
  "What did I agree with Rowan about the garden?",
];
const errors = {
  "not-configured":
    "AI answers aren't configured on this server. You can still answer from your pod without AI.",
  "rate-limited": "Too many questions for now. Try again later, or use an answer without AI.",
  network: "We couldn't reach the answer service. Your question is still here.",
  invalid: "The answer service returned an incomplete reply. Try an answer without AI.",
};

function SourceLink({ source, number }: { source: AskPassage; number: number }) {
  return (
    <a className="ask-citation" href={source.href} aria-label={`Source ${number}: ${source.title}`}>
      <sup>{number}</sup>
    </a>
  );
}
export function AskWorkspace() {
  const { controller, state } = useAsk();
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<AppSlug>();
  const [noAi, setNoAi] = useState(true);
  const connection = useConnectionState();
  const input = useRef<HTMLTextAreaElement>(null);
  const online = connection === "online";
  const busy = state.status === "answering";
  useEffect(() => {
    if (state.error) toast.error(errors[state.error]);
  }, [state.error]);
  const ask = (value = question) => {
    void controller.ask(value, scope, noAi, online);
  };
  const choose = (value: string) => {
    setQuestion(value);
    input.current?.focus();
  };
  const scopes = controller.retrieval.scopes;
  const sidebar = (
    <div className="ask-sidebar">
      <div className="ask-eyebrow">
        <LockKeyhole size={16} aria-hidden="true" /> Your sources, in your control
      </div>
      <h2>Recent questions</h2>
      <p className="ask-muted">Only in this session. Nothing is saved to your pod.</p>
      {state.recent.length ? (
        <ul>
          {state.recent.map((recent) => (
            <li key={recent}>
              <Button variant="ghost" onClick={() => choose(recent)}>
                {recent}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ask-muted">Your questions will appear here.</p>
      )}
    </div>
  );
  return (
    <AppFrame app="ask" sidebar={sidebar} context={<span>Ask my pod</span>}>
      <div className="ask-workspace">
        <header className="ask-intro">
          <div className="ask-emblem">
            <MessageCircleQuestionMark size={28} aria-hidden="true" />
          </div>
          <AppHeading>Answers, with a source.</AppHeading>
          <p>Ask a question about your own pod. Follow each citation back to the original.</p>
          {controller.demo && (
            <p className="ask-demo">
              Fictional sample pod · answers use extracts, with no AI call.
            </p>
          )}
        </header>
        {!online && (
          <p className="ask-notice" role="status">
            You're offline. Answers use the snippets already loaded in this session, without AI.
          </p>
        )}
        <form
          className="ask-question"
          onSubmit={(event) => {
            event.preventDefault();
            ask();
          }}
        >
          <Label htmlFor="ask-question">Your question</Label>
          <Textarea
            ref={input}
            id="ask-question"
            value={question}
            maxLength={2000}
            placeholder="When does my passport expire?"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                ask();
              }
            }}
            aria-describedby="ask-question-help"
          />
          <div className="ask-question-foot">
            <span id="ask-question-help" className="ask-muted">
              Enter to ask · Shift+Enter for a new line
            </span>
            <Button type="submit" disabled={!question.trim() || busy}>
              <ArrowUp size={16} aria-hidden="true" /> Ask my pod
            </Button>
          </div>
          <div className="ask-mode">
            <Switch
              id="ask-no-ai"
              checked={noAi || controller.demo}
              disabled={controller.demo}
              onCheckedChange={(checked) => {
                setNoAi(checked);
                if (checked) controller.showExtracts();
              }}
            />
            <Label htmlFor="ask-no-ai">Answer from my pod only (no AI)</Label>
          </div>
          <p className="ask-muted">
            {noAi || controller.demo
              ? "Shows matching extracts. Your question stays in your browser."
              : "Anthropic writes an answer from selected snippets after you give consent."}
          </p>
        </form>
        <fieldset className="ask-scopes" aria-label="Search scope">
          <Button
            size="sm"
            variant={!scope ? "secondary" : "ghost"}
            aria-pressed={!scope}
            onClick={() => setScope(undefined)}
          >
            All apps
          </Button>
          {scopes.map((app) => (
            <Button
              key={app}
              size="sm"
              variant={scope === app ? "secondary" : "ghost"}
              aria-pressed={scope === app}
              onClick={() => setScope(app)}
            >
              <AppGlyph app={app} />
              <span className="ask-app-name">{app}</span>
            </Button>
          ))}
        </fieldset>
        <p className="ask-muted ask-coverage">
          {controller.retrieval.count} resources indexed in this session. Search covers readable
          labels and description snippets within the shared search's limits, rather than every
          file's contents.{controller.retrieval.limited && " The 1,000-resource limit was reached."}
        </p>
        <div aria-live="polite" aria-busy={busy}>
          {state.status === "idle" && (
            <div className="ask-start">
              <EmptyState
                title="What would you like to find?"
                body="Try a name, date or topic. Answers are grounded in the matching snippets."
                icon={<BookOpen size={24} />}
              />
              <div className="ask-suggestions">
                {suggestions.map((suggestion) => (
                  <Button key={suggestion} variant="outline" onClick={() => choose(suggestion)}>
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {busy && (
            <LoadingSkeleton
              preset="document"
              count={3}
              label="Writing an answer from your sources…"
            />
          )}
          {state.status === "empty" && (
            <EmptyState
              variant="no-results"
              title="Nothing in your pod matches; try other words"
              body="Try a shorter phrase, a name, or a different app filter. Only indexed snippets are searched."
            />
          )}
          {state.status === "error" && (
            <ErrorState error="unknown">
              <p>{errors[state.error ?? "network"]}</p>
              <Button variant="outline" onClick={() => controller.showExtracts()}>
                Use an answer without AI
              </Button>
            </ErrorState>
          )}
          {state.answer && (
            <section className="ask-answer" aria-label="Answer">
              <div className="ask-answer-header">
                <h2>{state.method === "extractive" ? "From your pod" : "Answer"}</h2>
                <span className="ask-method">
                  {state.method === "extractive"
                    ? "Matching extracts · no AI"
                    : "Written by AI · check the sources"}
                </span>
              </div>
              <p className="ask-asked">{state.question}</p>
              <div className="ask-answer-text">
                {state.answer.sentences.map((sentence) => (
                  <p
                    key={sentence.text}
                    className={sentence.unsupported ? "ask-unsupported" : undefined}
                  >
                    {sentence.text}
                    {sentence.citations.map((citation) => {
                      const source = state.passages[citation.number - 1];
                      return source ? (
                        <SourceLink
                          key={citation.number}
                          source={source}
                          number={citation.number}
                        />
                      ) : null;
                    })}
                    {sentence.unsupported && (
                      <span className="ask-warning">No valid source citation</span>
                    )}
                    {sentence.invalidCitations.length > 0 && (
                      <span className="ask-warning">Unknown citation removed</span>
                    )}
                  </p>
                ))}
              </div>
              <p className="ask-muted">
                Citations identify sources. They do not independently verify what a source says.
              </p>
            </section>
          )}
        </div>
        {state.passages.length > 0 && (
          <section className="ask-sources" aria-labelledby="ask-sources-title">
            <h2 id="ask-sources-title">
              Sources <span className="ask-muted">({state.passages.length})</span>
            </h2>
            <ol>
              {state.passages.map((source, index) => (
                <li key={source.url}>
                  <div className="ask-source-head">
                    <AppGlyph app={source.app} />
                    <a href={source.href}>{source.title}</a>
                    <span className="ask-muted">[{index + 1}]</span>
                  </div>
                  <p>{source.text}</p>
                  <div className="ask-source-meta">
                    <span className="ask-app-name">{source.app}</span>
                    {source.modified && (
                      <time dateTime={source.modified}>
                        {new Date(source.modified).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          timeZone: "UTC",
                        })}
                      </time>
                    )}
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      Open raw resource<span className="ask-sr">: {source.title} (new tab)</span>
                    </a>
                  </div>
                </li>
              ))}
            </ol>
            <details className="ask-disclosure">
              <summary>Which data was used</summary>
              <p>
                {state.method === "model"
                  ? "Only your question and the snippets, titles, source URLs and metadata listed above are sent to Anthropic. Your pod credentials and recent questions are never sent."
                  : "Only the snippets listed above were used in your browser. Nothing was sent to an AI provider."}
              </p>
              <p>
                Search uses a bounded, session-only index. Refresh this page to load recent pod
                changes. This first cut searches labels and descriptions; binary files and full
                collaborative document bodies may not be included.
              </p>
            </details>
          </section>
        )}
        <Dialog
          open={state.status === "consent"}
          onOpenChange={(open) => {
            if (!open) controller.showExtracts();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Let Anthropic write this answer?</DialogTitle>
              <DialogDescription>
                Your question and the matching snippets from your pod will be sent to Anthropic to
                write the answer.
              </DialogDescription>
            </DialogHeader>
            <p>
              Only the {state.passages.length} sources listed on this page will be sent. This choice
              lasts for this Ask session.
            </p>
            <details className="ask-disclosure">
              <summary>Review the selected snippets</summary>
              <ol>
                {state.passages.map((source) => (
                  <li key={source.url}>
                    <strong>{source.title}</strong>
                    <p>{source.text}</p>
                  </li>
                ))}
              </ol>
            </details>
            <DialogFooter>
              <Button variant="outline" onClick={() => controller.showExtracts()}>
                Use without AI
              </Button>
              <Button
                onClick={() => {
                  if (online) void controller.consent();
                  else controller.showExtracts();
                }}
              >
                Allow for this session
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppFrame>
  );
}

function Connected({ session }: { session: PodSession }) {
  const [boot, setBoot] = useState<{ controller?: AskController; error?: boolean }>({});
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries search initialisation
  useEffect(() => {
    const abort = new AbortController();
    let controller: AskController | undefined;
    setBoot({});
    void ensureAskSample(session)
      .then(() => {
        abort.signal.throwIfAborted();
        return openAskRetrieval(session, abort.signal);
      })
      .then((retrieval) => {
        if (abort.signal.aborted) {
          retrieval.dispose();
          return;
        }
        controller = new AskController(retrieval, hostedAnswerModel(), session.mode === "demo");
        setBoot({ controller });
      })
      .catch(() => {
        if (!abort.signal.aborted) setBoot({ error: true });
      });
    return () => {
      abort.abort();
      controller?.dispose();
    };
  }, [session, attempt]);
  if (boot.error)
    return (
      <div className="ask-workspace">
        <ErrorState error="unreachable" actions={{ retry: () => setAttempt((value) => value + 1) }}>
          <p>We couldn't prepare your pod's search index. Reconnect and try again.</p>
        </ErrorState>
      </div>
    );
  if (!boot.controller)
    return (
      <div className="ask-workspace">
        <LoadingSkeleton preset="document" label="Preparing your pod's search index…" />
      </div>
    );
  return (
    <AskContext value={boot.controller}>
      <AskWorkspace />
    </AskContext>
  );
}
function SessionGate() {
  const state = usePodSessionState();
  if (state.status === "loading") return <LoadingSkeleton label="Opening your pod…" />;
  if (state.status === "error") return <ErrorState error="unreachable" />;
  if (state.status === "signed-out")
    return (
      <EmptyState
        title="Sign in to ask your pod"
        body="Open your account from the suite to get started."
      />
    );
  return (
    <Connected
      key={`${state.session.mode}:${state.session.webId}:${state.session.storageUrl}`}
      session={state.session}
    />
  );
}
export function AskApp() {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <SessionGate />
        <Toaster position="bottom-center" />
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
