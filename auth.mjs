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
<title>Gen NX Sketch · Log in</title><meta name="robots" content="noindex"><meta name="theme-color" content="#111417"><link rel="icon" href="/logo.svg" type="image/svg+xml">
<style>
@font-face{font-family:"Geist";font-weight:400;font-display:swap;src:url(/vendor/fonts/geist-sans-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:"Geist";font-weight:600;font-display:swap;src:url(/vendor/fonts/geist-sans-latin-600-normal.woff2) format("woff2")}
/* the app's start page colours (public/style.css): ink frame, safety-yellow main action */
:root{--frame:#111417;--frame-2:#1b1f24;--frame-line:#363c44;--frame-text:#f1f2f4;--frame-text-2:#a3abb5;--accent:#ffcf1a;--accent-2:#ffdc52;--accent-ink:#111417;--err-dark:#ff9e9a;--r:4px;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:32px 16px;background:var(--frame);color:var(--frame-text);font:15px/1.45 "Geist",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
form{width:100%;max-width:440px;display:flex;flex-direction:column}
img{display:block;align-self:center}h1{margin:20px 0 8px;font-size:40px;line-height:1;font-weight:600;letter-spacing:-.035em;text-align:center}p{margin:0 0 32px;text-align:center;color:var(--frame-text-2);font-size:14px}
label{font-size:13px;color:var(--frame-text-2)}
input{width:100%;height:44px;margin-top:6px;padding:0 12px;font:inherit;font-size:16px;border:1px solid var(--frame-line);border-radius:var(--r);background:var(--frame-2);color:var(--frame-text)}
input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px #ffcf1a66}
button{height:48px;margin-top:18px;border:0;border-radius:var(--r);background:var(--accent);color:var(--accent-ink);font:inherit;font-size:15px;font-weight:600;cursor:pointer;transition:background .15s}
button:hover{background:var(--accent-2)}button:active{transform:scale(.98)}
button:focus-visible{outline:2px solid var(--frame-text);outline-offset:2px}
.err{color:var(--err-dark);margin:14px 0 0;text-align:left}
</style></head><body>
<form method="post" action="/login"><img src="/logo.svg" width="64" height="64" alt=""><h1>Gen NX Sketch</h1><p>Enter the team password.</p>
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
  if (url.pathname === "/logo.svg" || /^\/vendor\/fonts\/[\w.-]+\.woff2$/.test(url.pathname)) return null; // the login page shows the logo in the app's font
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
