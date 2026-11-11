// If the app script fails to start (usually a file that was not updated with the others, or old cached files after an
// update), say what went wrong instead of doing nothing. Checked when the page has finished loading, not after a fixed
// time, so a slow connection is not reported as a failure.
window.__bootErrors = [];
addEventListener("error", e => {
  const src = e.target && e.target !== window && (e.target.src || e.target.href);
  window.__bootErrors.push(src ? `could not load ${src.split("/").pop()}` : `${e.message || "error"}${e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : ""}`);
}, true);
addEventListener("unhandledrejection", e => window.__bootErrors.push(String(e.reason?.message || e.reason)));
// every file the app needs; one missing (or an older index.html next to a newer app.js) stops the whole app
const APP_FILES = ["index.html", "style.css", "app.js", "core.js", "rebar.js", "design.js", "render.js", "viewer3d.js", "shop.js", "bbs.js", "bundle.js", "zip.js", "project.js", "demo.js", "changelog.js"];
addEventListener("load", () => setTimeout(async () => {
  if (window.__appReady) return;
  const s = document.getElementById("status");
  if (!s) return;
  s.className = "status err";
  s.textContent = "The app did not start. Checking its files…";
  let missing = [];
  if (location.protocol.startsWith("http")) {
    const res = await Promise.all(APP_FILES.map(f => fetch(f, { cache: "no-store" }).then(r => (r.ok ? null : `${f} (HTTP ${r.status})`), () => `${f} (not reachable)`)));
    missing = res.filter(Boolean);
  }
  if (window.__appReady) { s.className = "status"; s.textContent = ""; return; }
  const errs = [...new Set(window.__bootErrors)].slice(0, 3);
  s.textContent = "The app did not start. " +
    (missing.length ? `Missing file(s): ${missing.join(", ")}. Copy all files of the public folder again (the app needs every one of them). ` : "") +
    (errs.length ? `Error: ${errs.join("; ")}. ` : "") +
    "Press Ctrl+F5 to reload; if you run it with node server.mjs, update the whole folder and restart it.";
}, 300));
