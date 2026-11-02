import * as C from "./core.js";
import { demoModel } from "./demo.js";
import { toSvg, toPdf } from "./render.js";
import { build3dHtml, model3dData } from "./viewer3d.js";
import { parseRebar, buildRebarViews, rebarCards, editValues, pushRecords, colRebarTexts } from "./rebar.js";
import { buildShopViews, shopBBS, bbsCsv } from "./shop.js";
import { buildBundleHtml } from "./bundle.js";
import { makeZip } from "./zip.js";
import { VERSION, CHANGELOG } from "./changelog.js";

const $ = s => document.querySelector(s);
const SETTINGS_KEY = "gnx-sketch-settings", EDITS_KEY = "gnx-sketch-rebar-edits"; // rebar edits, by type key (kind|section|n)
// local single-file build: vendor libraries are embedded in the page instead of served from vendor/
const VENDOR = window.__GNX_VENDOR || null;
const state = { raw: null, source: "", model: null, views: [], currentId: null, tab: "2d", grids: null, levels: null, colors: null, connMode: null, dirty3d: true };

// ---------- settings ----------
const FIELDS = ["base", "conn", "colorMode", "labels", "tol", "gridMode", "gridX", "gridY", "project", "dxfUnits", "scope", "remember", "fontMm", "slabT", "beamTop", "markNoRebar", "gridAlpha"];
function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch {}
  for (const f of FIELDS) if (s[f] !== undefined) { const el = $("#" + f); el.type === "checkbox" ? (el.checked = s[f]) : (el.value = s[f]); }
  if (s.remember && s.key) $("#key").value = s.key;
}
function saveSettings() {
  const s = {};
  for (const f of FIELDS) { const el = $("#" + f); s[f] = el.type === "checkbox" ? el.checked : el.value; }
  if (s.remember) s.key = $("#key").value;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

// the sidebar line keeps the full message; the viewbar repeats it next to the drawing, where the eye is
const status = (msg, kind = "") => {
  const el = $("#status"); el.textContent = msg; el.className = "status " + kind;
  const v = $("#viewStatus"); if (v) { v.textContent = msg; v.className = "vstatus " + kind; }
};
// thin progress bar and a busy cursor while loading or packing files
const busy = on => document.body.classList.toggle("busy", on);

// ---------- MIDAS API ----------
const midasGet = path => midasCall(path);
// body: sent with PUT (the rebar tables only, see proxy.mjs)
async function midasCall(path, body) {
  const put = body ? { method: "PUT", body: JSON.stringify(body) } : {};
  const base = $("#base").value.trim().replace(/\/+$/, ""), key = $("#key").value.trim();
  if (!key) throw new Error("Enter your MAPI-Key first (Gen NX > Apps > API Settings).");
  const viaProxy = async () => {
    const r = await fetch("api/midas" + path, { ...put, headers: { "mapi-key": key, "x-midas-base": base, ...(body ? { "content-type": "application/json" } : {}) } });
    if (!r.headers.get("x-midas-proxy")) throw new Error("no proxy");
    return r;
  };
  const direct = () => fetch(base + path, { ...put, headers: { "MAPI-Key": key, "Content-Type": "application/json" } });
  const mode = $("#conn").value === "auto" ? state.connMode || "auto" : $("#conn").value;
  let r;
  if (mode === "proxy") r = await viaProxy();
  else if (mode === "direct") {
    try { r = await direct(); } catch (e) { throw new Error("The browser blocked the direct call (CORS). Run the app with its proxy: deploy on Netlify or start it with `node server.mjs`."); }
  } else {
    try { r = await viaProxy(); state.connMode = "proxy"; }
    catch { try { r = await direct(); state.connMode = "direct"; } catch { throw new Error("Could not reach the API. Opened as a plain file or static host? The browser blocks direct calls (CORS), so run it via Netlify or `node server.mjs`."); } }
  }
  const text = await r.text();
  let j;
  try { j = text ? JSON.parse(text) : {}; } catch { throw new Error(`${path}: HTTP ${r.status}, response is not JSON`); }
  if (r.status === 401 || r.status === 403) throw new Error("MAPI-Key rejected (HTTP " + r.status + "). Check the key and that Gen NX is open and connected.");
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${j?.message || j?.error?.message || ""}`.trim());
  if (j && j.error) throw new Error(`${path}: ${j.error.message || JSON.stringify(j.error)}`);
  return j;
}

// progress bar on the start page while the tables come in, one step per table
const TABLES = [["NODE", "nodes"], ["ELEM", "elements"], ["UNIT", "units"], ["SECT", "sections"], ["THIK", "thicknesses"], ["STOR", "stories"], ["MATL", "materials"],
  ["MEMB", "member assignment"], ["REBB", "beam rebar"], ["REBC", "column rebar"], ["RCHK", "rebar for checking"]]; // REBB/REBC/RCHK: design rebar, optional
function progress(i, label) {
  const p = $("#loadProg");
  if (i === null) { p.hidden = true; return; }
  const pct = Math.round((i / TABLES.length) * 100);
  p.hidden = false; p.setAttribute("aria-valuenow", pct);
  $("#progFill").style.transform = `scaleX(${pct / 100})`;
  $("#progLabel").textContent = label; $("#progCount").textContent = `${pct}%`;
}
async function loadFromMidas() {
  saveSettings();
  const btn = $("#connect"); btn.disabled = true; busy(true); status("");
  try {
    const raw = {};
    for (const [i, [t, name]] of TABLES.entries()) {
      progress(i, `Reading ${name} (${t}) from Gen NX…`); $("#viewStatus").textContent = `Reading ${t} from Gen NX…`;
      try { raw[t] = await midasGet("/db/" + t); }
      catch (e) { if (t === "NODE" || t === "ELEM") throw e; raw[t] = {}; }
    }
    if (!Object.keys(C.tableOf(raw.NODE, "NODE")).length) throw new Error("The model has no nodes. Is the right model open in Gen NX?");
    progress(TABLES.length, "Drawing plans, elevations and rebar…");
    await new Promise(r => setTimeout(r, 350)); // let the full bar show before the workspace opens
    setModel(raw, "MIDAS Gen NX");
    progress(null);
  } catch (e) {
    progress(null); status(e.message, "err");
  } finally { btn.disabled = false; busy(false); }
}

// ---------- model -> views ----------
function setModel(raw, source) {
  // a full Gen NX database export {"DBG": {"NODE": {...}, ...}}: give each table its usual {"NODE": {...}} wrapper
  if (raw.DBG && !raw.NODE) raw = Object.fromEntries(Object.entries(raw.DBG).map(([k, v]) => [k, { [k]: v }]));
  state.raw = raw; state.source = source;
  state.model = C.normalizeModel(raw);
  // rebar edited earlier on this computer comes back for types of the same section name, unless the JSON carries its own
  const saved = loadEdits();
  if (!raw.REBAR_USER) raw.REBAR_USER = {};
  const names = new Set([...state.model.sects.values()].map(x => x.name));
  for (const [k, v] of Object.entries(saved)) if (!(k in raw.REBAR_USER) && names.has(k.split("|")[1])) raw.REBAR_USER[k] = v;
  const m = state.model, kinds = {};
  for (const e of m.elems) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  $("#summary").innerHTML = `<b>${source}</b> · unit ${m.unit}<br>${m.nodes.size} nodes · ${m.elems.length} elements` +
    `<br>${Object.entries(kinds).map(([k, n]) => `${n} ${C.KIND_LABEL[k].toLowerCase()}`).join(" · ")}` +
    `<br>${m.sects.size} sections · ${m.thick.size} thicknesses · ${m.stories.length ? m.stories.length + " stories" : "no story data (levels from geometry)"}`;
  document.body.classList.add("has-model"); document.body.classList.remove("on-start"); $("#backWrap").hidden = false;
  const chip = $("#modelChip"); chip.textContent = `${source} · ${m.elems.length} elements`; chip.hidden = false;
  status(`Loaded ${m.elems.length} elements.`, "ok");
  $("#dataDl").hidden = false;
  rebuild();
}

// text size: label height in px on the A3 sheet at 96 dpi (8 px is the drawing standard's 2 mm text)
const fontScale = () => Math.min(6, Math.max(1, +$("#fontMm").value || 2)) / 2; // text height on paper in mm; 2 mm is the standard (STANDAR GAMBAR, 5. TEXT SIZE)

// manual grid: a table per axis (label, coordinate in m), kept as "A:0, B:7.5" text in the hidden #gridX / #gridY
function gridRow(label = "", v = "") {
  return `<tr><td><input autocomplete="off" aria-label="Label" value="${String(label).replace(/"/g, "&quot;")}" spellcheck="false"></td><td><input autocomplete="off" aria-label="Coordinate in m" type="number" step="0.05" value="${v}"></td><td><button type="button" class="x" aria-label="Remove this line">×</button></td></tr>`;
}
function fillGridTables() {
  for (const t of document.querySelectorAll(".gtab")) {
    const g = C.parseGridText($(t.dataset.axis === "x" ? "#gridX" : "#gridY").value, t.dataset.axis);
    t.querySelector("tbody").innerHTML = (g.length ? g : [{ label: "", v: "" }]).map(l => gridRow(l.label, l.v === "" ? "" : +(+l.v).toFixed(3))).join("");
  }
}
function readGridTables() {
  for (const t of document.querySelectorAll(".gtab")) {
    const rows = [...t.querySelectorAll("tbody tr")].map(r => r.querySelectorAll("input")).filter(([, v]) => v.value.trim() !== "" && isFinite(+v.value));
    $(t.dataset.axis === "x" ? "#gridX" : "#gridY").value = rows.map(([l, v]) => (l.value.trim() ? l.value.trim().replace(/[\s,:;=]/g, "") + ":" : "") + +v.value).join(", ");
  }
  saveSettings();
}
function setupGridTables() {
  fillGridTables();
  for (const t of document.querySelectorAll(".gtab")) {
    t.querySelector("[data-add]").onclick = () => {
      const body = t.querySelector("tbody"), last = [...body.querySelectorAll("tr")].pop()?.querySelectorAll("input");
      const prev = last && last[1].value !== "" ? +last[1].value : null;
      body.insertAdjacentHTML("beforeend", gridRow("", prev === null ? 0 : +(prev + 6).toFixed(3)));
      body.querySelector("tr:last-child input").focus();
    };
    t.addEventListener("click", e => { const b = e.target.closest("button.x"); if (b) { b.closest("tr").remove(); if (!t.querySelector("tbody tr")) t.querySelector("tbody").innerHTML = gridRow(); } });
    t.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("input")) { e.preventDefault(); readGridTables(); rebuild(); } });
  }
}

