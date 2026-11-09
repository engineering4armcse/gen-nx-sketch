// Beam rebar designed per element from the Gen NX member forces (SNI 2847:2019), instead of one design per section.
// Gen NX Concrete Design gives every element of a section the bars of the worst one unless the model is split into
// more sections or members and run again. Bars do not change the forces of an elastic analysis (the stiffness comes
// from the section and its cracked-section factor), so one run of Gen NX is enough: the forces of every element are
// read once and each beam gets the bars it needs here. Then the beams of a section are grouped into a few rebar types
// (rationalize) so the site does not get a different beam on every span.
//
// Units: mm, N, MPa inside; moments in kN·m and shears in kN at the edges. The result has the shape of
// parseBeamDesign().beams in design.js: { I, M, J: { top: [{ n, bar }], bot: [{ n, bar }], stir: { leg, bar, s (m) } } },
// so the plans, sections, schedule, shop drawings and BBS draw it as they draw the pasted Gen NX design.
//
// Covered: flexure at I, M and J (singly reinforced, tension controlled, As,min 9.6.1.2, up to two layers), shear
// (22.5, Vc simplified 22.5.5.1, Av,min 9.6.3, spacing 9.7.6.2.2), and with srpmk: the flexural rules of 18.6.3.2
// and the hoop spacing of 18.6.4.4 over 2h from each face.
// Not covered (flagged, left to Gen NX): capacity design shear Ve of 18.6.5 from the probable moments, torsion,
// compression bars, T-beam flange width. A beam that needs them gets a note and keeps the Gen NX design.

export const BAR_AREA = d => Math.PI * d * d / 4;
const dia = bar => +String(bar).replace(/[^\d.]/g, "");
const ceilTo = (x, step) => Math.ceil(x / step - 1e-9) * step;
const floorTo = (x, step) => Math.floor(x / step + 1e-9) * step;

export const DEFAULTS = {
  fc: 30, fy: 420, fyt: 420, cover: 40, // clear cover to the stirrup, mm
  bars: ["D16", "D19", "D22", "D25"], // tried for the main bars; the engineer can narrow it
  stirBars: ["D10", "D13"], legs: [2, 3, 4], sStep: 25, sMin: 75,
  aggregate: 20, // max aggregate size, mm (clear spacing ≥ 4/3 of it)
  minBars: 2, srpmk: false,
};

// ---------- flexure ----------
// required As (mm²) for Mu (kN·m) on a b×d section; null when the section cannot carry it as tension controlled
export function asRequired(Mu, b, d, o) {
  const { fc, fy } = o, M = Math.abs(Mu) * 1e6, phi = 0.9;
  const Rn = M / (phi * b * d * d), k = 1 - 2 * Rn / (0.85 * fc);
  const asMin = Math.max(0.25 * Math.sqrt(fc) / fy, 1.4 / fy) * b * d;
  if (k < 0) return { As: null, asMin, reason: "momen melebihi kapasitas penampang" };
  const rho = 0.85 * fc / fy * (1 - Math.sqrt(k));
  const b1 = fc <= 28 ? 0.85 : Math.max(0.65, 0.85 - 0.05 * (fc - 28) / 7);
  const rhoT = 0.85 * b1 * fc / fy * 0.003 / (0.003 + 0.005); // εt = 0.005: tension controlled
  if (rho > rhoT) return { As: rho * b * d, asMin, reason: "tidak terkontrol tarik (perlu tulangan tekan atau penampang lebih besar)" };
  return { As: Math.max(rho * b * d, M > 0 ? Math.min(asMin, 4 / 3 * rho * b * d) : 0), asMin, reason: null };
}
// bars per layer that fit the clear width
export function perLayer(b, db, ds, o) {
  const clear = b - 2 * o.cover - 2 * ds, gap = Math.max(25, db, 4 / 3 * o.aggregate);
  return Math.max(0, Math.floor((clear + gap) / (db + gap)));
}
// choose bars for a required As: the least steel among the bar sizes, at most two layers
export function chooseBars(As, b, ds, o, onlyBar) {
  let best = null;
  for (const bar of onlyBar ? [onlyBar] : o.bars) {
    const db = dia(bar), n = Math.max(o.minBars, Math.ceil(As / BAR_AREA(db) - 1e-9)), fit = perLayer(b, db, ds, o);
    if (!fit || n > 2 * fit) continue;
    const layers = n <= fit ? [n] : [fit, n - fit];
    const area = n * BAR_AREA(db);
    if (!best || area < best.area - 1e-6) best = { bar, db, n, layers, area };
  }
  return best;
}
// effective depth for a set of bars (two layers: the centroid moves up by half of (db + 25))
const effD = (h, o, ds, db, layers) => h - o.cover - ds - db / 2 - (layers.length > 1 ? (layers[1] / (layers[0] + layers[1])) * (db + 25) : 0);

