// AUTHORED-BY Claude Opus 5.5
/**
 * The agent engine behind the chat. The core (scripted or a live model) only proposes; every
 * purchase, data share and step-up goes through the outbound gate in @jeswr/agent-consent,
 * and everything a counterparty says comes through the inbound gate (parties.ts).
 *
 * The principal's consent is signed on this device with a non-extractable key: approvals
 * bound to one action's digest, spending rules and revocations. The gate relies only on
 * records whose signatures verify against the pinned public key; it re-verifies them on every
 * decision. Approvals are single use and expire after ten minutes.
 */
import {
  type ApprovalRequest,
  actionDigest,
  buildApprovalRequest,
  type CheckLine,
  checkResponse,
  createDeviceKey,
  type DataField,
  type DeviceKey,
  describeRule,
  evaluateAction,
  formatMoney,
  type GateResult,
  type Money,
  type PrincipalResponse,
  type ProposedAction,
  type PurchaseAction,
  ruleLabel,
  ruleUsage,
  type ShareAction,
  type SpendingRule,
  type SpendRecord,
  type StepUpAction,
  signRecord,
  summarizeDraft,
  verifyRecord,
} from "@jeswr/agent-consent";
import { Parties } from "./parties.js";
import type {
  ActivityEntry,
  Chat,
  ChatMessage,
  EngineState,
  NewMessage,
  ProductView,
  ProgressState,
  RuleView,
} from "./types.js";
import {
  AGENT_NAME,
  feesFor,
  MORTGAGE,
  PRINCIPAL,
  PRODUCTS,
  PROTECTION_PLAN,
  type Product,
  productById,
  SAM_POLICY,
  STORES,
  storeById,
} from "./world.js";

export interface EngineOptions {
  /** Milliseconds per word when streaming and between progress steps; 0 in tests. */
  readonly pace?: number;
  readonly now?: () => Date;
}

type Listener = (state: EngineState) => void;
type Resolver = { resolve: (r: PrincipalResponse) => void; reject: (e: Error) => void };
type Done = "done" | "denied" | "stopped" | "blocked";

export class StoppedError extends Error {
  constructor() {
    super("stopped by the principal");
  }
}

const UNDO_MS = 10 * 60_000;

export class Engine {
  private state: EngineState;
  private readonly listeners = new Set<Listener>();
  private key!: DeviceKey;
  private parties!: Parties;
  /** Signed spending rules and revocations, as compact JWS. The gate verifies each use. */
  private readonly ruleRecords: string[] = [];
  private readonly approvalRecords = new Map<string, string>();
  private readonly attestations = new Map<string, string>();
  private readonly ledger: SpendRecord[] = [];
  private readonly history = new Map<string, { purchases: number; shares: number }>();
  private readonly declined = new Map<string, number>();
  private resolver: Resolver | undefined;
  private seq = 0;
  private readonly pace: number;
  private readonly clock: () => Date;
  /** Products shown in the current chat, so "choose" and follow-ups can find them. */
  readonly ready: Promise<void>;

  constructor(options: EngineOptions = {}) {
    this.pace = options.pace ?? 22;
    this.clock = options.now ?? (() => new Date());
    const first: Chat = { id: "chat-1", title: "New chat", messages: [] };
    this.state = {
      chats: [first],
      activeChat: first.id,
      rules: [],
      activity: [],
      stopped: false,
      working: false,
      core: "scripted",
      liveAvailable: false,
    };
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    this.key = await createDeviceKey();
    this.parties = await Parties.create([
      ...STORES.map((s) => ({ id: s.id, name: s.name })),
      MORTGAGE.index,
      ...MORTGAGE.lenders.map((l) => ({ id: l.id, name: l.name })),
      MORTGAGE.bank,
      MORTGAGE.payroll,
      { id: "org:idp", name: MORTGAGE.idp },
    ]);
    this.set({ deviceKid: this.key.kid });
  }

  // ---- state plumbing -------------------------------------------------------------------

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getState(): EngineState {
    return this.state;
  }

