// AUTHORED-BY Claude Opus 5.5
// Static assets. APP_JS is written the way a small production bundle looks (short names, a fetch
// wrapper, a cookie reader) so the profiler's script analysis meets realistic code, not a toy.

export const APP_JS = `/*! shop.test storefront bundle v1.4.2 */
(()=>{"use strict";const c=n=>{const m=document.cookie.split(/;\\s*/).find(p=>p.startsWith(n+"="));return m?decodeURIComponent(m.slice(n.length+1)):""},$=s=>document.querySelector(s),h={"Content-Type":"application/json"};
function a(e,t){return fetch(e,Object.assign({credentials:"same-origin"},t)).then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.json()})}
const p=$("[data-product-id]");p&&a("/api/products/"+p.dataset.productId).then(d=>{const s=$("#stock");s&&(s.textContent=d.stock>0?d.stock+" in stock":"Out of stock")});
const b=$("#add-to-cart");b&&b.addEventListener("click",()=>{const q=parseInt($("#qty").value,10)||1;a("/api/cart/items",{method:"POST",headers:Object.assign({},h,{"X-CSRF-Token":c("csrf")}),body:JSON.stringify({sku:b.dataset.sku,qty:q})}).then(d=>{$("#cart-count").textContent=String(d.count);$("#cart-status").textContent="Added to basket"}).catch(e=>{$("#cart-status").textContent="Could not add: "+e.message})});
document.querySelectorAll("[data-remove-sku]").forEach(x=>x.addEventListener("click",()=>{a("/api/cart/items/"+encodeURIComponent(x.dataset.removeSku),{method:"DELETE",headers:{"X-CSRF-Token":c("csrf")}}).then(()=>location.reload())}));
const m=$("#load-more");m&&m.addEventListener("click",()=>{const n=Number(m.dataset.page)+1;a("/api/search?q="+encodeURIComponent(m.dataset.q)+"&page="+n).then(d=>{const l=$("#results");d.items.forEach(i=>{const e=document.createElement("li");e.className="product-card";e.textContent=i.name+" "+i.price;l.appendChild(e)});m.dataset.page=String(d.page);d.page*5>=d.total&&m.remove()})});
const t={get:()=>localStorage.getItem("shop.rt"),set:d=>{localStorage.setItem("shop.at",d.access_token);localStorage.setItem("shop.rt",d.refresh_token)}};
window.shopApi={me:()=>fetch("/api/me",{headers:{Authorization:"Bearer "+localStorage.getItem("shop.at")}}).then(r=>r.json()),refresh:()=>fetch("/api/token/refresh",{method:"POST",body:new URLSearchParams({refresh_token:t.get()})}).then(r=>r.json()).then(t.set),token:(u,w)=>fetch("/api/token",{method:"POST",body:new URLSearchParams({username:u,password:w})}).then(r=>r.json()).then(t.set)};
})();
`;

export const STYLE_CSS = `body{font-family:system-ui,sans-serif;margin:0;color:#1d1d1f}
header nav{display:flex;gap:1rem;padding:.75rem 1rem;background:#f4f4f6}
main{padding:1rem;max-width:60rem;margin:auto}
.product-card{list-style:none;padding:.5rem 0;border-bottom:1px solid #ddd}
.price{font-weight:600}
`;
