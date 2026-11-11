// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import {
  type AnswerModel,
  buildGroundedPrompt,
  extractiveAnswer,
  type GroundedAnswer,
  type GroundedPrompt,
  MAX_QUESTION_CHARS,
  parseGroundedAnswer,
} from "@jeswr/pod-ask";
import type { AppSlug } from "@jeswr/suite-ui";
import { type AskErrorCode, AskModelError } from "../lib/model";
import type { AskPassage, AskRetrieval } from "../lib/retrieval";

interface ModelPlan {
  model: AnswerModel;
  prompt: GroundedPrompt;
}
export interface AskState {
  status: "idle" | "consent" | "answering" | "answered" | "empty" | "error";
  question: string;
  passages: AskPassage[];
  answer: GroundedAnswer | null;
  recent: string[];
  error: AskErrorCode | null;
  method: "extractive" | "model";
}

/**
 * One single-question controller per pod session; no conversation or durable history.
 * Without a model (the only configuration today) every answer is extractive and the
 * consent and answering states are never entered. A model is an injected `AnswerModel`.
 */
export class AskController {
  #state: AskState = {
    status: "idle",
    question: "",
    passages: [],
    answer: null,
    recent: [],
    error: null,
    method: "extractive",
  };
  #listeners = new Set<() => void>();
  #consented = false;
  /** The model call planned for the current question, if a model will answer it. */
  #plan: ModelPlan | undefined;
  #disposed = false;
  #request = new AbortController();
  constructor(
    readonly retrieval: AskRetrieval,
    readonly model: AnswerModel | undefined,
    readonly demo: boolean,
  ) {}
  getSnapshot = () => this.#state;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #set(patch: Partial<AskState>) {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }
  async ask(
    question: string,
    scope: AppSlug | undefined,
    noAi: boolean,
    online: boolean,
  ): Promise<void> {
    if (this.#disposed) return;
    const q = question.trim();
    if (!q || q.length > MAX_QUESTION_CHARS) return;
    this.#request.abort();
    this.#request = new AbortController();
    const recent = [q, ...this.#state.recent.filter((entry) => entry !== q)].slice(0, 8);
    let passages = this.retrieval.retrieve(q, scope);
    const model = noAi || this.demo || !online ? undefined : this.model;
    let plan: ModelPlan | undefined;
    if (model && passages.length) {
      // List exactly the sources the prompt keeps, so numbers and the disclosure match it.
      const prompt = buildGroundedPrompt(q, passages);
      const kept = new Set(prompt.passages.map((passage) => passage.url));
      const sent = passages.filter((passage) => kept.has(passage.url));
      if (sent.length) {
        passages = sent;
        plan = { model, prompt };
      }
    }
    this.#plan = plan;
    this.#set({
      question: q,
      passages,
      recent,
      answer: null,
      error: null,
      method: plan ? "model" : "extractive",
    });
    if (!passages.length) {
      this.#set({ status: "empty" });
      return;
    }
    if (!plan) {
      this.showExtracts();
      return;
    }
    if (!this.#consented) {
      this.#set({ status: "consent" });
      return;
    }
    await this.#complete(plan);
  }
  /** Re-run the current question, for example after the app filter changes. */
  async reask(scope: AppSlug | undefined, noAi: boolean, online: boolean): Promise<void> {
    const { status, question } = this.#state;
    if (status === "idle" || status === "consent" || !question) return;
    await this.ask(question, scope, noAi, online);
  }
  async consent(): Promise<void> {
    const plan = this.#plan;
    if (!plan || this.#state.status !== "consent" || this.#disposed) return;
    this.#consented = true;
    await this.#complete(plan);
  }
  showExtracts(): void {
    if (this.#disposed || !this.#state.passages.length) return;
    this.#request.abort();
    this.#set({
      status: "answered",
      method: "extractive",
      error: null,
      answer: extractiveAnswer(this.#state.question, this.#state.passages),
    });
  }
  async #complete({ model, prompt }: ModelPlan): Promise<void> {
    const request = this.#request;
    this.#set({ status: "answering", method: "model" });
    try {
      const text = await model.answer(prompt, request.signal);
      if (request.signal.aborted || this.#disposed) return;
      this.#set({ status: "answered", answer: parseGroundedAnswer(text, prompt.passages) });
    } catch (error) {
      if (request.signal.aborted || this.#disposed) return;
      this.#set({
        status: "error",
        error: error instanceof AskModelError ? error.code : "network",
      });
    }
  }
  dispose() {
    this.#disposed = true;
    this.#request.abort();
    this.retrieval.dispose();
    this.#listeners.clear();
  }
}