// ---------- shear ----------
// stirrups for Vu (kN): { leg, bar, s (mm) } or { fail }
export function designShear(Vu, b, d, o, sCap = Infinity) {
  const { fc, fyt } = o, phi = 0.75, rt = Math.sqrt(fc);
  const Vc = 0.17 * rt * b * d / 1000, Vs = Math.max(0, Math.abs(Vu) / phi - Vc);
  if (Vs > 0.66 * rt * b * d / 1000) return { fail: "geser melebihi batas penampang (22.5.1.2)", Vc, Vs };
  const sMax = Math.min(Vs > 0.33 * rt * b * d / 1000 ? Math.min(d / 4, 300) : Math.min(d / 2, 600), sCap);
  const avsMin = Math.max(0.062 * rt, 0.35) * b / fyt, avs = Math.max(Vs * 1000 / (fyt * d), avsMin);
  for (const bar of o.stirBars) for (const leg of o.legs) {
    const Av = leg * BAR_AREA(dia(bar));
    const s = floorTo(Math.min(Av / avs, sMax), o.sStep);
    if (s >= o.sMin) return { leg, bar, s, Vc, Vs };
  }
  return { fail: "sengkang terlalu rapat", Vc, Vs };
}

// ---------- one beam ----------
// f: { I: { Mneg, Mpos, V }, M: {...}, J: {...} } in kN·m / kN (Mneg = hogging, top bars; Mpos = sagging, bottom bars)
// -> { I, M, J: { top, bot, stir }, need: { I: { top, bot } ... } (mm²), notes: [] }
export function designBeam(f, b, h, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, notes = [], out = { notes, need: {} };
  const ds0 = dia(o.stirBars[0]);
  const dGuess = h - o.cover - ds0 - 19 / 2;
  // required areas
  for (const p of ["I", "M", "J"]) {
    const top = asRequired(f[p]?.Mneg || 0, b, dGuess, o), bot = asRequired(f[p]?.Mpos || 0, b, dGuess, o);
    for (const [side, r] of [["atas", top], ["bawah", bot]]) if (r.reason) notes.push(`${p} ${side}: ${r.reason}`);
    out.need[p] = { top: top.As ?? Infinity, bot: bot.As ?? Infinity, asMin: top.asMin };
  }
  if (o.srpmk) {
    // 18.6.3.2: M+ at a face ≥ ½ M- there; at every section M+ and M- ≥ ¼ of the largest at either face
    const maxEnd = Math.max(out.need.I.top, out.need.J.top, out.need.I.bot, out.need.J.bot);
    for (const p of ["I", "J"]) out.need[p].bot = Math.max(out.need[p].bot, out.need[p].top / 2);
    for (const p of ["I", "M", "J"]) { out.need[p].top = Math.max(out.need[p].top, maxEnd / 4); out.need[p].bot = Math.max(out.need[p].bot, maxEnd / 4); }
  }
  // one bar size for the whole beam (top and bottom), the one with the least steel overall
  let best = null;
  for (const bar of o.bars) {
    const pick = {};
    let ok = true, area = 0;
    for (const p of ["I", "M", "J"]) for (const side of ["top", "bot"]) {
      const need = out.need[p][side];
      const c = Number.isFinite(need) ? chooseBars(o.srpmk ? Math.max(need, out.need[p].asMin) : need, b, ds0, o, bar) : null; // 18.6.3.1: As,min top and bottom everywhere
      if (!c) { ok = false; break; }
      pick[p + side] = c; area += c.area;
    }
    if (ok && (!best || area < best.area)) best = { bar, pick, area };
  }
  if (!best) { notes.push("tulangan tidak muat dalam dua lapis untuk semua ukuran besi"); return { ...out, fail: true }; }
  // recheck the flexure with the real effective depth (two layers lower d)
  for (const p of ["I", "M", "J"]) for (const side of ["top", "bot"]) {
    const c = best.pick[p + side], d = effD(h, o, ds0, c.db, c.layers), M = side === "top" ? f[p]?.Mneg : f[p]?.Mpos;
    const r = asRequired(M || 0, b, d, o);
    if (r.As != null && r.As > c.area + 1e-6) best.pick[p + side] = chooseBars(r.As, b, ds0, o, best.bar) || c;
  }
  // shear: hoops over 2h at each face in SRPMK
  const dS = h - o.cover - ds0 - 19 / 2;
  for (const p of ["I", "M", "J"]) {
    const end = p !== "M", db = dia(best.bar);
    const cap = o.srpmk && end ? Math.min(dS / 4, 6 * db, 150) : Infinity;
    const s = designShear(f[p]?.V || 0, b, dS, o, cap);
    if (s.fail) { notes.push(`${p} geser: ${s.fail}`); out.fail = true; }
    out[p] = { top: best.pick[p + "top"].layers.map(n => ({ n, bar: best.bar })), bot: best.pick[p + "bot"].layers.map(n => ({ n, bar: best.bar })), stir: s.fail ? null : { leg: s.leg, bar: s.bar, s: s.s / 1000 } };
  }
  if (o.srpmk) notes.push("geser kapasitas Ve (18.6.5) belum dihitung: cek terhadap desain Gen NX");
  return out;
}

