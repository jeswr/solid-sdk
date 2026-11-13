// AUTHORED-BY Claude Opus 5.5
/** What the UI calls: send a message, choose a product. One task runs at a time. */
import { type Core, liveCore, type SampleFn, scriptedCore } from "./core.js";
import { Engine, type EngineOptions, StoppedError } from "./engine.js";

export class Session {
  readonly engine: Engine;
  private live: Core | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: EngineOptions = {}) {
    this.engine = new Engine(options);
  }

  enableLive(sample: SampleFn): void {
    this.live = liveCore(sample);
    this.engine.setLiveAvailable(true);
  }

  private run(task: () => Promise<unknown>): Promise<void> {
    this.queue = this.queue.then(async () => {
      await this.engine.ready;
      if (this.engine.getState().stopped) return;
      this.engine.setWorking(true);
      try {
        await task();
      } catch (error) {
        if (!(error instanceof StoppedError)) throw error;
      } finally {
        this.engine.setWorking(false);
      }
    });
    return this.queue;
  }

  send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return Promise.resolve();
    const chatId = this.engine.getState().activeChat;
    this.engine.push(chatId, { type: "text", role: "user", text: trimmed });
    const core = this.engine.getState().core === "live" && this.live ? this.live : scriptedCore;
    return this.run(() => core(this.engine, chatId, trimmed));
  }

  choose(productId: string, variant: string, label: string): Promise<void> {
    const chatId = this.engine.getState().activeChat;
    this.engine.push(chatId, { type: "text", role: "user", text: label });
    return this.run(() => this.engine.buy(chatId, productId, variant));
  }
}
