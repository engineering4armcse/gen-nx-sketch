// Rebar detail sheets from Gen NX design data:
//   /db/REBB  Modify Beam Rebar Data (per section, I/M/J sectors)
//   /db/REBC  Modify Column Rebar Data (per section)
//   /db/RCHK  Rebar Input for Checking (per element, beam or column)
// Drawn as schedule tables: one column per beam span group / column type, rows for the section sketch and bar lists.
import { tableOf, adders, itemExtents, UNIT_TO_M, sectionOutline } from "./core.js";

// "D25" -> 0.025, "#5" -> 5/8 in, "M20" / "Ø10" / "10" -> mm
export function barDia(name) {
  const s = String(name || "").trim().toUpperCase();
  const us = /^#(\d+)/.exec(s);
  if (us) return (+us[1] * 0.0254) / 8;
  const m = /(\d+(?:\.\d+)?)/.exec(s);
  return m ? +m[1] / 1000 : 0.016;
}
const LAYER_GAP = 0.025; // clear distance between bar layers when the data gives no layer depth
const SECTORS = [["I", "SUPPORT (I-END)"], ["M", "MIDSPAN"], ["J", "SUPPORT (J-END)"]];
// tolerate key variants between Gen NX builds: {NAME,NUM}, {BAR_NAME,BAR_NUM}, {BAR_NAME1,BAR_NUM}, objects keyed by layer
const barNum = b => +(b?.NUM ?? b?.BAR_NUM ?? b?.NUMBER ?? b?.dNUM ?? 0);
const barName = b => String(b?.NAME ?? b?.BAR_NAME ?? b?.BAR_NAME1 ?? b?.DIA ?? "");
const asList = v => (Array.isArray(v) ? v : v && typeof v === "object" ? (barNum(v) ? [v] : Object.values(v)) : []);
const pickKey = (o, re) => { const k = Object.keys(o).find(k => re.test(k) && !/DC|DIST/.test(k)); return k ? o[k] : undefined; };

// -> { beams: [detail], cols: [detail] }
export function parseRebar(raw, model) {
  const f = UNIT_TO_M[model.unit] ?? 1, out = { beams: [], cols: [] };
  const lines = model.elems.filter(e => e.nodes.length === 2), byId = new Map(lines.map(e => [e.id, e]));
  const elemsOf = (sid, kind) => lines.filter(e => e.sect === sid && (!kind || e.kind === kind)).map(e => e.id);

  // REBB: one detail per section item
  for (const [sid, rec] of Object.entries(tableOf(raw.REBB, "REBB"))) {
    // older builds: MAIN_BAR_TOP {LAYER1,LAYER2}, DT/DB covers, SKIN_BAR {NAME,NUM}; sub-sections list their elements in ELEMS.KEYS
    const items = rec.ITEMS || [], subElems = new Set(items.flatMap(it => it.ELEMS?.KEYS || []).map(Number));
    items.forEach((it, i) => {
      const dcT = (+(it.MAIN_BAR_DC_TOP ?? it.DT) || 0.05 / f) * f, dcB = (+(it.MAIN_BAR_DC_BOT ?? it.DB) || 0.05 / f) * f;
      const elems = it.ELEMS?.KEYS ? [...new Set(it.ELEMS.KEYS.map(Number))] : it.CREATE_SUB_SECTION ? [] : elemsOf(+sid).filter(id => !subElems.has(id));
      const layers = (arr, dc) => {
        let d = dc;
        return asList(arr).filter(b => barNum(b) > 0).map((b, j, a) => {
          if (j) d += barDia(barName(a[j - 1])) / 2 + LAYER_GAP + barDia(barName(b)) / 2;
          return { n: barNum(b), bar: barName(b), d };
        });
      };
      const sectors = SECTORS.map(([key, label]) => {
        const s = it["BAR_SECTOR_" + key];
        if (!s) return null;
        const sh = s.SHEAR_BAR || {};
        return {
          key, label, top: layers(s.vMAIN_BAR_TOP ?? pickKey(s, /TOP/), dcT), bot: layers(s.vMAIN_BAR_BOT ?? pickKey(s, /BOT/), dcB),
          stir: sh.NAME ? { bar: String(sh.NAME), leg: +sh.LEG || 2, s: (+sh.DIST || 0) * f } : null,
          skin: s.SKIN_BAR_NAME && +s.SKIN_BAR_NUM ? { bar: String(s.SKIN_BAR_NAME), n: +s.SKIN_BAR_NUM } : barNum(s.SKIN_BAR) ? { bar: barName(s.SKIN_BAR), n: barNum(s.SKIN_BAR) } : null,
        };
      }).filter(Boolean);
      if (sectors.length && elems.length) out.beams.push({ sect: +sid, sub: items.length > 1 ? i + 1 : 0, sectors, elems, src: "Modify Beam Rebar Data", origin: { t: "REBB", i } });
    });
  }

  // REBC: Modify Column Rebar Data, per section. vMAIN_BAR {NAME, NUM total, ROW, D0 cover}, SHEAR_BAR_END/CEN {NAME, LEG_Y, LEG_Z, DIST}.
  // ROW = bars on each face along H (corners included), the rest share the faces along B. DO (cover to bar centre) sits on the item.
  for (const [sid, rec] of Object.entries(tableOf(raw.REBC, "REBC"))) {
    const items = rec.ITEMS || [], subElems = new Set(items.flatMap(it => it.ELEMS?.KEYS || []).map(Number));
    items.forEach((it, i) => {
      const elems = it.ELEMS?.KEYS ? [...new Set(it.ELEMS.KEYS.map(Number))] : it.CREATE_SUB_SECTION ? [] : elemsOf(+sid).filter(id => !subElems.has(id));
      const round = !!(model.sects.get(+sid) || {}).round; // round: NUM bars around, ROW does not apply
      const layers = asList(it.vMAIN_BAR ?? it.MAIN_BAR).filter(b => barNum(b) > 0).map(b => {
        const n = barNum(b), row = round ? 0 : +b.ROW || 0;
        return { dc: (+(b.D0 ?? b.DO ?? it.D0 ?? it.DO) || 0.05 / f) * f, n1: row ? Math.max(2, (n - 2 * row) / 2 + 2) : n, n2: row || 0, bar: barName(b), total: n, corner: b.bUSE_CORNER && b.NAME_CORNER ? String(b.NAME_CORNER) : "" };
      });
      const sh = (o, key) => (o && (o.NAME || o.BAR_NAME) ? { bar: String(o.NAME || o.BAR_NAME), s: (+o.DIST || 0) * f, ny: +o.LEG_Y || 2, nz: +o.LEG_Z || 2, key } : null);
      const end = sh(it.SHEAR_BAR_END, "end"), cen = sh(it.SHEAR_BAR_CEN, "centre");
      if (layers.length && elems.length) out.cols.push({ type: "col", sect: +sid, sub: items.length > 1 ? i + 1 : 0, layers, tie: end || cen, tieCen: end && cen && cen.s !== end.s ? cen : null, spiral: +it.HOOP_TYPE === 2 || /SPIRAL/i.test(it.HOOP_TYPE), elems, src: "Modify Column Rebar Data", origin: { t: "REBC", i } });
    });
  }

  // RCHK: per element, grouped by section + identical rebar
  const groups = new Map();
  for (const [eid, rec] of Object.entries(tableOf(raw.RCHK, "RCHK"))) {
    const el = byId.get(+eid); // RCHK keys are element ids; plates share section numbers, so line elements only
    if (!el) continue;
    let d = null;
    if (String(rec.MEMBTYPE).toUpperCase() === "BEAM" && rec.BEAM) {
      const subs = new Map((rec.BEAM.vSUB_BAR || []).map(s => [String(s.SECTOR).toUpperCase(), s]));
      const layers = arr => (arr || []).filter(b => +b.BAR_NUM > 0).sort((a, b) => (a.LAYER || 0) - (b.LAYER || 0))
        .map(b => ({ n: +b.BAR_NUM, bar: String(b.BAR_NAME1), bar2: b.BAR_NAME2 ? String(b.BAR_NAME2) : "", d: (+b.dD || 0.05 / f) * f }));
      const main = new Map((rec.BEAM.vMAIN || []).map(m => [String(m.SECTOR).toUpperCase(), m]));
      const sectors = SECTORS.filter(([k]) => main.has(k) || subs.has(k)).map(([key, label]) => {
        const m = main.get(key) || {}, s = subs.get(key);
        return {
          key, label, top: layers(m.POS_TOP_LAYERS), bot: layers(m.POS_BOT_LAYERS),
          stir: s && s.SUB_BARNAME ? { bar: String(s.SUB_BARNAME), leg: +s.dSUB_BARNUM || 2, s: (+s.dSUB_BARDIST || 0) * f } : null,
          skin: s && s.LONGIBARNA && +s.dLONGIBARNUM ? { bar: String(s.LONGIBARNA), n: +s.dLONGIBARNUM } : null,
        };
      });
      if (sectors.length) d = { type: "beam", sectors };
    } else if (String(rec.MEMBTYPE).toUpperCase() === "COLUMN" && rec.COLM) {
      const layers = (rec.COLM.vLAYER || []).map(l => {
        const pos = new Map((l.vPOSITION || []).map(p => [String(p.POSITION).toUpperCase(), p]));
        const p1 = pos.get("P1"), p2 = pos.get("P2");
        return { dc: (+l.dDc || 0.05 / f) * f, n1: p1 ? +p1.BAR_NUM : 0, n2: p2 ? +p2.BAR_NUM : 0, bar: String((p1 || p2 || {}).BAR_NAME1 || "") };
      }).filter(l => l.n1 + l.n2 > 0);
      const t = rec.COLM.SUB_BAR || {};
      if (layers.length) d = { type: "col", layers, tie: t.SUBBAR_NAME ? { bar: String(t.SUBBAR_NAME), s: (+t.SUBBAR_DIST || 0) * f, ny: +t.SUBBAR_NUM_Y || 0, nz: +t.SUBBAR_NUM_Z || 0 } : null };
    }
    if (!d) continue;
    const key = el.sect + "|" + JSON.stringify(d);
    if (!groups.has(key)) groups.set(key, { ...d, sect: el.sect, elems: [] });
    groups.get(key).elems.push(el.id);
  }
  const typeNo = new Map();
  for (const g of groups.values()) {
    const n = (typeNo.get(g.type + g.sect) || 0) + 1; typeNo.set(g.type + g.sect, n);
    const det = { ...g, sub: n, src: "Rebar Input for Checking", origin: { t: "RCHK" } };
    (g.type === "col" ? out.cols : out.beams).push(det);
  }
  applyEdits(out, raw.REBAR_USER || {}, model, f, elemsOf);
  // number types per section (B2A3, B2A3-A, B2A3-B ...) only when a section has more than one rebar arrangement
  for (const list of [out.beams, out.cols]) {
    const per = new Map();
    for (const d of list) { if (!per.has(d.sect)) per.set(d.sect, []); per.get(d.sect).push(d); }
    for (const ds of per.values()) ds.forEach((d, i) => (d.sub = ds.length > 1 ? i + 1 : 0));
  }
  for (const list of [out.beams, out.cols]) for (const d of list) d.name = detName(sectionBox(model, d.sect), d);
  return out;
}

