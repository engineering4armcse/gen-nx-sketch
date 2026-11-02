// Builds Gen-NX-Sketch-local.html: the whole app in one file that opens by double-click (file://), no server, works offline.
//   node build-local.mjs
// Browsers refuse ES modules from file://, so the modules travel as text and are loaded as blob: modules at start;
// The libraries travel as text too (three.js / OrbitControls for the 3D view and the HTML export, jsPDF run once at start).
// Everything is a JSON string with "<" escaped, so no library text can end or confuse the page's <script> blocks.
// Without the local server there is no API proxy: Load model from Gen NX calls the API directly (works only if the
// API allows it); Open JSON and the demo model always work.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url)), PUB = join(ROOT, "public");
const read = f => readFileSync(join(PUB, f), "utf8");
const js = v => JSON.stringify(v).replace(/</g, "\\u003c"); // safe inside <script>

// modules in dependency order (each one after the modules it imports)
const mods = Object.fromEntries(readdirSync(PUB).filter(f => f.endsWith(".js")).map(f => [f, read(f)]));
const deps = f => [...mods[f].matchAll(/from\s+"\.\/([\w.-]+\.js)"/g)].map(m => m[1]);
const order = [], seen = new Set(), visit = f => { if (seen.has(f)) return; seen.add(f); deps(f).forEach(visit); order.push(f); };
visit("app.js");

const loader = `
window.__GNX_VENDOR = ${js(Object.fromEntries(["three.min.js", "OrbitControls.js", "jspdf.umd.min.js"].map(f => ["vendor/" + f, read("vendor/" + f)])))};
(0, eval)(window.__GNX_VENDOR["vendor/jspdf.umd.min.js"]); // global scope, defines window.jspdf
(async () => {
  const M = ${js(Object.fromEntries(order.map(f => [f, mods[f]])))}, order = ${js(order)}, url = {};
  for (const f of order) url[f] = URL.createObjectURL(new Blob([M[f].replace(/from\\s+"\\.\\/([\\w.-]+\\.js)"/g, (m, d) => 'from "' + url[d] + '"')], { type: "text/javascript" }));
  await import(url["app.js"]);
})().catch(e => { const s = document.getElementById("status"); if (s) { s.className = "status err"; s.textContent = "The app did not start: " + e.message; } });
`;

// fonts go in as data: URIs so the file still needs nothing next to it
const css = read("style.css").replace(/url\((vendor\/fonts\/[\w.-]+\.woff2)\)/g, (m, f) => `url(data:font/woff2;base64,${readFileSync(join(PUB, f)).toString("base64")})`);
// logo, icon sprite and the start-up check live in their own files next to index.html; here they go into the page
const logo = "data:image/svg+xml;base64," + readFileSync(join(PUB, "logo.svg")).toString("base64");
const sprite = read("icons.svg").replace("<svg ", '<svg style="display:none" aria-hidden="true" ');
let html = read("index.html")
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}</style>`)
  .replace('<script src="boot.js"></script>', () => `<script>\n${read("boot.js")}</script>`)
  .replaceAll('"logo.svg"', () => `"${logo}"`)
  .replaceAll('href="icons.svg#', 'href="#')
  .replace("<body>", () => `<body>\n${sprite}`)
  .replace('<script src="vendor/jspdf.umd.min.js"></script>', "")
  .replace('<script type="module" src="app.js"></script>', "")
  .replace("restart node server.mjs if it persists", "rebuild the file with node build-local.mjs if it persists")
  .replace("</body>", () => `<script>${loader}</script>\n</body>`);
if (/src="(?!data:)[^"]+\.(js|svg)"|href="style\.css"|href="icons\.svg|url\(vendor\//.test(html)) throw new Error("an external file is still referenced");
writeFileSync(join(ROOT, "Gen-NX-Sketch-local.html"), html);
console.log(`Gen-NX-Sketch-local.html: ${(html.length / 1048576).toFixed(2)} MB, modules ${order.join(", ")}`);
