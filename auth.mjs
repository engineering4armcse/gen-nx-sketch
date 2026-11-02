// Password gate, shared by the Netlify edge function (netlify/edge-functions/auth.js) and the local server (server.mjs).
// Set APP_PASSWORD (Netlify: Site configuration > Environment variables) to require it; without it the app is open.
// After the right password the browser keeps a signed cookie for 30 days. Changing APP_PASSWORD (or APP_SECRET) logs
// everyone out. Only web standard APIs (crypto.subtle, Request, Response), so it runs on Deno and Node 18+.
const COOKIE = "gnx_auth", FLAG = "gnx_login", DAYS = 30;
const enc = new TextEncoder();

async function token(password, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password + "\u0000" + (secret || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("gen-nx-sketch login v1"));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
// compare without stopping at the first different character
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const cookieOf = (req, name) => (req.headers.get("cookie") || "").split(/;\s*/).map(c => c.split("=")).find(([k]) => k === name)?.[1] || "";
const safeNext = n => (typeof n === "string" && /^\/(?!\/)[^\s]*$/.test(n) ? n : "/");

function page(next, error) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gen NX Sketch · Log in</title><meta name="robots" content="noindex"><link rel="icon" href="/logo.svg" type="image/svg+xml">
<style>
:root{--bg:#f4f2ee;--panel:#fff;--ink:#22262b;--ink-2:#5d636b;--line:#d9d5ce;--accent:#b33a2e}
@media (prefers-color-scheme:dark){:root{--bg:#15181b;--panel:#1d2125;--ink:#e8e6e1;--ink-2:#a3a7ad;--line:#33383e}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
form{width:min(360px,100%);background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:28px 24px}
img{display:block;margin:0 auto 10px}h1{font-size:20px;text-align:center;margin:0 0 4px}p{margin:0 0 18px;text-align:center;color:var(--ink-2);font-size:13.5px}
label{display:block;font-size:13px;color:var(--ink-2);margin-bottom:6px}
input{width:100%;height:44px;padding:0 12px;font-size:16px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--ink)}
input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button{width:100%;height:44px;margin-top:14px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-size:15px;font-weight:600;cursor:pointer}
.err{color:var(--accent);margin:10px 0 0;text-align:left}
</style></head><body>
<form method="post" action="/login"><img src="/logo.svg" width="56" height="56" alt=""><h1>Gen NX Sketch</h1><p>Enter the team password.</p>
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<input type="hidden" name="next" value="${esc(next)}">
<button type="submit">Log in</button>${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
</form></body></html>`;
}
const html = (body, status = 200, headers = {}) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers } });
const cookies = (value, maxAge, secure) => {
  const s = secure ? "; Secure" : "";
  return [`${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${s}`, `${FLAG}=${maxAge ? 1 : ""}; Path=/; Max-Age=${maxAge}; SameSite=Lax${s}`];
};
const redirect = (to, setCookies) => { const h = new Headers({ location: to, "cache-control": "no-store" }); for (const c of setCookies) h.append("set-cookie", c); return new Response(null, { status: 303, headers: h }); };

// -> a Response (login page, redirect, 401), or null when the request may go on to the app
export async function gate(req, password, secret) {
  if (!password) return null;
  const url = new URL(req.url), secure = url.protocol === "https:";
  if (url.pathname === "/logo.svg") return null; // the login page shows it
  if (url.pathname === "/logout") return redirect("/login", cookies("", 0, secure));
  const want = await token(password, secret);
  if (url.pathname === "/login" && req.method === "POST") {
    const f = await req.formData().catch(() => null), next = safeNext(f?.get("next"));
    if (f && same(String(f.get("password") || ""), password)) return redirect(next, cookies(want, DAYS * 86400, secure));
    await new Promise(r => setTimeout(r, 800)); // slows down guessing
    return html(page(next, "Wrong password."), 401);
  }
  if (same(cookieOf(req, COOKIE), want)) return url.pathname === "/login" ? redirect("/", []) : null;
  if (url.pathname.startsWith("/api/")) return new Response(JSON.stringify({ error: { message: "Log in first (the session ended). Reload the page." } }), { status: 401, headers: { "content-type": "application/json" } });
  return html(page(url.pathname === "/login" ? "/" : url.pathname + url.search), 200);
}
