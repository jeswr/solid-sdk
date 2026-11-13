// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// A small, deterministic, fictional shop on node:http. It behaves like a real site (cookie
// sessions, double-submit CSRF, a JSON API next to server-rendered pages, a bearer token API with
// refresh) so the profiler and executor can be tested against something realistic.

import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { APP_JS, STYLE_CSS } from "./assets.js";
import {
  DELIVERY_OPTIONS,
  type DeliveryOption,
  type Product,
  SEARCH_PAGE_SIZE,
  seedProducts,
  USERS,
} from "./data.js";
import {
  accountPage,
  type CartView,
  cartPage,
  checkoutPage,
  deliveryHelpPage,
  homePage,
  loginPage,
  notFoundPage,
  type OrderView,
  orderPage,
  ordersPage,
  type PageContext,
  productPage,
  searchPage,
} from "./pages.js";

export { DELIVERY_OPTIONS, INJECTION_REVIEW, type Product, seedProducts, USERS } from "./data.js";

export interface ShopOptions {
  /** Port to listen on; 0 or omitted picks a free one. */
  port?: number;
  /** Interface to bind; defaults to 127.0.0.1. */
  host?: string;
  /** Lifetime of bearer access tokens. Default 300 seconds. */
  accessTokenTtlSeconds?: number;
  /** Clock in epoch milliseconds, for token expiry tests. */
  now?: () => number;
}

export interface CartLine {
  sku: string;
  qty: number;
}

export interface Order {
  id: number;
  email: string;
  lines: CartLine[];
  delivery: DeliveryOption;
  /** Items plus delivery, decimal string. */
  total: string;
  createdAt: string;
}

export interface LoginEvent {
  email: string;
  success: boolean;
  /** 'form' for POST /login, 'token' for POST /api/token. */
  via: "form" | "token";
  at: string;
}

export interface RequestLogEntry {
  method: string;
  /** Path plus query string. */
  url: string;
  status: number;
  /** True when the request carried a valid session cookie. */
  signedIn: boolean;
  at: string;
}

interface Session {
  sid: string;
  email: string;
  csrf: string;
}

interface AccessToken {
  email: string;
  expiresAt: number;
}

export interface ShopState {
  products: Product[];
  /** Carts by user email. */
  carts: Map<string, CartLine[]>;
  orders: Order[];
  logins: LoginEvent[];
  requests: RequestLogEntry[];
  /** Number of live cookie sessions. */
  sessionCount(): number;
  /** Clear carts, orders, logs, sessions and tokens. */
  reset(): void;
}

export interface RunningShop {
  /** Origin, e.g. http://127.0.0.1:43210 */
  url: string;
  state: ShopState;
  close(): Promise<void>;
}

const MAX_BODY = 64 * 1024;