function rebuild() {
  const m = state.model;
  if (!m) return;
  saveSettings();
  const tol = Math.max(1, +$("#tol").value || 100) / 1000;
  const auto = C.autoGrids(m, tol);
  $("#autoGrid").textContent = `Detected from ${auto.source}: X ${auto.x.length} lines, Y ${auto.y.length} lines`;
  let grids = auto;
  if ($("#gridMode").value === "manual") {
    const gx = C.parseGridText($("#gridX").value, "x"), gy = C.parseGridText($("#gridY").value, "y");
    grids = { source: "manual", x: gx.length ? gx : auto.x, y: gy.length ? gy : auto.y };
  }
  $("#manualGrid").hidden = $("#gridMode").value !== "manual";
  state.grids = grids;
  state.levels = C.levels(m);
  state.colors = C.sectionColors(m);
  C.setGridAlpha(+$("#gridAlpha").value / 100); $("#gridAlphaV").textContent = `${$("#gridAlpha").value}%`;
  const opts = { colorMode: $("#colorMode").value, labels: $("#labels").checked, fontScale: fontScale(), beamTop: $("#beamTop").checked, markNoRebar: $("#markNoRebar").checked, slabT: slabT(), info: C.sectionInfo(m), grids, levels: state.levels, colors: state.colors, planeTol: tol, levelTol: 0.05 };
  state.rebar = parseRebar(state.raw, m);
  // members of a section with several rebar types are labelled by type (B2A3, B2A3-A ...) in plans and elevations
  m.typeOf = new Map();
  for (const d of [...state.rebar.beams, ...state.rebar.cols]) if (d.sub) for (const id of d.elems) m.typeOf.set(id, d.name);
  m.colRebar = colRebarTexts(m, state.rebar); // main bars and ties written by each column in the column plans and the schedule
  // concrete beams that no beam rebar type covers: marked red in plans and elevations
  const withRebar = new Set(state.rebar.beams.flatMap(d => d.elems));
  m.noRebar = new Set(m.elems.filter(e => e.kind === "beam" && e.matlType.toUpperCase() !== "STEEL" && !withRebar.has(e.id)).map(e => e.id));
  state.opts = opts;
  state.views = [...C.buildViews(m, opts), ...buildRebarViews(m, state.rebar, opts), ...shopViews()];
  fillEditTypes();
  if (!tabViews().some(v => v.id === state.currentId)) state.currentId = tabViews()[0]?.id;
  renderViewList();
  drawCurrent();
  state.dirty3d = true;
  if (!$("#pane3d").hidden) show3d();
}
// shop drawing sheets (one per beam line and column stack) and the schedule taken from them
function shopViews() {
  const t0 = performance.now(), vs = buildShopViews(state.model, state.rebar, { ...state.opts, ...bbsParams() });
  state.bbs = shopBBS(vs, bbsParams());
  console.log(`shop drawings: ${vs.length} sheets in ${Math.round(performance.now() - t0)} ms`);
  return vs;
}
const BBS_VIEW = { id: "shop:bbs", kind: "bbs", title: "BAR BENDING SCHEDULE" }; // not a sheet: shows the schedule pane

