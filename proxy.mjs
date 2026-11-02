// Shared by the Netlify function and the local server.
export const DEFAULT_BASE = "https://moa-engineers.midasit.com:443/gen";
// Only MIDAS hosts are relayed, so the proxy cannot be used to reach arbitrary sites.
// Add more with the ALLOWED_HOSTS env var, e.g. "localhost,192.168.1.20" for a local Gen NX.
const allowedHost = h => h === "midasit.com" || h.endsWith(".midasit.com") ||
  (process.env.ALLOWED_HOSTS || "").split(",").map(s => s.trim()).filter(Boolean).includes(h);

const reply = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-midas-proxy": "1" },
});

// Reads any /db/<TABLE>; writes (PUT) only the rebar tables, for "Send rebar edits to Gen NX".
const WRITABLE = new Set(["/db/REBB", "/db/REBC"]);
export async function relay(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/api\/midas/, "");
  if (!/^\/db\/[A-Za-z0-9_]+$/.test(path)) return reply(400, { error: { message: "Only /db/<TABLE> is relayed" } });
  if (req.method !== "GET" && !(req.method === "PUT" && WRITABLE.has(path))) return reply(405, { error: { message: "Only GET, and PUT on /db/REBB and /db/REBC, are relayed" } });
  const key = req.headers.get("mapi-key");
  if (!key) return reply(400, { error: { message: "Missing MAPI-Key" } });
  let base;
  try { base = new URL(req.headers.get("x-midas-base") || DEFAULT_BASE); } catch { return reply(400, { error: { message: "Bad base URL" } }); }
  if (!/^https?:$/.test(base.protocol) || !allowedHost(base.hostname)) return reply(403, { error: { message: `Host ${base.hostname} is not allowed` } });
  try {
    const r = await fetch(base.href.replace(/\/+$/, "") + path, { method: req.method, headers: { "MAPI-Key": key, "Content-Type": "application/json" }, body: req.method === "PUT" ? await req.text() : undefined });
    return reply(r.status, await r.text());
  } catch (e) {
    return reply(502, { error: { message: "Could not reach MIDAS API: " + e.message } });
  }
}
