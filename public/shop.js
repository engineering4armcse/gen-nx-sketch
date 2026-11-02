// Shop drawings (beam lines and column stacks) and the bar bending schedule, after the office STANDARD DETAIL (T-01 .. T-08):
//   1.3 / 1.2  hooks: main bars 90° 12db, stirrups and ties 135° max(6ds, 75)
//   1.5        development and lap lengths by concrete strength (ld, lde, ldh, ls) for TS-420B
//   4.1        no beam splice within 2HB of a support face; top bars spliced at midspan
//   4.2        web bars by beam depth: <= 500 none, <= 700 2D13, <= 900 2 x 2D13, > 900 as drawn
//   5.0 / 5.2  beams: support stirrups over max(0.25Ln, 2HB), first one 50 from the face, top extras 0.33 of the larger
//              adjacent clear span, end anchorage into the column core with a 90° hook, F + G >= 40db;
//              columns: ties over B = max(bc, hc, 500, Ho/6) at each end and through the joint, splices at mid height
//              (outside 2hc of the beam faces), ties at <= 100 along a splice; bars into the pile cap 40db with a 15db foot
// Lengths come from the model centrelines and the Gen NX rebar data; every sheet says so and asks to check before cutting.
import { adders, colAxes, sectionOutline, tagOf, fmtEl, itemExtents } from "./core.js";
import { barDia, colBars, beamBox, drawColSection } from "./rebar.js";

// ---------- 1.5 TABEL PANJANG PENJANGKARAN MINIMUM (TS-420B): fc -> db -> [ld, lde, ldh, ls] in mm ----------
const ANCH = {
  20: { 10: [450, 590, 230, 590], 13: [590, 760, 300, 760], 16: [720, 940, 370, 940], 19: [850, 1110, 430, 1110], 22: [1220, 1580, 500, 1580], 25: [1390, 1800, 570, 1800], 29: [1610, 2090, 660, 2090], 32: [1770, 2300, 730, 2300] },
  25: { 10: [400, 520, 210, 520], 13: [520, 680, 270, 680], 16: [640, 840, 330, 840], 19: [760, 990, 390, 990], 22: [1090, 1420, 450, 1420], 25: [1240, 1610, 510, 1610], 29: [1440, 1870, 590, 1870], 32: [1590, 2060, 650, 2060] },
  30: { 10: [370, 480, 200, 480], 13: [480, 620, 240, 620], 16: [590, 760, 300, 760], 19: [700, 910, 350, 910], 22: [1000, 1300, 410, 1300], 25: [1130, 1470, 470, 1470], 29: [1310, 1710, 540, 1710], 32: [1450, 1880, 590, 1880] },
  35: { 10: [340, 440, 200, 440], 13: [440, 580, 240, 580], 16: [550, 710, 290, 710], 19: [650, 840, 350, 840], 22: [920, 1200, 400, 1200], 25: [1050, 1360, 460, 1360], 29: [1220, 1580, 530, 1580], 32: [1340, 1740, 580, 1740] },
  40: { 10: [320, 420, 200, 420], 13: [420, 540, 240, 540], 16: [510, 660, 290, 660], 19: [610, 790, 350, 790], 22: [860, 1120, 400, 1120], 25: [980, 1270, 460, 1270], 29: [1140, 1480, 530, 1480], 32: [1260, 1630, 580, 1630] },
  45: { 10: [300, 390, 200, 390], 13: [390, 510, 240, 510], 16: [480, 630, 290, 630], 19: [570, 740, 350, 740], 22: [820, 1060, 400, 1060], 25: [930, 1200, 460, 1200], 29: [1070, 1390, 530, 1390], 32: [1180, 1540, 580, 1540] },
};
export const FC_TABLE = Object.keys(ANCH).map(Number);
// concrete strength from a material name: "Fc30", "fc' 30", "C30", "K-300" (K / 12, rounded); null when none
export function fcOf(matl) {
  const s = String(matl || ""), k = /\bK\s*-?\s*(\d{3})\b/i.exec(s);
  if (k) return Math.round(+k[1] / 12);
  const m = /(?:f'?c'?|C)\s*'?\s*=?\s*(\d{2}(?:\.\d+)?)/i.exec(s) || /(\d{2}(?:\.\d+)?)/.exec(s);
  return m ? +m[1] : null;
}
// table row used for a strength: the largest tabled fc not above it (on the safe side), 20 .. 45
export const fcRow = fc => FC_TABLE.filter(f => f <= (fc || 25)).pop() || 20;
// lengths in m for a bar d (m) in concrete fc: { ld, lde, ldh, ls }; sizes off the table scale from the nearest one
export function anchorage(fc, d) {
  const row = ANCH[fcRow(fc)], db = Math.round(d * 1000), keys = Object.keys(row).map(Number);
  const near = keys.reduce((a, b) => (Math.abs(b - db) < Math.abs(a - db) ? b : a)), f = row[near].map(v => (v * db) / near / 1000);
  return row[db] ? { ld: row[db][0] / 1000, lde: row[db][1] / 1000, ldh: row[db][2] / 1000, ls: row[db][3] / 1000 } : { ld: f[0], lde: f[1], ldh: f[2], ls: f[3] };
}
export const SHOP_DEFAULTS = { stock: 12, waste: 5, fc: null }; // fc null: from each member's material
const hk135 = d => Math.max(6 * d, 0.075), hk90 = d => 12 * d, kgm = d => (d * 1000) ** 2 / 162;
const mm = v => Math.round(v * 1000), r5 = v => Math.ceil((v * 1000) / 5) * 5;
const byBar = layers => { const m = new Map(); for (const l of layers || []) m.set(l.bar, (m.get(l.bar) || 0) + l.n); return m; };
const INK = "#000000", RED = "#c3262c", BAR_C = "#b8251c";
const T = { layer: "TG", color: INK, font: "ROMANS", size: 2 }, TB = { layer: "TEXT JUDUL", color: INK, font: "ROMAND", size: 2.4 };
const ST = { bar: { layer: "REBAR", color: BAR_C, lw: 0.35 }, stir: { layer: "4", color: BAR_C, lw: 0.18 }, conc: { layer: "3", color: INK, lw: 0.35 }, thin: { layer: "7", color: INK, lw: 0.18 }, hid: { layer: "SS00GG", color: "#8a929c", lw: 0.13, dash: "center" }, lvl: { layer: "SS00G1", color: "#0050a0", lw: 0.13, dash: "dashed" } };

// ---------- model helpers ----------
function framing(model) {
  const N = id => model.nodes.get(id), atNode = new Map();
  for (const e of model.elems) if (e.nodes.length === 2) for (const id of e.nodes) (atNode.get(id) || atNode.set(id, []).get(id)).push(e);
  const vertAt = new Set(model.elems.filter(e => e.kind === "column" || e.kind === "wall").flatMap(e => e.nodes));
  const dir = e => { const a = N(e.nodes[0]), b = N(e.nodes[1]), l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1; return [(b.x - a.x) / l, (b.y - a.y) / l, (b.z - a.z) / l]; };
  return { N, atNode, vertAt, dir };
}
// extent of a column (at a node) along a plan direction u: [behind, ahead] in m from the node
function colExtent(model, c, u) {
  const sec = model.sects.get(c.sect), outl = sec?.h ? sectionOutline(sec) : null;
  if (!outl) { const h = (sec?.h || 0.3) / 2; return [h, h]; }
  const [zv, yv] = colAxes(model, c), vs = outl.flatMap(o => o.pts).map(([p, w]) => (w * zv[0] + p * yv[0]) * u[0] + (w * zv[1] + p * yv[1]) * u[1]);
  return [-Math.min(...vs), Math.max(...vs)];
}
const fcFor = (opts, e) => opts.fc || fcOf(e?.matl) || 25;
const levelName = (levels, z) => { const l = (levels || []).reduce((a, b) => (Math.abs(b.z - z) < Math.abs((a?.z ?? 1e9) - z) ? b : a), null); return l && Math.abs(l.z - z) < 0.3 ? l.name : `EL. ${fmtEl(z)}`; };
const gridName = (gs, v) => { // the grid's label, or the nearest grid plus the offset in mm ("3 +1625")
  const g = (gs || []).reduce((a, b) => (Math.abs(b.v - v) < Math.abs((a?.v ?? 1e9) - v) ? b : a), null);
  if (!g) return `${mm(v)}`;
  const d = mm(v - g.v);
  return Math.abs(v - g.v) < 0.3 ? g.label : `${g.label} ${d > 0 ? "+" : ""}${d}`;
};

