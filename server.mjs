// Local run without Netlify: node server.mjs  ->  http://localhost:8080
// Serves ./public and the same /api/midas proxy the Netlify function provides. Needs Node 18+, no npm install.
// Optional password, as on Netlify: APP_PASSWORD=... node server.mjs (Windows: set APP_PASSWORD=... then node server.mjs)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { relay } from "./proxy.mjs";
import { gate } from "./auth.mjs";
globalThis.crypto ??= webcrypto; // Node 18: crypto.subtle for the password gate

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const PORT = +process.env.PORT || 8080;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };

http.createServer(async (req, res) => {
  try {
    const chunks = []; if (req.method === "PUT" || req.method === "POST") for await (const c of req) chunks.push(c); // rebar sent to Gen NX, the login form
    const request = () => new Request("http://" + (req.headers.host || "localhost") + req.url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
    const send = async r => { const h = {}; r.headers.forEach((v, k) => { h[k] = k === "set-cookie" ? r.headers.getSetCookie?.() || v : v; }); res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer())); };
    const g = await gate(request(), process.env.APP_PASSWORD, process.env.APP_SECRET);
    if (g) return send(g);
    if (req.url.startsWith("/api/midas/")) {
      const r = await relay(request());
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
    if (!p || p.endsWith("/")) p += "index.html";
    const file = join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache" }); // always pick up updated files
    res.end(body);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
}).listen(PORT, () => console.log(`Gen NX Sketch on http://localhost:${PORT}`));
