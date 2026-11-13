// AUTHORED-BY Claude Opus 5.5
import { startShop } from "@jeswr/test-shop";
import { describe, expect, it } from "vitest";
import { analyseScript } from "../src/scripts.js";

const SCRIPT = "https://shop.test/static/app.js";

describe("analyseScript", () => {
  it("finds the test shop bundle's calls through its fetch wrapper and cookie reader", async () => {
    const shop = await startShop();
    try {
      const js = await (await fetch(`${shop.url}/static/app.js`)).text();
      const { calls, error } = analyseScript(js, `${shop.url}/static/app.js`);
      expect(error).toBeUndefined();
      const summary = calls.map((c) => `${c.method} ${c.urlPattern.replace(shop.url, "")}`);
      expect(summary).toEqual(
        expect.arrayContaining([
          "GET /api/products/{id}",
          "POST /api/cart/items",
          "DELETE /api/cart/items/{sku}",
          "GET /api/search?q={q}&page={page}",
          "GET /api/me",
          "POST /api/token/refresh",
          "POST /api/token",
        ]),
      );
      const add = calls.find(
        (c) => c.method === "POST" && c.urlPattern.endsWith("/api/cart/items"),
      );
      expect(add).toMatchObject({
        via: "wrapper:a",
        bodyKind: "json",
        bodyKeys: ["sku", "qty"],
        headers: { "Content-Type": "application/json" },
        csrf: [
          {
            source: { kind: "cookie", name: "csrf" },
            target: { kind: "header", name: "X-CSRF-Token" },
          },
        ],
      });
      const del = calls.find((c) => c.method === "DELETE");
      expect(del?.csrf).toHaveLength(1);
      expect(calls.find((c) => c.urlPattern.endsWith("/api/me"))?.authScheme).toBe("Bearer");
      expect(calls.find((c) => c.urlPattern.endsWith("/api/token/refresh"))).toMatchObject({
        bodyKind: "form",
        bodyKeys: ["refresh_token"],
      });
      // The wrapper's own fetch(e, ...) has no literal URL and is not reported.
      expect(calls.every((c) => c.urlPattern.startsWith(shop.url))).toBe(true);
    } finally {
      await shop.close();
    }
  });

  it("handles direct fetch, template literals, constants and window.fetch", () => {
    const { calls } = analyseScript(
      `const BASE = "/api/v2"; let mutable = "/nope";
       fetch("/a");
       window.fetch(\`/items/\${item.id}/reviews?sort=new&limit=\${n}\`, { method: "put", body: "x" });
       fetch(BASE + "/orders", { method: "POST", headers: { "X-Requested-With": "XMLHttpRequest" }, body: JSON.stringify({ ...extra, note }) });
       fetch(mutable);
       fetch(url);
       fetch("https://other.example/track", { method: "POST" });`,
      SCRIPT,
    );
    expect(calls.map((c) => `${c.method} ${c.urlPattern}`)).toEqual([
      "GET https://shop.test/a",
      "PUT https://shop.test/items/{id}/reviews?sort=new&limit={limit}",
      "POST https://shop.test/api/v2/orders",
    ]);
    expect(calls[1]?.bodyKind).toBe("text");
    expect(calls[2]).toMatchObject({
      headers: { "X-Requested-With": "XMLHttpRequest" },
      bodyKeys: ["note"],
    });
  });

  it("reads XMLHttpRequest, axios and jQuery calls", () => {
    const { calls } = analyseScript(
      `function token(){ return document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/)[1]; }
       const x = new XMLHttpRequest();
       x.open("POST", "/api/comments");
       x.setRequestHeader("X-XSRF-TOKEN", token());
       x.setRequestHeader("Content-Type", "application/json");
       x.send(JSON.stringify({ text: t, postId: p }));
       axios.get("/api/feed?page=" + page);
       axios.post("/api/like", { id: 1 }, { headers: { "X-CSRF": document.querySelector('meta[name="csrf-token"]').content } });
       axios({ url: "/api/raw", method: "patch" });
       axios.request({ url: "/api/req", method: "DELETE" });
       axios("/api/plain");
       $.ajax({ url: "/legacy/save", type: "POST", data: { a: 1 } });
       $.get("/legacy/list");
       $.post("/legacy/post", { b: 2 });
       x.open("BREW", "/coffee");`,
      SCRIPT,
    );
    const byUrl = Object.fromEntries(
      calls.map((c) => [c.urlPattern.replace("https://shop.test", ""), c]),
    );
    expect(byUrl["/api/comments"]).toMatchObject({
      method: "POST",
      via: "xhr",
      bodyKind: "json",
      bodyKeys: ["text", "postId"],
      csrf: [
        {
          source: { kind: "cookie", name: "XSRF-TOKEN" },
          target: { kind: "header", name: "X-XSRF-TOKEN" },
        },
      ],
    });
    expect(byUrl["/api/feed?page={page}"]?.method).toBe("GET");
    expect(byUrl["/api/like"]).toMatchObject({
      method: "POST",
      bodyKeys: ["id"],
      csrf: [
        {
          source: { kind: "meta", name: "csrf-token" },
          target: { kind: "header", name: "X-CSRF" },
        },
      ],
    });
    expect(byUrl["/api/raw"]?.method).toBe("PATCH");
    expect(byUrl["/api/req"]?.method).toBe("DELETE");
    expect(byUrl["/api/plain"]?.method).toBe("GET");
    expect(byUrl["/legacy/save"]).toMatchObject({ method: "POST", bodyKeys: ["a"] });
    expect(byUrl["/legacy/list"]?.method).toBe("GET");
    expect(byUrl["/legacy/post"]).toMatchObject({
      method: "POST",
      bodyKind: "form",
      bodyKeys: ["b"],
    });
    expect(byUrl["/coffee"]).toBeUndefined();
  });

  it("follows wrappers of wrappers and FormData bodies", () => {
    const { calls } = analyseScript(
      `const req = (u, o) => fetch(u, o);
       function api(path, opts) { return req(path, Object.assign({ credentials: "include" }, opts)); }
       api("/api/upload", { method: "POST", body: new FormData(form) });`,
      SCRIPT,
    );
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        urlPattern: "https://shop.test/api/upload",
        bodyKind: "multipart",
        via: "wrapper:api",
      }),
    ]);
  });

  it("reports parse errors instead of throwing", () => {
    const r = analyseScript("function (", SCRIPT);
    expect(r.calls).toEqual([]);
    expect(r.error).toMatch(/could not parse/);
  });

  it("parses classic scripts that are not valid modules", () => {
    const { calls } = analyseScript(`with (obj) { fetch("/legacy"); }`, SCRIPT);
    expect(calls).toHaveLength(1);
  });
});