// ---------- bars along a line: pieces no longer than the stock, spliced with ls at the allowed places ----------
// zones: centres where a splice may sit (sorted). Returns [[s0, s1]] pieces (overlapping by ls at each splice).
function splitBar(s0, s1, ls, stock, zones) {
  const out = []; let a = s0;
  while (s1 - a > stock + 1e-6) {
    const ok = zones.filter(c => c - ls / 2 > a + 0.3 && c + ls / 2 - a <= stock);
    const c = ok.length ? ok[ok.length - 1] : a + stock - ls / 2; // no allowed place: at the stock length (marked)
    out.push([a, c + ls / 2, !ok.length]); a = c - ls / 2;
  }
  out.push([a, s1, false]);
  return out;
}

// ---------- beam lines ----------
// One line = collinear beams at one level joined node to node; spans between columns / walls (or crossing beams when the
// line has no column at all). -> [{ name, z, dir, start, spans: [{ s0, s1, a0, a1 (faces), det, H, B }], supports, elems }]
export function beamLines(model, rebar, opts = {}) {
  const { N, atNode, vertAt, dir } = framing(model), detOf = new Map();
  for (const d of rebar.beams) for (const id of d.elems) detOf.set(id, d);
  const beams = model.elems.filter(e => e.kind === "beam" && e.nodes.length === 2 && Math.abs(dir(e)[2]) < 0.05);
  const par = (u, v) => Math.abs(u[0] * v[0] + u[1] * v[1]) > 0.999;
  const used = new Set(), lines = [];
  for (const e of beams) {
    if (used.has(e.id) || !detOf.has(e.id)) continue;
    used.add(e.id);
    const d0 = dir(e), chain = [...e.nodes], els = [e];
    for (const atStart of [false, true]) for (;;) {
      const end = atStart ? chain[0] : chain[chain.length - 1];
      const nx = (atNode.get(end) || []).find(o => o.kind === "beam" && !used.has(o.id) && o.nodes.length === 2 && par(dir(o), d0) && Math.abs(N(o.nodes[0]).z - N(end).z) < 0.01 && Math.abs(N(o.nodes[1]).z - N(end).z) < 0.01);
      if (!nx) break;
      used.add(nx.id); els.push(nx); const other = nx.nodes[0] === end ? nx.nodes[1] : nx.nodes[0]; atStart ? chain.unshift(other) : chain.push(other);
    }
    // read left to right / bottom to top
    let u = [d0[0], d0[1]]; if (u[0] < -0.5 || (Math.abs(u[0]) <= 0.5 && u[1] < 0)) u = [-u[0], -u[1]];
    const p0 = N(chain[0]), sOf = id => { const p = N(id); return (p.x - p0.x) * u[0] + (p.y - p0.y) * u[1]; };
    if (sOf(chain[chain.length - 1]) < 0) chain.reverse();
    const o = N(chain[0]), s = id => { const p = N(id); return (p.x - o.x) * u[0] + (p.y - o.y) * u[1]; };
    const crossAt = id => (atNode.get(id) || []).some(b => b.kind === "beam" && !els.includes(b) && !par(dir(b), d0));
    const anyCol = chain.slice(1, -1).some(id => vertAt.has(id)) || chain.some(id => vertAt.has(id));
    const supIds = chain.filter((id, i) => i === 0 || i === chain.length - 1 || vertAt.has(id) || (!anyCol && crossAt(id)));
    const supports = supIds.map(id => {
      const col = (atNode.get(id) || []).find(c => c.kind === "column"), wall = !col && vertAt.has(id);
      let back = 0, ahead = 0, kind = "free";
      if (col) { [back, ahead] = colExtent(model, col, u); kind = "col"; }
      else if (wall) { back = ahead = 0.1; kind = "wall"; }
      else { const g = (atNode.get(id) || []).find(b => b.kind === "beam" && !els.includes(b) && !par(dir(b), d0)); if (g) { back = ahead = (model.sects.get(g.sect)?.b || 0.3) / 2; kind = "beam"; } }
      const below = (atNode.get(id) || []).find(c => c.kind === "column" && Math.min(N(c.nodes[0]).z, N(c.nodes[1]).z) < N(id).z - 0.05);
      const above = (atNode.get(id) || []).find(c => c.kind === "column" && Math.max(N(c.nodes[0]).z, N(c.nodes[1]).z) > N(id).z + 0.05);
      return { id, s: s(id), back, ahead, kind, below: !!below, above: !!above, col, wall };
    });
    const spans = [];
    for (let i = 1; i < supports.length; i++) {
      const A = supports[i - 1], B = supports[i], mid = (A.s + B.s) / 2;
      const inSpan = els.filter(b => { const m = (s(b.nodes[0]) + s(b.nodes[1])) / 2; return m > A.s && m < B.s; });
      const cnt = new Map(); for (const b of inSpan) { const d = detOf.get(b.id); if (d) cnt.set(d, (cnt.get(d) || 0) + Math.abs(s(b.nodes[1]) - s(b.nodes[0]))); }
      const det = [...cnt].sort((a, b) => b[1] - a[1])[0]?.[0] || null, sec = beamBox(model, (det || { sect: inSpan[0]?.sect }).sect);
      spans.push({ s0: A.s, s1: B.s, a0: A.s + A.ahead, a1: B.s - B.back, Ln: Math.max(0.2, B.s - B.back - (A.s + A.ahead)), det, B: sec.B, H: sec.H, name: det?.name || model.sects.get(inSpan[0]?.sect)?.name || "-", mid, matl: inSpan[0]?.matl, elems: inSpan.map(b => b.id) });
    }
    if (!spans.some(x => x.det)) continue;
    const z = o.z, horiz = Math.abs(u[0]) >= Math.abs(u[1]), off = horiz ? o.y : o.x;
    const grid = gridName(horiz ? opts.grids?.y : opts.grids?.x, off), cross = horiz ? opts.grids?.x : opts.grids?.y;
    const gridsOn = (cross || []).map(g => ({ label: g.label, s: (horiz ? g.v - o.x : g.v - o.y) * (horiz ? Math.sign(u[0]) : Math.sign(u[1])) })).filter(g => g.s > -0.05 && g.s < supports[supports.length - 1].s + 0.05);
    lines.push({ z, level: levelName(opts.levels, z), grid, horiz, u, origin: o, supports, spans, gridsOn, elems: els.map(b => b.id), L: supports[supports.length - 1].s });
  }
  // identical lines (same spans, supports and types) are drawn once: "LANTAI 2, 3, 4"
  const same = new Map();
  for (const l of lines) {
    const sig = l.grid + "|" + l.spans.map(x => [mm(x.s1 - x.s0), mm(x.a0 - x.s0), mm(x.s1 - x.a1), x.name].join(",")).join(";") + "|" + l.supports.map(x => x.kind + x.below + x.above).join("");
    if (same.has(sig)) { const g = same.get(sig); g.copies.push(l); g.elems.push(...l.elems); } else same.set(sig, { ...l, copies: [l], elems: [...l.elems] });
  }
  return [...same.values()].sort((a, b) => b.z - a.z || a.grid.localeCompare(b.grid, undefined, { numeric: true }));
}

