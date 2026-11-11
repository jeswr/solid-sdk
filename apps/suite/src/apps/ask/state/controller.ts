// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  type AnswerModel,
  extractiveAnswer,
  type GroundedAnswer,
  MAX_QUESTION_CHARS,
  parseGroundedAnswer,
} from "@jeswr/pod-ask";
import type { AppSlug } from "@jeswr/suite-ui";
import { type AskErrorCode, AskModelError } from "../lib/model";
import type { AskPassage, AskRetrieval } from "../lib/retrieval";

export interface AskState {
  status: "idle" | "consent" | "answering" | "answered" | "empty" | "error";
  question: string;
  passages: AskPassage[];
  answer: GroundedAnswer | null;
  recent: string[];
  error: AskErrorCode | null;
  method: "extractive" | "model";
}

/** One single-question controller per pod session; no conversation or durable history. */
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
  #disposed = false;
  #request = new AbortController();
  constructor(
    readonly retrieval: AskRetrieval,
    readonly model: AnswerModel,
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
    const passages = this.retrieval.retrieve(q, scope);
    this.#set({
      question: q,
      passages,
      recent,
      answer: null,
      error: null,
      method: noAi || this.demo || !online ? "extractive" : "model",
    });
    if (!passages.length) {
      this.#set({ status: "empty" });
      return;
    }
    if (noAi || this.demo || !online) {
      this.showExtracts();
      return;
    }
    if (!this.#consented) {
      this.#set({ status: "consent" });
      return;
    }
    await this.#complete();
  }
  async consent(): Promise<void> {
    if (this.#state.status !== "consent" || this.#disposed) return;
    this.#consented = true;
    await this.#complete();
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
  async #complete(): Promise<void> {
    const request = this.#request;
    const { question, passages } = this.#state;
    this.#set({ status: "answering", method: "model" });
    try {
      const text = await this.model.answer(question, passages, request.signal);
      if (request.signal.aborted || this.#disposed) return;
      this.#set({ status: "answered", answer: parseGroundedAnswer(text, passages) });
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
