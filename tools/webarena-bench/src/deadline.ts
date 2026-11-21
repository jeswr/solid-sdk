// AUTHORED-BY Claude Opus 5.5
/** Covers login, planner calls, approval, HTTP and bodies; late continuations cannot send requests. */
export class Deadline {
  readonly controller = new AbortController();
  private readonly end: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  constructor(timeoutMs: number) {
    this.end = performance.now() + timeoutMs;
    this.timer = setTimeout(
      () => this.controller.abort(new Error("Task time limit reached.")),
      timeoutMs,
    );
  }
  get remaining(): number {
    return Math.max(0, Math.ceil(this.end - performance.now()));
  }
  get expired(): boolean {
    return this.controller.signal.aborted || this.remaining === 0;
  }
  check(): void {
    if (this.expired && !this.controller.signal.aborted)
      this.controller.abort(new Error("Task time limit reached."));
    this.controller.signal.throwIfAborted();
  }
  async wait<T>(work: () => Promise<T>): Promise<T> {
    this.check();
    const signal = this.controller.signal;
    let rejectAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error("Task time limit reached."));
      signal.addEventListener("abort", rejectAbort, { once: true });
    });
    try {
      return await Promise.race([work(), aborted]);
    } finally {
      signal.removeEventListener("abort", rejectAbort);
    }
  }
  close(): void {
    clearTimeout(this.timer);
    this.controller.abort();
  }
}