// bars of a beam line: [{ face: "top"|"bot", bar, d, n, s0, s1, hook0, hook1, label, kind, forced }] (s along the line, hooks in m)
function beamBars(line, opts) {
  const st = opts.stock || 12, bars = [], sup = line.supports, sp = line.spans;
  const fc = fcFor(opts, { matl: sp.find(x => x.det)?.matl });
  const sec = x => Object.fromEntries((x.det?.sectors || []).map(q => [q.key, q]));
  const cnt = (x, face, key, bar) => { const S = sec(x), q = S[key] || x.det?.sectors?.[0]; return q ? byBar(q[face]).get(bar) || 0 : 0; };
  // end anchorage at support i (0 or last): horizontal into the support to its far face - 50, then a 90° hook; F + G >= 40db
  const endAnch = (i, d) => { const S = sup[i], F = Math.max(0, S.back + S.ahead - 0.05); return { F, G: S.kind === "free" ? hk90(d) : Math.max(hk90(d), 40 * d - F) }; };
  for (const face of ["top", "bot"]) {
    const dias = new Set(sp.flatMap(x => (x.det?.sectors || []).flatMap(q => (q[face] || []).map(l => l.bar))));
    for (const bar of dias) {
      const d = barDia(bar), { ls } = anchorage(fc, d);
      const cont = Math.min(...sp.map(x => x.det ? Math.min(cnt(x, face, "I", bar), cnt(x, face, "M", bar), cnt(x, face, "J", bar)) : 0));
      const e0 = endAnch(0, d), e1 = endAnch(sup.length - 1, d), s0 = sup[0].s + sup[0].ahead - e0.F, s1 = sup[sup.length - 1].s - sup[sup.length - 1].back + e1.F;
      if (cont > 0) {
        // splice zones: top at midspan, bottom from 2HB past a support face (4.1)
        const zones = face === "top" ? sp.map(x => (x.a0 + x.a1) / 2) : sp.flatMap(x => [x.a0 + Math.max(2 * x.H, 0.25 * x.Ln) + ls / 2, x.a1 - Math.max(2 * x.H, 0.25 * x.Ln) - ls / 2]).filter((c, i, a) => true).sort((a, b) => a - b);
        const pieces = splitBar(s0, s1, ls, st, zones);
        pieces.forEach(([a, b, forced], i) => bars.push({ face, bar, d, n: cont, s0: a, s1: b, hook0: i === 0 ? e0.G : 0, hook1: i === pieces.length - 1 ? e1.G : 0, kind: "cont", forced, ls }));
      }
      // support extras: top 0.33 x the larger adjacent clear span, bottom 0.25; end supports anchored like the continuous bars
      sup.forEach((S, i) => {
        const L = sp[i - 1], R = sp[i], need = Math.max(L ? cnt(L, face, "J", bar) : 0, R ? cnt(R, face, "I", bar) : 0) - cont;
        if (need <= 0) return;
        const f = face === "top" ? 0.33 : 0.25, ext = f * Math.max(L?.Ln || 0, R?.Ln || 0);
        const a = i === 0 ? S.s + S.ahead - e0.F : L.a1 - ext, b = i === sup.length - 1 ? S.s - S.back + e1.F : R.a0 + ext;
        bars.push({ face, bar, d, n: need, s0: a, s1: b, hook0: i === 0 ? e0.G : 0, hook1: i === sup.length - 1 ? e1.G : 0, kind: "sup", f, ext, ls });
      });
      // midspan extras: 0.5Ln centred, 20db past each end (as the office drawings)
      sp.forEach(x => {
        const need = x.det ? cnt(x, face, "M", bar) - Math.max(cont, 0) : 0;
        if (need <= 0) return;
        const c = (x.a0 + x.a1) / 2, h = 0.25 * x.Ln + 20 * d;
        bars.push({ face, bar, d, n: need, s0: c - h, s1: c + h, hook0: 0, hook1: 0, kind: "mid", Ln: x.Ln, ext20: 20 * d });
      });
    }
  }
  return bars;
}

// stirrups and web bars of a span: zones [{ a, b, bar, s, n, leg }], web { bar, n }
function spanStirrups(x) {
  const S = Object.fromEntries((x.det?.sectors || []).map(q => [q.key, q])), I = S.I || x.det?.sectors?.[0], M = S.M || I, J = S.J || I;
  if (!I?.stir) return { zones: [], web: null };
  const A = Math.min(Math.max(0.25 * x.Ln, 2 * x.H), x.Ln / 2), zs = [];
  const zone = (a, b, q, end) => { if (b - a < 0.01 || !q?.stir) return; const n = end ? Math.floor((b - a - 0.05) / q.stir.s) + 1 : Math.max(0, Math.ceil((b - a) / q.stir.s) - 1); zs.push({ a, b, bar: q.stir.bar, s: q.stir.s, n, leg: q.stir.leg || 2 }); };
  zone(x.a0, x.a0 + A, I, true); zone(x.a0 + A, x.a1 - A, M, false); zone(x.a1 - A, x.a1, J, true);
  const skin = [I, M, J].find(q => q?.skin)?.skin;
  const web = skin ? { bar: skin.bar, n: 2 * skin.n } : x.H > 0.9 ? null : x.H > 0.7 ? { bar: "D13", n: 4, std: true } : x.H > 0.5 ? { bar: "D13", n: 2, std: true } : null;
  return { zones: zs, web };
}

// ---------- column stacks ----------
// One stack = the columns on one x, y from the bottom up; identical stacks are drawn once.
export function columnStacks(model, rebar, opts = {}) {
  const { N, atNode } = framing(model), detOf = new Map(), q = v => Math.round(v / 0.05);
  for (const d of rebar.cols) for (const id of d.elems) detOf.set(id, d);
  const stacks = new Map();
  for (const e of model.elems) {
    if (e.kind !== "column" || e.nodes.length !== 2) continue;
    const [p0, p1] = e.nodes.map(N).sort((a, b) => a.z - b.z), key = q(p0.x) + "," + q(p0.y);
    if (!stacks.has(key)) stacks.set(key, { x: p0.x, y: p0.y, segs: [] });
    const top = e.nodes.find(id => N(id).z === p1.z), beamsTop = (atNode.get(top) || []).filter(b => b.kind === "beam");
    stacks.get(key).segs.push({ e, z0: p0.z, z1: p1.z, det: detOf.get(e.id) || null, name: tagOf(model, e), sec: model.sects.get(e.sect), hb: Math.max(0, ...beamsTop.map(b => model.sects.get(b.sect)?.h || 0)), matl: e.matl, steel: e.matlType === "STEEL" });
  }
  const same = new Map();
  for (const st of stacks.values()) {
    const segs = st.segs.filter(g => !g.steel).sort((a, b) => a.z0 - b.z0);
    if (!segs.some(g => g.det)) continue;
    // stories of one element each (meshed columns joined)
    const runs = [];
    for (const g of segs) { const l = runs[runs.length - 1]; if (l && l.name === g.name && Math.abs(g.z0 - l.z1) < 0.05 && l.hbTop === 0) { l.z1 = g.z1; l.hbTop = g.hb; l.elems.push(g.e.id); } else runs.push({ ...g, hbTop: g.hb, elems: [g.e.id] }); }
    const sig = runs.map(r => `${r.name}@${r.z0.toFixed(2)}-${r.z1.toFixed(2)}:${mm(r.hbTop)}`).join("|");
    const gx = gridName(opts.grids?.x, st.x), gy = gridName(opts.grids?.y, st.y);
    if (same.has(sig)) { const s = same.get(sig); s.at.push(`${gy}-${gx}`); s.elems.push(...runs.flatMap(r => r.elems)); s.pos.push([st.x, st.y]); }
    else same.set(sig, { runs, at: [`${gy}-${gx}`], elems: runs.flatMap(r => r.elems), pos: [[st.x, st.y]], name: [...new Set(runs.map(r => r.name))].join(" / ") });
  }
  return [...same.values()].sort((a, b) => a.runs[0].name.localeCompare(b.runs[0].name, undefined, { numeric: true }));
}

// main bars of a stack: pieces [{ bar, d, n, z0, z1, foot, hook, forced, ls }] and ties per story
function columnBars(stack, model, opts) {
  const st = opts.stock || 12, out = [], runs = stack.runs;
  const barsOf = r => (r.det ? colBars(model, r.det).bars : []);
  // groups of stories with the same main bars (bar and count) are one bar set, spliced at mid height where needed
  let i = 0;
  while (i < runs.length) {
    const key = r => barsOf(r).map(b => b.n + b.bar).join("+");
    let j = i; while (j + 1 < runs.length && key(runs[j + 1]) === key(runs[i]) && Math.abs(runs[j + 1].z0 - runs[j].z1) < 0.05) j++;
    const fc = fcFor(opts, runs[i]);
    for (const b of barsOf(runs[i])) {
      const d = barDia(b.bar), { ls, ldh } = anchorage(fc, d), base = i === 0, top = j === runs.length - 1;
      // bottom: into the pile cap 40db with a 15db foot (5.2); above a size change: a lap ls below the floor
      const z0 = base ? runs[i].z0 - Math.max(40 * d, ldh) : runs[i].z0 - ls;
      // top: into the top beam to its top - 50, 90° hook with F + G >= 40db; under a size change: run on through the floor
      const hbT = runs[j].hbTop || 0.4, F = Math.max(0.05, hbT - 0.05), z1 = top ? runs[j].z1 - 0.05 : runs[j].z1;
      const zones = []; for (let k = i; k <= j; k++) { const r = runs[k], hc = Math.max(r.sec?.h || 0.4, r.sec?.b || 0.4); const lo = r.z0 + 2 * hc, hi = r.z1 - (r.hbTop || 0) - 2 * hc; if (hi - lo > ls) zones.push((r.z0 + r.z1 - (r.hbTop || 0)) / 2); }
      const pieces = splitBar(z0, z1, ls, st, zones);
      pieces.forEach(([a, c, forced], k) => out.push({ bar: b.bar, d, n: b.n, z0: a, z1: c, foot: base && k === 0 ? 15 * d : 0, hook: top && k === pieces.length - 1 ? Math.max(hk90(d), 40 * d - F) : 0, forced, ls, splice: k < pieces.length - 1 ? c : null }));
    }
    i = j + 1;
  }
  return out;
}
function storyTies(r, laps) {
  const det = r.det, t = det?.tie; if (!t) return null;
  const tm = det.tieCen || t, hc = Math.max(r.sec?.h || 0.4, r.sec?.b || 0.4), Ho = r.z1 - r.z0 - (r.hbTop || 0);
  const B = Math.max(hc, 0.5, Ho / 6), joint = r.hbTop || 0, zs = [];
  const z = (a, b, s, lab) => { if (b - a > 0.01) zs.push({ a, b, s, n: Math.max(1, Math.ceil((b - a) / s)), bar: t.bar, lab }); };
  z(r.z0, r.z0 + B, t.s, "end"); z(r.z0 + B, r.z1 - joint - B, tm.s, "mid"); z(r.z1 - joint - B, r.z1 - joint, t.s, "end"); z(r.z1 - joint, r.z1, t.s, "joint");
  // along a splice: at most 100 (D)
  for (const p of laps) if (p > r.z0 && p < r.z1) for (const q of zs) if (q.lab === "mid" && q.s > 0.1) q.lap = true;
  return { zones: zs, t, tm, B };
}