function viewGroups(tab = state.tab) {
  const by = f => state.views.filter(f);
  const groups = tab === "rebar"
    ? [["Column plans", by(v => v.sub === "colplanrebar")], ["Column schedule & sections", by(v => v.sub === "colrebar")], ["Beam plans: main bars", by(v => v.rebarKind === "main")], ["Beam plans: stirrups", by(v => v.rebarKind === "stir")], ["Beam sections", by(v => v.sub === "beamrebar")]]
    : tab === "shop" ? [["Column", by(v => v.sub === "shopcol")], ["Beam", by(v => v.sub === "shopbeam")], ["Bar bending schedule", state.bbs && (state.bbs.beams.length || state.bbs.cols.length) ? [BBS_VIEW] : []]]
    : [["Column plans", by(v => v.sub === "column")], ["Beam plans", by(v => v.sub === "beam")], ["Elevations", by(v => v.kind === "elev")]];
  return groups.filter(g => g[1].length);
}
const tabViews = () => viewGroups().flatMap(g => g[1]);
function renderViewList() {
  state.groups = viewGroups();
  const cur = current() || tabViews()[0];
  const gi = Math.max(0, state.groups.findIndex(g => g[1].includes(cur)));
  $("#viewType").innerHTML = state.groups.map(([h, vs], i) => `<option value="${i}">${h} (${vs.length})</option>`).join("");
  $("#viewType").value = gi;
  // the drawing types as one row of buttons (the select stays for the logic and narrow screens)
  $("#groupBar").innerHTML = state.groups.map(([h, vs], i) => `<button type="button" role="tab" data-g="${i}" aria-selected="${i === gi}" class="${i === gi ? "on" : ""}">${h}<span class="n">${vs.length}</span></button>`).join("");
  fillViewSel();
}
function fillViewSel() {
  const g = state.groups[+$("#viewType").value];
  $("#viewSel").innerHTML = g ? g[1].map(v => `<option value="${v.id}">${v.title.replace(/^(BEAM REBAR PLAN \((?:MAIN BARS|STIRRUPS & SKIN)\)|COLUMN REBAR PLAN|COLUMN PLAN|COLUMN|BEAM PLAN|BEAM|ELEVATION|BEAM REBAR|COLUMN REBAR|BEAM SHOP DRAWING|COLUMN SHOP DRAWING) - /, "")}</option>`).join("") : "";
  if (g && !g[1].some(v => v.id === state.currentId)) state.currentId = g[1][0].id;
  $("#viewSel").value = state.currentId;
}
function stepView(d) {
  const vs = tabViews(), i = vs.findIndex(v => v.id === state.currentId), v = vs[(i + d + vs.length) % vs.length];
  if (!v) return;
  state.currentId = v.id; renderViewList(); drawCurrent();
}

const meta = () => ({ project: $("#project").value.trim(), date: new Date().toISOString().slice(0, 10), colorMode: $("#colorMode").value });
const current = () => tabViews().find(v => v.id === state.currentId);

function drawCurrent() {
  const v = current(), host = $("#sheet");
  if (state.tab === "shop") { const bbs = v?.kind === "bbs"; $("#pane2d").hidden = bbs; $("#paneShop").hidden = !bbs; if (bbs) { $("#viewTitle").textContent = ""; showShop(); return; } }
  if (!v) {
    host.innerHTML = state.tab === "rebar"
      ? '<p class="empty">This model has no rebar data. Gen NX keeps it under Design: <b>Modify Beam Rebar Data</b> (beams), <b>Modify Column Rebar Data</b> (columns) and <b>Rebar Input for Checking</b>. Enter or design the rebar there and load the model again, or add it in the sidebar under Edit rebar. The demo model shows sample details.</p>'
      : state.tab === "shop" ? '<p class="empty">No shop drawings: this model has no rebar data yet. Add it in Gen NX (Modify Beam / Column Rebar Data) or under Rebar detail &gt; Edit rebar.</p>'
      : '<p class="empty">No drawable views. Check the grid tolerance or the model.</p>';
    $("#viewTitle").textContent = ""; return;
  }
  // a type picked from the 3D view gets a red frame round its table cells (preview only, never exported)
  const hl = state.hl && state.hl.view === v.id ? [{ t: "poly", pts: [[state.hl.box[0], state.hl.box[1]], [state.hl.box[2], state.hl.box[1]], [state.hl.box[2], state.hl.box[3]], [state.hl.box[0], state.hl.box[3]]], closed: true, color: "#b8251c", lw: 0.8 }] : [];
  host.innerHTML = toSvg(hl.length ? { ...v, items: [...v.items, ...hl] } : v, meta());
  $("#viewTitle").textContent = `${v.title} · 1:${v.scale} on A3`;
  setupPanZoom(host.querySelector("svg"));
}

// ---------- preview pan/zoom + hover ----------
function setupPanZoom(svg) {
  let vb = [0, 0, 420, 297];
  const apply = () => svg.setAttribute("viewBox", vb.join(" "));
  const toSvgPt = (cx, cy) => { const p = svg.createSVGPoint(); p.x = cx; p.y = cy; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  svg.addEventListener("wheel", e => {
    e.preventDefault();
    const f = Math.exp(e.deltaY * 0.0015), p = toSvgPt(e.clientX, e.clientY);
    const w = Math.min(Math.max(vb[2] * f, 8), 840), s = w / vb[2];
    vb = [p.x - (p.x - vb[0]) * s, p.y - (p.y - vb[1]) * s, w, vb[3] * s]; apply();
  }, { passive: false });
  let drag = null;
  svg.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, vb: [...vb] }; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener("pointermove", e => {
    if (!drag) return;
    const s = 1 / svg.getScreenCTM().a;
    vb = [drag.vb[0] - (e.clientX - drag.x) * s, drag.vb[1] - (e.clientY - drag.y) * s, vb[2], vb[3]]; apply();
  });
  svg.addEventListener("pointerup", () => (drag = null));
  svg.addEventListener("dblclick", e => {
    // a member in a plan or elevation: open its rebar type; a type table in the Rebar detail tab: edit it
    const hit = document.elementFromPoint(e.clientX, e.clientY); // pointer capture retargets events to the svg
    const ids = (hit?.closest("[data-el]")?.dataset.el || "").split(",").filter(Boolean).map(Number);
    // in the Rebar detail tab a double-click on a type's table cell or section goes straight to Edit rebar
    if (state.tab === "rebar") { const p = toSvgPt(e.clientX, e.clientY), h = hitAt(current(), p.x, p.y); if (h) { selectEditType(h.elems[0]); goEdit(); return; } }
    if (ids.length && openRebarFor(ids)) return;
    vb = [0, 0, 420, 297]; apply();
  });
  $("#fit").onclick = () => { vb = [0, 0, 420, 297]; apply(); };
}
function setupTooltip() {
  const tip = $("#tip");
  $("#sheet").addEventListener("mousemove", e => {
    const el = e.target.closest("[data-tip]");
    if (!el) { tip.hidden = true; return; }
    const [a, ...rest] = el.dataset.tip.split("\n"), b = rest.join("\n");
    const R = rebarHover3d(), card = (el.dataset.el || "").split(",").map(id => R.of[id]).find(i => i !== undefined);
    tip.innerHTML = `<b>${a.replace(/[&<]/g, "")}</b><br>${b.replace(/[&<]/g, "").replace(/\n/g, "<br>")}` + (card !== undefined ? `<div class="rb">${R.svg[card]}</div>` : "");
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
    tip.style.top = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8) + "px";
  });
  $("#sheet").addEventListener("mouseleave", () => (tip.hidden = true));
}

