// AUTHORED-BY Codex GPT-6
import { request } from "node:http";
import { expect, it } from "vitest";
import { startShop } from "../src/index.js";

it("exposes the signed-in basket plus delivery as a fresh checkout total", async () => {
  const shop = await startShop();
  const transport = (path: string, method = "GET", data = "", headers = {}) =>
    new Promise<{ status: number; text: string; cookies: string[] }>((resolve, reject) => {
      const req = request(`${shop.url}${path}`, { method, headers }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text, cookies: res.headers["set-cookie"] ?? [] }),
        );
      });
      req.on("error", reject);
      req.end(data);
    });
  try {
    expect((await transport("/api/checkout")).status).toBe(401);
    const login = await transport("/login");
    const csrf = /name="csrf_token" value="([^"]+)"/.exec(login.text)?.[1] ?? "";
    const signedIn = await transport(
      "/login",
      "POST",
      new URLSearchParams({
        username: "alex@example.test",
        password: "correct-horse",
        csrf_token: csrf,
      }).toString(),
      {
        cookie: login.cookies.map((c) => c.split(";")[0]).join("; "),
        "content-type": "application/x-www-form-urlencoded",
      },
    );
    expect(signedIn.status).toBe(303);
    const cookie = signedIn.cookies.map((c) => c.split(";")[0]).join("; ");
    const token =
      signedIn.cookies
        .find((c) => c.startsWith("csrf="))
        ?.split(";")[0]
        ?.slice(5) ?? "";
    const added = await transport(
      "/api/cart/items",
      "POST",
      JSON.stringify({ sku: "SNK-TRAIL-01", qty: 1 }),
      { cookie, "x-csrf-token": token, "content-type": "application/json" },
    );
    expect(added.status).toBe(201);
    const total = await transport("/api/checkout?delivery=standard", "GET", "", { cookie });
    expect(JSON.parse(total.text)).toEqual({
      url: `${shop.url}/checkout`,
      totalPaymentDue: "20.00",
      currency: "GBP",
    });
    const express = await transport("/api/checkout?delivery=express", "GET", "", { cookie });
    expect(JSON.parse(express.text).totalPaymentDue).toBe("24.99");
    expect((await transport("/api/checkout?delivery=unknown", "GET", "", { cookie })).status).toBe(
      400,
    );
    expect(shop.state.orders).toHaveLength(0);
  } finally {
    await shop.close();
  }
});