// ---------- drawing helpers (paper mm offsets scaled by k) ----------
function barShape(A, k, x, y, w, legs, st, txt) { // a bar of length w (m) at (x, y) with legs [{ at: 0|1, h (m, signed) }]
  A.line([x, y], [x + w, y], st);
  for (const l of legs) { const xx = l.at ? x + w : x; A.line([xx, y], [xx, y + l.h], st); if (l.txt) A.text([xx + (l.at ? 0.8 : -0.8) * k, y + l.h / 2], l.txt, { ...T, size: 1.8, align: l.at ? "left" : "right", valign: "middle" }); }
  if (txt) A.text([x + w / 2, y + 0.8 * k], txt, { ...T, align: "center", valign: "bottom" });
}
const markBubble = (A, k, p, m) => { A.circle(p, 2 * k, { ...ST.thin, fill: "#ffffff" }); A.text(p, m, { ...T, size: 1.8, align: "center", valign: "middle" }); };

// BBS table in paper mm at (x0, y0) top-left (world), rows [{ mark, bar, shape: { legs, len }, cut, n, len, kg }]
function bbsTable(A, k, x0, y0, rows, title) {
  const W = [12, 46, 14, 22, 16, 22, 22], X = [0]; for (const w of W) X.push(X[X.length - 1] + w);
  const rh = 8, hh = 7, P = (x, y) => [x0 + x * k, y0 - y * k];
  A.text(P(0, -3), title, { ...TB, align: "left", valign: "bottom" });
  const yEnd = hh + rh * rows.length + rh;
  for (const y of [0, hh, yEnd - rh, yEnd]) A.line(P(0, y), P(X[X.length - 1], y), ST.thin);
  rows.forEach((_, i) => A.line(P(0, hh + rh * (i + 1)), P(X[X.length - 1], hh + rh * (i + 1)), { ...ST.thin, lw: 0.09 }));
  for (const x of X) A.line(P(x, 0), P(x, yEnd), ST.thin);
  ["MARK", "BENTUK (mm)", "DIA", "PANJANG", "JUMLAH", "TOTAL (m)", "BERAT (kg)"].forEach((h, i) => A.text(P((X[i] + X[i + 1]) / 2, hh / 2), h, { ...T, size: 1.8, align: "center", valign: "middle" }));
  rows.forEach((r, i) => {
    const yc = hh + rh * (i + 0.5);
    markBubble(A, k, P(X[0] + W[0] / 2, yc), r.mark);
    shapeSketch(A, k, P(X[1] + 4, yc), W[1] - 8, r.shape);
    [[2, r.bar], [3, String(r.cut)], [4, String(r.n)], [5, (r.n * r.cut / 1000).toFixed(2)], [6, (r.n * r.cut / 1000 * kgm(r.d)).toFixed(1)]].forEach(([c, s]) => A.text(P((X[c] + X[c + 1]) / 2, yc), s, { ...T, align: "center", valign: "middle" }));
  });
  const tot = rows.reduce((s, r) => s + r.n * r.cut / 1000 * kgm(r.d), 0);
  A.text(P(X[5] - 2, yEnd - rh / 2), "TOTAL", { ...T, align: "right", valign: "middle" });
  A.text(P((X[6] + X[7]) / 2, yEnd - rh / 2), tot.toFixed(1), { ...TB, size: 2, align: "center", valign: "middle" });
  return { w: X[X.length - 1], h: yEnd + 4, kg: tot };
}
// sketch of a bar shape in a cell (paper mm): kinds straight / hook / hook2 / hoop / tie / foot
function shapeSketch(A, k, [x, y], w, s) {
  const P = (dx, dy) => [x + dx * k, y + dy * k], st = { ...ST.bar, lw: 0.25 }, t = { ...T, size: 1.6 };
  if (s.kind === "hoop") {
    const bw = 12, bh = 6; A.poly([P(w / 2 - bw / 2, -bh / 2), P(w / 2 + bw / 2, -bh / 2), P(w / 2 + bw / 2, bh / 2), P(w / 2 - bw / 2, bh / 2)], { ...st, closed: true });
    A.line(P(w / 2 - bw / 2, bh / 2), P(w / 2 - bw / 2 + 2, bh / 2 - 2), st); A.line(P(w / 2 - bw / 2 + 1.2, bh / 2), P(w / 2 - bw / 2 + 3.2, bh / 2 - 2), st);
    A.text(P(w / 2, bh / 2 + 0.6), s.a, { ...t, align: "center", valign: "bottom" }); A.text(P(w / 2 + bw / 2 + 1, 0), s.b, { ...t, align: "left", valign: "middle" });
    return;
  }
  const L = w * 0.7, x0 = (w - L) / 2;
  A.line(P(x0, 0), P(x0 + L, 0), st);
  A.text(P(x0 + L / 2, -0.6), String(s.len), { ...t, align: "center", valign: "top" });
  const leg = (at, up, txt) => { const xx = at ? x0 + L : x0, dy = up ? 3 : -3; A.line(P(xx, 0), P(xx, dy), st); A.text(P(xx + (at ? 0.8 : -0.8), dy / 2), txt, { ...t, align: at ? "left" : "right", valign: "middle" }); };
  if (s.l0) leg(0, s.up0, s.l0);
  if (s.l1) leg(1, s.up1, s.l1);
  if (s.kind === "tie") { A.line(P(x0, 0), P(x0 + 2, 2), st); A.line(P(x0 + L, 0), P(x0 + L - 2, 2), st); if (s.b) A.text(P(x0 - 1, 0), s.b, { ...t, align: "right", valign: "middle" }); }
}

// keyplan: the level's beams and columns, the subject in red, fitted in a box w x h (paper mm) at (x0, y0) top-left
function keyplan(A, k, model, x0, y0, w, h, z, hiBeams, hiCols, title) {
  const N = id => model.nodes.get(id), at = el => el.nodes.every(id => Math.abs(N(id).z - z) < 0.05);
  const beams = model.elems.filter(e => e.kind === "beam" && e.nodes.length === 2 && at(e));
  const cols = model.elems.filter(e => e.kind === "column" && e.nodes.some(id => Math.abs(N(id).z - z) < 0.05));
  const pts = [...beams, ...cols].flatMap(e => e.nodes.map(N)); if (!pts.length) return;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y), X0 = Math.min(...xs), Y1 = Math.max(...ys), dx = Math.max(...xs) - X0 || 1, dy = Y1 - Math.min(...ys) || 1;
  const f = Math.min(w / dx, h / dy) * k, P = p => [x0 + (p.x - X0) * f, y0 - (Y1 - p.y) * f];
  for (const e of beams) A.line(P(N(e.nodes[0])), P(N(e.nodes[1])), hiBeams.has(e.id) ? { layer: "1", color: RED, lw: 0.5 } : { layer: "7", color: "#8a929c", lw: 0.09 });
  const seen = new Set();
  for (const e of cols) { const p = N(e.nodes[0]), key = Math.round(p.x * 20) + "," + Math.round(p.y * 20); if (seen.has(key) && !hiCols.has(e.id)) continue; seen.add(key); const q = P(p), r = hiCols.has(e.id) ? 1.6 * k : 0.6 * k; A.poly([[q[0] - r, q[1] - r], [q[0] + r, q[1] - r], [q[0] + r, q[1] + r], [q[0] - r, q[1] + r]], hiCols.has(e.id) ? { layer: "1", color: RED, lw: 0.35, closed: true } : { layer: "7", color: INK, fill: INK, lw: 0.09, closed: true }); }
  A.text([x0 + (dx * f) / 2, y0 - dy * f - 3 * k], title, { ...T, align: "center", valign: "top" });
}

