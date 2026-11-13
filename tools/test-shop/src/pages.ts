// AUTHORED-BY Claude Opus 5.5
// Server-rendered HTML for the fictional shop. Every interpolated value goes through esc().

import { DELIVERY_OPTIONS, type Product } from "./data.js";

export function esc(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface PageContext {
  /** Signed-in user's display name, when there is a session. */
  userName?: string;
  /** The session's CSRF token, for the sign-out form. */
  csrf?: string;
  cartCount: number;
}

export function layout(title: string, body: string, ctx: PageContext): string {
  const account = ctx.userName
    ? `<a href="/account">Account</a>
      <form method="post" action="/logout" class="sign-out"><input type="hidden" name="csrf_token" value="${esc(ctx.csrf ?? "")}"><button type="submit">Sign out</button></form>`
    : `<a href="/login">Sign in</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)} | shop.test</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<header>
  <nav>
    <a href="/" class="brand">shop.test</a>
    <a href="/search">Search</a>
    <a href="/cart">Basket (<span id="cart-count">${ctx.cartCount}</span>)</a>
    <a href="/orders">Orders</a>
    <a href="/help/delivery">Delivery</a>
    ${account}
  </nav>
  <form method="get" action="/search" class="search-form" role="search">
    <label for="q">Search</label>
    <input id="q" name="q" type="search" placeholder="Search products">
    <button type="submit">Go</button>
  </form>
</header>
<main>
${body}
</main>
<script src="/static/app.js" defer></script>
</body>
</html>`;
}

function priceSpan(p: Pick<Product, "price" | "currency">): string {
  return `<span class="price" data-price="${esc(p.price)}" data-currency="${esc(p.currency)}">£${esc(p.price)}</span>`;
}

export function productCard(p: Product): string {
  return `<li class="product-card" data-product-id="${p.id}" data-sku="${esc(p.sku)}">
    <a class="product-link" href="/product/${p.id}">${esc(p.name)}</a>
    ${priceSpan(p)}
  </li>`;
}

export function homePage(featured: Product[], ctx: PageContext): string {
  return layout(
    "Home",
    `<h1>Welcome to shop.test</h1>
<p>Outdoor kit for walkers and runners.</p>
<section class="featured">
  <h2>Featured</h2>
  <ul class="product-list">
    ${featured.map(productCard).join("\n    ")}
  </ul>
</section>`,
    ctx,
  );
}

export function searchPage(
  q: string,
  page: number,
  items: Product[],
  total: number,
  pageSize: number,
  ctx: PageContext,
): string {
  const more = page * pageSize < total;
  const results = q
    ? `<p class="summary">${total} results for "${esc(q)}"</p>
<ul id="results" class="product-list">
  ${items.map(productCard).join("\n  ")}
</ul>
${more ? `<a class="next-page" href="/search?q=${encodeURIComponent(q)}&amp;page=${page + 1}">Next page</a>` : ""}
${more ? `<button id="load-more" type="button" data-q="${esc(q)}" data-page="${page}">Load more</button>` : ""}`
    : `<p>Type a word to search the catalogue.</p>`;
  return layout(q ? `Search: ${q}` : "Search", `<h1>Search</h1>\n${results}`, ctx);
}

export function productPage(p: Product, ctx: PageContext): string {
  const reviews = p.reviews
    .map(
      (r) => `<article class="review">
    <span class="author">${esc(r.author)}</span>
    <span class="rating">${r.rating}/5</span>
    <p class="review-body">${esc(r.body)}</p>
  </article>`,
    )
    .join("\n  ");
  return layout(
    p.name,
    `<div class="product" data-product-id="${p.id}">
  <h1 class="product-name">${esc(p.name)}</h1>
  ${priceSpan(p)}
  <p class="sku">SKU: <code>${esc(p.sku)}</code></p>
  <p class="description">${esc(p.description)}</p>
  <p id="stock"></p>
  <label for="qty">Quantity</label>
  <input id="qty" type="number" min="1" max="99" value="1">
  <button id="add-to-cart" type="button" data-sku="${esc(p.sku)}">Add to basket</button>
  <p id="cart-status" role="status"></p>
</div>
<section class="reviews">
  <h2>Reviews</h2>
  ${reviews}
</section>`,
    ctx,
  );
}

export function loginPage(csrf: string, ctx: PageContext, error?: string, next?: string): string {
  return layout(
    "Sign in",
    `<h1>Sign in</h1>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<form method="post" action="/login" id="login-form">
  <input type="hidden" name="csrf_token" value="${esc(csrf)}">
  ${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ""}
  <label for="username">Email</label>
  <input id="username" name="username" type="email" autocomplete="username" required>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>
</form>`,
    ctx,
  );
}

export function accountPage(name: string, email: string, ctx: PageContext): string {
  return layout(
    "Your account",
    `<h1>Your account</h1>
<dl class="account"><dt>Name</dt><dd class="name">${esc(name)}</dd><dt>Email</dt><dd class="email">${esc(email)}</dd></dl>
<p><a href="/orders">Your orders</a></p>`,
    ctx,
  );
}

export interface CartView {
  sku: string;
  name: string;
  qty: number;
  price: string;
}

export function cartPage(lines: CartView[], total: string, ctx: PageContext): string {
  const rows = lines
    .map(
      (l) =>
        `<li class="cart-line" data-sku="${esc(l.sku)}"><span class="name">${esc(l.name)}</span> x <span class="qty">${l.qty}</span> <span class="price">£${esc(l.price)}</span> <button type="button" data-remove-sku="${esc(l.sku)}">Remove</button></li>`,
    )
    .join("\n  ");
  return layout(
    "Basket",
    `<h1>Basket</h1>
${lines.length ? `<ul class="cart">\n  ${rows}\n</ul>\n<p class="total">Total £${esc(total)}</p>\n<a href="/checkout" class="checkout-link">Checkout</a>` : "<p>Your basket is empty.</p>"}`,
    ctx,
  );
}

export function checkoutPage(
  csrf: string,
  lines: CartView[],
  total: string,
  ctx: PageContext,
): string {
  const options = Object.entries(DELIVERY_OPTIONS)
    .map(
      ([value, o], i) =>
        `<option value="${value}"${i === 0 ? " selected" : ""}>${esc(o.label)} (£${o.cost})</option>`,
    )
    .join("");
  return layout(
    "Checkout",
    `<h1>Checkout</h1>
<ul class="summary">${lines.map((l) => `<li>${esc(l.name)} x ${l.qty}</li>`).join("")}</ul>
<p class="total">Items £${esc(total)}</p>
<form method="post" action="/checkout" id="checkout-form">
  <input type="hidden" name="csrf_token" value="${esc(csrf)}">
  <label for="delivery">Delivery</label>
  <select id="delivery" name="delivery">${options}</select>
  <button type="submit" id="place-order">Place order</button>
</form>`,
    ctx,
  );
}

export interface OrderView {
  id: number;
  total: string;
  delivery: string;
  createdAt: string;
  lines: CartView[];
}

export function ordersPage(orders: OrderView[], ctx: PageContext): string {
  return layout(
    "Your orders",
    `<h1>Your orders</h1>
${orders.length ? `<ul class="orders">${orders.map((o) => `<li class="order" data-order-id="${o.id}"><a href="/orders/${o.id}">Order ${o.id}</a> <span class="price">£${esc(o.total)}</span></li>`).join("")}</ul>` : "<p>No orders yet.</p>"}`,
    ctx,
  );
}

export function orderPage(order: OrderView, ctx: PageContext): string {
  return layout(
    `Order ${order.id}`,
    `<h1>Order <span class="order-id">${order.id}</span></h1>
<p class="status">Confirmed</p>
<ul class="lines">${order.lines.map((l) => `<li data-sku="${esc(l.sku)}">${esc(l.name)} x ${l.qty}</li>`).join("")}</ul>
<p>Delivery: <span class="delivery">${esc(order.delivery)}</span></p>
<p class="total">Total <span class="price">£${esc(order.total)}</span></p>`,
    ctx,
  );
}

export function deliveryHelpPage(ctx: PageContext): string {
  return layout(
    "Delivery",
    `<h1>Delivery and returns</h1>
<p>Standard delivery is free. Express delivery costs £4.99 and arrives the next working day.</p>
<p>Return anything unused within 30 days.</p>`,
    ctx,
  );
}

export function notFoundPage(ctx: PageContext): string {
  return layout("Not found", "<h1>Not found</h1><p>That page does not exist.</p>", ctx);
}