// ---------- steel weight ----------
// kg of one beam of length L (m): main bars over thirds (I and J top bars over L/3 each, M over the middle third;
// bottom the same), stirrups by count over each third. An estimate for comparing designs, not a BBS.
export function beamWeight(d, L, b, h, o = DEFAULTS) {
  const kg = (db, len) => BAR_AREA(db) * 1e-6 * len * 7850;
  let w = 0;
  for (const p of ["I", "M", "J"]) {
    const z = d[p]; if (!z) continue;
    for (const g of [...(z.top || []), ...(z.bot || [])]) w += g.n * kg(dia(g.bar), L / 3);
    if (z.stir?.s) { const per = 2 * ((b - 2 * o.cover) + (h - 2 * o.cover)) / 1000 * (z.stir.leg / 2); w += Math.ceil(L / 3 / z.stir.s) * kg(dia(z.stir.bar), per); }
  }
  return w;
}

// ---------- rationalize ----------
// beams: [{ id, L, b, h, d (designBeam result) }] of ONE section. Groups them into at most k types, each type the
// envelope of its beams (more bars wins, closer stirrups win). Order by demand, then the best split into k runs
// (dynamic programming on the total weight). -> { types: [{ ids, d, weight }], weight }
export function envelope(ds) {
  const area = gs => gs.reduce((a, g) => a + g.n * BAR_AREA(dia(g.bar)), 0);
  const out = {};
  for (const p of ["I", "M", "J"]) {
    const pick = side => ds.map(d => d[p][side]).reduce((a, x) => (area(x) > area(a) ? x : a));
    const stir = ds.map(d => d[p].stir).filter(Boolean).reduce((a, x) => (!a || x.leg * BAR_AREA(dia(x.bar)) / x.s > a.leg * BAR_AREA(dia(a.bar)) / a.s ? x : a), null);
    out[p] = { top: pick("top"), bot: pick("bot"), stir };
  }
  return out;
}
export function rationalize(beams, k) {
  const area = gs => gs.reduce((a, g) => a + g.n * BAR_AREA(dia(g.bar)), 0);
  const demand = x => ["I", "M", "J"].reduce((a, p) => a + area(x.d[p].top) + area(x.d[p].bot), 0);
  const list = beams.filter(x => !x.d.fail).slice().sort((a, b) => demand(a) - demand(b));
  const n = list.length; k = Math.max(1, Math.min(k, n));
  if (!n) return { types: [], weight: 0 };
  // cost(i, j): weight of beams i..j all built as their envelope
  const cache = new Map();
  const cost = (i, j) => { const key = i * 1e5 + j; if (!cache.has(key)) { const env = envelope(list.slice(i, j + 1).map(x => x.d)); cache.set(key, { env, w: list.slice(i, j + 1).reduce((a, x) => a + beamWeight(env, x.L, x.b, x.h), 0) }); } return cache.get(key); };
  const best = Array.from({ length: k + 1 }, () => Array(n + 1).fill(Infinity)), cut = Array.from({ length: k + 1 }, () => Array(n + 1).fill(0));
  best[0][0] = 0;
  for (let g = 1; g <= k; g++) for (let j = 1; j <= n; j++) for (let i = g - 1; i < j; i++) {
    const v = best[g - 1][i] + cost(i, j - 1).w;
    if (v < best[g][j]) { best[g][j] = v; cut[g][j] = i; }
  }
  let g = k; while (g > 1 && best[g - 1][n] <= best[g][n] + 1e-9) g--; // no extra type when it saves nothing
  const types = [];
  for (let j = n; g > 0; g--) { const i = cut[g][j], c = cost(i, j - 1); types.unshift({ ids: list.slice(i, j).map(x => x.id), d: c.env, weight: c.w }); j = i; }
  return { types, weight: types.reduce((a, t) => a + t.weight, 0) };
}