const SCALES = [25, 50, 75, 100, 150, 200, 250];
const sheetFits = (wMm, hMm) => wMm <= 300 && hMm <= 255;

// ---------- beam shop drawing sheet ----------
function beamSheet(model, line, opts, no) {
  const bars = beamBars(line, opts), fc = fcFor(opts, { matl: line.spans.find(x => x.det)?.matl });
  const L0 = line.supports[0].s - line.supports[0].back - 0.3, L1 = line.L + line.supports[line.supports.length - 1].ahead + 0.3;
  const top = bars.filter(b => b.face === "top"), bot = bars.filter(b => b.face === "bot");
  // pack bars into rows (no overlap in a row)
  const pack = list => { const rows = []; for (const b of list.sort((p, q) => (p.kind === "cont" ? 0 : 1) - (q.kind === "cont" ? 0 : 1) || p.s0 - q.s0)) { let r = rows.find(r => r.every(o => b.s0 > o.s1 + 0.4 || b.s1 < o.s0 - 0.4)); if (!r) rows.push(r = []); r.push(b); } return rows; };
  const rowsT = pack(top), rowsB = pack(bot);
  const Hmax = Math.max(...line.spans.map(x => x.H));
  let k, scale;
  const rowsBBS = 0;
  for (scale of [25, 50, 75, 100].filter(s => s >= (opts.minScale || 50))) { if (scale > 25) { k = scale / 1000; break; } k = scale / 1000; const wMm = (L1 - L0) / k + 20, hMm = 26 + 9 * rowsT.length + Hmax / k + 30 + 9 * rowsB.length + 20; if (sheetFits(wMm, hMm + 60)) break; }
  const items = [], A = adders(items, k, opts.fontScale || 1, { dim: "DIM" }), y = mmv => mmv * k; // y in paper mm (up = +)
  // beam elevation: top of beam at 0
  const yT = 0;
  for (const S of line.supports) {
    const x0 = S.s - S.back, x1 = S.s + S.ahead, Hs = Math.max(...line.spans.filter(x => x.s0 === S.s || x.s1 === S.s).map(x => x.H));
    if (S.kind === "col" || S.kind === "wall") {
      if (S.below) { A.line([x0, yT - Hs], [x0, yT - Hs - y(14)], ST.conc); A.line([x1, yT - Hs], [x1, yT - Hs - y(14)], ST.conc); A.poly([[x0, yT - Hs - y(14)], [(x0 + x1) / 2 - y(1), yT - Hs - y(14)], [(x0 + x1) / 2, yT - Hs - y(12.5)], [(x0 + x1) / 2 + y(1), yT - Hs - y(15.5)], [(x0 + x1) / 2 + y(1.6), yT - Hs - y(14)], [x1, yT - Hs - y(14)]], { ...ST.thin }); }
      if (S.above) { A.line([x0, yT], [x0, yT + y(8)], ST.conc); A.line([x1, yT], [x1, yT + y(8)], ST.conc); }
      A.line([x0, yT], [x0, yT - Hs], ST.conc); A.line([x1, yT], [x1, yT - Hs], ST.conc);
    } else if (S.kind === "beam") A.poly([[x0, yT], [x1, yT], [x1, yT - Hs], [x0, yT - Hs]], { ...ST.thin, dash: "dashed", closed: true });
    A.line([S.s, yT + y(10)], [S.s, -Hmax - y(18 + 9 * rowsB.length)], ST.hid);
  }
  for (const x of line.spans) {
    A.line([x.a0, yT], [x.a1, yT], ST.conc); A.line([x.a0, yT - x.H], [x.a1, yT - x.H], ST.conc);
    // stirrups at their places, zones dimensioned with their spacing
    const { zones, web } = spanStirrups(x); x.zones = zones; x.web = web;
    const cv = 0.04;
    for (const zn of zones) {
      const n = zn.n, s0 = zn.a + (zn === zones[0] ? 0.05 : zn.s), step = zn.s;
      for (let i = 0; i < n; i++) { const xx = zn === zones[zones.length - 1] ? zn.b - 0.05 - i * step : s0 + i * step; if (xx > zn.a - 1e-6 && xx < zn.b + 1e-6) A.line([xx, yT - cv], [xx, yT - x.H + cv], ST.stir); }
    }
    if (zones.length) {
      A.dimChain([x.a0, ...zones.map(zn => zn.b)], yT + y(14), "h", 1);
      zones.forEach(zn => A.text([(zn.a + zn.b) / 2, yT + y(9)], `${zn.bar}-${mm(zn.s)}`, { ...T, align: "center", valign: "bottom" }));
      A.dimChain([x.a0, x.a1], yT + y(22), "h", 1);
    }
    A.text([(x.a0 + x.a1) / 2, yT - x.H / 2], `${x.name}  ${mm(x.B)}x${mm(x.H)}`, { ...T, size: 1.8, align: "center", valign: "middle" });
    if (web) A.line([x.a0, yT - x.H / 2 - y(1.2)], [x.a1, yT - x.H / 2 - y(1.2)], { ...ST.bar, lw: 0.18, dash: "dashed" });
  }
  A.dimChain([yT - Hmax, yT], L0 + 0.1 - y(3), "v", -1);
  // exploded bars
  let mark = 0; const rowsOut = [];
  const draw = (rows, face) => rows.forEach((row, ri) => {
    const yy = face === "top" ? yT + y(30 + 9 * ri) : yT - Hmax - y(14 + 9 * ri);
    for (const b of row) {
      const m = String(++mark).padStart(2, "0"), up = face === "top" ? -1 : 1, legs = [];
      if (b.hook0) legs.push({ at: 0, h: up * b.hook0, txt: String(mm(b.hook0)) });
      if (b.hook1) legs.push({ at: 1, h: up * b.hook1, txt: String(mm(b.hook1)) });
      const len = b.s1 - b.s0, cut = r5(len + b.hook0 + b.hook1);
      barShape(A, k, b.s0, yy, len, legs, { ...ST.bar, ...(b.forced ? { color: RED } : {}) }, `${b.n}-${b.bar} (@${cut})`);
      markBubble(A, k, [b.s0 - y(3), yy + y(2.2)], m);
      if (b.kind === "sup" && (b.hook0 === 0 || b.hook1 === 0)) { // extras: their length past the face
        const sp = b.hook0 ? null : line.spans.find(x => Math.abs(x.a1 - b.ext - b.s0) < 0.01), sq = b.hook1 ? null : line.spans.find(x => Math.abs(x.a0 + b.ext - b.s1) < 0.01);
        if (sp) A.text([(b.s0 + sp.a1) / 2, yy - y(1.2)], `${b.f}Ln = ${mm(b.ext)}`, { ...T, size: 1.8, align: "center", valign: "top" });
        if (sq) A.text([(sq.a0 + b.s1) / 2, yy - y(1.2)], `${b.f}Ln = ${mm(b.ext)}`, { ...T, size: 1.8, align: "center", valign: "top" });
      }
      if (b.kind === "mid") A.text([(b.s0 + b.s1) / 2, yy - y(1.2)], `0.5Ln = ${mm(0.5 * b.Ln)} + 2 x ${mm(b.ext20)}`, { ...T, size: 1.8, align: "center", valign: "top" });
      rowsOut.push({ mark: m, bar: b.bar, d: b.d, cut, n: b.n * line.copies.length, shape: { kind: b.hook0 && b.hook1 ? "hook2" : b.hook0 || b.hook1 ? "hook" : "straight", len: mm(len), l0: b.hook0 ? mm(b.hook0) : 0, l1: b.hook1 ? mm(b.hook1) : 0, up0: face !== "top", up1: face !== "top" }, desc: `${face === "top" ? "Top" : "Bottom"} ${b.kind === "cont" ? "continuous" : b.kind === "sup" ? "support extra" : "midspan extra"}`, forced: b.forced });
    }
  });
  draw(rowsT, "top"); draw(rowsB, "bot");
  // stirrups, cross ties and web bars into the schedule
  const stir = new Map(), add = (key, r) => { const o = stir.get(key); if (o) o.n += r.n; else stir.set(key, r); };
  for (const x of line.spans) {
    const cv = 0.04, ds = barDia(x.zones?.[0]?.bar || "D10"), bw = x.B - 2 * cv, hw = x.H - 2 * cv;
    for (const zn of x.zones || []) {
      add(`h${zn.bar}${mm(bw)}${mm(hw)}`, { bar: zn.bar, d: barDia(zn.bar), cut: r5(2 * (bw + hw) + 2 * hk135(barDia(zn.bar))), n: zn.n * line.copies.length, shape: { kind: "hoop", a: mm(bw), b: mm(hw) }, desc: "Stirrup" });
      if (zn.leg > 2) add(`t${zn.bar}${mm(hw)}`, { bar: zn.bar, d: barDia(zn.bar), cut: r5(hw + 2 * hk135(barDia(zn.bar))), n: zn.n * (zn.leg - 2) * line.copies.length, shape: { kind: "tie", len: mm(hw) }, desc: "Inner leg" });
    }
    if (x.web) { const d = barDia(x.web.bar), lsw = anchorage(fc, d).ls; add(`w${x.web.bar}${mm(x.Ln)}`, { bar: x.web.bar, d, cut: r5(x.Ln + 2 * 0.15), n: x.web.n * line.copies.length, shape: { kind: "straight", len: mm(x.Ln + 0.3) }, desc: x.web.std ? "Web bar (4.2)" : "Skin bar" }); }
    void ds;
  }
  for (const r of stir.values()) rowsOut.push({ ...r, mark: String(++mark).padStart(2, "0") });
  // grids and spans below
  const yG = yT - Hmax - y(18 + 9 * rowsB.length);
  const gs = line.gridsOn.length ? line.gridsOn : line.supports.map((S, i) => ({ s: S.s, label: String(i + 1) }));
  if (gs.length > 1) A.dimChain(gs.map(g => g.s), yG, "h", 1);
  gs.forEach(g => A.bubble([g.s, yG - y(6)], g.label));
  const levels = [...new Set(line.copies.map(c => c.level))].join(", "), title = `BEAM SHOP DRAWING - ${levels} - AS ${line.grid}`;
  const allIds = new Set(line.copies.flatMap(c => c.elems)), yK = yT + y(30 + 9 * rowsT.length + 40);
  const notes = [
    `Development and laps from STANDARD DETAIL 1.5 for fc' ${fcRow(fc)} MPa (TS-420B). Hooks 90° 12db (F + G >= 40db), stirrups 135° max(6ds, 75).`,
    "Top extras 0.33 Ln of the larger span, splices of top bars at midspan, none within 2HB of a support (4.1). Red bar: spliced at the stock length, place it by hand.",
    `Cut lengths = sum of the straight legs (outside), stock ${opts.stock || 12} m. Lengths from the model centrelines: check against the drawings before cutting.`,
  ];
  const tabTitle = `BAR BENDING SCHEDULE (fc' ${fcRow(fc)} MPa, ${line.copies.length} x)`, kg = rowsOut.reduce((q, r) => q + r.n * r.cut / 1000 * kgm(r.d), 0);
  const bbs = { name: `${line.level} / AS ${line.grid}`, types: [...new Set(line.spans.map(x => x.name))].join(", "), rows: rowsOut, kg, copies: line.copies.length, kind: "beam" };
  const sheet = (id, t, its, extra = {}) => ({ kind: "shop", sub: "shopbeam", id, title: t, scale, k, items: its, legend: [], hits: [], ...extra });
  const nElev = items.length;
  // one sheet: schedule and keyplan to the right when there is room, else under the drawing
  if (rowsOut.length <= 24) {
    const lenMm = (L1 - L0) / k, right = lenMm + 160 <= 300, tabY = right ? yT + y(30 + 9 * rowsT.length) : yG - y(14), tabX = right ? L1 + y(8) : L0;
    const tb = bbsTable(A, k, tabX, tabY, rowsOut, tabTitle);
    keyplan(A, k, model, L0, yK, 55, 35, line.z, allIds, new Set(), `KEYPLAN ${line.level}`);
    addNotes(A, k, tabX, tabY - y(tb.h + 4), notes, tb.w);
    const e = itemExtents(items);
    if ((e.x1 - e.x0) / k <= 300 && (e.y1 - e.y0) / k <= 257) return [sheet(`shop:beam:${no}`, title, items, { bbs })];
    if (scale < 50) return beamSheet(model, line, { ...opts, minScale: 50 }, no);
  }
  const nextScale = { 25: 50, 50: 75, 75: 100 }[scale];
  // a long line: the elevation over several sheets cut at supports (match lines), the schedule on its own sheet(s)
  if (scale < 50) return beamSheet(model, line, { ...opts, minScale: 50 }, no);
  const elev = items.slice(0, nElev), cuts = [L0];
  for (let i = 1; i < line.supports.length - 1; i++) { const c = line.supports[i].s, nx = line.supports[i + 1].s; if ((nx + 0.3 - cuts[cuts.length - 1]) / k > 250 && (c - cuts[cuts.length - 1]) / k > 40) cuts.push(c); }
  cuts.push(L1);
  if (nextScale && cuts.some((c, i) => i && (c - cuts[i - 1]) / k > 260)) return beamSheet(model, line, { ...opts, minScale: nextScale }, no); // a span longer than a sheet
  const out = [], n = cuts.length - 1;
  for (let i = 0; i < n; i++) {
    const xa = cuts[i], xb = cuts[i + 1], its = elev.map(it => clipX(it, xa - (i ? 0.02 : 0), xb + (i < n - 1 ? 0.02 : 0))).filter(Boolean), B = adders(its, k, opts.fontScale || 1, { dim: "DIM" });
    for (const [c, txt] of [[i ? xa : null, `MATCH LINE - SHEET ${i}/${n}`], [i < n - 1 ? xb : null, `MATCH LINE - SHEET ${i + 2}/${n}`]]) if (c != null) {
      B.line([c, yT + y(26)], [c, yG + y(4)], { layer: "7", color: RED, lw: 0.35, dash: "center" });
      B.text([c + (c === xa ? -y(1.2) : y(1.2)), yT - Hmax / 2], txt, { ...T, size: 1.8, color: RED, align: "center", valign: c === xa ? "bottom" : "top", rot: 90 });
    }
    keyplan(B, k, model, xa + 0.3, yK, 55, 35, line.z, allIds, new Set(), `KEYPLAN ${line.level}`);
    B.text([xa + 0.3 + y(62), yK], `${n > 1 ? `SHEET ${i + 1}/${n} - ` : ""}BAR BENDING SCHEDULE ON SHEET "${title} - BBS"`, { ...T, align: "left", valign: "top" });
    out.push(sheet(`shop:beam:${no}:${i}`, n > 1 ? `${title} (${i + 1}/${n})` : title, its));
  }
  for (let j = 0, part = 0, parts = Math.ceil(rowsOut.length / 24); j < rowsOut.length; j += 24, part++) {
    const its = [], B = adders(its, k, opts.fontScale || 1, { dim: "DIM" }), rows = rowsOut.slice(j, j + 24);
    const tb = bbsTable(B, k, 0, 0, rows, tabTitle + (parts > 1 ? ` ${part + 1}/${parts}` : ""));
    keyplan(B, k, model, y(tb.w + 10), 0, 60, 40, line.z, allIds, new Set(), `KEYPLAN ${line.level}`);
    if (part === parts - 1) addNotes(B, k, 0, -y(tb.h + 4), notes, tb.w);
    out.push(sheet(`shop:beam:${no}:bbs${part || ""}`, `${title} - BBS${parts > 1 ? ` ${part + 1}/${parts}` : ""}`, its, part ? {} : { bbs }));
  }
  return out;
}
// an item drawn about (0, 0) at another scale, moved to c and scaled by f (text keeps its size)
function scaled(it, f, [cx, cy]) {
  const P = ([x, yv]) => [cx + x * f, cy + yv * f];
  if (it.t === "line") return { ...it, a: P(it.a), b: P(it.b) };
  if (it.t === "poly") return { ...it, pts: it.pts.map(P) };
  if (it.t === "circle") return { ...it, c: P(it.c), r: it.r * f };
  return { ...it, p: P(it.p), h: it.h * f };
}
// an item cut to the x range [xa, xb] (lines and outlines clipped, points kept when inside), or null
function clipX(it, xa, xb) {
  if (it.t === "line") {
    let [a, b] = [it.a, it.b]; if (a[0] > b[0]) [a, b] = [b, a];
    if (b[0] < xa || a[0] > xb) return null;
    const at = x => (b[0] === a[0] ? [x, a[1]] : [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])]);
    return { ...it, a: a[0] < xa ? at(xa) : a, b: b[0] > xb ? at(xb) : b };
  }
  if (it.t === "poly") { const xs = it.pts.map(p => p[0]); if (Math.max(...xs) < xa || Math.min(...xs) > xb) return null; return { ...it, pts: it.pts.map(([x, yv]) => [Math.min(xb, Math.max(xa, x)), yv]) }; }
  const p = it.t === "circle" ? it.c : it.p;
  return p[0] >= xa && p[0] <= xb ? it : null;
}
// notes wrapped to w paper mm (1.8 mm text, about 1.35 mm a character)
function addNotes(A, k, x, y, lines, w = 150) {
  const max = Math.floor(w / 1.35), out = [];
  for (const s of lines) { let cur = ""; for (const word of s.split(" ")) { if (cur && (cur + " " + word).length > max) { out.push(cur); cur = "  " + word; } else cur = cur ? cur + " " + word : word; } out.push(cur); }
  out.forEach((s, i) => A.text([x, y - i * 3.2 * k], s, { layer: "TEXT UMUM", color: "#555555", size: 1.8, align: "left", valign: "top" }));
  return out.length * 3.2; // height, paper mm
}