// ---------- member -> its rebar type ----------
const NOOP = { line() {}, poly() {}, circle() {}, text() {} };
function hitRect(v, h) { const { T } = C.drawPaper(v, NOOP), [x0, y0] = T([h.box[0], h.box[3]]), [x1, y1] = T([h.box[2], h.box[1]]); return [x0, y0, x1, y1]; }
function hitAt(v, x, y) { return v?.hits?.find(h => { const [x0, y0, x1, y1] = hitRect(v, h); return x >= x0 && x <= x1 && y >= y0 && y <= y1; }); }
// ids: element ids of a member (a merged run has several); returns false when none has rebar
function openRebarFor(ids) {
  for (const v of state.views || []) for (const h of v.hits || []) if (ids.some(id => h.elems.includes(id))) {
    state.hl = { view: v.id, box: h.box }; state.currentId = v.id;
    show2d("rebar"); renderViewList(); drawCurrent(); selectEditType(ids.find(id => h.elems.includes(id)));
    $("#tip").hidden = true; status(`Opened the rebar of element ${ids[0]}.`, "ok");
    return true;
  }
  if (ids.length && state.tab !== "rebar") status(`Element ${ids[0]} has no rebar data. Add it under Rebar detail > Edit rebar.`, "err");
  return false;
}

