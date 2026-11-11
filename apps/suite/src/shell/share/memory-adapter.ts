// AUTHORED-BY Codex GPT-6.1-Sol
import { shareRoleRank } from "@jeswr/suite-ui/sharing";
import {
  ShareError,
  type ShareRole,
  type ShareWriteOptions,
  type SharingAdapter,
  type SharingState,
} from "./types";

/** Fictional storage, scoped per URL; deterministic delay and one-shot failures for fixtures. */
export class MemorySharingAdapter implements SharingAdapter {
  private states = new Map<string, SharingState>();
  private failure: "forbidden" | "network" | undefined;
  readonly purposes = new Map<string, Map<string, string>>();
  readonly notifications: { url: string; webIds: string[]; message?: string }[] = [];
  readonly requests: { url: string; role: ShareRole; message?: string; purpose?: string }[] = [];
  constructor(
    private initial: SharingState,
    private latency = 120,
  ) {}
  failNext(code: "forbidden" | "network") {
    this.failure = code;
  }
  private async wait(signal?: AbortSignal) {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, this.latency);
      signal?.addEventListener("abort", abort, { once: true });
    });
    if (this.failure) {
      const code = this.failure;
      this.failure = undefined;
      throw new ShareError(code);
    }
  }
  private state(url: string) {
    if (!this.states.has(url)) this.states.set(url, structuredClone(this.initial));
    return this.states.get(url) as SharingState;
  }
  private writable(url: string) {
    const state = this.state(url);
    if (state.readOnly || !state.canManage)
      throw new ShareError(state.readOnly === "offline" ? "network" : "forbidden");
    return state;
  }
  async load(url: string, signal: AbortSignal) {
    await this.wait(signal);
    return structuredClone(this.state(url));
  }
  async setPerson(
    url: string,
    webId: string,
    role: ShareRole | null,
    opts?: ShareWriteOptions & { expires?: Date; purpose?: string },
  ) {
    await this.wait();
    const state = this.writable(url);
    const person = state.people.find((entry) => entry.webId === webId);
    if (person?.role === "owner" || person?.inherited) throw new ShareError("forbidden");
    if (opts?.narrowOnly && role && (!person || shareRoleRank[role] > shareRoleRank[person.role]))
      throw new ShareError("would-grant");
    state.people = state.people.filter((entry) => entry.webId !== webId);
    if (role === null) this.purposes.get(url)?.delete(webId);
    if (role && opts?.purpose) {
      if (!this.purposes.has(url)) this.purposes.set(url, new Map());
      this.purposes.get(url)?.set(webId, opts.purpose);
    }
    if (role) {
      const next = { ...person, webId, role };
      delete next.expires;
      if (opts?.expires) next.expires = new Date(opts.expires);
      state.people.push(next);
    }
  }
  async setGeneral(url: string, general: SharingState["general"], opts?: ShareWriteOptions) {
    await this.wait();
    const state = this.writable(url);
    if (
      opts?.narrowOnly &&
      general.mode !== "restricted" &&
      (general.mode !== state.general.mode ||
        shareRoleRank[general.role ?? "viewer"] > shareRoleRank[state.general.role ?? "viewer"])
    )
      throw new ShareError("would-grant");
    state.general = structuredClone(general);
  }
  async notify(url: string, webIds: string[], message?: string) {
    await this.wait();
    this.notifications.push({
      url,
      webIds: [...webIds],
      ...(message === undefined ? {} : { message }),
    });
  }
  async requestAccess(url: string, req: { role: ShareRole; message?: string; purpose?: string }) {
    await this.wait();
    this.requests.push({ url, ...req });
  }
}