// ---------- column shop drawing sheet ----------
function columnSheet(model, stack, opts, no) {
  const bars = columnBars(stack, model, opts), runs = stack.runs, z0 = Math.min(...bars.map(b => b.z0), runs[0].z0), z1 = runs[runs.length - 1].z1;
  let k, scale;
  for (scale of SCALES.filter(s => s >= (opts.minScale || 0))) { k = scale / 1000; if ((z1 - z0 + 0.8) / k + 40 <= 255) break; }
  const items = [], A = adders(items, k, opts.fontScale || 1, { dim: "DIM" }), y = v => v * k, fc = fcFor(opts, runs[0]);
  const W = Math.max(...runs.map(r => r.sec?.b || 0.4)), cx = 0;
  // levels
  const lv = [...new Set([runs[0].z0, ...runs.map(r => r.z1)])];
  for (const z of lv) {
    A.line([cx - W / 2 - y(30), z], [cx + W / 2 + y(55), z], ST.lvl);
    A.text([cx + W / 2 + y(56), z + y(0.8)], levelName(opts.levels, z), { ...T, color: "#0050a0", align: "left", valign: "bottom" });
    A.text([cx + W / 2 + y(56), z - y(0.8)], fmtEl(z), { ...T, color: "#0050a0", align: "left", valign: "top" });
  }
  // column, beams at each floor, ties
  const laps = bars.filter(b => b.splice).map(b => b.splice - b.ls / 2);
  for (const r of runs) {
    const b = r.sec?.b || 0.4;
    A.line([cx - b / 2, r.z0], [cx - b / 2, r.z1], ST.conc); A.line([cx + b / 2, r.z0], [cx + b / 2, r.z1], ST.conc);
    if (r.hbTop) for (const s of [-1, 1]) { const xa = cx + s * b / 2, xb = cx + s * (b / 2 + y(16)); A.poly([[xa, r.z1], [xb, r.z1], [xb, r.z1 - r.hbTop], [xa, r.z1 - r.hbTop]], { ...ST.conc, lw: 0.25 }); A.text([(xa + xb) / 2, r.z1 - r.hbTop / 2], "BALOK", { ...T, size: 1.8, align: "center", valign: "middle" }); }
    const tz = storyTies(r, laps); r.ties = tz;
    if (tz) {
      for (const zn of tz.zones) { const s = zn.lap ? Math.min(zn.s, 0.1) : zn.s; for (let zz = zn.a + (zn.lab === "end" && zn.a === r.z0 ? 0.05 : s / 2); zz < zn.b; zz += s) A.line([cx - b / 2 + 0.03, zz], [cx + b / 2 - 0.03, zz], ST.stir); }
      A.dimChain([r.z0, ...tz.zones.map(zn => zn.b)], cx + W / 2 + y(24), "v", 1);
      tz.zones.forEach(zn => A.text([cx + W / 2 + y(28), (zn.a + zn.b) / 2], `${zn.bar}-${mm(zn.lap ? Math.min(zn.s, 0.1) : zn.s)}`, { ...T, align: "left", valign: "middle" }));
    }
    A.dimChain([r.z0, r.z1 - (r.hbTop || 0)], cx - W / 2 - y(22), "v", -1);
    A.text([cx - W / 2 - y(19), (r.z0 + r.z1 - (r.hbTop || 0)) / 2], `Ln = ${mm(r.z1 - (r.hbTop || 0) - r.z0)}`, { ...T, align: "center", valign: "bottom", rot: 90 });
    A.text([cx, (r.z0 + r.z1) / 2], r.name, { ...T, size: 1.8, align: "center", valign: "middle", rot: 90 });
  }
  // pile cap / foundation outline under the base
  A.poly([[cx - W / 2 - y(14), runs[0].z0], [cx + W / 2 + y(14), runs[0].z0], [cx + W / 2 + y(14), z0 - 0.1], [cx - W / 2 - y(14), z0 - 0.1]], { ...ST.thin, dash: "dashed", closed: true });
  A.text([cx + W / 2 + y(15), z0], "PILE CAP / PONDASI", { ...T, size: 1.8, align: "left", valign: "middle" });
  // exploded main bars on the left, one column of bars per piece
  let mark = 0; const rowsOut = [], xs = [];
  bars.forEach((b, i) => {
    const xx = cx - W / 2 - y(34 + 7 * (i % 4)), m = String(++mark).padStart(2, "0"), len = b.z1 - b.z0, cut = r5(len + b.foot + b.hook);
    A.line([xx, b.z0], [xx, b.z1], { ...ST.bar, ...(b.forced ? { color: RED } : {}) });
    if (b.foot) { A.line([xx, b.z0], [xx + b.foot, b.z0], ST.bar); A.text([xx + b.foot / 2, b.z0 - y(0.8)], String(mm(b.foot)), { ...T, size: 1.8, align: "center", valign: "top" }); }
    if (b.hook) { A.line([xx, b.z1], [xx + b.hook, b.z1], ST.bar); A.text([xx + b.hook / 2, b.z1 + y(0.8)], String(mm(b.hook)), { ...T, size: 1.8, align: "center", valign: "bottom" }); }
    A.text([xx - y(0.8), (b.z0 + b.z1) / 2], `${b.n}-${b.bar}  L = ${cut}`, { ...T, align: "center", valign: "bottom", rot: 90 });
    markBubble(A, k, [xx, b.z0 - y(5)], m);
    rowsOut.push({ mark: m, bar: b.bar, d: b.d, cut, n: b.n * stack.at.length, shape: { kind: b.foot || b.hook ? (b.foot && b.hook ? "hook2" : "hook") : "straight", len: mm(len), l0: b.foot ? mm(b.foot) : 0, l1: b.hook ? mm(b.hook) : 0, up0: true, up1: true }, desc: "Main bar", forced: b.forced });
    xs.push(xx);
  });
  // ties into the schedule
  const tieRows = new Map();
  for (const r of runs) {
    const tz = r.ties; if (!tz) continue;
    const s = colBars(model, r.det).s, dt = barDia(tz.t.bar), c = Math.max(0.025, (colBars(model, r.det).bars[0]?.dc ?? 0.05) - barDia(colBars(model, r.det).bars[0]?.bar || "D16") / 2 - dt), bw = s.B - 2 * c, hw = s.H - 2 * c;
    const n = tz.zones.reduce((q, zn) => q + Math.ceil((zn.b - zn.a) / (zn.lap ? Math.min(zn.s, 0.1) : zn.s)), 0) * stack.at.length;
    const add = (key, row) => { const o = tieRows.get(key); if (o) o.n += row.n; else tieRows.set(key, row); };
    if (s.round) add(`c${tz.t.bar}${mm(bw)}`, { bar: tz.t.bar, d: dt, cut: r5(Math.PI * bw + 2 * hk135(dt)), n, shape: { kind: "straight", len: mm(Math.PI * bw) }, desc: "Circular tie" });
    else {
      add(`h${tz.t.bar}${mm(bw)}${mm(hw)}`, { bar: tz.t.bar, d: dt, cut: r5(2 * (bw + hw) + 2 * hk135(dt)), n, shape: { kind: "hoop", a: mm(bw), b: mm(hw) }, desc: "Hoop" });
      if (tz.t.ny > 2) add(`y${tz.t.bar}${mm(bw)}`, { bar: tz.t.bar, d: dt, cut: r5(bw + 2 * hk135(dt)), n: n * (tz.t.ny - 2), shape: { kind: "tie", len: mm(bw) }, desc: "Cross tie along B" });
      if (tz.t.nz > 2) add(`z${tz.t.bar}${mm(hw)}`, { bar: tz.t.bar, d: dt, cut: r5(hw + 2 * hk135(dt)), n: n * (tz.t.nz - 2), shape: { kind: "tie", len: mm(hw) }, desc: "Cross tie along H" });
    }
  }
  for (const r of tieRows.values()) rowsOut.push({ ...r, mark: String(++mark).padStart(2, "0") });
  // section table per type, schedule, keyplan on the right
  const xR = cx + W / 2 + y(80);
  let yy = z1;
  A.text([xR, yy + y(2)], `TABEL PENULANGAN KOLOM ${stack.name}`, { ...TB, align: "left", valign: "bottom" });
  const types = [...new Map(runs.filter(r => r.det).map(r => [r.name, r])).values()];
  let xq = xR;
  const ks = Math.min(k, 0.03), chOf = r => Math.max(30, colBars(model, r.det).s.H / ks + 16); // sections at 1:30 whatever the sheet scale
  for (const r of types) {
    const s = colBars(model, r.det).s, cw = Math.max(36, s.B / ks + 16), chh = chOf(r);
    if (xq > xR && (xq - cx) / k + cw + 56 > 236 - W / (2 * k)) { xq = xR; yy -= y(Math.max(...types.map(chOf)) + 32); } // wrap: the sheet is about 300 mm wide
    A.poly([[xq, yy], [xq + y(cw), yy], [xq + y(cw), yy - y(chh + 30)], [xq, yy - y(chh + 30)]], { ...ST.thin, closed: true });
    const c0 = [xq + y(cw / 2), yy - y(chh / 2 + 2)], tmp = [];
    drawColSection(adders(tmp, ks, opts.fontScale || 1, { dim: "DIM" }), model, r.det, 0, 0, ks);
    items.push(...tmp.map(it => scaled(it, k / ks, c0)));
    const t = r.det.tie, tm = r.det.tieCen || t, lines = [r.name, `${mm(s.B)} x ${mm(s.H)}`, `TUL. UTAMA ${colBars(model, r.det).bars.map(b => b.n + "-" + b.bar).join(" + ")}`, `SENGKANG TUMP. ${t ? t.bar + "-" + mm(t.s) : "-"}`, `SENGKANG LAP. ${tm ? tm.bar + "-" + mm(Math.min(tm.s, 0.1)) : "-"}`, `PENGIKAT ${t ? Math.max(0, t.ny - 2) + "H / " + Math.max(0, t.nz - 2) + "V" : "-"}`];
    lines.forEach((s2, i) => A.text([xq + y(2), yy - y(chh + 4 + i * 4.2)], s2, { ...(i ? T : TB), size: i ? 1.8 : 2.2, align: "left", valign: "top" }));
    xq += y(cw + 2);
  }
  const kx = xq + y(6), ky = yy - y(4); // the wrap leaves room for the keyplan after the last cell
  yy -= y(Math.max(...types.map(chOf)) + 40);
  const tb = bbsTable(A, k, xR, yy, rowsOut, `BAR BENDING SCHEDULE (fc' ${fcRow(fc)} MPa, ${stack.at.length} x)`);
  const hi = new Set(stack.elems);
  keyplan(A, k, model, kx, ky, 50, 36, runs[0].z0, new Set(), hi, `KEYPLAN ${levelName(opts.levels, runs[0].z0)}`);
  addNotes(A, k, xR, yy - y(tb.h + 4), [
    `Columns at ${stack.at.slice(0, 12).join(", ")}${stack.at.length > 12 ? " ..." : ""} (${stack.at.length}). fc' ${fcRow(fc)} MPa, laps ls from STANDARD DETAIL 1.5.`,
    "Splices at mid height, outside 2hc of the beam faces (5.0), ties at <= 100 along a splice. Ties over B = max(bc, hc, 500, Ho/6) at each end and through the joint (5.2).",
    "Bars into the pile cap 40db with a 15db foot; top bars hooked into the beam, F + G >= 40db. Check the pile cap depth and lengths before cutting.",
  ], tb.w);
  return { kind: "shop", sub: "shopcol", id: `shop:col:${no}`, title: `COLUMN SHOP DRAWING - ${stack.name}`, scale, k, items, legend: [], hits: [], bbs: { name: `${stack.name} (${stack.at.length} x)`, types: stack.name, rows: rowsOut, kg: tb.kg, copies: stack.at.length, kind: "col" } };
}