// ---------- rebar edited by the user (Rebar detail > Edit rebar), kept in the Model JSON as REBAR_USER ----------
// key "beam|<section name>|<n>" or "col|<section name>|<n>": n = position of the arrangement in that section (0 based).
// Since 3.3 the value also carries _sig (the Gen NX arrangement it was made on) and _elems, so the edit follows its type
// when a model revision reorders the arrangements. A key for a section with no Gen NX rebar adds a type.
// "4D19 + 2D19" -> [{ n: 4, bar: "D19" }, { n: 2, bar: "D19" }]
export const parseBars = t => String(t || "").split("+").map(x => /^\s*(\d+)\s*([A-Z#Ø]*\s*\d+(?:\.\d+)?)\s*$/i.exec(x)).filter(Boolean).map(m => ({ n: +m[1], bar: m[2].replace(/\s+/g, "").toUpperCase() }));
// "D10-100" -> { bar: "D10", s: 0.1 }
export const parseTie = t => { const m = /^\s*([A-Z#Ø]*\s*\d+(?:\.\d+)?)\s*[-@/]\s*(\d+(?:\.\d+)?)\s*$/i.exec(String(t || "")); return m ? { bar: m[1].replace(/\s+/g, "").toUpperCase(), s: +m[2] / 1000 } : null; };
const barsTxt = ls => ls.map(l => `${l.n}${l.bar}`).join(" + ");
const tieStr = t => (t ? `${t.bar}-${Math.round(t.s * 1000)}` : "");

// ---------- edited rebar back to Gen NX (PUT /db/REBB, /db/REBC) ----------
// Each edited type rewrites its own item of the section's record, in the format Gen NX gives (bars as LAYER1, LAYER2 ..., covers
// DT / DB / DO to bar centre and spacings in model units); the section's other items go back as read. Not sent: a type from
// Rebar Input for Checking (per element) and a new type on a section that already has Gen NX rebar.
// -> { tables: { REBB: { sid: record }, REBC: {...} }, sent: [detail], skipped: [detail] }
export function pushRecords(raw, rebar, model) {
  const f = UNIT_TO_M[model.unit] ?? 1, u = m => Math.round((m / f) * 1e6) / 1e6;
  const tables = {}, sent = [], skipped = [];
  const bars = ls => Object.fromEntries(ls.map((b, j) => ["LAYER" + (j + 1), { NAME: b.bar, NUM: b.n }]));
  for (const [t, list] of [["REBB", rebar.beams], ["REBC", rebar.cols]]) for (const d of list.filter(x => x.edited)) {
    const read = tableOf(raw[t], t);
    if (d.origin ? d.origin.t !== t : String(d.sect) in read) { skipped.push(d); continue; }
    const r = ((tables[t] ??= {})[d.sect] ??= structuredClone(read[d.sect] || { ITEMS: [] }));
    const i = d.origin ? d.origin.i : r.ITEMS.length, old = r.ITEMS[i] || {};
    const it = Object.fromEntries(["CREATE_SUB_SECTION", "ID", "ELEMS"].filter(k => k in old).map(k => [k, old[k]])); // a sub-section keeps its elements
    if (t === "REBB") {
      for (const s of d.sectors) {
        const x = { MAIN_BAR_TOP: bars(s.top), MAIN_BAR_BOT: bars(s.bot) };
        if (s.stir) x.SHEAR_BAR = { NAME: s.stir.bar, LEG: s.stir.leg || 2, DIST: u(s.stir.s) };
        if (s.skin) x.SKIN_BAR = { NAME: s.skin.bar, NUM: s.skin.n };
        it["BAR_SECTOR_" + s.key] = x;
      }
      it.DT = u(d.sectors[0]?.top[0]?.d ?? 0.05); it.DB = u(d.sectors[0]?.bot[0]?.d ?? 0.05);
    } else {
      const l = d.layers[0], round = !!(model.sects.get(d.sect) || {}).round, mb = old.MAIN_BAR || {};
      const tie = x => x && { NAME: x.bar, LEG_Y: x.ny || 2, LEG_Z: x.nz || 2, DIST: u(x.s) };
      // NUM = all bars; ROW = bars on each face along H, corners included (as read in parseRebar)
      it.MAIN_BAR = { NAME: l.bar, NUM: round || !l.n2 ? l.n1 : 2 * (l.n1 - 2) + 2 * l.n2, ROW: round ? +mb.ROW || 0 : l.n2, USE_CORNER: mb.USE_CORNER ?? false };
      if (d.tie) { it.SHEAR_BAR_END = tie(d.tie); it.SHEAR_BAR_CEN = tie(d.tieCen || d.tie); }
      it.DO = u(l.dc); it.HOOP_TYPE = old.HOOP_TYPE ?? "Ties"; it.HOOK_TYPE = old.HOOK_TYPE ?? 1;
    }
    r.ITEMS[i] = it; sent.push(d);
  }
  return { tables, sent, skipped };
}

// detail -> editable values (strings and mm), used to fill the form
export function editValues(d, kind) {
  if (kind === "beam") return {
    dcT: Math.round((d.sectors[0]?.top[0]?.d ?? 0.05) * 1000), dcB: Math.round((d.sectors[0]?.bot[0]?.d ?? 0.05) * 1000),
    sectors: Object.fromEntries(SECTORS.map(([k]) => { const x = d.sectors.find(s => s.key === k) || d.sectors[0] || { top: [], bot: [] };
      return [k, { top: barsTxt(x.top), bot: barsTxt(x.bot), stir: tieStr(x.stir), legs: x.stir?.leg || 2, skin: x.skin ? `${x.skin.n}${x.skin.bar}` : "" }]; })),
  };
  const l = d.layers[0] || {}, t = d.tie, c = d.tieCen || t;
  return { n1: l.n1 || "", n2: l.n2 || "", bar: l.bar || "", dc: Math.round((l.dc ?? 0.05) * 1000), tieEnd: tieStr(t), tieMid: tieStr(c), ny: t?.ny || 2, nz: t?.nz || 2 };
}

// fingerprint of a type's Gen NX arrangement (before any edit): bars, covers and ties, not the elements or the name
const rebarSig = d => { const { elems, sub, src, origin, key, name, sect, edited, gsig, ...x } = d; let h = 5381; for (const c of JSON.stringify(x)) h = (h * 33 + c.charCodeAt(0)) >>> 0; return h.toString(36); };
function applyEdits(out, edits, model, f, elemsOf) {
  const sname = sid => (model.sects.get(sid) || {}).name;
  const sidOf = new Map([...model.sects].map(([id, s]) => [s.name, id]));
  out.orphans = []; out.changed = [];
  for (const [kind, list] of [["beam", out.beams], ["col", out.cols]]) {
    const per = new Map();
    for (const d of list) { const n = sname(d.sect); per.set(n, (per.get(n) || 0) + 1); d.key = `${kind}|${n || d.sect}|${per.get(n) - 1}`; d.gsig = rebarSig(d); }
    // an edit finds its type by the Gen NX arrangement it was made on (_sig), so a revision that adds or drops an arrangement
    // of the section does not move it to another type; edits from files before 3.3 have no _sig and keep the position (n)
    const used = new Set();
    for (let [key, v] of Object.entries(edits)) {
      const [k, name] = key.split("|");
      if (k !== kind || !v) continue;
      const same = list.filter(x => sname(x.sect) === name && !used.has(x));
      let d = v._sig && v._sig !== "none" ? same.find(x => x.gsig === v._sig) : same.find(x => x.key === key);
      if (!d && v._sig && v._sig !== "none" && same.length) { // Gen NX changed this arrangement: the type sharing most elements
        const was = new Set(v._elems || []), score = x => x.elems.filter(id => was.has(id)).length;
        d = same.reduce((a, b) => (score(b) > score(a) ? b : a));
        out.changed.push(d);
      }
      if (d && d.key !== key) { delete edits[key]; edits[d.key] = v; key = d.key; } // stored under the type's current key
      if (!d) { // a section without Gen NX rebar
        const sid = sidOf.get(name), elems = sid === undefined ? [] : elemsOf(sid, kind === "beam" ? "beam" : "column");
        if (!elems.length) { out.orphans.push({ key, name, kind }); continue; }
        d = { sect: sid, elems, key, sectors: [], layers: [], gsig: "none" }; list.push(d);
      }
      used.add(d);
      d.src = "rebar edited in this app"; d.edited = true;
      if (kind === "beam") {
        const lay = (bars, dc) => { let y = dc; return parseBars(bars).map((b, j, a) => { if (j) y += barDia(a[j - 1].bar) / 2 + LAYER_GAP + barDia(b.bar) / 2; return { ...b, d: y }; }); };
        const dcT = (+v.dcT || 50) / 1000, dcB = (+v.dcB || 50) / 1000;
        d.sectors = SECTORS.map(([sk, label]) => { const x = v.sectors?.[sk] || {}, st = parseTie(x.stir), sk2 = parseBars(x.skin)[0];
          return { key: sk, label, top: lay(x.top, dcT), bot: lay(x.bot, dcB), stir: st ? { ...st, leg: +x.legs || 2 } : null, skin: sk2 || null }; });
      } else {
        const t = parseTie(v.tieEnd), c = parseTie(v.tieMid) || t, sec = model.sects.get(d.sect) || {};
        const n1 = +v.n1 || 0, n2 = sec.round ? 0 : +v.n2 || 0;
        d.layers = n1 && v.bar ? [{ dc: (+v.dc || 50) / 1000, n1, n2, bar: String(v.bar).toUpperCase(), total: sec.round ? n1 : 0 }] : [];
        d.tie = t ? { ...t, ny: +v.ny || 2, nz: +v.nz || 2 } : null;
        d.tieCen = t && c && c.s !== t.s ? { ...c, ny: d.tie.ny, nz: d.tie.nz } : null;
        d.type = "col";
      }
    }
    // an edit that leaves no bars drops the type
    for (let i = list.length - 1; i >= 0; i--) if (kind === "col" ? !list[i].layers.length : !list[i].sectors.length) list.splice(i, 1);
  }
}

const SCALES = [5, 10, 20, 25, 40, 50, 75, 100]; // the standard's scales (STANDAR GAMBAR, 5. TEXT SIZE)
const CELL_MM = 34; // largest section drawn at most this size on paper; every table on a sheet set shares one scale

function sectionBox(model, sid) {
  const sec = model.sects.get(sid) || {};
  return { sec, name: sec.name || `SECT ${sid}`, B: sec.b || 0.3, H: sec.h || 0.5, round: !!sec.round, general: !!sec.poly };
}

// Drawing standard (STANDAR GAMBAR.dwg, 12. STANDARD PEMBESIAN BALOK / 13. KOLOM): concrete on layer 3 (column outline on
// SS00G6), stirrups and ties on 4, bars filled (REBAR for beams, 6 for columns), dimensions on DIM / SS00G6, table lines on 7,
// names, row labels and headers in ROMAND 2.4 mm, values in ROMANS 2 mm (TG): 60 and 50 at 1:25, as in the standard.
const INK = "#000000", RED = "#b8251c";
const T_LAB = { layer: "3", color: INK, font: "ROMAND", size: 2.4 }, T_VAL = { layer: "TG", color: INK, font: "ROMANS", size: 2 };

// Concrete outline at (cx, cy): rectangle, circle or the general polygon
function concrete(A, s, cx, cy, layer = "3") {
  const st = { layer, color: INK, lw: 0.35 };
  if (s.round) return A.circle([cx, cy], s.H / 2, st);
  const o = s.general ? sectionOutline(s.sec) : null;
  if (o) {
    const all = o.flatMap(p => p.pts), mu = (Math.min(...all.map(q => q[0])) + Math.max(...all.map(q => q[0]))) / 2, mw = (Math.min(...all.map(q => q[1])) + Math.max(...all.map(q => q[1]))) / 2;
    const at = l => l.map(([u, w]) => [cx + u - mu, cy + w - mw]); // centre the bounding box, so dimensions line up
    for (const p of o) { A.poly(at(p.pts), { ...st, closed: true }); for (const h of p.holes) A.poly(at(h), { ...st, closed: true }); }
  }
  else A.poly([[cx - s.B / 2, cy - s.H / 2], [cx + s.B / 2, cy - s.H / 2], [cx + s.B / 2, cy + s.H / 2], [cx - s.B / 2, cy + s.H / 2]], { ...st, closed: true });
}
// beam with the slab it carries: open U for the web, slab top line and flange underside, zig-zag breaks at the flange ends
const flangeO = s => Math.min(Math.max(0.45 * s.B, 0.1), 0.25); // flange shown this far each side
function tBeam(A, s, cx, cy, tf) {
  const st = { layer: "3", color: INK, lw: 0.35 }, L = cx - s.B / 2, R = cx + s.B / 2, top = cy + s.H / 2, bot = cy - s.H / 2, fb = top - tf, o = flangeO(s);
  A.poly([[L, fb], [L, bot], [R, bot], [R, fb]], st);
  A.line([L - o, top], [R + o, top], st);
  A.line([L - o, fb], [L, fb], st); A.line([R, fb], [R + o, fb], st);
  const z = Math.min(tf * 0.28, 0.035), m = (top + fb) / 2;
  for (const x of [L - o, R + o]) A.poly([[x, top + 0.2 * tf], [x, m + z], [x + z * 0.8, m + z * 0.35], [x - z * 0.8, m - z * 0.35], [x, m - z], [x, fb - 0.2 * tf]], { layer: "KOLOM BAWAH", color: INK, lw: 0.13 });
}
// 45° hatch lines inside the rectangle x0..x1, y0..y1, every sp
function hatchRect(A, x0, y0, x1, y1, sp, st) {
  for (let c = x0 - (y1 - y0) + sp / 2; c < x1; c += sp) { // line x = c + (y - y0)
    const a = [Math.max(x0, c), y0 + Math.max(0, x0 - c)], b = [Math.min(x1, c + (y1 - y0)), y0 + Math.min(y1 - y0, x1 - c)];
    if (b[0] > a[0]) A.line(a, b, st);
  }
}
// ground beam (base level, FG / FB / TB): brick on both sides of the web under the slab, lean concrete (50) and a sand bed (100) under it
function groundBed(A, s, cx, cy, tf) {
  const st = { layer: "1", color: INK, lw: 0.18 }, hst = { layer: "A-HATCH", color: INK, lw: 0.09 }, o = flangeO(s);
  const L = cx - s.B / 2, R = cx + s.B / 2, bot = cy - s.H / 2, fb = cy + s.H / 2 - tf, x0 = L - o, x1 = R + o;
  for (const [a, b] of [[x0, L], [R, x1]]) { // brick
    A.poly([[a, bot], [b, bot], [b, fb], [a, fb]], { ...hst, lw: 0.13, closed: true });
    hatchRect(A, a, bot, b, fb, 0.04, hst);
  }
  A.poly([[x0, bot], [x1, bot], [x1, bot - 0.05], [x0, bot - 0.05]], { ...st, closed: true }); // lean concrete
  A.poly([[x0, bot - 0.05], [x1, bot - 0.05], [x1, bot - 0.15], [x0, bot - 0.15]], { ...st, closed: true }); // sand
  for (let x = x0 + 0.02; x < x1 - 0.02; x += 0.035) for (const y of [bot - 0.08, bot - 0.12]) A.circle([x + (y < bot - 0.1 ? 0.017 : 0), y], 0.004, { ...hst, fill: INK, solid: true }); // sand dots
}
const bar = (A, x, y, d, layer = "REBAR") => A.circle([x, y], Math.max(d / 2, 0.004), { layer, color: INK, fill: INK, lw: 0.13, solid: true });
const spread = (n, a, b) => (n <= 1 ? [(a + b) / 2] : Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1)));
// m items spread over arr (inner legs on bar positions)
const pick = (arr, m) => (m > 0 && arr.length ? spread(m + 2, -1, arr.length).slice(1, -1).map(j => arr[Math.min(arr.length - 1, Math.max(0, Math.round(j)))]) : []);
// 135° hook: a hairpin from p going along unit u, about 6 bar diameters long (flip: bends to the other side)
function hook(A, p, u, ds, st, flip = false) {
  // the bend sits at the corner p (as in the standard), the two legs run inward along u, about 6 bar diameters
  const L = Math.max(6 * ds, 0.05), n = flip ? [u[1], -u[0]] : [-u[1], u[0]], w = Math.max(ds, 0.008), r = w / 2;
  const b = [p[0] + u[0] * r, p[1] + u[1] * r], c = [b[0] + n[0] * r, b[1] + n[1] * r], at = (q, t) => [q[0] + u[0] * t, q[1] + u[1] * t];
  const arc = Array.from({ length: 7 }, (_, i) => { const t = (Math.PI * i) / 6; return [c[0] - n[0] * r * Math.cos(t) - u[0] * r * Math.sin(t), c[1] - n[1] * r * Math.cos(t) - u[1] * r * Math.sin(t)]; });
  A.poly([at(b, L), ...arc, at([b[0] + n[0] * w, b[1] + n[1] * w], L)], st);
}
// stirrup / tie: closed loop with rounded corners and a 135° hook at the top-right corner, plus extra inner legs hooked at the top
// (and cross ties hooked on the right), as on the office's typical beam section
function hoop(A, x0, y0, x1, y1, ds, legsV = 0, legsH = 0, bx = null) {
  const st = { layer: "4", color: RED, lw: 0.25 }, r = Math.min(Math.max(1.5 * ds, 0.008), (x1 - x0) / 4, (y1 - y0) / 4);
  const corner = (cx, cy, a0) => Array.from({ length: 4 }, (_, i) => { const a = a0 + (Math.PI / 2) * (i / 3); return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  A.poly([...corner(x1 - r, y0 + r, -Math.PI / 2), ...corner(x1 - r, y1 - r, 0), ...corner(x0 + r, y1 - r, Math.PI / 2), ...corner(x0 + r, y0 + r, Math.PI)], { ...st, closed: true });
  const c = [x1 - r * 0.3, y1 - r * 0.3], u = [-Math.SQRT1_2, -Math.SQRT1_2];
  hook(A, c, u, ds, st, true);
  const xs = bx || spread(legsV + 2, x0, x1).slice(1, -1);
  for (const x of xs.slice(0, legsV)) { A.line([x, y0], [x, y1], st); hook(A, [x, y1], [-Math.SQRT1_2, -Math.SQRT1_2], ds, st, true); }
  for (const y of spread(legsH + 2, y0, y1).slice(1, -1)) { A.line([x0, y], [x1, y], st); hook(A, [x1, y], [-Math.SQRT1_2, Math.SQRT1_2], ds, st, true); }
}

// identical sectors collapse: I = M = J -> ALL, I = J -> BOTH END + MIDDLE, otherwise END I, MIDDLE, END J
function spanGroups(sectors) {
  const key = x => JSON.stringify([x.top, x.bot, x.stir, x.skin]);
  const by = Object.fromEntries(sectors.map(x => [x.key, x]));
  if (by.I && by.M && by.J) {
    if (key(by.I) === key(by.M) && key(by.M) === key(by.J)) return [{ ...by.I, label: "(ALL)" }];
    if (key(by.I) === key(by.J)) return [{ ...by.I, label: "(BOTH END)" }, { ...by.M, label: "(MIDDLE)" }];
    return [{ ...by.I, label: "(END I)" }, { ...by.M, label: "(MIDDLE)" }, { ...by.J, label: "(END J)" }];
  }
  return sectors.map(x => ({ ...x, label: { I: "(END I)", M: "(MIDDLE)", J: "(END J)" }[x.key] || `(${x.label})` }));
}
// A, B, ... Z, AA, AB ...
const typeLetter = n => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const detName = (s, det) => s.name + (det.sub > 1 ? `-${typeLetter(det.sub - 1)}` : ""); // first type keeps the section name (B2), then B2-A, B2-B ...

// beam cross-section centred at (cx, cy): width dimension on top, height on the left (layer DIM)
function drawBeamSection(A, s, sec, cx, cy, k, { tf = 0, ground = false } = {}) {
  const L = cx - s.B / 2, R = cx + s.B / 2, top = cy + s.H / 2, bot = cy - s.H / 2;
  if (tf > 0 && tf < s.H * 0.8 && !s.round && !s.general) tBeam(A, s, cx, cy, tf); else concrete(A, s, cx, cy);
  if (ground) groundBed(A, s, cx, cy, tf);
  const db = l => barDia(l.bar), ds = sec.stir ? barDia(sec.stir.bar) : 0.01;
  const dcT = sec.top[0]?.d ?? 0.05, dcB = sec.bot[0]?.d ?? 0.05, side = Math.min(dcT, dcB); // side cover taken as the smaller of top/bottom
  const sx0 = L + side - (sec.top[0] ? db(sec.top[0]) : 0.016) / 2 - ds / 2, sx1 = R - (sx0 - L);
  const sy1 = top - dcT + (sec.top[0] ? db(sec.top[0]) : 0.016) / 2 + ds / 2, sy0 = bot + dcB - (sec.bot[0] ? db(sec.bot[0]) : 0.016) / 2 - ds / 2;
  const bx = l => spread(l.n, L + side, R - side);
  for (const l of sec.top) for (const x of bx(l)) bar(A, x, top - l.d, db(l));
  for (const l of sec.bot) for (const x of bx(l)) bar(A, x, bot + l.d, db(l));
  if (sec.skin) for (const y of spread(sec.skin.n + 2, bot + dcB, top - dcT).slice(1, -1)) { bar(A, L + side, y, barDia(sec.skin.bar)); bar(A, R - side, y, barDia(sec.skin.bar)); }
  if (sec.stir) {
    const m = Math.max(0, sec.stir.leg - 2), xs = sec.top[0] ? bx(sec.top[0]).slice(1, -1) : [];
    hoop(A, sx0, sy0, sx1, sy1, ds, m, 0, xs.length >= m ? pick(xs, m) : null); // inner legs on the inner top bars
  }
  A.dimChain([L, R], top + 3 * k, "h", 1);
  A.dimChain([bot, top], L - (tf > 0 ? Math.min(Math.max(0.45 * s.B, 0.1), 0.25) : 0) - 3 * k, "v", -1);
}

// bars round a rectangle: P1 = bars on each face along B, P2 = on each face along H (corners counted in both).
// REBC ROW = bars on each face along H (checked against Arnold's K26: 14 bars, ROW 7 -> 2 x 7). No ROW = total round the perimeter
function rectBars(n1, n2, B, H) {
  let nx = n1, ny = n2;
  if (!n2) { // total only: share the bars between faces by length, 4 corners first
    const rest = Math.max(0, n1 - 4);
    const ix = Math.round((rest / 2) * (B / (B + H)));
    nx = ix + 2; ny = Math.max(2, Math.round((rest - 2 * ix) / 2) + 2);
  }
  return { nx: Math.max(2, nx), ny: Math.max(2, ny) };
}

// column section centred at (cx, cy); returns the main-bar texts per layer
function drawColumnSection(A, s, det, cx, cy, k) {
  const rows = { main: [], layout: [] }, tieD = det.tie ? barDia(det.tie.bar) : 0.01, tst = { layer: "4", color: RED, lw: 0.25 };
  concrete(A, s, cx, cy, "SS00G6");
  det.layers.forEach((l, li) => {
    const d = barDia(l.bar), pre = det.layers.length > 1 ? `L${li + 1}: ` : "";
    if (s.round) {
      const n = l.total || l.n1 + l.n2, r = s.H / 2 - l.dc;
      for (let i = 0; i < n; i++) bar(A, cx + r * Math.cos((2 * Math.PI * i) / n + Math.PI / 2), cy + r * Math.sin((2 * Math.PI * i) / n + Math.PI / 2), d, "6");
      rows.main.push(`${pre}${n} - ${l.bar}`); rows.layout.push("round");
      if (li === 0 && det.tie) A.circle([cx, cy], r + d / 2 + tieD / 2, tst);
    } else if (s.general) {
      rows.main.push(`${pre}${l.total || l.n1 + l.n2} - ${l.bar}`); rows.layout.push("not drawn");
    } else {
      const { nx, ny } = rectBars(l.n1, l.n2, s.B, s.H), x0 = cx - s.B / 2 + l.dc, x1 = cx + s.B / 2 - l.dc, y0 = cy - s.H / 2 + l.dc, y1 = cy + s.H / 2 - l.dc;
      const pts = new Map(), put = (x, y) => pts.set(x.toFixed(4) + "," + y.toFixed(4), [x, y]);
      for (const x of spread(nx, x0, x1)) { put(x, y0); put(x, y1); }
      for (const y of spread(ny, y0, y1)) { put(x0, y); put(x1, y); }
      for (const [x, y] of pts.values()) bar(A, x, y, d, "6");
      rows.main.push(`${pre}${pts.size} - ${l.bar}${l.corner ? ` (corner ${l.corner})` : ""}`); rows.layout.push(`${nx} x ${ny}`);
      if (li === 0 && det.tie) {
        const o = l.dc - d / 2 - tieD / 2;
        const X0 = cx - s.B / 2 + o, X1 = cx + s.B / 2 - o, Y0 = cy - s.H / 2 + o, Y1 = cy + s.H / 2 - o;
        hoop(A, X0, Y0, X1, Y1, tieD, 0, 0);
        // cross ties beyond the hoop's two legs, hooked at one end: Y legs run along local y (across B, drawn horizontal), Z legs along local z (across H)
        for (const y of pick(spread(ny, y0, y1).slice(1, -1), Math.max(0, det.tie.ny - 2))) { A.line([X0, y], [X1, y], tst); hook(A, [X1, y], [-Math.SQRT1_2, Math.SQRT1_2], tieD, tst, true); }
        for (const x of pick(spread(nx, x0, x1).slice(1, -1), Math.max(0, det.tie.nz - 2))) { A.line([x, Y0], [x, Y1], tst); hook(A, [x, Y1], [-Math.SQRT1_2, -Math.SQRT1_2], tieD, tst, true); }
      }
    }
  });
  A.dimChain([cx - s.B / 2, cx + s.B / 2], cy - s.H / 2 - 3 * k, "h", -1);
  A.dimChain([cy - s.H / 2, cy + s.H / 2], cx - s.B / 2 - 3 * k, "v", -1);
  return rows;
}

const mm = v => Math.round(v * 1000);
const sizeTxt = s => (s.round ? `Ø${mm(s.H)}` : `${mm(s.B)} x ${mm(s.H)}`);
const tieTxt = t => (t ? `${t.bar}-${mm(t.s)}` : "-");
// ties end / middle / end: "D10-100/150/100" (bar named again when the middle one differs)
const tieEMEtxt = (e, m) => `${e.bar}-${mm(e.s)}/${m.bar === e.bar ? "" : m.bar + "-"}${mm(m.s)}/${mm(e.s)}`;
// standard notation: "6-D16" (layers of one bar size added up), "4-D16/2-D19" for mixed sizes, "D10 @150"
const barsStd = ls => !ls.length ? "-" : ls.every(l => l.bar === ls[0].bar && !l.bar2) ? `${ls.reduce((s, l) => s + l.n, 0)}-${ls[0].bar}` : ls.map(l => `${l.n}-${l.bar}${l.bar2 ? "+" + l.bar2 : ""}`).join("/");
const stirStd = t => (t ? `${t.bar} @${mm(t.s)}${t.leg > 2 ? ` (${t.leg} legs)` : ""}` : "-");
const charW = (h, fs) => h * 0.85 * fs; // character width (mm) of a text h mm high, with room for ROMANS in CAD

// Beam schedule as in the standard: one column per span position, rows NAME / SECTION / TOP BAR / BOTTOM BAR / STIRRUP / SKIN BAR.
// groups: [{ name, elems, cols: [{ label, sec (section box), draw(A, cx, cy), vals: { row: text } }] }]
// Groups are placed left to right in bands (a band is one table), bands top to bottom, then a new A3 sheet.
function beamSheets(groups, rowDefs, { k, fs, kind, label, note }) {
  const W = 300, H = 248, labW = 38 * fs, hHead = 8 * fs, hVal = 7 * fs;
  const maxB = Math.max(...groups.flatMap(g => g.cols.map(c => c.sec.B + (c.tf ? 2 * Math.min(Math.max(0.45 * c.sec.B, 0.1), 0.25) : 0))));
  const maxH = Math.max(...groups.flatMap(g => g.cols.map(c => c.sec.H + (c.ground ? 0.15 : 0))));
  const hDraw = maxH / k + 28; // position label + section + dimensions + margin
  const longest = Math.max(4, ...groups.flatMap(g => g.cols.flatMap(c => Object.values(c.vals).map(t => String(t).length))));
  const colW = Math.max(30, maxB / k + 16, longest * charW(2, fs) + 6);
  const bandH = hHead + hDraw + rowDefs.length * hVal, gap = 10;
  const sheets = [];
  let sheet = null, band = null, y = 0;
  const newSheet = () => { sheet = { names: [], hits: [], bands: [] }; sheets.push(sheet); y = 0; band = null; };
  const newBand = () => {
    if (!sheet || (band && y + bandH + gap + bandH > H)) newSheet();
    else if (band) y += bandH + gap;
    band = { x: labW, y, groups: [] }; sheet.bands.push(band);
  };
  newBand();
  for (const g of groups) {
    const w = g.cols.length * colW;
    if (band.groups.length && band.x + w > W) newBand();
    band.groups.push({ g, x: band.x });
    sheet.hits.push({ elems: g.elems || [], box: [band.x * k, -(band.y + bandH) * k, (band.x + w) * k, -band.y * k] }); // table cells of this type, for 3D click-through
    band.x += w; sheet.names.push(g.name);
  }
  return sheets.map((sh, si) => {
    const items = [], A = adders(items, k, fs, { dim: "DIM" }), P = (x, yy) => [x * k, -yy * k];
    const thin = { layer: "7", color: INK, lw: 0.18 }, thick = { ...thin, lw: 0.35 };
    for (const b of sh.bands) {
      const y0 = b.y, x1 = b.x, yRows = [y0 + hHead, y0 + hHead + hDraw];
      rowDefs.forEach((_, i) => yRows.push(yRows[1] + (i + 1) * hVal));
      const yEnd = yRows[yRows.length - 1];
      A.line(P(0, y0), P(x1, y0), thick); A.line(P(0, yEnd), P(x1, yEnd), thick);
      for (const yy of yRows.slice(0, -1)) A.line(P(0, yy), P(x1, yy), thin);
      A.line(P(0, y0), P(0, yEnd), thick); A.line(P(labW, y0), P(labW, yEnd), thick);
      const lab = (t, ya, yb) => A.text(P(2.5, (ya + yb) / 2), t, { ...T_LAB, align: "left", valign: "middle" });
      lab("NAME", y0, yRows[0]); lab("SECTION", yRows[0], yRows[1]);
      rowDefs.forEach(([, t], i) => lab(t, yRows[1 + i], yRows[2 + i]));
      for (const { g, x } of b.groups) {
        const gx1 = x + g.cols.length * colW;
        A.line(P(gx1, y0), P(gx1, yEnd), thick);
        A.text(P((x + gx1) / 2, (y0 + yRows[0]) / 2), g.name, { ...T_LAB, align: "center", valign: "middle" });
        g.cols.forEach((c, ci) => {
          const cx0 = x + ci * colW, cxm = cx0 + colW / 2;
          if (ci) A.line(P(cx0, yRows[0]), P(cx0, yEnd), thin);
          A.text(P(cxm, yRows[0] + 2.5), c.label, { ...T_VAL, layer: "3", align: "center", valign: "top" }); // position at the top of the cell
          c.draw(A, cxm * k + 2 * k, -((yRows[0] + yRows[1]) / 2 + 3) * k); // a little right and down: room for the label and dimensions
          rowDefs.forEach(([key], i) => A.text(P(cxm, (yRows[1 + i] + yRows[2 + i]) / 2), c.vals[key] ?? "-", { ...T_VAL, align: "center", valign: "middle" }));
        });
      }
    }
    const e = itemExtents(items);
    if (note) addNote(items, note, e, k);
    const range = sh.names.length > 1 ? `${sh.names[0]} to ${sh.names[sh.names.length - 1]}` : sh.names[0];
    return { kind: "rebar", sub: kind, id: `rebar:${kind}:${si}`, title: `${label} - ${si + 1}/${sheets.length} (${range})`, scale: Math.round(k * 1000), k, items, legend: [], hits: sh.hits };
  });
}

// Column schedule as in the standard: one row per type, DIMENSI (section with its name) | TULANGAN: UTAMA | SENGKANG.
// Rows run down a table; full tables sit side by side, then a new A3 sheet.
function colSheets(groups, { k, fs, kind, label, note }) {
  const W = 300, H = 248, hH1 = 7 * fs, hH2 = 7 * fs, cw = charW(2, fs);
  const maxB = Math.max(...groups.map(g => g.cols[0].sec.B)), rowH = g => Math.max(26, g.cols[0].sec.H / k + 20 + (g.cols[0].sec.B / k < 12 ? 5 : 0)); // narrow: the width text sits below its dimension // each row as tall as its section
  const wD = Math.max(40, maxB / k + 22);
  const len = key => Math.max(...groups.flatMap(g => [].concat(g.cols[0].vals[key] || "-").map(t => String(t).length)));
  const wU = Math.max(32, len("main") * cw + 8), wS = Math.max(32, len("ties") * cw + 8), tabW = wD + wU + wS, gap = 10;
  // fill tables top to bottom, tables left to right, then a new sheet
  const perRow = Math.max(1, Math.floor((W + gap) / (tabW + gap))), sheets = [];
  let tab = null, hUsed = 0;
  for (const g of groups) {
    if (!tab || (tab.length && hUsed + rowH(g) > H - hH1 - hH2)) {
      const sh = sheets[sheets.length - 1];
      if (!sh || sh.length >= perRow) sheets.push([]);
      tab = []; sheets[sheets.length - 1].push(tab); hUsed = 0;
    }
    tab.push(g); hUsed += rowH(g);
  }
  return sheets.map((tabs, si) => {
    const gs = tabs.flat();
    const items = [], A = adders(items, k, fs, { dim: "SS00G6" }), P = (x, yy) => [x * k, -yy * k], hits = [];
    const thin = { layer: "7", color: INK, lw: 0.18 }, thick = { ...thin, lw: 0.35 }, head = { ...T_VAL, layer: "7", font: "ROMAND", size: 2.4 };
    tabs.forEach((rows, t) => {
      const x0 = t * (tabW + gap), xa = x0 + wD, xb = xa + wU, x1 = xb + wS, yEnd = hH1 + hH2 + rows.reduce((h, g) => h + rowH(g), 0);
      A.line(P(x0, 0), P(x1, 0), thick); A.line(P(x0, yEnd), P(x1, yEnd), thick);
      A.line(P(xa, hH1), P(x1, hH1), thin); A.line(P(x0, hH1 + hH2), P(x1, hH1 + hH2), thick);
      A.line(P(x0, 0), P(x0, yEnd), thick); A.line(P(x1, 0), P(x1, yEnd), thick); A.line(P(xa, 0), P(xa, yEnd), thick); A.line(P(xb, hH1), P(xb, yEnd), thin);
      A.text(P((x0 + xa) / 2, (hH1 + hH2) / 2), "DIMENSI", { ...head, align: "center", valign: "middle" });
      A.text(P((xa + x1) / 2, hH1 / 2), "TULANGAN", { ...head, align: "center", valign: "middle" });
      A.text(P((xa + xb) / 2, hH1 + hH2 / 2), "UTAMA", { ...head, align: "center", valign: "middle" });
      A.text(P((xb + x1) / 2, hH1 + hH2 / 2), "SENGKANG", { ...head, align: "center", valign: "middle" });
      let yy = hH1 + hH2;
      rows.forEach((g, ri) => {
        const c = g.cols[0], ya = yy, yb = (yy += rowH(g));
        if (ri) A.line(P(x0, ya), P(x1, ya), thin);
        A.text(P(x0 + 2.5, ya + 2.5), g.name, { ...T_LAB, layer: "4", align: "left", valign: "top" });
        c.draw(A, ((x0 + xa) / 2 + 3) * k, -((ya + yb) / 2 + 2) * k);
        const put = (vals, xm) => { const ls = [].concat(vals || "-"); ls.forEach((s, i) => A.text(P(xm, (ya + yb) / 2 + (i - (ls.length - 1) / 2) * 4.5 * fs), s, { ...T_VAL, layer: "7", align: "center", valign: "middle" })); };
        put(c.vals.main, (xa + xb) / 2); put(c.vals.ties, (xb + x1) / 2);
        hits.push({ elems: g.elems || [], box: [x0 * k, -yb * k, x1 * k, -ya * k] });
      });
    });
    const e = itemExtents(items);
    if (note) addNote(items, note, e, k);
    const range = gs.length > 1 ? `${gs[0].name} to ${gs[gs.length - 1].name}` : gs[0].name;
    return { kind: "rebar", sub: kind, id: `rebar:${kind}:${si}`, title: `${label} - ${si + 1}/${sheets.length} (${range})`, scale: Math.round(k * 1000), k, items, legend: [], hits };
  });
}

// beams at the base (tie beams on the ground): all nodes at the lowest level, or named FG / FB / TB
function groundOf(model, nameOf) {
  const N = id => model.nodes.get(id), zMin = Math.min(...[...model.nodes.values()].map(n => n.z)), byId = new Map(model.elems.map(e => [e.id, e]));
  return det => {
    const els = det.elems.map(id => byId.get(id)).filter(Boolean);
    return /^(FG|FB|TB)/i.test(nameOf(det)) || (els.length > 0 && els.every(e => e.nodes.every(id => N(id).z <= zMin + 0.05)));
  };
}

// note under the tables, wrapped to the table width (at least 120 mm) so a long note never widens the sheet
function addNote(items, note, e, k) {
  const h = 2, maxCh = Math.max(120, (e.x1 - e.x0) / k) / (h * 0.75), lines = [""];
  for (const w of note.split(" ")) { const l = lines[lines.length - 1]; if (l && (l + " " + w).length > maxCh) lines.push(w); else lines[lines.length - 1] = l ? l + " " + w : w; }
  lines.forEach((s, i) => items.push({ t: "text", p: [e.x0, e.y0 - (5 + i * 3) * k], s, h: h * k, align: "left", valign: "top", layer: "TEXT UMUM", color: "#555555" }));
}
const edNote = ds => (ds.some(d => d.edited) ? " (* rebar edited in this app)" : "");
// table definitions shared by the sheets and the 3D hover cards: [{ groups, sheets(groups, o), o }] per member kind
function rebarTables(model, rebar, opts = {}) {
  const fs = opts.fontScale || 1, byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const scaleFor = dets => {
    const m = Math.max(0.2, ...dets.map(d => { const s = sectionBox(model, d.sect); return Math.max(s.B, s.H); }));
    return (SCALES.find(sc => (m * 1000) / sc <= CELL_MM) || 100) / 1000;
  };
  const tables = [];
  if (rebar.beams.length) {
    const k = scaleFor(rebar.beams), isGround = groundOf(model, det => det.name || detName(sectionBox(model, det.sect), det)), tf = opts.slabT ?? 0.12; // one slab thickness for every beam, set in the app
    const groups = rebar.beams.map(det => {
      const s = sectionBox(model, det.sect), ground = isGround(det);
      return { name: (det.name || detName(s, det)) + (det.edited ? " *" : ""), elems: det.elems, cols: spanGroups(det.sectors).map(sec => ({
        label: sec.label, sec: s, tf, ground, draw: (A, cx, cy) => drawBeamSection(A, s, sec, cx, cy, k, { tf, ground }),
        vals: { top: barsStd(sec.top), bot: barsStd(sec.bot), stir: stirStd(sec.stir), skin: sec.skin ? `${2 * sec.skin.n}-${sec.skin.bar}` : "-" },
      })), rank: [/^FG/i, /^FB/i, /^TB/i].findIndex(re => re.test(det.name || s.name)) >>> 0 >= 3 ? (ground ? 3 : 4) : [/^FG/i, /^FB/i, /^TB/i].findIndex(re => re.test(det.name || s.name)) };
    }).sort((a, b) => a.rank - b.rank || byName(a, b)); // base level first (FG, FB, TB, other ground beams), then B, G ... by name
    const rows = [["top", "TOP BAR"], ["bot", "BOTTOM BAR"], ["stir", "STIRRUP"], ["skin", "SKIN BAR"]];
    tables.push({ groups, sheets: beamSheets, rows, o: { k, fs, kind: "beamrebar", label: "BEAM REBAR", note: "Gen NX Modify Beam Rebar Data" + edNote(rebar.beams) + ". Skin bar = total of both faces. Bars drawn evenly spaced; " + (tf > 0 ? `every beam drawn with a ${mm(tf)} mm slab flange; ` : "") + "ground beams (base level, FG / FB / TB) with brick, lean concrete and sand. Check before issue." } });
  }
  if (rebar.cols.length) {
    const k = scaleFor(rebar.cols);
    const groups = rebar.cols.map(det => {
      const s = sectionBox(model, det.sect), col = { label: "", sec: s, vals: {} };
      col.draw = (A, cx, cy) => drawColumnSection(A, s, det, cx, cy, k);
      // texts are known before drawing for the table width, so run the bar layout once on a scratch list
      const r = drawColumnSection(adders([], k), s, det, 0, 0, k), sp = det.spiral ? "SPIRAL " : "";
      col.vals = { main: r.main, ties: [det.tieCen ? sp + tieEMEtxt(det.tie, det.tieCen) : det.tie ? sp + tieTxt(det.tie) : "-"] };
      return { name: (det.name || detName(s, det)) + (det.edited ? " *" : ""), elems: det.elems, cols: [col], spiral: det.spiral };
    }).sort(byName);
    tables.push({ groups, sheets: (gs, rows, o) => colSheets(gs, o), rows: [], o: { k, fs, kind: "colrebar", label: "COLUMN REBAR", note: "Gen NX column rebar data" + edNote(rebar.cols) + ". Ties D10-100/150/100 = end / middle / end. Bars drawn evenly spaced. Check before issue." } });
  }
  return tables;
}

export function buildRebarViews(model, rebar, opts = {}) {
  return rebarTables(model, rebar, opts).flatMap(t => t.sheets(t.groups, t.rows, t.o));
}

// one small table per rebar type for the 3D hover: [{ elems, view }] (view.bare: no paper frame, cropped to the table)
export function rebarCards(model, rebar, opts = {}) {
  return rebarTables(model, rebar, { slabT: opts.slabT }).flatMap(t => t.groups.map(g => ({ elems: g.elems, view: { ...t.sheets([g], t.rows, { ...t.o, note: "" })[0], bare: true } })));
}
