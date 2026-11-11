// Shop drawing quantities: bar bending schedule (BBS) per beam and column type, from the Gen NX rebar data and the model geometry.
// Lengths are estimates for the shop drawing: spans between supports on the centreline, anchorage into the support with a
// 90° hook (12d), laps where a bar is longer than the stock length, hoops and ties with 135° hooks (6d, at least 75 mm).
import { barDia, colBars, beamBox, spacingOk } from "./rebar.js";

export const BBS_DEFAULTS = { lap: 40, hook: 12, stock: 12, waste: 5 };
const kgm = d => (d * 1000) ** 2 / 162; // kg per metre of a bar d (m) across
const r5 = v => Math.ceil((v * 1000) / 5) * 5; // cutting length, mm, rounded up to 5 mm
const byBar = layers => { const m = new Map(); for (const l of layers || []) m.set(l.bar, (m.get(l.bar) || 0) + l.n); return m; };
const hk = d => Math.max(6 * d, 0.075); // 135° hook extension

export function computeBBS(model, rebar, p = {}) {
  const P = { ...BBS_DEFAULTS, ...p }, N = id => model.nodes.get(id);
  const verts = model.elems.filter(e => (e.kind === "column" || e.kind === "wall") && e.nodes.length >= 2);
  const atNode = new Map(); // node -> elements framing in
  for (const e of model.elems) if (e.nodes.length === 2) for (const id of e.nodes) (atNode.get(id) || atNode.set(id, []).get(id)).push(e);
  const vertAt = new Set(verts.flatMap(e => e.nodes));
  const dirOf = e => { const a = N(e.nodes[0]), b = N(e.nodes[1]), l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1; return [(b.x - a.x) / l, (b.y - a.y) / l, (b.z - a.z) / l]; };
  const par = (u, v) => Math.abs(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) > 0.999;
  // support width under a beam end: the column (its larger side) or the beam it frames into
  const supportW = (node, beam) => {
    const es = atNode.get(node) || [], c = es.find(e => e.kind === "column");
    if (c) { const s = model.sects.get(c.sect); return Math.max(s?.b || 0, s?.h || 0); }
    if (vertAt.has(node)) return 0.2; // wall
    const g = es.find(e => e !== beam && e.kind === "beam" && !par(dirOf(e), dirOf(beam)));
    return g ? model.sects.get(g.sect)?.b || 0 : 0;
  };
  const lapped = (len, d) => { // bars longer than the stock length are spliced: extra lap per joint
    const lap = P.lap * d, st = P.stock;
    if (len <= st) return { len, joints: 0 };
    const joints = Math.ceil((len - st) / (st - lap));
    return { len: len + joints * lap, joints };
  };
  const out = { beams: [], cols: [], params: P };

  // ---- beams: spans between supports (columns, walls, or beams framing across) ----
  for (const det of rebar.beams) {
    const s = beamBox(model, det), own = new Set(det.elems), els = det.elems.map(id => model.elems.find(e => e.id === id)).filter(e => e && e.nodes.length === 2);
    if (!els.length || !det.sectors?.length) continue;
    const used = new Set(), spans = [];
    const isSupport = (node, b) => vertAt.has(node) || (atNode.get(node) || []).some(e => e.kind === "beam" && !own.has(e.id) && !par(dirOf(e), dirOf(b)));
    for (const e of els) {
      if (used.has(e.id)) continue; used.add(e.id);
      const chain = [...e.nodes], d0 = dirOf(e);
      for (const atStart of [false, true]) for (;;) {
        const end = atStart ? chain[0] : chain[chain.length - 1];
        if (isSupport(end, e)) break;
        const nx = (atNode.get(end) || []).find(o => own.has(o.id) && !used.has(o.id) && par(dirOf(o), d0));
        if (!nx) break;
        used.add(nx.id); const other = nx.nodes[0] === end ? nx.nodes[1] : nx.nodes[0]; atStart ? chain.unshift(other) : chain.push(other);
      }
      const a = N(chain[0]), b = N(chain[chain.length - 1]), L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      spans.push({ L, wa: supportW(chain[0], e), wb: supportW(chain[chain.length - 1], e) });
    }
    const groups = new Map(); // spans of the same length and supports: one BBS block
    for (const sp of spans) { const k = [sp.L, sp.wa, sp.wb].map(v => Math.round(v * 100)).join("|"); if (!groups.has(k)) groups.set(k, { ...sp, n: 0 }); groups.get(k).n++; }
    const sec = Object.fromEntries(det.sectors.map(x => [x.key, x])), list = ["I", "M", "J"].map(k => sec[k] || det.sectors[0]);
    const ds = list[0].stir ? barDia(list[0].stir.bar) : 0.01, db0 = list[0].top[0] ? barDia(list[0].top[0].bar) : 0.016;
    const cover = Math.min(0.075, Math.max(0.025, (list[0].top[0]?.d ?? 0.05) - db0 / 2 - ds)); // to the stirrup
    const rows = [];
    let gi = 0;
    for (const g of [...groups.values()].sort((x, y) => y.L - x.L)) {
      gi++;
      const Ln = Math.max(0.3, g.L - g.wa / 2 - g.wb / 2), anc = (w, d) => Math.max(w - 0.05, 0) + P.hook * d; // into the support, 90° hook
      const tag = groups.size > 1 ? ` (span ${gi}: L ${Math.round(g.L * 1000)})` : "";
      const add = (bar, shape, dims, cut, per) => { if (per > 0) rows.push({ bar, d: barDia(bar), shape, dims, cut: r5(cut), per, members: g.n, note: tag }); };
      for (const face of ["top", "bot"]) {
        const [I, M, J] = list.map(x => byBar(x[face])), bars = new Set([...I.keys(), ...M.keys(), ...J.keys()]);
        const F = face === "top" ? "Top" : "Bottom";
        for (const bar of bars) {
          const d = barDia(bar), nI = I.get(bar) || 0, nM = M.get(bar) || 0, nJ = J.get(bar) || 0, c = Math.min(nI, nM, nJ);
          const full = lapped(Ln + anc(g.wa, d) + anc(g.wb, d), d);
          add(bar, "90° hook both ends", `${F} continuous · Ln ${Math.round(Ln * 1000)} + anchorage` + (full.joints ? ` · ${full.joints} lap ${Math.round(P.lap * d * 1000)}` : ""), full.len, c);
          const ext = face === "top" ? Ln / 3 : Ln / 4; // support extras: top Ln/3, bottom Ln/4 past the face
          add(bar, "90° hook one end", `${F} extra at I · ${Math.round(ext * 1000)} + anchorage`, ext + anc(g.wa, d), nI - c);
          add(bar, "90° hook one end", `${F} extra at J · ${Math.round(ext * 1000)} + anchorage`, ext + anc(g.wb, d), nJ - c);
          add(bar, "straight", `${F} extra at midspan · 0.75 Ln`, 0.75 * Ln, nM - c);
        }
      }
      // stirrups: I / J zones Ln/4 each at their spacing, midspan Ln/2
      const zones = [[list[0], Ln / 4], [list[1], Ln / 2], [list[2], Ln / 4]], hoops = new Map(), ties = new Map();
      for (const [x, z] of zones) if (x.stir && spacingOk(x.stir.s)) {
        const n = Math.ceil(z / x.stir.s), k = x.stir.bar;
        hoops.set(k, (hoops.get(k) || 0) + n);
        if (x.stir.leg > 2) ties.set(k, (ties.get(k) || 0) + n * (x.stir.leg - 2));
      }
      const bw = s.B - 2 * cover, hw = s.H - 2 * cover;
      for (const [bar, n] of hoops) { const d = barDia(bar); add(bar, "closed hoop, 135° hooks", `Stirrup ${Math.round(bw * 1000)} x ${Math.round(hw * 1000)}`, 2 * (bw + hw) + 2 * hk(d), n + 1); }
      for (const [bar, n] of ties) { const d = barDia(bar); add(bar, "cross tie, 135° + 90°", `Stirrup inner leg ${Math.round(hw * 1000)}`, hw + 2 * hk(d), n); }
      const sk = list.find(x => x.skin)?.skin;
      if (sk) add(sk.bar, "straight", "Skin bar, both faces", Ln + Math.max(g.wa - 0.05, 0) + Math.max(g.wb - 0.05, 0), 2 * sk.n);
    }
    out.beams.push(finish({ name: det.name, kind: "beam", size: `${Math.round(s.B * 1000)} x ${Math.round(s.H * 1000)}`, members: spans.length, unit: "span", rows }));
  }

  // ---- columns: one block per story height; bars lapped above when a column continues ----
  const bottoms = new Set();
  for (const e of verts) { const zb = Math.min(...e.nodes.map(id => N(id).z)); for (const id of e.nodes) if (N(id).z <= zb + 0.05) bottoms.add(id); }
  for (const det of rebar.cols) {
    const { s, bars } = colBars(model, det), els = det.elems.map(id => model.elems.find(e => e.id === id)).filter(e => e && e.nodes.length === 2);
    if (!els.length || !bars.length) continue;
    const groups = new Map();
    for (const e of els) {
      const [p0, p1] = e.nodes.map(N).sort((a, b) => a.z - b.z), top = e.nodes.find(id => N(id).z === p1.z);
      const H = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z), cont = bottoms.has(top) && (atNode.get(top) || []).some(o => o !== e && (o.kind === "column" || o.kind === "wall"));
      const k = Math.round(H * 100) + "|" + cont;
      if (!groups.has(k)) groups.set(k, { H, cont, n: 0 }); groups.get(k).n++;
    }
    const rows = [], tie = det.tie && spacingOk(det.tie.s) ? det.tie : null, tm = det.tieCen && spacingOk(det.tieCen.s) ? det.tieCen : tie, dt = tie ? barDia(tie.bar) : 0.01;
    let gi = 0;
    for (const g of [...groups.values()].sort((x, y) => y.H - x.H || x.cont - y.cont)) {
      gi++;
      const tag = groups.size > 1 ? ` (H ${Math.round(g.H * 1000)}${g.cont ? "" : ", top"})` : "";
      const add = (bar, shape, dims, cut, per) => { if (per > 0) rows.push({ bar, d: barDia(bar), shape, dims, cut: r5(cut), per, members: g.n, note: tag }); };
      for (const l of bars) {
        const d = barDia(l.bar);
        if (g.cont) add(l.bar, "straight", `Main · H ${Math.round(g.H * 1000)} + lap ${Math.round(P.lap * d * 1000)}`, g.H + P.lap * d, l.n);
        else add(l.bar, "90° hook top", `Main · H ${Math.round(g.H * 1000)} - 50 + hook into the beam`, g.H - 0.05 + P.hook * d, l.n);
      }
      if (tie) {
        const lo = Math.max(Math.max(s.B, s.H), g.H / 6, 0.45), mid = Math.max(0, g.H - 2 * lo);
        const n = 2 * Math.ceil(lo / tie.s) + Math.ceil(mid / tm.s) + 1;
        const c = Math.max(0.025, (bars[0].dc ?? 0.05) - barDia(bars[0].bar) / 2 - dt), bw = s.B - 2 * c, hw = s.H - 2 * c;
        if (s.round) add(tie.bar, det.spiral ? "spiral (per turn)" : "circular hoop", `Tie Ø ${Math.round(bw * 1000)}`, Math.PI * bw + 2 * hk(dt) + (det.spiral ? 0 : P.lap * dt), n);
        else {
          add(tie.bar, "closed hoop, 135° hooks", `Tie ${Math.round(bw * 1000)} x ${Math.round(hw * 1000)} · ends lo ${Math.round(lo * 1000)} @${Math.round(tie.s * 1000)}, middle @${Math.round(tm.s * 1000)}`, 2 * (bw + hw) + 2 * hk(dt), n);
          if (tie.ny > 2) add(tie.bar, "cross tie, 135° + 90°", `Cross tie along B ${Math.round(bw * 1000)}`, bw + 2 * hk(dt), n * (tie.ny - 2));
          if (tie.nz > 2) add(tie.bar, "cross tie, 135° + 90°", `Cross tie along H ${Math.round(hw * 1000)}`, hw + 2 * hk(dt), n * (tie.nz - 2));
        }
      }
    }
    out.cols.push(finish({ name: det.name, kind: "col", size: s.round ? `Ø${Math.round(s.H * 1000)}` : `${Math.round(s.B * 1000)} x ${Math.round(s.H * 1000)}`, members: els.length, unit: "column", rows }));
  }
  // ---- totals per bar size, beams and columns ----
  const sum = new Map();
  for (const [part, list] of [["beam", out.beams], ["col", out.cols]]) for (const t of list) for (const r of t.rows) {
    const x = sum.get(r.bar) || { bar: r.bar, d: r.d, beam: 0, col: 0, len: 0 }; x[part] += r.kg; x.len += r.len; sum.set(r.bar, x);
  }
  out.summary = [...sum.values()].sort((a, b) => a.d - b.d).map(x => ({ ...x, total: x.beam + x.col, order: (x.beam + x.col) * (1 + P.waste / 100), bars12: Math.ceil((x.len * (1 + P.waste / 100)) / P.stock) }));
  return out;
}