  private set(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  private now(): Date {
    return this.clock();
  }

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private sleep(units = 1): Promise<void> {
    const ms = this.pace * units;
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  private guard(): void {
    if (this.state.stopped) throw new StoppedError();
  }

  private chat(chatId: string): Chat {
    const chat = this.state.chats.find((c) => c.id === chatId);
    if (!chat) throw new Error(`no chat ${chatId}`);
    return chat;
  }

  private updateChat(chatId: string, fn: (c: Chat) => Chat): void {
    this.set({ chats: this.state.chats.map((c) => (c.id === chatId ? fn(c) : c)) });
  }

  push(chatId: string, message: NewMessage): string {
    const id = message.id ?? this.id("m");
    const full = { ...message, id, at: this.now().toISOString() } as ChatMessage;
    this.updateChat(chatId, (c) => ({ ...c, messages: [...c.messages, full] }));
    return id;
  }

  patch(chatId: string, id: string, patch: Record<string, unknown>): void {
    this.updateChat(chatId, (c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === id ? ({ ...m, ...patch } as ChatMessage) : m)),
    }));
  }

  /** Stream an agent line word by word. */
  async say(chatId: string, text: string): Promise<void> {
    this.guard();
    const id = this.push(chatId, { type: "text", role: "agent", text: "", streaming: true });
    const words = text.split(/(\s+)/);
    if (this.pace === 0) {
      this.patch(chatId, id, { text, streaming: false });
      return;
    }
    let shown = "";
    for (const w of words) {
      shown += w;
      this.patch(chatId, id, { text: shown });
      if (w.trim()) await this.sleep(1);
    }
    this.patch(chatId, id, { streaming: false });
  }

  /** A live step list; returns a setter for each step's state. */
  progress(chatId: string, title: string, steps: { label: string; party?: string }[]) {
    const id = this.push(chatId, {
      type: "progress",
      title,
      steps: steps.map((s, i) => ({ ...s, id: `s${i}`, state: "pending" as ProgressState })),
    });
    return async (index: number, state: ProgressState, wait = 14) => {
      const chat = this.chat(chatId);
      const msg = chat.messages.find((m) => m.id === id);
      if (msg?.type !== "progress") return;
      this.patch(chatId, id, {
        steps: msg.steps.map((s, i) => (i === index ? { ...s, state } : s)),
      });
      if (state === "running") await this.sleep(wait);
    };
  }

  private log(entry: Omit<ActivityEntry, "id" | "at">): string {
    const id = this.id("rec");
    this.set({
      activity: [{ ...entry, id, at: this.now().toISOString() }, ...this.state.activity],
    });
    return id;
  }

  // ---- chats, stop, core -----------------------------------------------------------------

  newChat(): string {
    const id = this.id("chat");
    this.set({
      chats: [{ id, title: "New chat", messages: [] }, ...this.state.chats],
      activeChat: id,
    });
    return id;
  }

  openChat(id: string): void {
    this.chat(id);
    this.set({ activeChat: id });
  }

  rename(chatId: string, title: string): void {
    this.updateChat(chatId, (c) => (c.title === "New chat" ? { ...c, title } : c));
  }

  setCore(core: "scripted" | "live"): void {
    this.set({ core });
  }

  setLiveAvailable(available: boolean): void {
    this.set({ liveAvailable: available });
  }

  setWorking(working: boolean): void {
    this.set({ working });
  }

  /** One tap stops everything at once; pending approvals are cancelled. */
  stop(): void {
    if (this.state.stopped) return;
    const pending = this.state.pending;
    if (pending) {
      this.markStub(pending.chatId, pending.request.id, "cancelled");
      const waiting = this.resolver;
      this.resolver = undefined;
      waiting?.reject(new StoppedError());
    }
    this.set({ stopped: true, pending: undefined, working: false });
    this.push(this.state.activeChat, { type: "stopped" });
    this.log({
      outcome: "stop",
      filter: "blocked",
      summary: "You stopped Errand",
      checks: [],
      authority: "You pressed Stop. Nothing runs until you resume.",
    });
  }

  resume(): void {
    this.set({ stopped: false });
    this.log({ outcome: "go", filter: "asked", summary: "You resumed Errand", checks: [] });
  }

  // ---- consent records -------------------------------------------------------------------

  /** Verified, in-force spending rules: every record re-verified against the pinned key. */
  private async verifiedRules(): Promise<SpendingRule[]> {
    const rules = new Map<string, SpendingRule>();
    const revoked = new Set<string>();
    for (const jws of this.ruleRecords) {
      const r = await verifyRecord(jws, this.key.publicJwk);
      if (r?.type === "spending-rule") rules.set(r.rule.id, r.rule);
      if (r?.type === "revocation") revoked.add(r.ruleId);
    }
    return [...rules.values()].filter((r) => !revoked.has(r.id));
  }

  private async verifiedApprovals(): Promise<Set<string>> {
    const out = new Set<string>();
    const t = this.now().toISOString();
    for (const jws of this.approvalRecords.values()) {
      const r = await verifyRecord(jws, this.key.publicJwk);
      if (r?.type === "approval" && r.decision === "approve" && r.expiresAt > t)
        out.add(r.actionDigest);
    }
    return out;
  }

  private async refreshRules(): Promise<void> {
    const rules = await this.verifiedRules();
    const now = this.now();
    const views: RuleView[] = rules.map((rule) => {
      const u = ruleUsage(rule, this.ledger, { minor: 0, currency: rule.limit.currency }, now);
      const jws =
        this.ruleRecords.find((j) => j.length > 0 && this.ruleJwsIds.get(j) === rule.id) ?? "";
      return {
        rule,
        jws,
        label: ruleLabel(rule),
        summary: summarizeDraft(rule, AGENT_NAME, now),
        used: u.used,
        remaining: u.remaining,
        ...(u.resetsAt ? { resetsAt: u.resetsAt } : {}),
      };
    });
    this.set({ rules: views });
  }

  private readonly ruleJwsIds = new Map<string, string>();

  private async signRule(rule: SpendingRule): Promise<string> {
    const jws = await signRecord(this.key, {
      type: "spending-rule",
      rule,
      issuedAt: this.now().toISOString(),
    });
    this.ruleRecords.push(jws);
    this.ruleJwsIds.set(jws, rule.id);
    return jws;
  }

  /** Turn a rule off (from Can do, or Undo). Writes a signed revocation. */
  async revokeRule(ruleId: string, chatId?: string): Promise<void> {
    const jws = await signRecord(this.key, {
      type: "revocation",
      ruleId,
      issuedAt: this.now().toISOString(),
    });
    this.ruleRecords.push(jws);
    const view = this.state.rules.find((r) => r.rule.id === ruleId);
    await this.refreshRules();
    if (view) {
      this.log({
        outcome: "go",
        filter: "asked",
        summary: `You turned off ${view.label}`,
        checks: [],
        consentJws: jws,
        authority: "Signed revocation from your device. Purchases already made are not reversed.",
      });
      if (chatId)
        this.push(chatId, {
          type: "rule-change",
          rule: view.rule,
          summary: `Turned off: ${view.label}.`,
          change: "revoked",
        });
    }
  }

  // ---- the gate and the principal --------------------------------------------------------

  private digestOf(action: ProposedAction): string {
    // The digest covers what the principal approves: party, items, amounts, fields, terms.
    return actionDigest(action);
  }

  private async gate(action: ProposedAction): Promise<{ gate: GateResult; digest: string }> {
    const digest = this.digestOf(action);
    const gate = evaluateAction({
      action,
      digest,
      policy: SAM_POLICY,
      rules: await this.verifiedRules(),
      records: this.ledger,
      approvals: await this.verifiedApprovals(),
      attestations: new Set(this.attestations.keys()),
      now: this.now(),
    });
    return { gate, digest };
  }

  private markStub(chatId: string, requestId: string, state: string): void {
    const msg = this.chat(chatId).messages.find(
      (m) => m.type === "approval" && m.requestId === requestId,
    );
    if (msg) this.patch(chatId, msg.id, { state, resolvedAt: this.now().toISOString() });
  }

  private ask(
    chatId: string,
    request: ApprovalRequest,
    summary: string,
  ): Promise<PrincipalResponse> {
    this.guard();
    this.push(chatId, { type: "approval", requestId: request.id, summary, state: "pending" });
    this.set({ pending: { chatId, request } });
    this.log({
      outcome: "ask",
      filter: "asked",
      summary: `Asked you: ${request.title}`,
      checks: request.checks,
      digest: request.digest,
    });
    return new Promise((resolve, reject) => {
      this.resolver = { resolve, reject };
    });
  }

  /** The UI answers the open approval. Refused responses leave it open. */
  async respond(response: PrincipalResponse): Promise<{ ok: boolean; reason?: string }> {
    const pending = this.state.pending;
    if (!pending || !this.resolver) return { ok: false, reason: "nothing-pending" };
    const check = checkResponse(pending.request, response, this.now());
    if (!check.ok) return { ok: false, reason: check.reason };
    const waiting = this.resolver;
    this.resolver = undefined;
    this.set({ pending: undefined });
    waiting.resolve(response);
    return { ok: true };
  }

  /**
   * Run one action through the gate until it goes, stops, or the principal says no. Each
   * answer becomes a signed record and the gate decides again from scratch.
   */
  private async passGate(
    chatId: string,
    initial: ProposedAction,
    summary: string,
  ): Promise<{
    result: Done;
    action: ProposedAction;
    gate?: GateResult;
    digest?: string;
    authority?: string;
    consentJws?: string;
  }> {
    let action = initial;
    let authority: string | undefined;
    let consentJws: string | undefined;
    for (let round = 0; round < 4; round += 1) {
      this.guard();
      const { gate, digest } = await this.gate(action);
      if (gate.outcome === "go") {
        if (!authority && gate.basis === "rule" && gate.spend?.outcome === "covered")
          authority = `Within ${describeRule(gate.spend.usage.rule).replace(/^your /, "your ")}`;
        return {
          result: "done",
          action,
          gate,
          digest,
          ...(authority ? { authority } : {}),
          ...(consentJws ? { consentJws } : {}),
        };
      }
      if (gate.outcome === "stop") return { result: "blocked", action, gate, digest };
      const request = buildApprovalRequest(gate, {
        id: this.id("req"),
        digest,
        now: this.now(),
        action,
        declinedStanding: this.declined.get(chatId) ?? 0,
      });
      await this.leadIn(chatId, action, gate);
      const response = await this.ask(chatId, request, summary);
      this.guard();
      const now = this.now();
      if (response.type === "deny") {
        this.markStub(chatId, request.id, "denied");
        if (request.offered.some((o) => o.role === "standing"))
          this.declined.set(chatId, (this.declined.get(chatId) ?? 0) + 1);
        this.log({
          outcome: "stop",
          filter: "asked",
          summary: `You said no: ${request.title}`,
          checks: request.checks,
          digest,
        });
        return { result: "denied", action };
      }
      if (response.type === "set-limit" || response.type === "raise-limit") {
        const check = checkResponse(request, response, now, this.id("rule"));
        if (!check.ok || !check.rule) return { result: "denied", action };
        if (
          response.type === "raise-limit" &&
          request.offered.find((o) => o.id === response.offeredId)?.replacesRuleId
        ) {
          const old = request.offered.find((o) => o.id === response.offeredId)
            ?.replacesRuleId as string;
          this.ruleRecords.push(
            await signRecord(this.key, {
              type: "revocation",
              ruleId: old,
              issuedAt: now.toISOString(),
            }),
          );
        }
        consentJws = await this.signRule(check.rule);
        await this.refreshRules();
        this.markStub(chatId, request.id, "standing-set");
        const sentence = ruleLabel(check.rule);
        this.push(chatId, {
          type: "rule-change",
          rule: check.rule,
          summary: `${response.type === "raise-limit" ? "Raised" : "New rule"}: up to ${sentence}.`,
          change: response.type === "raise-limit" ? "raised" : "created",
          undoUntil: new Date(now.getTime() + UNDO_MS).toISOString(),
        });
        this.log({
          outcome: "go",
          filter: "asked",
          summary: `You set a limit: ${sentence}`,
          checks: [],
          consentJws,
          authority: "Spending rule signed on your device",
        });
        continue;
      }
      if (response.type === "share-less" && action.type === "share") {
        const keep = new Set(response.keep);
        action = {
          ...action,
          fields: action.fields.map((f) =>
            f.state === "offered" && !keep.has(f.id)
              ? {
                  ...f,
                  state: "withheld-by-gate" as const,
                  withheldReason: "You chose not to share this.",
                }
              : f,
          ),
        };
      }
      if (response.type === "step-up-done") {
        const attestation = await this.parties.sign("org:idp", {
          attests: digest,
          method: "face-check",
          at: now.toISOString(),
        });
        const ok = await this.parties.receive<{ attests: string }>(attestation, "org:idp", (p) =>
          p.attests === digest ? undefined : "wrong action",
        );
        if (ok) this.attestations.set(digest, attestation);
        this.markStub(chatId, request.id, "approved-once");
        authority = "You completed a face check";
        continue;
      }
      // approve-once (and share-less, which approves the reduced action)
      const approvedDigest = this.digestOf(action);
      const jws = await signRecord(this.key, {
        type: "approval",
        id: this.id("approval"),
        actionDigest: approvedDigest,
        decision: "approve",
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      });
      this.approvalRecords.set(approvedDigest, jws);
      consentJws = jws;
      authority =
        action.type === "share" ? "You approved this sharing" : "You approved this purchase";
      this.markStub(chatId, request.id, "approved-once");
    }
    return { result: "denied", action };
  }

  /** The chat line before a sheet. The sheet itself is written by the gate. */
  private async leadIn(chatId: string, action: ProposedAction, gate: GateResult): Promise<void> {
    if (action.type === "purchase") {
      const item = action.items[0]?.name ?? "This";
      if (gate.kind === "limit-exceeded")
        await this.say(
          chatId,
          `The ${item} is ${formatMoney(action.total)}. That takes you over your limit, so I need your OK.`,
        );
      else if (gate.kind === "new-recipient")
        await this.say(
          chatId,
          `I could not confirm ${action.recipient.name} from your list or a register, so I need your OK first.`,
        );
      else await this.say(chatId, "I need your OK to buy these.");
    } else if (action.type === "step-up") {
      await this.say(
        chatId,
        `${action.recipient.name} wants a stronger approval before it releases ${action.releases}.`,
      );
    }
  }

  // ---- skills (what either core may ask for) ---------------------------------------------

  productView(p: Product): ProductView {
    const s = storeById(p.store);
    return {
      id: p.id,
      name: p.name,
      store: s.name,
      storeId: s.id,
      price: p.price,
      delivery: s.delivery,
      returns: s.returns,
      variants: p.variants,
      color: p.color,
      art: p.art,
    };
  }

  /** Search the three stores. Prices and records come signed from each store. */
  async searchProducts(
    chatId: string,
    query: { category?: string; maxPrice?: Money; text?: string },
  ): Promise<ProductView[]> {
    this.guard();
    const step = this.progress(chatId, "Searching", [{ label: "Searching 3 stores" }]);
    await step(0, "running", 30);
    const hits: ProductView[] = [];
    for (const p of PRODUCTS) {
      const listing = await this.parties.sign(p.store, {
        product: p.id,
        price: p.price.minor,
        currency: p.price.currency,
      });
      const ok = await this.parties.receive<{ price: number }>(listing, p.store, (x) =>
        x.price === p.price.minor ? undefined : "price changed",
      );
      if (!ok) continue;
      const text = query.text?.toLowerCase();
      if (query.category && p.category !== query.category) continue;
      if (query.maxPrice && p.price.minor > query.maxPrice.minor) continue;
      if (text && !`${p.name} ${p.category} ${p.art}`.toLowerCase().includes(text)) continue;
      hits.push(this.productView(p));
    }
    await step(0, "done");
    return hits;
  }

  private ordinal = 20418;

  /**
   * Buy one product. Reads the product page first: its text is content, so any instruction
   * in it is refused by the gate and surfaced.
   */
  async buy(chatId: string, productId: string, variant?: string): Promise<Done> {
    this.guard();
    const p = productById(productId);
    const store = storeById(p.store);
    const chosen = variant ?? (p.variants[0] as string);
    if (p.pageText && /AI agents?:/i.test(p.pageText)) {
      const quoted = /AI agents?:[^<]*/i.exec(p.pageText)?.[0]?.trim() ?? "";
      const upsell: PurchaseAction = {
        ...this.purchaseAction(p, chosen),
        items: [{ name: PROTECTION_PLAN.name, qty: 1, price: PROTECTION_PLAN.price }],
        total: PROTECTION_PLAN.price,
        fees: [],
        origin: "content",
      };
      const { gate, digest } = await this.gate(upsell);
      const recordId = this.log({
        outcome: "stop",
        filter: "blocked",
        summary: "Ignored an instruction on the Stride & Co product page",
        detail: quoted,
        checks: gate.checks,
        inbound: [
          { check: "integrity", result: "pass", plain: "The page loaded intact." },
          { check: "source", result: "pass", plain: `It is ${store.name}'s own page.` },
          {
            check: "authority",
            result: "fail",
            plain: "The page is not you: admitted as content only, never as an instruction.",
            code: "not-the-principal",
          },
          { check: "terms", result: "not-applicable", plain: "No terms in page text." },
          { check: "fitness", result: "pass", plain: "Product details are usable as information." },
        ],
        digest,
      });
      this.push(chatId, {
        type: "blocked",
        title: "I ignored an instruction that was not from you",
        quoted,
        source: `The ${store.name} product page`,
        notDone: `I did not add the ${PROTECTION_PLAN.name.replace(/^2-year /, "")}.`,
        checks: gate.checks,
        recordId,
      });
    }
    const action = this.purchaseAction(p, chosen);
    return this.completePurchase(chatId, action, `buy ${p.name}, ${formatMoney(action.total)}`);
  }

  private purchaseAction(p: Product, variant: string): PurchaseAction {
    const store = storeById(p.store);
    const fee = feesFor(store);
    const history = this.history.get(store.id) ?? { purchases: 0, shares: 0 };
    return {
      type: "purchase",
      recipient: {
        id: store.id,
        name: store.name,
        established: store.established,
        lookupPath: store.lookupPath,
        history,
      },
      category: p.category,
      items: [{ name: p.name, variant, qty: 1, price: p.price }],
      fees: fee.minor > 0 ? [{ label: "Delivery fee", amount: fee }] : [],
      total: { minor: p.price.minor + fee.minor, currency: p.price.currency },
      paymentLabel: PRINCIPAL.card,
      delivery: store.delivery.replace(/^\$[\d.]+, /, ""),
      returns: store.returns,
      reversibility: "refundable",
      origin: "principal-request",
    };
  }

  private async completePurchase(
    chatId: string,
    action: PurchaseAction,
    summary: string,
  ): Promise<Done> {
    const outcome = await this.passGate(chatId, action, summary);
    if (outcome.result !== "done" || !outcome.gate || outcome.action.type !== "purchase") {
      if (outcome.result === "denied")
        await this.say(chatId, "OK, I did not buy it. Nothing was charged.");
      if (outcome.result === "blocked" && outcome.gate) {
        const why = outcome.gate.checks.find((c) => c.result === "fail")?.plain ?? "";
        await this.say(chatId, `I can't do that: ${why}`);
      }
      return outcome.result;
    }
    const a = outcome.action;
    const g = outcome.gate;
    // The store confirms the order with a signed receipt; the inbound gate checks it.
    this.ordinal += 13;
    const orderRef = `SC-${this.ordinal}`;
    const receiptJws = await this.parties.sign(a.recipient.id, {
      order: orderRef,
      total: a.total.minor,
    });
    const receipt = await this.parties.receive<{ order: string; total: number }>(
      receiptJws,
      a.recipient.id,
      (x) => (x.total === a.total.minor ? undefined : "total differs"),
    );
    if (!receipt) {
      await this.say(
        chatId,
        "The store's confirmation did not check out, so I am treating this order as not placed.",
      );
      return "blocked";
    }
    const ruleId =
      g.basis === "rule" && g.spend?.outcome === "covered" ? g.spend.usage.rule.id : undefined;
    this.ledger.push({
      id: orderRef,
      ...(ruleId ? { ruleId } : {}),
      merchant: a.recipient.id,
      category: a.category,
      amount: a.total,
      at: this.now().toISOString(),
    });
    // The approval was single use.
    if (outcome.digest) this.approvalRecords.delete(outcome.digest);
    const h = this.history.get(a.recipient.id) ?? { purchases: 0, shares: 0 };
    this.history.set(a.recipient.id, { ...h, purchases: h.purchases + 1 });
    await this.refreshRules();
    const authority = outcome.authority ?? "You approved this purchase";
    const recordId = this.log({
      outcome: "go",
      filter: "purchases",
      summary: `Bought ${a.items.map((i) => i.name).join(", ")} at ${a.recipient.name}`,
      detail: formatMoney(a.total),
      checks: g.checks,
      inbound: receipt.checks,
      digest: outcome.digest,
      authority,
      ...(outcome.consentJws ? { consentJws: outcome.consentJws } : {}),
    });
    const item = a.items[0] as (typeof a.items)[number];
    const arrives = a.delivery?.replace(/^Free, /, "").replace(/^arrives /, "arriving ") ?? "";
    if (ruleId) {
      await this.say(
        chatId,
        `Bought. ${item.name}, ${formatMoney(a.total)}, ${arrives}. I did not need to ask: this is inside your limit.`,
      );
    } else {
      await this.say(
        chatId,
        `Bought. ${item.name}${item.variant ? `, ${item.variant.split(",")[0]}` : ""}, ${arrives}.`,
      );
    }
    this.push(chatId, {
      type: "receipt",
      store: a.recipient.name,
      items: a.items.map((i) => ({
        name: `${i.name}${i.variant ? ` (${i.variant})` : ""}`,
        price: i.price,
      })),
      total: a.total,
      orderRef,
      authority,
      recordId,
    });
    this.limitChip(chatId, ruleId ?? this.ruleFor(a.recipient.id));
    return "done";
  }

  private ruleFor(merchant: string): string | undefined {
    return this.state.rules.find(
      (r) => r.rule.scope.kind === "merchant" && r.rule.scope.merchant === merchant,
    )?.rule.id;
  }

  private limitChip(chatId: string, ruleId: string | undefined): void {
    const view = this.state.rules.find((r) => r.rule.id === ruleId);
    if (!view || view.rule.kind === "per-purchase") return;
    const tone = view.used.minor >= view.rule.limit.minor * 0.75 ? "ask" : "go";
    this.push(chatId, {
      type: "limit-chip",
      ruleId: view.rule.id,
      label: `Within your ${view.label}`,
      used: view.used,
      limit: view.rule.limit,
      tone,
    });
  }

  /** "What can you do without asking me?" */
  async explainRules(chatId: string): Promise<void> {
    const rules = this.state.rules;
    if (rules.length === 0) {
      await this.say(
        chatId,
        "Right now I ask before every purchase and before sharing anything about you. You can set a spending limit for a store from any purchase, and I will buy inside it and tell you after. I never follow instructions found on web pages, and accepting a loan always comes back to you.",
      );
      return;
    }
    const list = rules.map((r) => `${r.label} (${formatMoney(r.used)} used)`).join("; ");
    await this.say(
      chatId,
      `Without asking, I can buy inside these limits: ${list}. Everything else, I ask first.`,
    );
  }

  // ---- mortgage --------------------------------------------------------------------------

  async mortgageSearch(chatId: string): Promise<void> {
    const loan = MORTGAGE.price - MORTGAGE.deposit;
    const step = this.progress(chatId, "Finding mortgages", [
      { label: "Asking the mortgage product index (no personal data sent)", party: "Index" },
      { label: "Checking each product against its lender" },
      { label: "Looking up lenders on the sector register" },
    ]);
    await step(0, "running", 40);
    const answer = await this.parties.sign(MORTGAGE.index.id, {
      products: 14,
      lenders: 6,
      updated: "2 hours ago",
    });
    const index = await this.parties.receive<{ products: number }>(answer, MORTGAGE.index.id);
    await step(0, "done");
    await step(1, "running", 40);
    for (const l of MORTGAGE.lenders) {
      const rec = await this.parties.sign(l.id, { product: l.product, rate: l.rate });
      await this.parties.receive(rec, l.id);
    }
    await step(1, "done");
    await step(2, "running", 30);
    await step(2, "done");
    this.log({
      outcome: "go",
      filter: "shared",
      summary: "Queried the mortgage product index",
      detail: "No personal data sent",
      checks: [
        { check: "mandate", result: "pass", plain: "Your rules allow looking up products." },
        {
          check: "recipient",
          result: "pass",
          plain: "The index is a public service; its key is pinned.",
        },
        {
          check: "disclosure",
          result: "pass",
          plain: "Nothing about you was sent: only the loan size.",
        },
        { check: "data-terms", result: "not-applicable", plain: "No personal data." },
        {
          check: "limits-and-approval",
          result: "pass",
          plain: "Reading costs nothing and commits nothing.",
        },
        { check: "evidence", result: "pass", plain: "A signed record of this decision is kept." },
      ],
      inbound: index?.checks ?? [],
    });
    await this.say(
      chatId,
      `The index holds ${index?.payload.products ?? 14} products from 6 lenders, updated 2 hours ago. Three fit a $${loan.toLocaleString("en-US")} loan.`,
    );
    this.push(chatId, {
      type: "comparison",
      columns: MORTGAGE.lenders.map((l, i) => ({
        id: l.id,
        title: l.product,
        party: l.name,
        ...(i === 0 ? { best: "Lowest monthly cost with no fee" } : {}),
      })),
      rows: [
        { label: "Rate", values: MORTGAGE.lenders.map((l) => l.rate) },
        { label: "Monthly", values: MORTGAGE.lenders.map((l) => l.monthly) },
        { label: "Fee", values: MORTGAGE.lenders.map((l) => l.fee) },
      ],
      footnote:
        "Each record is signed by its lender. The index is relied on only for coverage and freshness.",
    });
  }

  async mortgageApply(chatId: string, lenderId = "org:north"): Promise<Done> {
    const lender =
      MORTGAGE.lenders.find((l) => l.id === lenderId) ??
      (MORTGAGE.lenders[0] as (typeof MORTGAGE.lenders)[number]);
    await this.say(
      chatId,
      `${lender.name} is a registered mortgage lender. It has told me what it needs. It asked for more than a decision in principle requires, so I am proposing to share less.`,
    );
    const fields: DataField[] = [
      {
        id: "income",
        kind: "income",
        label: "Income",
        preview: "Net pay for the last 3 months",
        source: "From Paywell",
        sensitivity: "financial",
        required: true,
        state: "offered",
      },
      {
        id: "balance",
        kind: "bank-balance",
        label: "Bank balance",
        preview: "One figure as of today",
        source: "From Harbour Bank",
        sensitivity: "financial",
        required: true,
        state: "offered",
      },
      {
        id: "employer",
        kind: "employment",
        label: "Employer",
        preview: "Employer name and start date",
        source: "From Paywell",
        sensitivity: "personal",
        required: false,
        state: "offered",
      },
      {
        id: "transactions",
        kind: "transactions",
        label: "3 years of bank transactions",
        preview: "Every payment in and out",
        source: "From Harbour Bank",
        sensitivity: "financial",
        required: false,
        state: "withheld-by-gate",
        withheldReason: "More than this purpose needs. I declined on your behalf.",
      },
    ];
    const share: ShareAction = {
      type: "share",
      recipient: {
        id: lender.id,
        name: lender.name,
        role: "Lender",
        established: "register",
        lookupPath: [
          "Your list: not found",
          "National financial root",
          "Sector register of mortgage lenders",
        ],
        history: this.history.get(lender.id) ?? { purchases: 0, shares: 0 },
      },
      fields,
      terms: {
        purpose: "Mortgage application (credit assessment)",
        retentionDays: 90,
        onwardSharing: "Its underwriter only",
        prohibitedUses: ["Marketing"],
      },
      origin: "principal-request",
      eachTimeApproval: true,
    };
    const shared = await this.passGate(
      chatId,
      share,
      `share income and balance with ${lender.name}`,
    );
    if (shared.result !== "done" || shared.action.type !== "share" || !shared.gate) {
      if (shared.result === "denied")
        await this.say(chatId, `OK, I have not shared anything with ${lender.name}.`);
      return shared.result;
    }
    const sent = shared.action.fields
      .filter((f) => f.state === "offered")
      .map((f) => f.label.toLowerCase());
    this.log({
      outcome: "go",
      filter: "shared",
      summary: `Shared ${sent.join(", ")} with ${lender.name}`,
      detail: "Kept up to 90 days, underwriter only",
      checks: shared.gate.checks,
      digest: shared.digest,
      authority: shared.authority,
      ...(shared.consentJws ? { consentJws: shared.consentJws } : {}),
    });
    const step = this.progress(chatId, "Applying", [
      { label: `Agreement on evidence signed by ${lender.name}`, party: lender.name },
      { label: "Asking Paywell for pay records", party: "Paywell" },
      { label: "Asking Harbour Bank for your balance", party: "Harbour Bank" },
      { label: `Application sent to ${lender.name} as a verifiable message` },
      { label: `${lender.name} is checking` },
    ]);
    await step(0, "running", 25);
    await step(0, "done");
    await step(1, "running", 30);
    const pay = await this.parties.sign(MORTGAGE.payroll.id, {
      statement: "net-pay-3m",
      issued: this.now().toISOString(),
    });
    await this.parties.receive(pay, MORTGAGE.payroll.id);
    await step(1, "done");
    await step(2, "running", 20);
    const stepUp: StepUpAction = {
      type: "step-up",
      recipient: {
        id: MORTGAGE.bank.id,
        name: MORTGAGE.bank.name,
        established: "own-list",
        lookupPath: ["Your list"],
        history: { purchases: 0, shares: 0 },
      },
      releases: "your bank balance",
      goesTo: `Your agent, then ${lender.name}`,
      method: "face-check",
      performedBy: MORTGAGE.idp,
      validMinutes: 15,
      origin: "agent-plan",
    };
    await step(2, "asked");
    const stepped = await this.passGate(chatId, stepUp, "face check for Harbour Bank");
    if (stepped.result !== "done") {
      await step(2, "stopped");
      if (stepped.result === "denied")
        await this.say(
          chatId,
          "OK. Without the face check Harbour Bank will not release your balance, so I have paused the application.",
        );
      return stepped.result;
    }
    await step(2, "running", 20);
    const balance = await this.parties.sign(MORTGAGE.bank.id, {
      statement: "balance",
      asOf: this.now().toISOString(),
    });
    const bal = await this.parties.receive(balance, MORTGAGE.bank.id);
    await step(2, "done");
    await step(3, "running", 25);
    await step(3, "done");
    await step(4, "running", 40);
    const dip = await this.parties.sign(lender.id, {
      decision: "decision-in-principle",
      upTo: 285_000,
      product: `${lender.product}, ${lender.rate}`,
      validUntil: "2026-12-13",
      binding: false,
    });
    const offer = await this.parties.receive<{
      upTo: number;
      product: string;
      validUntil: string;
      binding: boolean;
    }>(dip, lender.id);
    await step(4, "done");
    if (!offer) {
      await this.say(
        chatId,
        `${lender.name}'s reply did not check out, so I am not relying on it.`,
      );
      return "blocked";
    }
    const recordId = this.log({
      outcome: "go",
      filter: "shared",
      summary: `Decision in principle from ${lender.name}`,
      detail: `Up to $${offer.payload.upTo.toLocaleString("en-US")}, not binding`,
      checks: [],
      inbound: [...offer.checks, ...(bal?.checks ?? []).slice(0, 0)],
    });
    await this.say(chatId, `${lender.name} has replied.`);
    this.push(chatId, {
      type: "offer",
      party: lender.name,
      headline: `Decision in principle: up to $${offer.payload.upTo.toLocaleString("en-US")}`,
      rows: [
        { label: "Product", value: offer.payload.product },
        { label: "Based on", value: "Income from Paywell, balance from Harbour Bank" },
        { label: "Valid until", value: "Dec 13, 2026" },
      ],
      binding: offer.payload.binding,
      sourceLine: `Signed by ${lender.name}. Checked against the sector register.`,
      recordId,
    });
    await this.say(
      chatId,
      `This does not commit you or ${lender.name}. I will always ask before accepting an offer.`,
    );
    return "done";
  }

  /** Inbound checks for the record view (used by Activity "Why"). */
  static outcomeWord(checks: readonly CheckLine[]): string {
    if (checks.some((c) => c.result === "fail")) return "stop";
    if (checks.some((c) => c.result === "ask")) return "ask the principal";
    return "go";
  }
}