// every shop drawing sheet: beam lines then column stacks
// the sheet at the first scale whose drawing fits the A3 drawing area (text and tables keep their paper size)
function fitted(make, scale0) {
  let best = null;
  for (let v = make(scale0), i = 0; ; i++) {
    const e = itemExtents(v.items), over = Math.max(0, (e.x1 - e.x0) / v.k - 300) + Math.max(0, (e.y1 - e.y0) / v.k - 257);
    if (!over) return v;
    if (!best || over < best.over - 1) best = { v, over }; // a smaller scale only when it helps
    const next = SCALES.find(s => s > v.scale);
    if (!next) return best.v;
    v = make(next);
  }
}
// beam sheets 1:25 for short lines, else 1:50 (the example's) over as many sheets as the line needs
export function buildShopViews(model, rebar, opts = {}) {
  const out = [];
  beamLines(model, rebar, opts).forEach((l, i) => { try { out.push(...beamSheet(model, l, { ...opts, minScale: l.L < 6 ? 25 : 50 }, i)); } catch (e) { console.error("beam shop drawing", l.grid, e); } });
  columnStacks(model, rebar, opts).forEach((s, i) => { try { out.push(fitted(sc => columnSheet(model, s, { ...opts, minScale: sc }, i), 0)); } catch (e) { console.error("column shop drawing", s.name, e); } });
  return out;
}