// ---------- rebar editing (Rebar detail tab) ----------
function goEdit() {
  const box = $("#edBox"); box.open = true;
  box.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  box.classList.remove("flash"); void box.offsetWidth; box.classList.add("flash");
  const first = [...box.querySelectorAll("#edForm input")].find(i => i.offsetParent); first?.focus({ preventScroll: true });
}
const SECT_KEYS = [["I", "Support I"], ["M", "Midspan"], ["J", "Support J"]];
function loadEdits() { try { return JSON.parse(localStorage.getItem(EDITS_KEY) || "{}"); } catch { return {}; } }
function storeEdit(key, v) { const s = loadEdits(); if (v) s[key] = v; else delete s[key]; try { localStorage.setItem(EDITS_KEY, JSON.stringify(s)); } catch {} }
// every type with rebar, plus concrete beam/column sections that have none yet
function editTypes() {
  const m = state.model, out = [], has = new Set();
  for (const [kind, list] of [["beam", state.rebar.beams], ["col", state.rebar.cols]]) for (const d of list) { out.push({ kind, key: d.key, name: d.name, det: d }); has.add(kind + "|" + d.sect); }
  const conc = e => e.matlType.toUpperCase() !== "STEEL";
  for (const [kind, ek] of [["beam", "beam"], ["col", "column"]]) for (const sid of new Set(m.elems.filter(e => e.kind === ek && conc(e)).map(e => e.sect)))
    if (!has.has(kind + "|" + sid) && m.sects.has(sid)) out.push({ kind, key: `${kind}|${m.sects.get(sid).name}|0`, name: m.sects.get(sid).name, det: null });
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
function fillEditTypes() {
  const sel = $("#edType"), keep = sel.value, types = state.edTypes = editTypes();
  const opt = t => `<option value="${t.key.replace(/"/g, "&quot;")}">${t.name.replace(/[&<]/g, "")}${t.det ? (t.det.edited ? " · edited" : "") : " · no rebar"}</option>`;
  sel.innerHTML = [["beam", "Beams"], ["col", "Columns"]].map(([k, l]) => { const ts = types.filter(t => t.kind === k); return ts.length ? `<optgroup label="${l}">${ts.map(opt).join("")}</optgroup>` : ""; }).join("");
  if (types.some(t => t.key === keep)) sel.value = keep;
  loadEditForm();
}
function selectEditType(elemId) {
  const t = state.edTypes?.find(x => x.det?.elems.includes(elemId));
  if (t) { $("#edType").value = t.key; loadEditForm(); }
}
// Beam rebar along the span: each sector, both ends alike (I = J) or one arrangement for the whole span (I = M = J).
// The first fieldset stands for the sectors it covers; Apply copies it to them.
const SECT_FIELDS = ["top", "bot", "stir", "legs", "skin"];
const sectVals = k => SECT_FIELDS.map(f => $(`#ed_${f}_${k}`).value.trim()).join("|");
const copySect = (from, to) => { for (const f of SECT_FIELDS) $(`#ed_${f}_${to}`).value = $(`#ed_${f}_${from}`).value; };
function showSpan() {
  const m = $("#edSpan").value;
  $("#edFsM").hidden = m === "all"; $("#edFsJ").hidden = m !== "each";
  $("#edLgI").textContent = m === "all" ? "All span" : m === "both" ? "Both ends (I and J)" : "Support I";
}
function spanChanged() { // a sector coming back into view starts from what it stood for
  const m = $("#edSpan").value;
  if (m !== "all" && $("#edFsM").hidden) copySect("I", "M");
  if (m === "each" && $("#edFsJ").hidden) copySect("I", "J");
  showSpan();
}
function loadEditForm() {
  const t = state.edTypes?.find(x => x.key === $("#edType").value);
  $("#edForm").hidden = !t;
  if (!t) return;
  const user = state.raw.REBAR_USER?.[t.key], v = user || (t.det ? editValues(t.det, t.kind) : t.kind === "beam"
    ? { dcT: 50, dcB: 50, sectors: Object.fromEntries(SECT_KEYS.map(([k]) => [k, { top: "", bot: "", stir: "D10-150", legs: 2, skin: "" }])) }
    : { n1: "", n2: "", bar: "D16", dc: 50, tieEnd: "D10-100", tieMid: "D10-150", ny: 2, nz: 2 });
  $("#edBeam").hidden = t.kind !== "beam"; $("#edCol").hidden = t.kind !== "col";
  if (t.kind === "beam") {
    $("#edDcT").value = v.dcT; $("#edDcB").value = v.dcB;
    for (const [k] of SECT_KEYS) for (const f of SECT_FIELDS) $(`#ed_${f}_${k}`).value = v.sectors?.[k]?.[f] ?? "";
    const [I, M, J] = ["I", "M", "J"].map(sectVals);
    $("#edSpan").value = I === J ? (I === M ? "all" : "both") : "each"; showSpan();
  } else {
    const round = !!state.model.sects.get(t.det?.sect ?? [...state.model.sects].find(([, x]) => x.name === t.key.split("|")[1])?.[0])?.round;
    for (const f of ["n1", "n2", "bar", "dc", "tieEnd", "tieMid", "ny", "nz"]) $("#ed_" + f).value = v[f] ?? "";
    $("#edN1Lbl").textContent = round ? "Total bars (round)" : "Bars per face along B"; $("#ed_n2").disabled = round;
  }
  $("#edSrc").textContent = user ? "Rebar edited here. “Use MIDAS rebar” puts the Gen NX data back." : t.det ? `From Gen NX ${t.det.src}.` : "No rebar in the model for this section yet.";
  $("#edReset").disabled = !user;
}
function applyEdit(reset) {
  const t = state.edTypes?.find(x => x.key === $("#edType").value);
  if (!t) return;
  let v = null;
  if (!reset) {
    if (t.kind === "beam") { const m = $("#edSpan").value; if (m === "all") copySect("I", "M"); if (m !== "each") copySect("I", "J"); }
    if (t.kind === "beam") v = { dcT: +$("#edDcT").value || 50, dcB: +$("#edDcB").value || 50, sectors: Object.fromEntries(SECT_KEYS.map(([k]) => [k, Object.fromEntries(["top", "bot", "stir", "legs", "skin"].map(f => [f, $(`#ed_${f}_${k}`).value.trim()]))])) };
    else v = Object.fromEntries(["n1", "n2", "bar", "dc", "tieEnd", "tieMid", "ny", "nz"].map(f => [f, $("#ed_" + f).value.trim()]));
    if (t.kind === "col" && !(+v.n1 > 0 && /\d/.test(v.bar))) { status("Enter the number of bars and the main bar, for example D19.", "err"); return; }
  }
  if (v) state.raw.REBAR_USER[t.key] = v; else delete state.raw.REBAR_USER[t.key];
  storeEdit(t.key, v);
  const keepTab = state.tab; rebuild();
  const d = [...state.rebar.beams, ...state.rebar.cols].find(x => x.key === t.key);
  if (d) openRebarFor(d.elems); else if (keepTab === "rebar") show2d("rebar");
  $("#edType").value = t.key; loadEditForm();
  status(reset ? `${t.name}: back to the Gen NX rebar.` : `${t.name}: rebar updated.`, "ok");
}
// edits are removed only after a second press within 4 s (asked inline, no dialog); true when the second press came
function confirmed(b, ask) {
  const disarm = () => { clearTimeout(b._t); b.textContent = b.dataset.armed; delete b.dataset.armed; b.classList.remove("armed"); };
  if (b.dataset.armed) { disarm(); return true; }
  b.dataset.armed = b.textContent; b.textContent = ask; b.classList.add("armed"); b._t = setTimeout(disarm, 4000);
  return false;
}
function resetAllEdits() {
  if (!Object.keys(state.raw.REBAR_USER || {}).length) { status("No rebar edits to remove.", ""); return; }
  if (!confirmed($("#edResetAll"), "Press again to remove all edits")) return;
  for (const k of Object.keys(state.raw.REBAR_USER || {})) storeEdit(k, null);
  state.raw.REBAR_USER = {}; rebuild(); status("All rebar edits removed; Gen NX rebar is used again.", "ok");
}
// Send the edited types to the model open in Gen NX (PUT /db/REBB, /db/REBC), read the tables back, and drop each edit
// Gen NX now holds: its type is then drawn from the Gen NX data again. Two presses, like the reset.
async function pushEdits() {
  const b = $("#edPush"), { tables, sent, skipped } = pushRecords(state.raw, state.rebar, state.model), names = ds => ds.map(d => d.name).join(", ");
  const why = skipped.length ? ` Not sent: ${names(skipped)} (rebar for checking per element, or a new type on a section with Gen NX rebar; enter those in Gen NX).` : "";
  if (!sent.length) { status((skipped.length ? "Nothing Gen NX can take." : "No rebar edits to send.") + why, skipped.length ? "err" : ""); return; }
  if (!$("#key").value.trim()) { status("Enter the MAPI-Key on the start page (Change project or model) to send rebar to Gen NX.", "err"); return; }
  if (!b.dataset.armed) status(`Sends ${names(sent)} to the model open in Gen NX and overwrites the rebar of ${Object.values(tables).reduce((n, t) => n + Object.keys(t).length, 0)} section(s) there. Save the Gen NX model first.` + (state.source !== "MIDAS Gen NX" ? " This model came from a file: check the same model is open in Gen NX." : "") + why, "");
  if (!confirmed(b, `Press again to send ${sent.length} type${sent.length > 1 ? "s" : ""}`)) return;
  busy(true); b.disabled = true;
  try {
    // Gen NX applies the rebar on its own UI thread: it can show "Not Responding" for a while and comes back by itself
    const t0 = performance.now(), secs = () => Math.round((performance.now() - t0) / 1000);
    for (const [t, recs] of Object.entries(tables)) {
      status(`Sending ${Object.keys(recs).length} section(s) to Gen NX (${t})… Gen NX may show "Not Responding" while it updates; wait for it.`, "");
      await midasCall("/db/" + t, { Assign: recs });
    }
    const tSend = secs();
    for (const t of Object.keys(tables)) { status(`Reading ${t} back from Gen NX…`, ""); state.raw[t] = await midasGet("/db/" + t); }
    // an edit is done when Gen NX now gives the same values for that type
    const back = parseRebar({ ...state.raw, REBAR_USER: {} }, state.model), kept = [];
    for (const d of sent) {
      const kind = state.rebar.beams.includes(d) ? "beam" : "col", g = (kind === "beam" ? back.beams : back.cols).find(x => x.key === d.key);
      if (g && JSON.stringify(editValues(g, kind)) === JSON.stringify(editValues(d, kind))) { delete state.raw.REBAR_USER[d.key]; storeEdit(d.key, null); } else kept.push(d);
    }
    rebuild();
    const ok = sent.filter(d => !kept.includes(d));
    status((ok.length ? `Sent to Gen NX: ${names(ok)} (Gen NX took ${tSend} s, read back in ${secs() - tSend} s).` : "") + (kept.length ? ` Gen NX did not show ${names(kept)} as sent; those edits are kept here.` : "") + why, kept.length ? "err" : "ok");
  } catch (e) {
    status("Rebar not sent: " + e.message, "err");
  } finally { busy(false); b.disabled = false; }
}

// ---------- 3D ----------
function data3d() { return { ...model3dData(state.model, state.colors, state.grids, state.levels, { beamTop: $("#beamTop").checked }), rebar: rebarHover3d() }; }
// 3D hover cards: one SVG table per rebar type, elements point at their card
// slab thickness drawn on every beam section (m); empty or invalid -> 120 mm
const slabT = () => { const v = +$("#slabT").value; return v >= 0 && v <= 1000 && $("#slabT").value !== "" ? v / 1000 : 0.12; };
function rebarHover3d() {
  if (state.cards?.rebar === state.rebar && state.cards.t === slabT()) return state.cards.out; // cached per parsed rebar set and slab thickness
  const cards = state.rebar ? rebarCards(state.model, state.rebar, { slabT: slabT() }) : [], of = {};
  cards.forEach((c, i) => { for (const id of c.elems) of[id] = i; });
  const out = { svg: cards.map(c => toSvg(c.view, {})), of };
  state.cards = { rebar: state.rebar, t: slabT(), out }; return out;
}
function show3d() {
  if (!state.model) return;
  if (!state.dirty3d) return;
  const abs = p => (VENDOR ? { code: VENDOR[p] } : { src: new URL(p, location.href).href });
  $("#frame3d").srcdoc = build3dHtml(data3d(), { title: $("#project").value.trim() || "3D Structure", colorMode: $("#colorMode").value === "section" ? "section" : "kind", scripts: { three: abs("vendor/three.min.js"), orbit: abs("vendor/OrbitControls.js") } });
  state.dirty3d = false;
}
async function inlineScript(path, cdn) {
  if (VENDOR?.[path]) return { code: VENDOR[path] };
  try { const r = await fetch(path); if (r.ok) return { code: await r.text() }; } catch {}
  return { src: cdn };
}

// The app without its sidebar in one HTML file: every 2D and rebar view as SVG, the rebar hover cards and the 3D page
async function bundleHtml() {
  const scripts = {
    three: await inlineScript("vendor/three.min.js", "https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js"),
    orbit: await inlineScript("vendor/OrbitControls.js", "https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js"),
  };
  const title = $("#project").value.trim() || "Gen NX Sketch", m = meta();
  const html3d = build3dHtml(data3d(), { title: "3D Structure", colorMode: $("#colorMode").value === "section" ? "section" : "kind", scripts });
  const views = [], hits = [];
  for (const tab of ["2d", "rebar"]) for (const [group, vs] of viewGroups(tab)) for (const v of vs) {
    for (const h of v.hits || []) { const [x0, y0, x1, y1] = hitRect(v, h); hits.push({ elems: h.elems, view: views.length, rect: [x0, y0, x1 - x0, y1 - y0].map(n => +n.toFixed(2)) }); }
    views.push({ tab, group, title: v.title, svg: toSvg(v, m) });
  }
  return buildBundleHtml({ title, views, cards: rebarHover3d(), hits, html3d });
}

// ---------- exports ----------
const slug = s => s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
const fileBase = () => slug($("#project").value.trim() || "GenNX");
function download(blob, name) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const scoped = () => ($("#scope").value === "all" ? tabViews() : [current()]).filter(v => v && v.items);
const scopeName = vs => (vs.length > 1 ? "all_views" : slug(vs[0].title));
const need = () => { if (!state.model) { status("Load a model first.", "err"); return false; } return true; };

const EXPORTS = {
  // scope "This view" or "All views"
  pdf() { const vs = scoped(); if (vs.length) toPdf(vs, meta()).save(`${fileBase()}_${scopeName(vs)}.pdf`); },
  dxf() {
    const vs = scoped(); if (!vs.length) return;
    download(new Blob([C.buildDxf(vs, { units: $("#dxfUnits").value, colorMode: $("#colorMode").value })], { type: "application/dxf" }), `${fileBase()}_${scopeName(vs)}.dxf`);
  },
  async html3d() {
    status("Packing HTML…"); busy(true);
    try { download(new Blob([await bundleHtml()], { type: "text/html" }), `${fileBase()}.html`); } finally { busy(false); }
    status("HTML saved: 2D sketches, rebar details and 3D in one file. Open it in any browser.", "ok");
  },
  // Output Sketch: every view as PDF and DXF per drawing type, plus the HTML, in one ZIP with folders
  async zip() {
    const btn = $("[data-export=zip]"); btn.disabled = true; busy(true);
    try {
      const base = fileBase(), root = `${base}_Sketch/`, files = [], m = meta();
      const pre = (t, gs) => gs.map(([n, vs]) => [`${t} - ${n}`, vs]); // file names say which tab: "Rebar - Column plans", "Shop - Beam"
      const groups = [...pre("Sketch", viewGroups("2d")), ...pre("Rebar", viewGroups("rebar")), ...pre("Shop", viewGroups("shop").filter(g => g[1][0]?.items))];
      const total = groups.reduce((s, g) => s + g[1].length, 0);
      const tick = () => new Promise(r => setTimeout(r)); // let the status line repaint
      for (const [gi, [name, vs]] of groups.entries()) {
        const g = `${String(gi + 1).padStart(2, "0")}_${slug(name)}`;
        status(`Output Sketch: ${name} (PDF, DXF)…`); await tick();
        files.push({ name: `${root}PDF/${g}.pdf`, data: new Uint8Array(toPdf(vs, m).output("arraybuffer")) });
        files.push({ name: `${root}DXF/${g}.dxf`, data: C.buildDxf(vs, { units: $("#dxfUnits").value, colorMode: $("#colorMode").value }) });
      }
      status("Output Sketch: HTML…"); await tick();
      files.push({ name: `${root}HTML/${base}.html`, data: await bundleHtml() });
      download(makeZip(files), `${base}_Sketch.zip`);
      status(`Output Sketch saved: ${total} drawings as PDF, DXF and HTML in ${base}_Sketch.zip.`, "ok");
    } finally { btn.disabled = false; busy(false); }
  },
  csv() {
    const m = state.model, q = v => `"${String(v ?? "").replace(/"/g, '""')}"`, f = v => +v.toFixed(4);
    const rows = [["Elem", "Type", "Member type", "Section", "Material", "Design member", "Nodes", "Length (m)", "X1", "Y1", "Z1", "X2", "Y2", "Z2"]];
    for (const e of m.elems) {
      const a = m.nodes.get(e.nodes[0]), b = m.nodes.get(e.nodes[e.nodes.length > 2 ? 2 : 1]);
      rows.push([e.id, e.type, C.KIND_LABEL[e.kind], e.sectName, e.matl, m.memberOf.get(e.id) ?? "", e.nodes.join(" "), e.L ? f(e.L) : "", f(a.x), f(a.y), f(a.z), f(b.x), f(b.y), f(b.z)]);
    }
    download(new Blob(["\ufeff" + rows.map(r => r.map(q).join(",")).join("\r\n")], { type: "text/csv" }), `${fileBase()}_elements.csv`);
  },
  json() { download(new Blob([JSON.stringify(state.raw)], { type: "application/json" }), `${fileBase()}_model.json`); },
};

// ---------- wiring ----------
function init() {
  loadSettings();
  setupStart();
  $("#startForm").onsubmit = e => { e.preventDefault(); takeProject(); loadFromMidas(); };
  $("#demo").onclick = () => { takeProject("Demo building"); setModel(demoModel(), "Demo model"); };
  $("#openJson").onclick = () => { takeProject(); $("#fileJson").click(); };
  $("#fileJson").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { setModel(JSON.parse(await f.text()), f.name); } catch (err) { status(`Could not read ${f.name}: ${err.message}. Open a model JSON saved from this app or a Gen NX database (DBG) export.`, "err"); }
    e.target.value = "";
  };
  $("#showKey").onclick = e => { const k = $("#key"), show = k.type === "password"; k.type = show ? "text" : "password"; e.currentTarget.setAttribute("aria-pressed", show); e.currentTarget.textContent = show ? "Hide" : "Show"; e.currentTarget.setAttribute("aria-label", show ? "Hide key" : "Show key"); };
  // tabs: arrow keys move between them (the sidebar lists them top to bottom), one tab stop for the group
  $(".tabs").addEventListener("keydown", e => {
    const tabs = [...document.querySelectorAll(".tabs [role=tab]")], i = tabs.indexOf(document.activeElement);
    const j = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (i < 0 || j === undefined) return;
    e.preventDefault(); const t = tabs[(j + tabs.length) % tabs.length]; t.focus(); t.click();
  });
  for (const id of ["colorMode", "labels", "tol", "gridMode", "project", "fontMm", "slabT", "beamTop", "markNoRebar", "gridAlpha"]) $("#" + id).addEventListener("change", rebuild);
  $("#gridAlpha").addEventListener("input", () => { $("#gridAlphaV").textContent = `${$("#gridAlpha").value}%`; });
  $("#applyGrid").onclick = () => { readGridTables(); rebuild(); };
  setupGridTables();
  $("#copyGrid").onclick = () => {
    if (!state.model) return;
    const auto = C.autoGrids(state.model, Math.max(1, +$("#tol").value || 100) / 1000);
    $("#gridX").value = C.gridToText(auto.x); $("#gridY").value = C.gridToText(auto.y);
    $("#gridMode").value = "manual"; fillGridTables(); rebuild();
  };
  for (const id of ["remember", "base", "conn", "dxfUnits", "scope"]) $("#" + id).addEventListener("change", () => { state.connMode = null; saveSettings(); });
  $("#viewType").onchange = () => { state.currentId = null; fillViewSel(); drawCurrent(); };
  $("#groupBar").onclick = e => { const b = e.target.closest("button[data-g]"); if (!b) return; const g = state.groups[+b.dataset.g]; if (!g) return; state.currentId = g[1][0].id; renderViewList(); drawCurrent(); }; // first sheet of that type
  $("#viewSel").onchange = e => { state.currentId = e.target.value; drawCurrent(); };
  $("#prevView").onclick = () => stepView(-1);
  $("#nextView").onclick = () => stepView(1);
  document.querySelectorAll("[data-export]").forEach(b => (b.onclick = async () => {
    if (!need()) return;
    try { await EXPORTS[b.dataset.export](); } catch (e) { status(`Export failed: ${e.message}. Try again; if it repeats, press Ctrl+F5 and reload the model.`, "err"); console.error(e); }
  }));
  $("#edType").onchange = loadEditForm;
  $("#edApply").onclick = () => applyEdit(false);
  $("#edSpan").onchange = spanChanged;
  $("#edReset").onclick = () => { if (confirmed($("#edReset"), "Press again")) applyEdit(true); };
  $("#edResetAll").onclick = resetAllEdits;
  $("#edPush").onclick = pushEdits;
  $("#tab2d").onclick = () => show2d("2d");
  $("#tabRebar").onclick = () => show2d("rebar");
  $("#tab3d").onclick = () => { state.tab = "3d"; setTabs(); document.body.classList.add("is3d"); $("#pane2d").hidden = $("#paneShop").hidden = true; $("#pane3d").hidden = false; show3d(); };
  $("#tabShop").onclick = () => show2d("shop");
  setupShop();
  setupTooltip();
  $("#sheet").innerHTML = '<div class="empty start"><h2>No model loaded yet</h2><p>Load the model open in Gen NX with your MAPI-Key, open a saved model JSON, or look around with the demo model.</p>' +
    '<div class="row"><button type="button" class="primary" data-go="demo">Try the demo model</button><button type="button" data-go="openJson">Open JSON…</button></div></div>';
  $("#sheet").addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) $("#" + b.dataset.go).click(); });
}
// ---------- start page: project name and MAPI-Key first ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function takeProject(fallback = "") {
  const v = $("#startProject").value.trim() || $("#project").value.trim() || fallback;
  $("#project").value = $("#startProject").value = v;
}
function setupStart() {
  document.body.classList.add("on-start");
  $("#appVersion").textContent = VERSION;
  $("#startProject").value = $("#project").value;
  $("#project").addEventListener("change", () => { $("#startProject").value = $("#project").value; });
  const toStart = e => { e?.preventDefault(); if (!state.model) return; $("#startProject").value = $("#project").value; document.body.classList.add("on-start"); $("#startProject").focus(); };
  $("#changeModel").onclick = toStart;
  document.querySelector("[data-go-start]").onclick = toStart;
  $("#backToWork").onclick = () => { takeProject(); rebuild(); document.body.classList.remove("on-start"); };
  $("#logBody").innerHTML = CHANGELOG.map(v => `<section><h3>Version ${esc(v.version)}</h3><p class="who">${esc(v.date)} · requested by ${esc(v.by)} · edited by ${esc(v.editor)}</p><ul>${v.changes.map(c => `<li>${esc(c)}</li>`).join("")}</ul></section>`).join("");
  $("#openLog").onclick = () => $("#logDlg").showModal();
  $("#closeLog").onclick = () => $("#logDlg").close();
  $("#logDlg").addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
}