function token(): string {
  return randomBytes(16).toString("hex");
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY) throw new HttpError(413, "Payload too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function startShop(options: ShopOptions = {}): Promise<RunningShop> {
  const now = options.now ?? Date.now;
  const ttl = options.accessTokenTtlSeconds ?? 300;
  const products = seedProducts();
  const byId = new Map(products.map((p) => [p.id, p]));
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const sessions = new Map<string, Session>();
  const accessTokens = new Map<string, AccessToken>();
  const refreshTokens = new Map<string, string>();
  let nextOrderId = 5001;
  let origin = "";

  const state: ShopState = {
    products,
    carts: new Map(),
    orders: [],
    logins: [],
    requests: [],
    sessionCount: () => sessions.size,
    reset() {
      state.carts.clear();
      state.orders.length = 0;
      state.logins.length = 0;
      state.requests.length = 0;
      sessions.clear();
      accessTokens.clear();
      refreshTokens.clear();
      nextOrderId = 5001;
    },
  };

  const stamp = () => new Date(now()).toISOString();

  function cartOf(email: string): CartLine[] {
    let cart = state.carts.get(email);
    if (!cart) {
      cart = [];
      state.carts.set(email, cart);
    }
    return cart;
  }

  function cartView(email: string): { lines: CartView[]; total: string; count: number } {
    const lines: CartView[] = [];
    let total = 0;
    let count = 0;
    for (const line of state.carts.get(email) ?? []) {
      const p = bySku.get(line.sku);
      if (!p) continue;
      const lineTotal = Number(p.price) * line.qty;
      total += lineTotal;
      count += line.qty;
      lines.push({ sku: p.sku, name: p.name, qty: line.qty, price: money(lineTotal) });
    }
    return { lines, total: money(total), count };
  }

  function apiProduct(p: Product, withDetail: boolean) {
    const base = {
      id: p.id,
      sku: p.sku,
      name: p.name,
      price: p.price,
      currency: p.currency,
      url: `${origin}/product/${p.id}`,
    };
    return withDetail
      ? { ...base, description: p.description, stock: p.stock, reviews: p.reviews }
      : base;
  }

  function search(q: string, page: number): { items: Product[]; total: number } {
    const needle = q.trim().toLowerCase();
    if (!needle) return { items: [], total: 0 };
    const inName = products.filter(
      (p) => p.name.toLowerCase().includes(needle) || p.sku.toLowerCase() === needle,
    );
    const inText = products.filter(
      (p) => !inName.includes(p) && p.description.toLowerCase().includes(needle),
    );
    const all = [...inName, ...inText];
    const start = (page - 1) * SEARCH_PAGE_SIZE;
    return { items: all.slice(start, start + SEARCH_PAGE_SIZE), total: all.length };
  }

  function orderView(o: Order): OrderView {
    const lines = o.lines.map((l) => {
      const p = bySku.get(l.sku);
      return {
        sku: l.sku,
        name: p?.name ?? l.sku,
        qty: l.qty,
        price: money(Number(p?.price ?? 0) * l.qty),
      };
    });
    return { id: o.id, total: o.total, delivery: o.delivery, createdAt: o.createdAt, lines };
  }

  function bearerEmail(req: IncomingMessage): string | undefined {
    const auth = req.headers.authorization ?? "";
    const match = /^Bearer\s+(\S+)$/i.exec(auth);
    if (!match?.[1]) return undefined;
    const t = accessTokens.get(match[1]);
    if (!t || t.expiresAt <= now()) return undefined;
    return t.email;
  }

  function issueTokens(email: string) {
    const access = token();
    const refresh = token();
    accessTokens.set(access, { email, expiresAt: now() + ttl * 1000 });
    refreshTokens.set(refresh, email);
    return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: ttl };
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://shop.invalid");
    const path = url.pathname;
    const cookies = parseCookies(req.headers.cookie);
    const session = cookies.sid ? sessions.get(cookies.sid) : undefined;
    const user = session ? USERS.find((u) => u.email === session.email) : undefined;
    const ctx: PageContext = {
      ...(user ? { userName: user.name } : {}),
      ...(session ? { csrf: session.csrf } : {}),
      cartCount: session ? cartView(session.email).count : 0,
    };

    const send = (
      status: number,
      body: string,
      type: string,
      headers: Record<string, string | string[]> = {},
    ) => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...headers });
      res.end(body);
    };
    const html = (status: number, body: string, headers: Record<string, string | string[]> = {}) =>
      send(status, body, "text/html; charset=utf-8", headers);
    const json = (status: number, body: unknown, headers: Record<string, string | string[]> = {}) =>
      send(status, JSON.stringify(body), "application/json", headers);
    const redirect = (status: number, location: string, headers: Record<string, string[]> = {}) => {
      res.writeHead(status, { location, "cache-control": "no-store", ...headers });
      res.end();
    };
    const requirePage = (): Session | undefined => {
      if (session) return session;
      redirect(302, `/login?next=${encodeURIComponent(path)}`);
      return undefined;
    };
    const requireApi = (): Session | undefined => {
      if (session) return session;
      json(401, { error: "not_signed_in" });
      return undefined;
    };
    const csrfHeaderOk = (s: Session): boolean => {
      const header = req.headers["x-csrf-token"];
      return typeof header === "string" && header === cookies.csrf && header === s.csrf;
    };
    const form = async () => new URLSearchParams(await readBody(req));

    if (method === "GET") {
      if (path === "/") {
        html(200, homePage(products.slice(0, 4), ctx));
        return true;
      }
      if (path === "/static/app.js") {
        send(200, APP_JS, "text/javascript; charset=utf-8");
        return true;
      }
      if (path === "/static/style.css") {
        send(200, STYLE_CSS, "text/css; charset=utf-8");
        return true;
      }
      if (path === "/search" || path === "/api/search") {
        const q = url.searchParams.get("q") ?? "";
        const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
        const { items, total } = search(q, page);
        if (path === "/api/search") {
          json(200, {
            items: items.map((p) => apiProduct(p, false)),
            page,
            pageSize: SEARCH_PAGE_SIZE,
            total,
          });
        } else {
          html(200, searchPage(q, page, items, total, SEARCH_PAGE_SIZE, ctx));
        }
        return true;
      }
      const productMatch = /^\/(api\/products|product)\/(\d+)$/.exec(path);
      if (productMatch) {
        const p = byId.get(Number(productMatch[2]));
        const api = productMatch[1] === "api/products";
        if (!p) {
          if (api) json(404, { error: "not_found" });
          else html(404, notFoundPage(ctx));
        } else if (api) json(200, apiProduct(p, true));
        else html(200, productPage(p, ctx));
        return true;
      }
      if (path === "/login") {
        const csrf = cookies.csrf && !session ? cookies.csrf : session ? session.csrf : token();
        const next = url.searchParams.get("next") ?? undefined;
        html(200, loginPage(csrf, ctx, undefined, next), {
          "set-cookie": [`csrf=${csrf}; Path=/; SameSite=Lax`],
        });
        return true;
      }
      if (path === "/account") {
        const s = requirePage();
        if (s && user) html(200, accountPage(user.name, user.email, ctx));
        return true;
      }
      if (path === "/cart") {
        const s = requirePage();
        if (s) {
          const v = cartView(s.email);
          html(200, cartPage(v.lines, v.total, ctx));
        }
        return true;
      }
      if (path === "/api/cart") {
        const s = requireApi();
        if (s) {
          const v = cartView(s.email);
          json(200, { items: v.lines, count: v.count, total: v.total, currency: "GBP" });
        }
        return true;
      }
      if (path === "/api/checkout") {
        const session = requireApi();
        if (session) {
          const delivery = url.searchParams.get("delivery") ?? "standard";
          if (!Object.hasOwn(DELIVERY_OPTIONS, delivery)) json(400, { error: "unknown_delivery" });
          else
            json(200, {
              url: `${origin}/checkout`,
              totalPaymentDue: money(
                Number(cartView(session.email).total) +
                  Number(DELIVERY_OPTIONS[delivery as DeliveryOption].cost),
              ),
              currency: "GBP",
            });
        }
        return true;
      }
      if (path === "/checkout") {
        const s = requirePage();
        if (s) {
          const v = cartView(s.email);
          html(200, checkoutPage(s.csrf, v.lines, v.total, ctx));
        }
        return true;
      }
      if (path === "/orders") {
        const s = requirePage();
        if (s) {
          const mine = state.orders.filter((o) => o.email === s.email).map(orderView);
          html(200, ordersPage(mine, ctx));
        }
        return true;
      }
      const orderMatch = /^\/orders\/(\d+)$/.exec(path);
      if (orderMatch) {
        const s = requirePage();
        if (s) {
          const o = state.orders.find((x) => x.id === Number(orderMatch[1]) && x.email === s.email);
          if (o) html(200, orderPage(orderView(o), ctx));
          else html(404, notFoundPage(ctx));
        }
        return true;
      }
      if (path === "/help/delivery") {
        html(200, deliveryHelpPage(ctx));
        return true;
      }
      if (path === "/api/me") {
        const email = bearerEmail(req);
        const u = email ? USERS.find((x) => x.email === email) : undefined;
        if (!u) {
          json(
            401,
            { error: "invalid_token" },
            { "www-authenticate": 'Bearer error="invalid_token"' },
          );
        } else json(200, { email: u.email, name: u.name });
        return true;
      }
      return false;
    }

    if (method === "POST" && path === "/login") {
      const body = await form();
      if (!cookies.csrf || body.get("csrf_token") !== cookies.csrf) {
        html(403, loginPage(token(), ctx, "Your session expired. Please try again."));
        return true;
      }
      const email = body.get("username") ?? "";
      const u = USERS.find((x) => x.email === email && x.password === body.get("password"));
      state.logins.push({ email, success: Boolean(u), via: "form", at: stamp() });
      if (!u) {
        html(401, loginPage(cookies.csrf, ctx, "Email or password is wrong."));
        return true;
      }
      const s: Session = { sid: token(), email: u.email, csrf: token() };
      sessions.set(s.sid, s);
      const next = body.get("next") ?? "";
      const target = next.startsWith("/") && !next.startsWith("//") ? next : "/account";
      redirect(303, target, {
        "set-cookie": [
          `sid=${s.sid}; Path=/; HttpOnly; SameSite=Lax`,
          `csrf=${s.csrf}; Path=/; SameSite=Lax`,
        ],
      });
      return true;
    }

    if (method === "POST" && path === "/logout") {
      const body = await form();
      if (session && body.get("csrf_token") === session.csrf) sessions.delete(session.sid);
      redirect(303, "/", {
        "set-cookie": ["sid=; Path=/; HttpOnly; Max-Age=0"],
      });
      return true;
    }

    if (method === "POST" && path === "/api/cart/items") {
      const s = requireApi();
      if (!s) return true;
      if (!csrfHeaderOk(s)) {
        json(403, { error: "bad_csrf" });
        return true;
      }
      let body: { sku?: unknown; qty?: unknown };
      try {
        body = JSON.parse(await readBody(req)) as typeof body;
      } catch {
        json(400, { error: "bad_json" });
        return true;
      }
      const p = typeof body.sku === "string" ? bySku.get(body.sku) : undefined;
      if (!p) {
        json(404, { error: "unknown_sku" });
        return true;
      }
      const qty = body.qty ?? 1;
      if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 99) {
        json(400, { error: "bad_qty" });
        return true;
      }
      const cart = cartOf(s.email);
      const line = cart.find((l) => l.sku === p.sku);
      if (line) line.qty = Math.min(99, line.qty + qty);
      else cart.push({ sku: p.sku, qty });
      const v = cartView(s.email);
      json(201, { items: v.lines, count: v.count, total: v.total, currency: "GBP" });
      return true;
    }

    const removeMatch = /^\/api\/cart\/items\/([^/]+)$/.exec(path);
    if (method === "DELETE" && removeMatch?.[1]) {
      const s = requireApi();
      if (!s) return true;
      if (!csrfHeaderOk(s)) {
        json(403, { error: "bad_csrf" });
        return true;
      }
      const sku = decodeURIComponent(removeMatch[1]);
      const cart = cartOf(s.email);
      const i = cart.findIndex((l) => l.sku === sku);
      if (i >= 0) cart.splice(i, 1);
      const v = cartView(s.email);
      json(200, { items: v.lines, count: v.count, total: v.total, currency: "GBP" });
      return true;
    }

    if (method === "POST" && path === "/checkout") {
      const s = requirePage();
      if (!s) return true;
      const body = await form();
      if (body.get("csrf_token") !== s.csrf) {
        html(403, notFoundPage(ctx).replace("Not found", "Forbidden"));
        return true;
      }
      const delivery = body.get("delivery") ?? "standard";
      if (!Object.hasOwn(DELIVERY_OPTIONS, delivery)) {
        html(400, notFoundPage(ctx).replace("Not found", "Unknown delivery option"));
        return true;
      }
      const cart = cartOf(s.email);
      if (cart.length === 0) {
        html(400, notFoundPage(ctx).replace("Not found", "Your basket is empty"));
        return true;
      }
      const opt = delivery as DeliveryOption;
      const items = Number(cartView(s.email).total);
      const order: Order = {
        id: nextOrderId++,
        email: s.email,
        lines: cart.map((l) => ({ ...l })),
        delivery: opt,
        total: money(items + Number(DELIVERY_OPTIONS[opt].cost)),
        createdAt: stamp(),
      };
      state.orders.push(order);
      cart.length = 0;
      redirect(303, `/orders/${order.id}`);
      return true;
    }

    if (method === "POST" && path === "/api/token") {
      const body = await form();
      const email = body.get("username") ?? "";
      const u = USERS.find((x) => x.email === email && x.password === body.get("password"));
      state.logins.push({ email, success: Boolean(u), via: "token", at: stamp() });
      if (!u) json(401, { error: "invalid_grant" });
      else json(200, issueTokens(u.email));
      return true;
    }

    if (method === "POST" && path === "/api/token/refresh") {
      const body = await form();
      const refresh = body.get("refresh_token") ?? "";
      const email = refreshTokens.get(refresh);
      if (!email) {
        json(401, { error: "invalid_grant" });
        return true;
      }
      refreshTokens.delete(refresh);
      json(200, issueTokens(email));
      return true;
    }

    return false;
  }

  const server = createServer((req, res) => {
    const method = req.method ?? "GET";
    const cookies = parseCookies(req.headers.cookie);
    const signedIn = Boolean(cookies.sid && sessions.has(cookies.sid));
    res.on("finish", () => {
      state.requests.push({
        method,
        url: req.url ?? "/",
        status: res.statusCode,
        signedIn,
        at: stamp(),
      });
    });
    handle(req, res)
      .then((handled) => {
        if (handled) return;
        if ((req.url ?? "").startsWith("/api/")) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not_found" }));
        } else {
          res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
          res.end(notFoundPage({ cartCount: 0 }));
        }
      })
      .catch((err: unknown) => {
        const status = err instanceof HttpError ? err.status : 500;
        if (!res.headersSent) res.writeHead(status, { "content-type": "text/plain" });
        res.end(err instanceof HttpError ? err.message : "Internal error");
      });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  origin = `http://${addr.family === "IPv6" ? `[${addr.address}]` : addr.address}:${addr.port}`;

  return {
    url: origin,
    state,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