// schedule for the Shop drawing tab and the CSV, from the sheets: { beams: [group], cols: [group], summary, params }
export function shopBBS(views, opts = {}) {
  const P = { ...SHOP_DEFAULTS, ...opts }, g = kind => views.filter(v => v.bbs?.kind === kind).map(v => ({
    name: v.bbs.name, size: v.bbs.types, members: v.bbs.copies, unit: kind === "beam" ? "line" : "stack", view: v.id,
    rows: v.bbs.rows.map(r => ({ mark: r.mark, bar: r.bar, d: r.d, shape: r.shape.kind, dims: r.desc + (r.shape.kind === "hoop" ? ` ${r.shape.a} x ${r.shape.b}` : r.shape.l0 || r.shape.l1 ? ` ${[r.shape.l0, r.shape.len, r.shape.l1].filter(Boolean).join(" + ")}` : ` ${r.shape.len}`), note: r.forced ? " (splice at stock length)" : "", cut: r.cut, per: r.n, members: 1, n: r.n, len: (r.n * r.cut) / 1000, kg: ((r.n * r.cut) / 1000) * kgm(r.d) })),
  })).map(t => ({ ...t, kg: t.rows.reduce((s, r) => s + r.kg, 0) }));
  const out = { beams: g("beam"), cols: g("col"), params: P }, sum = new Map();
  for (const [part, list] of [["beam", out.beams], ["col", out.cols]]) for (const t of list) for (const r of t.rows) { const x = sum.get(r.bar) || { bar: r.bar, d: r.d, beam: 0, col: 0, len: 0 }; x[part] += r.kg; x.len += r.len; sum.set(r.bar, x); }
  out.summary = [...sum.values()].sort((a, b) => a.d - b.d).map(x => ({ ...x, total: x.beam + x.col, order: (x.beam + x.col) * (1 + P.waste / 100), bars12: Math.ceil((x.len * (1 + P.waste / 100)) / P.stock) }));
  return out;
}

// the schedule as CSV (UTF-8 with BOM so Excel reads it)
export function bbsCsv(b, project = "") {
  const q = v => (/[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v), f = (v, n = 2) => (+v).toFixed(n);
  const lines = [[`Bar bending schedule${project ? " - " + project : ""}`], ["Sheet", "Types", "Mark", "Bar", "Shape", "Description", "Cutting length (mm)", "Bars", "Total length (m)", "Weight (kg)"]];
  for (const t of [...b.beams, ...b.cols]) for (const r of t.rows) lines.push([t.name, t.size, r.mark, r.bar, r.shape, r.dims + r.note, r.cut, r.n, f(r.len), f(r.kg)]);
  lines.push([], ["Totals per bar size"], ["Bar", "Beams (kg)", "Columns (kg)", "Total (kg)", `With ${b.params.waste}% waste (kg)`, `${b.params.stock} m bars`]);
  for (const x of b.summary) lines.push([x.bar, f(x.beam), f(x.col), f(x.total), f(x.order), x.bars12]);
  return "﻿" + lines.map(l => l.map(q).join(",")).join("\r\n");
}
