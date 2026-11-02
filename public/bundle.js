// Standalone HTML with the app's three tabs (2D sketch, Rebar detail, 3D model) and no sidebar.
// data: { title, views: [{ tab, group, title, svg }], cards: { svg, of }, hits: [{ elems, view, rect }], html3d }
export function buildBundleHtml(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)}</title>
<style>
  :root{--paper:#ecebe6;--sheet-bg:#dcdbd5;--ink:#1a1c1e;--ink-2:#4a4f55;--line:#d3d2cb;--accent:#b8251c}
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:var(--paper);color:var(--ink);display:flex;flex-direction:column}
  header{display:flex;align-items:baseline;gap:14px;background:var(--ink);color:#f1f0eb;padding:10px 18px}
  header b{font-size:17px}header span{color:#a9adb2;font-size:13px}
  .bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line)}
  .tabs{display:flex;border:1px solid #c3c2bb;border-radius:6px;overflow:hidden}
  .tabs button{border:0;border-radius:0}
  button,select{font:inherit;padding:6px 11px;border:1px solid #c3c2bb;border-radius:6px;background:#fff;color:var(--ink);cursor:pointer}
  button.on{background:var(--ink);color:#fff}
  button:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
  select{max-width:46vw}
  #title{padding:6px 14px;font-weight:600;color:var(--ink-2);font-size:13px}
  main{flex:1;min-height:0;display:flex;padding:0 14px 14px}
  #stage{flex:1;background:var(--sheet-bg);border-radius:6px;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:grab}
  #stage svg{width:100%;height:100%;display:block}
  #f3d{flex:1;border:0;border-radius:6px;background:#eef0f3}
  #tip{position:fixed;z-index:10;pointer-events:none;background:var(--ink);color:#fff;font-size:12px;padding:6px 9px;border-radius:6px;white-space:nowrap}
  #tip .rb{margin-top:6px}#tip .rb svg{display:block;max-width:min(520px,90vw);height:auto;border-radius:3px}
  [hidden]{display:none!important}
</style></head><body>
<header><b>${esc(data.title)}</b><span>Drafting sketches from a MIDAS Gen NX model</span></header>
<div class="bar">
  <div class="tabs" role="tablist"><button data-tab="2d">2D sketch</button><button data-tab="rebar">Rebar detail</button><button data-tab="3d">3D model</button></div>
  <span id="pick"><select id="grp" aria-label="Drawing type"></select> <select id="sel" aria-label="View"></select>
  <button id="prev" aria-label="Previous view">‹</button><button id="next" aria-label="Next view">›</button></span>
</div>
<div id="title"></div>
<main><div id="stage"></div><iframe id="f3d" title="3D model" hidden></iframe></main>
<div id="tip" hidden></div>
<script>
const D = ${json};
const $ = id => document.getElementById(id);
let tab = "2d", cur = 0, hl = null, vb = [0, 0, 420, 297];
const inTab = () => D.views.map((v, i) => i).filter(i => D.views[i].tab === tab);
const groups = () => [...new Set(inTab().map(i => D.views[i].group))];
function setTab(t) {
  tab = t;
  document.querySelectorAll("[data-tab]").forEach(b => { b.classList.toggle("on", b.dataset.tab === t); b.setAttribute("aria-selected", b.dataset.tab === t); });
  const is3d = t === "3d";
  $("f3d").hidden = !is3d; $("stage").hidden = is3d; $("pick").hidden = is3d;
  if (is3d) { if (!$("f3d").srcdoc) $("f3d").srcdoc = D.html3d; $("title").textContent = "3D model"; return; }
  if (!inTab().includes(cur)) cur = inTab()[0];
  fill(); show();
}
function fill() {
  const g = cur === undefined ? "" : D.views[cur].group;
  $("grp").innerHTML = groups().map(n => '<option>' + n + '</option>').join(""); $("grp").value = g;
  $("sel").innerHTML = inTab().filter(i => D.views[i].group === g).map(i => '<option value="' + i + '">' + D.views[i].title.replace(/^[A-Z ]+ - /, "") + '</option>').join("");
  $("sel").value = cur;
}
function show() {
  const v = D.views[cur];
  if (!v) { $("stage").innerHTML = '<p style="color:#4a4f55">' + (tab === "rebar" ? "This model has no rebar data." : "No drawings.") + '</p>'; $("title").textContent = ""; return; }
  $("stage").innerHTML = v.svg; $("title").textContent = v.title;
  const svg = $("stage").querySelector("svg");
  if (hl && hl.view === cur) svg.insertAdjacentHTML("beforeend", '<rect x="' + hl.rect[0] + '" y="' + hl.rect[1] + '" width="' + hl.rect[2] + '" height="' + hl.rect[3] + '" fill="none" stroke="#b8251c" stroke-width="0.8"/>');
  vb = [0, 0, 420, 297]; svg.setAttribute("viewBox", vb.join(" "));
}
$("grp").onchange = () => { cur = inTab().find(i => D.views[i].group === $("grp").value); fill(); show(); };
$("sel").onchange = () => { cur = +$("sel").value; show(); };
const step = d => { const l = inTab(), i = l.indexOf(cur); cur = l[(i + d + l.length) % l.length]; fill(); show(); };
$("prev").onclick = () => step(-1); $("next").onclick = () => step(1);
document.querySelectorAll("[data-tab]").forEach(b => (b.onclick = () => setTab(b.dataset.tab)));
// pan / zoom
const stage = $("stage"), apply = () => stage.querySelector("svg")?.setAttribute("viewBox", vb.join(" "));
const pt = e => { const s = stage.querySelector("svg"), p = s.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(s.getScreenCTM().inverse()); };
stage.addEventListener("wheel", e => {
  if (!stage.querySelector("svg")) return; e.preventDefault();
  const p = pt(e), f = e.deltaY < 0 ? 0.85 : 1 / 0.85;
  vb = [p.x - (p.x - vb[0]) * f, p.y - (p.y - vb[1]) * f, vb[2] * f, vb[3] * f]; apply();
}, { passive: false });
let drag = null;
stage.addEventListener("pointerdown", e => { if (stage.querySelector("svg")) { drag = { p: pt(e) }; stage.setPointerCapture(e.pointerId); } });
stage.addEventListener("pointermove", e => { if (!drag) return; const p = pt(e); vb[0] -= p.x - drag.p.x; vb[1] -= p.y - drag.p.y; apply(); });
stage.addEventListener("pointerup", () => (drag = null));
stage.addEventListener("dblclick", () => { vb = [0, 0, 420, 297]; apply(); });
// hover: element info, plus its rebar table when it has one
stage.addEventListener("mousemove", e => {
  const el = e.target.closest("[data-tip]"), tip = $("tip");
  if (!el || drag) { tip.hidden = true; return; }
  const [a, b] = el.dataset.tip.split("\\n"), h = s => (s || "").replace(/[&<]/g, "");
  const c = (el.dataset.el || "").split(",").map(id => D.cards.of[id]).find(i => i !== undefined);
  tip.innerHTML = "<b>" + h(a) + "</b><br>" + h(b) + (c !== undefined ? '<div class="rb">' + D.cards.svg[c] + "</div>" : "");
  tip.hidden = false;
  tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
  tip.style.top = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8) + "px";
});
stage.addEventListener("mouseleave", () => ($("tip").hidden = true));
// 3D click on an element with rebar -> its rebar sheet, type framed in red
addEventListener("message", e => {
  const id = e.source === $("f3d").contentWindow && e.data && e.data.gnxRebar;
  const h = id && D.hits.find(x => x.elems.includes(id));
  if (h) { hl = h; cur = h.view; setTab("rebar"); }
});
setTab("2d");
</script></body></html>`;
}