function finish(t) {
  t.rows.forEach((r, i) => { r.mark = `${t.name}-${String(i + 1).padStart(2, "0")}`; r.n = r.per * r.members; r.len = (r.n * r.cut) / 1000; r.kg = r.len * kgm(r.d); });
  t.kg = t.rows.reduce((s, r) => s + r.kg, 0);
  return t;
}

// CSV for Excel: every BBS row of beams and columns, then the totals per bar size
export function bbsCsv(b, project = "") {
  const q = v => (/[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v), f = (v, n = 2) => (+v).toFixed(n);
  const lines = [[`Bar bending schedule${project ? " - " + project : ""}`], ["Type", "Size", "Mark", "Bar", "Shape", "Description", "Cutting length (mm)", "Bars per member", "Members", "Bars", "Total length (m)", "Weight (kg)"]];
  for (const t of [...b.beams, ...b.cols]) for (const r of t.rows) lines.push([t.name, t.size, r.mark, r.bar, r.shape, r.dims + r.note, r.cut, r.per, r.members, r.n, f(r.len), f(r.kg)]);
  lines.push([], ["Totals per bar size"], ["Bar", "Beams (kg)", "Columns (kg)", "Total (kg)", `With ${b.params.waste}% waste (kg)`, `${b.params.stock} m bars`]);
  for (const x of b.summary) lines.push([x.bar, f(x.beam), f(x.col), f(x.total), f(x.order), x.bars12]);
  return "﻿" + lines.map(l => l.map(q).join(",")).join("\r\n");
}