function setTabs() { document.body.classList.toggle("tab-rebar", state.tab === "rebar"); for (const [id, t] of [["#tab2d", "2d"], ["#tabRebar", "rebar"], ["#tab3d", "3d"], ["#tabShop", "shop"]]) { $(id).classList.toggle("on", state.tab === t); $(id).setAttribute("aria-selected", state.tab === t); $(id).tabIndex = state.tab === t ? 0 : -1; } }
function show2d(tab) {
  const changed = state.tab !== tab;
  state.tab = tab; setTabs();
  document.body.classList.remove("is3d"); $("#pane2d").hidden = false; $("#pane3d").hidden = $("#paneShop").hidden = true;
  if (changed && state.model) {
    if (!tabViews().some(v => v.id === state.currentId)) state.currentId = tabViews()[0]?.id;
    renderViewList();
  }
  drawCurrent();
}

// 3D click on an element with rebar -> its sheet in the Rebar detail tab
addEventListener("message", e => { const id = e.source === $("#frame3d").contentWindow && e.data?.gnxRebar; if (id) openRebarFor([id]); });

init();
window.__appReady = true;

// ---------- Shop drawing: bar bending schedule per beam and column type ----------
const SHAPE_SVG = { // small bar sketches, 44 x 18, by shop.js shape kind
  straight: ['<path d="M3 9h38"/>', "straight"],
  hook: ['<path d="M4 5h36v10"/>', "90° hook one end"],
  hook2: ['<path d="M4 15V5h36v10"/>', "90° hook both ends"],
  foot: ['<path d="M8 3v12h28"/>', "starter with foot"],
  hoop: ['<path d="M12 3h20v12H12z M12 3l5 5 M14 3l5 5"/>', "closed hoop, 135° hooks"],
  tie: ['<path d="M8 6l-3 3h34l-3-3"/>', "cross tie, 135° hooks"],
};
const bbsParams = () => ({ fc: +$("#bbsFc").value || null, stock: +$("#bbsStock").value || 12, waste: +$("#bbsWaste").value || 0 });
const nf = (v, n = 1) => (+v).toLocaleString("en-US", { minimumFractionDigits: n, maximumFractionDigits: n });
function showShop() {
  const host = $("#bbsBody");
  if (!state.model) { host.innerHTML = '<p class="empty">Load a model first.</p>'; return; }
  if (!state.rebar.beams.length && !state.rebar.cols.length) { host.innerHTML = '<p class="empty">This model has no rebar data yet. Add it in Gen NX (Modify Beam / Column Rebar Data) or under Rebar detail &gt; Edit rebar.</p>'; return; }
  const b = state.bbs, part = state.bbsPart || "beams", q = $("#bbsQ").value.trim().toLowerCase();
  document.querySelectorAll("[data-bbs]").forEach(x => x.classList.toggle("on", x.dataset.bbs === part));
  const tot = k => b[k].reduce((s, t) => s + t.kg, 0);
  const head = `<div class="bbs-sum"><span><b>${nf(tot("beams") / 1000, 2)}</b> t beams</span><span><b>${nf(tot("cols") / 1000, 2)}</b> t columns</span><span><b>${nf((tot("beams") + tot("cols")) / 1000 * (1 + b.params.waste / 100), 2)}</b> t to order (${b.params.waste}% waste)</span></div>`;
  if (part === "sum") {
    host.innerHTML = head + `<table class="bbs"><thead><tr><th>Bar</th><th class="n">Beams (kg)</th><th class="n">Columns (kg)</th><th class="n">Total (kg)</th><th class="n">With waste (kg)</th><th class="n">${b.params.stock} m bars</th></tr></thead><tbody>` +
      b.summary.map(x => `<tr><td>${esc(x.bar)}</td><td class="n">${nf(x.beam)}</td><td class="n">${nf(x.col)}</td><td class="n">${nf(x.total)}</td><td class="n">${nf(x.order)}</td><td class="n">${nf(x.bars12, 0)}</td></tr>`).join("") +
      `</tbody><tfoot><tr><td>Total</td><td class="n">${nf(tot("beams"))}</td><td class="n">${nf(tot("cols"))}</td><td class="n">${nf(tot("beams") + tot("cols"))}</td><td class="n">${nf((tot("beams") + tot("cols")) * (1 + b.params.waste / 100))}</td><td class="n">${nf(b.summary.reduce((s, x) => s + x.bars12, 0), 0)}</td></tr></tfoot></table>` + bbsNote(b);
    return;
  }
  const types = b[part].filter(t => !q || t.name.toLowerCase().includes(q));
  host.innerHTML = head + (types.length ? types.map(t => `<section class="bbs-type"><h3>${esc(t.name)} <span>${esc(t.size)} · <b>${nf(t.kg)} kg</b></span> <button type="button" class="link" data-sheet="${esc(t.view)}">Sheet</button></h3>
    <table class="bbs"><thead><tr><th>Mark</th><th>Bar</th><th>Shape</th><th>Description</th><th class="n">Cut length (mm)</th><th class="n">Bars</th><th class="n">Length (m)</th><th class="n">Weight (kg)</th></tr></thead><tbody>` +
    t.rows.map(r => { const sh = SHAPE_SVG[r.shape] || SHAPE_SVG.straight; return `<tr><td translate="no">${esc(r.mark)}</td><td>${esc(r.bar)}</td><td class="shape" title="${esc(sh[1])}"><svg viewBox="0 0 44 18" aria-hidden="true">${sh[0]}</svg><span>${esc(sh[1])}</span></td><td>${esc(r.dims + r.note)}</td><td class="n">${nf(r.cut, 0)}</td><td class="n">${nf(r.n, 0)}</td><td class="n">${nf(r.len, 2)}</td><td class="n">${nf(r.kg)}</td></tr>`; }).join("") +
    `</tbody></table></section>`).join("") : '<p class="empty">No type matches.</p>') + bbsNote(b);
  host.querySelectorAll("[data-sheet]").forEach(x => x.onclick = () => { state.currentId = x.dataset.sheet; renderViewList(); drawCurrent(); });
}
const bbsNote = b => `<p class="bbs-note">Same numbers as the shop drawing sheets (Beam / Column shop drawings above), from the Gen NX rebar data and the model centrelines, by the standard detail: laps, ld and ldh from Table 1.5 (TS-420B) for ${b.params.fc ? `fc' ${b.params.fc} MPa` : "each member's concrete grade (fc' read from the material name)"}; beam top bars lapped at midspan, bottom bars outside 2H from the face; support extras 0.33 Ln, midspan extras 0.5 Ln + 20db; end bars into the column F + G >= 40db with a 90° hook 12db; stirrups zone A = max(0.25 Ln, 2H), first one 50 from the face; column laps at mid-height, ties in zone B = max(b, h, 500, Ho/6) and along laps; starters 40db with a 15db foot. Bars over ${b.params.stock} m spliced. Weight d²/162 kg/m. Check against the drawings before cutting.</p>`;
function setupShop() {
  document.querySelectorAll("[data-bbs]").forEach(x => x.onclick = () => { state.bbsPart = x.dataset.bbs; showShop(); });
  $("#bbsQ").oninput = () => showShop();
  for (const id of ["#bbsFc", "#bbsStock", "#bbsWaste"]) $(id).onchange = () => { if (state.model) rebuild(); };
  $("#bbsCsv").onclick = () => { if (!need()) return; download(new Blob([bbsCsv(state.bbs, $("#project").value)], { type: "text/csv" }), `${fileBase()}_BBS.csv`); status("BBS saved as CSV (opens in Excel).", "ok"); };
}
