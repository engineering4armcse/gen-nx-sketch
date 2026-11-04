// Core logic: MIDAS JSON -> normalized model -> grids/levels -> 2D drawing views -> DXF.
// Pure functions only (no DOM), so the same code runs in the browser and in Node tests.
// World units are metres everywhere after normalizeModel().

export const UNIT_TO_M = { M: 1, CM: 0.01, MM: 0.001, FT: 0.3048, IN: 0.0254 };
const LINE_TYPES = new Set(["BEAM", "TRUSS", "TENSTR", "COMPTR"]);
const AREA_TYPES = new Set(["PLATE", "WALL", "PLSTRS", "PLSTRN"]);
export const KIND_LABEL = { column: "Column", beam: "Beam", brace: "Brace", wall: "Wall", slab: "Slab/Plate" };

// ---------- MIDAS responses ----------
// Every /db/XXXX GET answers {"XXXX": {"1": {...}, ...}}; an empty table can come back as {"message": ""}.
export function tableOf(resp, key) {
  if (!resp || typeof resp !== "object" || resp.error) return {};
  if (resp[key] && typeof resp[key] === "object") return resp[key];
  return Object.values(resp).find(v => v && typeof v === "object" && !Array.isArray(v)) || {};
}

function findKey(obj, key, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 5) return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const r = findKey(v, key, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

// General (GEN) sections: SECT_I.OUTER_POLYGON[].VERTEX[{X,Y}] (X = local y, Y = local z, origin at the centroid),
// openings in INNER_POLYGON. Returns [outer, ...holes] in metres, or null.
function sectPolys(s, f) {
  const loops = key => (findKey(s, key) || []).map(p => (p.VERTEX || []).map(q => [(+q.X || 0) * f, (+q.Y || 0) * f])).filter(l => l.length >= 3 && area(l) > 1e-8);
  const outer = loops("OUTER_POLYGON").sort((a, b) => area(b) - area(a));
  return outer.length ? [outer[0], ...loops("INNER_POLYGON")] : null;
}
const area = pts => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

// Section size: vSIZE (model units) when the section is user-defined, otherwise read it from the name ("H300x150x6.5/9", "C1 600x600").
function parseSect(id, s, f) {
  const name = String(s.SECT_NAME || findKey(s, "SECT_NAME") || `SECT ${id}`);
  const shape = String(findKey(s, "SHAPE") || "").toUpperCase();
  const round = ["P", "SR"].includes(shape);
  const off = String(findKey(s, "OFFSET_PT") || "CC").toUpperCase();
  let h = null, b = null, dims = null;
  // vSIZE for user/DB sections; tapered sections carry vSIZE_I (i-end) instead
  const v = findKey(s, "vSIZE") || findKey(s, "vSIZE_I");
  let poly = null;
  if (Array.isArray(v) && +v[0] > 0) {
    dims = v.map(x => (+x || 0) * f);
  } else if ((poly = sectPolys(s, f))) {
    const us = poly[0].map(p => p[0]), ws = poly[0].map(p => p[1]);
    b = Math.max(...us) - Math.min(...us); h = Math.max(...ws) - Math.min(...ws);
  } else if (shape !== "GEN") { // a general section's name ("KL7015") is not a size
    // DB sections: the catalogue designation (e.g. "H 350x175x7/11") sits in SECT_I.SECT_NAME, under the user's name
    const desig = [s.SECT_BEFORE?.SECT_I?.SECT_NAME, name].filter(Boolean);
    const nums = desig.map(d => (/\d/.test(d) ? d.replace(/^[^\d]*/, "").match(/\d+(?:\.\d+)?/g) : null)).find(Boolean);
    if (nums) {
      const n = nums.map(Number), g = n[0] >= 50 ? 0.001 : n[0] >= 5 ? 0.01 : 1; // mm / cm / m guess
      dims = n.map(x => x * g);
      if (shape === "L" && dims.length === 2) dims = [dims[0], dims[0], dims[1], dims[1]]; // "L 70x6": equal legs
      if (shape === "CC" && dims.length >= 4) dims = [dims[0], dims[1], dims[2], dims[3]]; // H x B x lip / t
      if (round && dims.length === 2) dims = [dims[0], dims[1]]; // "P 216.3x8.2": D x t
    }
  }
  if (dims) { h = dims[0]; b = round ? h : dims[1] > 0 ? dims[1] : h; }
  const desig = String(s.SECT_BEFORE?.SECT_I?.SECT_NAME || "").trim(); // DB catalogue designation, as Gen NX lists it
  return { id, name, shape, round, h, b, dims, off, poly, desig };
}

export function normalizeModel(raw) {
  const unitRow = Object.values(tableOf(raw.UNIT, "UNIT"))[0] || {};
  // no UNIT table (read failed, or a file saved without it): guess from the element lengths instead of assuming metres,
  // which drew a model in mm 1000 times too large. Typical spans: 2-12 m, 200-1200 cm, 2000-12000 mm.
  const given = String(unitRow.DIST || "").toUpperCase();
  const dist = UNIT_TO_M[given] ? given : guessUnit(raw);
  const unitGuessed = !UNIT_TO_M[given];
  const f = UNIT_TO_M[dist];

  const nodes = new Map();
  for (const [id, n] of Object.entries(tableOf(raw.NODE, "NODE")))
    nodes.set(+id, { id: +id, x: (+n.X || 0) * f, y: (+n.Y || 0) * f, z: (+n.Z || 0) * f });

  const sects = new Map();
  for (const [id, s] of Object.entries(tableOf(raw.SECT, "SECT"))) sects.set(+id, parseSect(+id, s, f));
  const thick = new Map();
  for (const [id, t] of Object.entries(tableOf(raw.THIK, "THIK")))
    thick.set(+id, { id: +id, name: String(t.NAME || `THK ${id}`), t: (+t.T_IN || +findKey(t, "T_IN") || 0) * f || null });
  const matls = new Map();
  const matlType = new Map();
  for (const [id, m] of Object.entries(tableOf(raw.MATL, "MATL"))) { matls.set(+id, String(m.NAME || `MAT ${id}`)); matlType.set(+id, String(m.TYPE || "")); }

  const stories = Object.values(tableOf(raw.STOR, "STOR"))
    .filter(s => s && s.STORY_LEVEL !== undefined)
    .map(s => ({ name: String(s.STORY_NAME ?? ""), z: +s.STORY_LEVEL * f }))
    .sort((a, b) => a.z - b.z);

  const elems = [];
  for (const [id, e] of Object.entries(tableOf(raw.ELEM, "ELEM"))) {
    const type = String(e.TYPE || "BEAM").toUpperCase();
    const ns = (e.NODE || []).filter(n => n > 0 && nodes.has(n)).map(n => nodes.get(n));
    const base = { id: +id, type, matl: matls.get(+e.MATL) || (e.MATL ? `MAT ${e.MATL}` : ""), matlType: matlType.get(+e.MATL) || "", angle: +e.ANGLE || 0 };
    if (LINE_TYPES.has(type) && ns.length >= 2) {
      const [a, b] = ns;
      const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (L < 1e-9) continue;
      const horiz = Math.hypot(b.x - a.x, b.y - a.y), dz = Math.abs(b.z - a.z);
      const kind = horiz < 0.02 * L ? "column" : dz < 0.5 * L ? "beam" : "brace"; // under 30° from horizontal (rafters) counts as beam
      const sec = sects.get(+e.SECT);
      elems.push({ ...base, kind, nodes: [a.id, b.id], sect: +e.SECT, sectName: sec?.name || `SECT ${e.SECT}`, L });
    } else if (AREA_TYPES.has(type) && ns.length >= 3) {
      const uniq = ns.filter((n, i) => ns.findIndex(m => m.id === n.id) === i);
      if (uniq.length < 3) continue;
      const nrm = normal(uniq);
      const kind = Math.abs(nrm[2]) < 0.1 ? "wall" : "slab";
      const t = thick.get(+e.SECT);
      elems.push({ ...base, kind, nodes: uniq.map(n => n.id), sect: +e.SECT, sectName: t?.name || `THK ${e.SECT}`, t: t?.t || null });
    }
  }
  // Design member assignment: element -> member id
  const memberOf = new Map();
  for (const [mid, mb] of Object.entries(tableOf(raw.MEMB, "MEMB"))) for (const id of mb.AELEM || []) memberOf.set(+id, +mid);
  return { unit: dist, unitGiven: given, unitGuessed, nodes, sects, thick, stories, elems, memberOf };
}

// the file's own unit from the section depths (beams and columns 0.15-2 m deep: under 5 -> M, under 160 -> CM, else MM),
// or from the element lengths (2-12 m spans) when no section has dimensions
function guessUnit(raw) {
  const med = a => a.sort((x, y) => x - y)[a.length >> 1];
  const hs = Object.entries(tableOf(raw.SECT, "SECT")).map(([id, s]) => parseSect(+id, s, 1).h).filter(h => h > 0);
  if (hs.length) { const h = med(hs); return h < 5 ? "M" : h < 160 ? "CM" : "MM"; }
  const nodes = tableOf(raw.NODE, "NODE"), Ls = [];
  for (const e of Object.values(tableOf(raw.ELEM, "ELEM"))) {
    const [a, b] = (e.NODE || []).map(n => nodes[n]);
    if (!a || !b || !LINE_TYPES.has(String(e.TYPE || "BEAM").toUpperCase())) continue;
    const L = Math.hypot((+b.X || 0) - (+a.X || 0), (+b.Y || 0) - (+a.Y || 0), (+b.Z || 0) - (+a.Z || 0));
    if (L > 0) Ls.push(L);
  }
  if (!Ls.length) return "M";
  const L = med(Ls); return L > 1500 ? "MM" : L > 60 ? "CM" : "M";
}

function normal(ns) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < ns.length; i++) {
    const a = ns[i], b = ns[(i + 1) % ns.length];
    nx += (a.y - b.y) * (a.z + b.z); ny += (a.z - b.z) * (a.x + b.x); nz += (a.x - b.x) * (a.y + b.y);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

// ---------- grids & levels ----------
export function cluster(values, tol) {
  const s = [...values].sort((a, b) => a - b), out = [];
  let g = [];
  for (const v of s) {
    if (g.length && v - g[g.length - 1] > tol) { out.push(g); g = []; }
    g.push(v);
  }
  if (g.length) out.push(g);
  return out.map(g => g.reduce((a, b) => a + b, 0) / g.length);
}

export function letterLabel(i) {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // I and O skipped (read as 1 and 0)
  let s = "";
  i += 1;
  while (i > 0) { const r = (i - 1) % L.length; s = L[r] + s; i = Math.floor((i - 1) / L.length); }
  return s;
}

// Gen NX's API exposes no grid table, so grid lines come from column positions (plus wall ends).
export function autoGrids(model, tol = 0.1) {
  const pts = [];
  for (const e of model.elems) if (e.kind === "column") pts.push(model.nodes.get(e.nodes[0]));
  for (const [p, q] of wallRuns(model, tol)) pts.push(p, q);
  let source = "columns";
  if (!pts.length) { pts.push(...model.nodes.values()); source = "all nodes"; }
  return {
    source,
    x: cluster(pts.map(p => p.x), tol).map((v, i) => ({ label: String(i + 1), v })),
    y: cluster(pts.map(p => p.y), tol).map((v, i) => ({ label: letterLabel(i), v })),
  };
}

// "0, 6, 12" or "1:0, 2:6, 2a:9.5" (metres). Labels default to 1,2,3 / A,B,C.
export function parseGridText(txt, axis) {
  const toks = String(txt || "").split(/[,;\s]+/).filter(Boolean);
  const out = [];
  toks.forEach((t, i) => {
    const m = /^(?:([^:=]+)[:=])?(-?\d+(?:\.\d+)?)$/.exec(t);
    if (!m) return;
    out.push({ label: m[1] || (axis === "x" ? String(out.length + 1) : letterLabel(out.length)), v: +m[2] });
  });
  return out.sort((a, b) => a.v - b.v);
}
export const gridToText = g => g.map(l => `${l.label}:${+l.v.toFixed(3)}`).join(", ");

export function levels(model, tol = 0.05) {
  if (model.stories.length) return model.stories.map(s => ({ ...s, name: s.name || fmtEl(s.z) }));
  const zs = [];
  for (const e of model.elems) for (const id of e.nodes) {
    if (e.kind === "beam" || e.kind === "slab" || e.kind === "column") zs.push(model.nodes.get(id).z);
  }
  if (!zs.length) for (const n of model.nodes.values()) zs.push(n.z);
  return cluster(zs, tol).map((z, i) => ({ name: i === 0 ? "BASE" : `LEVEL ${i}`, z }));
}

export const fmtEl = z => (z >= 0 ? "+" : "-") + Math.abs(z).toFixed(3);

// ---------- colours ----------
// AutoCAD Colour Index (ACI) so DXF and screen colours match exactly.
export function aciRgb(i) {
  const fixed = { 1: "#ff0000", 2: "#ffff00", 3: "#00ff00", 4: "#00ffff", 5: "#0000ff", 6: "#ff00ff", 7: "#000000", 8: "#808080", 9: "#c0c0c0" };
  if (fixed[i]) return fixed[i];
  const hue = Math.floor((i - 10) / 10) * 15, v = i % 10;
  const val = [1, 1, 0.65, 0.65, 0.5, 0.5, 0.3, 0.3, 0.15, 0.15][v], sat = v % 2 ? 0.5 : 1;
  return hsv(hue, sat, val);
}
function hsv(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map(t => Math.round((t + m) * 255).toString(16).padStart(2, "0")).join("");
}
// Readable on white: dark (0.65) then darker (0.5) variants of 24 hues, spread around the wheel.
const PALETTE = [];
for (const variant of [2, 4]) for (let k = 0; k < 24; k++) PALETTE.push(10 + ((k * 7) % 24) * 10 + variant);
export function sectionColors(model) {
  const names = [...new Set(model.elems.map(e => e.sectName))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const map = new Map();
  names.forEach((n, i) => { const aci = PALETTE[i % PALETTE.length]; map.set(n, { aci, color: aciRgb(aci) }); });
  return map;
}
// Per section name: size as B x H in mm (or plate thickness) and the most used material.
// Section outline in local (u = width along y, w = height along z), MIDAS offset point at the origin.
// Returns [{ pts, holes }] (2L gives two parts), or null when nothing is known.
export function sectionOutline(sec) {
  if (!sec) return null;
  const circle = (r, n = 24) => Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * 2 * Math.PI), r * Math.sin((i / n) * 2 * Math.PI)]);
  const rect = (b, h) => [[-b / 2, -h / 2], [b / 2, -h / 2], [b / 2, h / 2], [-b / 2, h / 2]];
  let parts;
  if (sec.poly) {
    const [o, ...holes] = sec.poly; // already about the centroid, which is MIDAS's CC point
    parts = [{ pts: o, holes }];
  } else if (sec.dims) {
    const [H, B, tw0, tf0, B2_, tf2_] = sec.dims, b = B || H, tw = tw0 || 0, tf = tf0 || tw, h2 = H / 2, one = pts => [{ pts, holes: [] }];
    if (!["SB", "SR", "P"].includes(sec.shape) && !tw) parts = one(rect(b, H)); // plate thicknesses unknown: plain block
    else switch (sec.shape) {
      case "SR": parts = one(circle(h2)); break;
      case "P": parts = [{ pts: circle(h2), holes: tw && tw < h2 ? [circle(h2 - tw)] : [] }]; break;
      case "B": { const t2 = tf2_ || tf; parts = [{ pts: rect(b, H), holes: [[[-b / 2 + tw, -h2 + t2], [b / 2 - tw, -h2 + t2], [b / 2 - tw, h2 - tf], [-b / 2 + tw, h2 - tf]]] }]; break; }
      case "H": { const t1 = b / 2, t2 = (B2_ || b) / 2, f2 = tf2_ || tf, w = tw / 2;
        parts = one([[-t2, -h2], [t2, -h2], [t2, -h2 + f2], [w, -h2 + f2], [w, h2 - tf], [t1, h2 - tf], [t1, h2], [-t1, h2], [-t1, h2 - tf], [-w, h2 - tf], [-w, -h2 + f2], [-t2, -h2 + f2]]); break; }
      case "T": { const w = tw / 2, f = b / 2; parts = one([[-w, -h2], [w, -h2], [w, h2 - tf], [f, h2 - tf], [f, h2], [-f, h2], [-f, h2 - tf], [-w, h2 - tf]]); break; }
      case "C": { const f2 = tf2_ || tf, u0 = -b / 2, u1 = (B2_ || b) - b / 2;
        parts = one([[u0, -h2], [u1, -h2], [u1, -h2 + f2], [u0 + tw, -h2 + f2], [u0 + tw, h2 - tf], [b / 2, h2 - tf], [b / 2, h2], [u0, h2]]); break; }
      case "CC": { const c = tw0, t = tf0 || 0.002, u0 = -b / 2, u1 = b / 2; // H x B x lip x t
        parts = one([[u0, -h2], [u1, -h2], [u1, -h2 + c], [u1 - t, -h2 + c], [u1 - t, -h2 + t], [u0 + t, -h2 + t], [u0 + t, h2 - t], [u1 - t, h2 - t], [u1 - t, h2 - c], [u1, h2 - c], [u1, h2], [u0, h2]]); break; }
      case "L": { const u0 = -b / 2; parts = one([[u0, -h2], [b / 2, -h2], [b / 2, -h2 + tf], [u0 + tw, -h2 + tf], [u0 + tw, h2], [u0, h2]]); break; }
      case "2L": { const g = (sec.dims[4] || 0) / 2, L1 = s0 => [[s0 * g, -h2], [s0 * (g + b), -h2], [s0 * (g + b), -h2 + tf], [s0 * (g + tw), -h2 + tf], [s0 * (g + tw), h2], [s0 * g, h2]];
        parts = [{ pts: L1(1), holes: [] }, { pts: L1(-1).reverse(), holes: [] }]; break; }
      default: parts = one(rect(b, H));
    }
  } else return null;
  // offset point: e.g. CT = node at centre-top, so the section hangs below it
  const all = parts.flatMap(p => p.pts), us = all.map(p => p[0]), ws = all.map(p => p[1]), off = sec.off || "CC";
  const du = off[0] === "L" ? -Math.min(...us) : off[0] === "R" ? -Math.max(...us) : 0, dw = off[1] === "T" ? -Math.max(...ws) : off[1] === "B" ? -Math.min(...ws) : 0;
  const mv = l => l.map(([u, w]) => [u + du, w + dw]);
  return parts.map(p => ({ pts: mv(p.pts), holes: p.holes.map(mv) }));
}

// beam drawn with its top at the node (top of the floor = top of the column), whatever offset point the section has
export const topOf = sec => (sec ? { ...sec, off: (sec.off || "CC")[0] + "T" } : sec);

// Catalogue-style profile text, e.g. "H 525x175x7/11", "□ 200x200x9/9", "Ø 216.3x8.2", "300 x 600"
export function sectDesc(s, t) {
  const mm = v => +(v * 1000).toFixed(1);
  if (t) return `t = ${mm(t)}`;
  if (s?.poly) return `General ${Math.round(s.b * 1000)} x ${Math.round(s.h * 1000)}`;
  if (!s?.dims) return "";
  const [H, B, tw, tf] = s.dims.map(mm);
  if (!tw && !["SB", "SR", "P"].includes(s.shape)) return `${B || H} x ${H}`; // plate thicknesses unknown
  switch (s.shape) {
    case "SB": return `${B} x ${H}`;
    case "SR": return `Ø ${H}`;
    case "P": return tw ? `Ø ${H}x${tw}` : `Ø ${H}`;
    case "B": return `□ ${H}x${B}x${tw}/${tf}`;
    case "CC": return `C ${H}x${B}x${tw}x${tf}`; // lipped channel: H x B x lip x t
    case "L": case "2L": return `${s.shape} ${H}x${B}x${tw}` + (tf && tf !== tw ? `/${tf}` : "");
    case "H": case "T": case "C": return `${s.shape} ${H}x${B}x${tw}/${tf}`;
    default: return `${B} x ${H}`;
  }
}

export function sectionInfo(model) {
  const out = new Map(), mats = new Map();
  for (const e of model.elems) {
    if (!out.has(e.sectName)) {
      const s = model.sects.get(e.sect), mm = v => Math.round(v * 1000);
      // size as Gen NX gives the section type: the DB designation (H 350x175x7/11), else shape and plates (□ 300x300x9/14), else B x H
      const size = e.t ? `t = ${mm(e.t)}` : s?.desig || (s?.dims && !["SB", "SR", ""].includes(s.shape) ? sectDesc(s) : "") || (s?.h ? (s.round ? `Ø${mm(s.h)}` : `${mm(s.b || s.h)} x ${mm(s.h)}`) : "");
      out.set(e.sectName, { size, desc: sectDesc(s, e.t), matl: "" }); mats.set(e.sectName, new Map());
    }
    const m = mats.get(e.sectName); if (e.matl) m.set(e.matl, (m.get(e.matl) || 0) + 1);
  }
  for (const [n, m] of mats) out.get(n).matl = [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  return out;
}

export function mix(hex, t) { // t=0 -> colour, t=1 -> white
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v + (255 - v) * t));
  return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
}

const MONO = {
  column: { color: "#000000", aci: 7 }, beam: { color: "#000000", aci: 7 }, brace: { color: "#000000", aci: 7 },
  wall: { color: "#404040", aci: 8 }, slab: { color: "#909090", aci: 9 },
};
// Layers of the office drawing standard (STANDAR GAMBAR.dwg): name -> [ACI colour, linetype]. Pen weights follow the colour (CTB plot style).
//   SS00GG grid, GRID BULLET grid bubbles, SS00D3 plan dimensions, SS00G1 thin lines (slab, levels), AS BALOK beam centrelines,
//   SS00G3 beam edges, SS00G5 column and wall outlines, SS00G6 steel and section details, SS00H1 hatch of columns that stop
//   (and the transfer column half), SS00H2 solid fill of columns and walls that continue; texts on TEXT xxx.
//   Rebar schedules: concrete on 3, stirrups and ties on 4, bars on REBAR, dimensions on DIM, table lines on 7, values on TG.
export const STD_LAYERS = {
  "SS00GG": [8, "DASHED"], "GRID BULLET": [1], "SS00D3": [1], "SS00G1": [95], "SS00G2": [2], "AS BALOK": [2], "SS00G3": [7], "SS00G4": [5],
  "SS00G5": [4], "SS00G6": [3], "SS00H1": [9], "SS00H2": [13],
  "TEXT JUDUL": [4], "TEXT SKALA": [7], "TEXT KOLOM": [6], "TEXT GIRDER": [7], "TEXT BEAM": [2], "TEXT WALL": [6], "TEXT SLAB": [7], "TEXT UMUM": [7], "TEXT TABEL DIMENSI": [2], "TEXT REBAR": [7], "TEXT REBAR KHUSUS": [6],
  "DIM": [1], "REBAR": [7], "KOLOM BAWAH": [1], "A-HATCH": [7], "1": [1], "3": [3], "4": [4], "6": [6], "7": [7], "TG": [7], "TB": [4],
};
const LABEL_LAYER = { column: "TEXT KOLOM", wall: "TEXT WALL", slab: "TEXT SLAB", beam: "TEXT BEAM", brace: "TEXT BEAM" };

// ---------- 2D views ----------
const SCALES = [20, 25, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000];
export const PAPER = { w: 420, h: 297, area: { x0: 15, y0: 15, x1: 325, y1: 282 } };
function pickScale(w, h, marginMm) {
  const aw = PAPER.area.x1 - PAPER.area.x0 - 2 * marginMm, ah = PAPER.area.y1 - PAPER.area.y0 - 2 * marginMm;
  for (const s of SCALES) if ((w * 1000) / s <= aw && (h * 1000) / s <= ah) return s;
  return SCALES[SCALES.length - 1];
}

function styleFor(e, opts, colors) {
  const layer = { column: "SS00G5", beam: "SS00G3", brace: "SS00G6", wall: "SS00G5", slab: "SS00G1" }[e.kind];
  if (opts.colorMode === "section") {
    const c = colors.get(e.sectName);
    return { layer: "SECT_" + e.sectName, color: c.color, aci: c.aci, sect: e.sectName };
  }
  return { layer, ...MONO[e.kind], aci: null, sect: e.sectName };
}

const GRID_C = "#9aa0a6"; // grid bubbles: thin grey
// grid lines: thin even dashes, their strength (0.1 faint .. 1 full) set from Drawing > Grid line strength
let gridAlpha = 0.6;
export const setGridAlpha = a => { gridAlpha = Math.min(1, Math.max(0.05, +a || 0.6)); };
const gridSt = () => ({ layer: "SS00GG", color: mix("#4a5058", 1 - gridAlpha), lw: 0.13, dash: "grid" });

// Shared helpers that add drafting items in world coordinates. k = metres per paper millimetre.
// Grid bubbles too close for one row are staggered: each value gets the first row (0, 1, 2) whose last bubble is at least gap away.
export function bubbleRows(vs, gap, maxRows = 3) {
  const last = Array(maxRows).fill(-Infinity), rows = [];
  for (const i of vs.map((v, i) => i).sort((a, b) => vs[a] - vs[b])) {
    let r = last.findIndex(x => vs[i] - x >= gap - 1e-9);
    if (r < 0) r = last.indexOf(Math.min(...last)); // still crowded: the row with the most room
    last[r] = vs[i]; rows[i] = r;
  }
  return rows;
}

export function adders(items, k, fs = 1, { dim = "SS00D3" } = {}) {
  const A = {
    line(a, b, st) { items.push({ t: "line", a, b, ...st }); },
    poly(pts, st) { items.push({ t: "poly", pts, ...st }); },
    circle(c, r, st) { items.push({ t: "circle", c, r, ...st }); },
    // fs scales labels and dimensions (Small/Medium/Large); grid bubbles keep their size
    text(p, s, st) { items.push({ t: "text", p, s: String(s), h: (st.size || 2.5) * k * (st.layer === "GRID BULLET" ? 1 : fs), ...st }); },
    // Outer part of grid lines vs, straight from near (just outside the drawing) to their bubbles beyond at; out = +1/-1, dir 'h' = row along x.
    // Close grids are staggered: every other line runs one bubble further out (CAD style).
    bubbles(vs, labels, near, at, dir, out) {
      const P = (u, w) => (dir === "h" ? [u, w] : [w, u]), gap = 7.2 * k, rows = bubbleRows(vs, gap), gst = gridSt();
      vs.forEach((v, i) => {
        const end = at + out * rows[i] * gap;
        A.line(P(v, near), P(v, end), gst);
        A.bubble(P(v, end + out * 3.3 * k), labels[i]);
      });
    },
    bubble(c, label) {
      A.circle(c, 3.3 * k, { layer: "GRID BULLET", color: GRID_C, lw: 0.18, fill: "#ffffff" });
      A.text(c, label, { layer: "GRID BULLET", color: "#3c4046", size: 3, align: "center", valign: "middle" });
    },
    // Dimension chain along a direction. pos: list of coordinates along u; at: offset coordinate; dir: 'h' (along x) or 'v' (along y).
    dimChain(pos, at, dir, side) {
      const st = { layer: dim, color: "#000000", lw: 0.18 };
      const P = (u, w) => (dir === "h" ? [u, w] : [w, u]);
      A.line(P(pos[0], at), P(pos[pos.length - 1], at), st);
      for (const u of pos) { // extension line and a 0.7 mm dot (the standard's _Dot arrow)
        A.line(P(u, at - 1.5 * k), P(u, at + 1.5 * k), st);
        A.circle(P(u, at), 0.35 * k, { ...st, fill: "#000000", solid: true });
      }
      // each text stays over its gap; texts too close for one row step out and back like the grid bubbles (up to 3 rows)
      const segs = [];
      for (let i = 1; i < pos.length; i++) { const d = pos[i] - pos[i - 1]; if (d * 1000 >= 1) segs.push({ u: (pos[i] + pos[i - 1]) / 2, d, s: String(Math.round(d * 1000)) }); }
      const w = s => (s.length * 2 * 0.62 * fs + 1.5) * k;
      const rows = segs.length ? bubbleRows(segs.map(g => g.u), Math.max(...segs.map(g => w(g.s)))) : [];
      segs.forEach((g, i) => {
        const off = rows[i] * 2.6 * fs * k;
        A.text(P(g.u, at + side * (1.2 * k + off)), g.s, { layer: dim, color: "#000000", aci: 7, size: 2, align: "center", valign: (side > 0) === (dir === "h") ? "bottom" : "top", rot: dir === "h" ? 0 : 90 }); // text always on the far side of the line
      });
    },
  };
  return A;
}

// Member label: the rebar type name (B2A3-A, B2A3-B) when its section has several rebar types, else the section name.
// model.typeOf (element id -> type name) is set by the app from the rebar data.
export const tagOf = (model, e) => model.typeOf?.get(e.id) ?? e.sectName;
// Concrete beams with no rebar detail yet (model.noRebar, element ids, set by the app) are marked in plans and elevations:
// a red label (colour 1 in the DXF) over a light red band (screen and PDF only). bare(): 1 when any element of the run lacks rebar.
const RP_ODD = "#c000c0"; // ACI 6: a bar size other than the plan's usual one
// one colour per bar size on the beam rebar plans (screen colour, ACI); the main size stays black
const BAR_COLORS = { D10: ["#007f7f", 4], D13: ["#007f7f", 4], D16: ["#009900", 3], D19: ["#0000ff", 5], D22: ["#c000c0", 6], D25: ["#e00000", 1], D29: ["#d07000", 30], D32: ["#7a3cc0", 190], D36: ["#8a6a00", 40] };
export const barColor = b => BAR_COLORS[b] || [RP_ODD, 6];
export const NO_REBAR = { band: "#f6c4be", text: { color: "#d0281c", aci: 1 }, note: n => `RED: BEAM WITHOUT REBAR DETAIL (${n})` };
const bare = (model, m, opts) => (opts.markNoRebar !== false && m.kind === "beam" && (m.ids || [m.id]).some(id => model.noRebar?.has(id)) ? 1 : 0);

function textRot(dx, dy) {
  let a = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (a > 90.01) a -= 180;
  if (a <= -89.99) a += 180;
  return a;
}

// Plan directions of a column's local z and y axes (Gen NX β). A column drawn top to bottom (i node above j) has its local x
// pointing down, so β turns the other way and y flips: z = (cos β, -sin β), y = (sin β, cos β); as in the 3D view.
export function colAxes(model, e) {
  const r = ((e.angle || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const down = model.nodes.get(e.nodes[0]).z > model.nodes.get(e.nodes[1]).z + 1e-6;
  return down ? [[c, -s], [s, c]] : [[c, s], [s, -c]];
}

// Join collinear segments of the same section into one run = one line = one label.
// They are joined at a node when nothing else frames into it, or when Gen NX's member assignment
// (/db/MEMB) puts both elements in the same design member (e.g. a rafter split at every purlin).
export function mergeRuns(elems, model, degree) {
  const used = new Set(), out = [];
  const byNode = new Map();
  for (const b of elems) for (const n of b.nodes) { if (!byNode.has(n)) byNode.set(n, []); byNode.get(n).push(b); }
  const dir = b => { const p = model.nodes.get(b.nodes[0]), q = model.nodes.get(b.nodes[1]); const l = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) || 1; return [(q.x - p.x) / l, (q.y - p.y) / l, (q.z - p.z) / l]; };
  const parallel = (u, v) => Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) < 2e-3;
  const memb = model.memberOf || new Map();
  for (const b of elems) {
    if (used.has(b.id)) continue;
    used.add(b.id);
    const chain = [...b.nodes], ids = [b.id], d0 = dir(b), m0 = memb.get(b.id);
    const grow = atStart => {
      for (;;) {
        const end = atStart ? chain[0] : chain[chain.length - 1];
        const free = (degree.get(end) || 0) === 2;
        const next = (byNode.get(end) || []).find(o => !used.has(o.id) && o.sectName === b.sectName && tagOf(model, o) === tagOf(model, b) && parallel(dir(o), d0) &&
          (free || (m0 !== undefined && memb.get(o.id) === m0)));
        if (!next) return;
        used.add(next.id); ids.push(next.id);
        const other = next.nodes[0] === end ? next.nodes[1] : next.nodes[0];
        atStart ? chain.unshift(other) : chain.push(other);
      }
    };
    grow(false); grow(true);
    const a = model.nodes.get(chain[0]), z = model.nodes.get(chain[chain.length - 1]);
    out.push({ ...b, a, b: z, ids, L: Math.hypot(z.x - a.x, z.y - a.y, z.z - a.z) });
  }
  return out;
}

// Wall panels merged into straight plan runs (a wall meshed into several panels gives one run), as [p, q] end points.
function wallRuns(model, tol) {
  const segs = model.elems.filter(e => e.kind === "wall").map(e => wallEnds(e.nodes.map(id => model.nodes.get(id))));
  const parent = segs.map((_, i) => i), find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const dir = ([p, q]) => { const l = Math.hypot(q.x - p.x, q.y - p.y) || 1; return [(q.x - p.x) / l, (q.y - p.y) / l]; };
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const [a, b] = segs[i], [c, d] = segs[j], u = dir(segs[i]), v = dir(segs[j]);
    if (Math.abs(u[0] * v[1] - u[1] * v[0]) > 1e-3) continue;
    if (near(a, c) || near(a, d) || near(b, c) || near(b, d)) parent[find(i)] = find(j);
  }
  const groups = new Map();
  segs.forEach((s, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(...s); });
  return [...groups.values()].map(ps => wallEnds(ps));
}

function wallEnds(ns) {
  // the two plan points of a vertical panel that are furthest apart
  let best = [ns[0], ns[1]], d = -1;
  for (const p of ns) for (const q of ns) { const dd = Math.hypot(p.x - q.x, p.y - q.y); if (dd > d) { d = dd; best = [p, q]; } }
  return best;
}

// mode "column": columns and walls rising from this level, with labels.
// mode "beam": beams and slabs at this level, with the columns/walls below shown as outlines (projection).
// Transfer columns: columns that start on a beam or slab, not on a column or wall below and not at the base.
// A column split into segments counts once, by its lowest segment.
export function transferCols(model) {
  if (model._transfer) return model._transfer;
  const N = id => model.nodes.get(id), tol = 0.05, tops = new Set();
  const zMin = Math.min(...[...model.nodes.values()].map(n => n.z));
  for (const e of model.elems) if (e.kind === "column" || e.kind === "wall") {
    const top = Math.max(...e.nodes.map(id => N(id).z));
    for (const id of e.nodes) if (N(id).z >= top - tol) tops.add(id);
  }
  model._transfer = new Set(model.elems.filter(e => {
    if (e.kind !== "column") return false;
    const bot = e.nodes.reduce((a, id) => (N(id).z < N(a).z ? id : a));
    return N(bot).z > zMin + tol && !tops.has(bot);
  }).map(e => e.id));
  return model._transfer;
}

const isSteel = sec => !!sec?.dims && !["SB", "SR"].includes(sec.shape) && !!sec.dims[2]; // rolled or built-up profile: plate thicknesses known

// Beam edges in plan, CAD style: two lines at ± b/2 per run, with the parts that fall inside another beam, a column or a
// wall left out (so junctions read as one piece of concrete). The outer edge of a corner runs on to close it; a free end
// gets an end line. -> Map(run -> { lines: [[a, b]] | null (steel or too narrow: one line), w, girder (both ends on a
// column or wall), steel })
function beamEdges(runs, verts, model, k, outlineOf) {
  const N = id => model.nodes.get(id), key = p => `${Math.round(p.x * 200)},${Math.round(p.y * 200)}`; // 5 mm buckets
  const at = new Map(), vAt = new Map(), push = (m, kk, v) => { if (!m.has(kk)) m.set(kk, []); m.get(kk).push(v); };
  const width = m => model.sects.get(m.sect)?.b || model.sects.get(m.sect)?.h || 0.25;
  for (const m of runs) { push(at, key(m.a), { m, p: m.a, q: m.b }); push(at, key(m.b), { m, p: m.b, q: m.a }); }
  for (const e of verts) for (const id of e.nodes) push(vAt, key(N(id)), e);
  const out = new Map(), bands = [];
  for (const m of runs) {
    const sec = model.sects.get(m.sect), w = width(m), steel = isSteel(sec), L = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
    const girder = [m.a, m.b].every(p => (vAt.get(key(p)) || []).length > 0);
    if (steel || w / k < 0.8 || L < 1e-6) { out.set(m, { lines: null, w, girder, steel }); continue; }
    const d = [(m.b.x - m.a.x) / L, (m.b.y - m.a.y) / L], nrm = [-d[1], d[0]], ext = [0, 0], caps = [];
    [m.a, m.b].forEach((p, ei) => {
      const others = (at.get(key(p)) || []).filter(o => o.m !== m), dd = ei ? [-d[0], -d[1]] : d;
      const cont = others.some(o => { const l = Math.hypot(o.q.x - o.p.x, o.q.y - o.p.y) || 1; return (dd[0] * (o.q.x - o.p.x) + dd[1] * (o.q.y - o.p.y)) / l < -0.995; });
      const col = (vAt.get(key(p)) || []).length > 0;
      if (!cont && !col && others.length) ext[ei] = Math.max(...others.map(o => width(o.m) / 2)); // corner: run on past the node
      if (!others.length && !col) caps.push(ei);
    });
    const A0 = [m.a.x - d[0] * ext[0], m.a.y - d[1] * ext[0]], B0 = [m.b.x + d[0] * ext[1], m.b.y + d[1] * ext[1]];
    const side = sd => [[A0[0] + nrm[0] * sd * w / 2, A0[1] + nrm[1] * sd * w / 2], [B0[0] + nrm[0] * sd * w / 2, B0[1] + nrm[1] * sd * w / 2]];
    const [l1, l2] = [side(1), side(-1)];
    const rec = { m, w, girder, steel, raw: [l1, l2], caps: caps.map(ei => (ei ? [l1[1], l2[1]] : [l1[0], l2[0]])), band: [l1[0], l1[1], l2[1], l2[0]] };
    out.set(m, rec); bands.push(rec);
  }
  // cutters: every beam band and every column / wall outline in the plan
  const cutters = [...bands.map(r => ({ pts: r.band, own: r })), ...verts.flatMap(e => outlineOf(e).map(pts => ({ pts })))]
    .map(c => ({ ...c, pts: convexHull(c.pts), box: bbox(c.pts) }));
  for (const r of bands) {
    r.lines = [];
    for (const seg of [...r.raw, ...r.caps]) {
      const sb = bbox(seg), cuts = [];
      for (const c of cutters) if (c.own !== r && c.box[0] < sb[2] && c.box[2] > sb[0] && c.box[1] < sb[3] && c.box[3] > sb[1]) { const iv = clipInside(seg, c.pts, 1e-3); if (iv) cuts.push(iv); }
      for (const [t0, t1] of keepParts(cuts)) {
        const P = t => [seg[0][0] + (seg[1][0] - seg[0][0]) * t, seg[0][1] + (seg[1][1] - seg[0][1]) * t];
        if ((t1 - t0) * Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]) > 1e-4) r.lines.push([P(t0), P(t1)]);
      }
    }
    delete r.raw; delete r.caps; delete r.band;
  }
  return out;
}
const bbox = pts => [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
function convexHull(pts) { // monotone chain, counter-clockwise
  const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => { const h = []; for (const p of list) { while (h.length >= 2 && cr(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); } h.pop(); return h; };
  return [...half(P), ...half([...P].reverse())];
}
// Cyrus-Beck: the part [t0, t1] of segment ab strictly inside convex polygon (ccw), shrunk by eps; null if none
function clipInside([a, b], poly, eps) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], ex = q[0] - p[0], ey = q[1] - p[1], l = Math.hypot(ex, ey);
    if (l < 1e-9) continue;
    const nx = -ey / l, ny = ex / l; // inward normal for ccw
    const num = (a[0] - p[0]) * nx + (a[1] - p[1]) * ny - eps, den = dx * nx + dy * ny;
    if (Math.abs(den) < 1e-12) { if (num < 0) return null; continue; }
    const t = -num / den;
    if (den > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 >= t1) return null;
  }
  return [t0, t1];
}
// [0, 1] minus the union of the cut intervals
function keepParts(cuts) {
  const out = []; let t = 0;
  for (const [a, b] of cuts.sort((x, y) => x[0] - y[0])) { if (a > t) out.push([t, a]); t = Math.max(t, b); }
  if (t < 1) out.push([t, 1]);
  return out;
}

export function buildPlan(model, opts, level, mode = "beam") {
  const proj = mode === "beam";
  const tol = opts.levelTol ?? 0.05, colors = opts.colors, grids = opts.grids;
  const N = id => model.nodes.get(id);
  const atL = id => Math.abs(N(id).z - level.z) <= tol;
  // Sloped beams not lying on any level (rafters) show, projected, on the first level at or above their top end.
  // Level beams between stories (landings, bordes) have plans of their own (see offLevels), so they never stack on the story above.
  const zr = e => e.nodes.map(id => N(id).z);
  const homeLevel = e => { const top = Math.max(...zr(e)); return (opts.levels || []).find(l => l.z >= top - tol); };
  const flat = e => { const z = zr(e); return Math.max(...z) - Math.min(...z) <= tol; };
  const beams = !proj ? [] : model.elems.filter(e => e.kind === "beam" && (e.nodes.every(atL) ||
    (!level.off && !flat(e) && !(opts.levels || []).some(l => zr(e).every(z => Math.abs(z - l.z) <= tol)) && homeLevel(e)?.z === level.z)));
  const slabs = !proj ? [] : model.elems.filter(e => e.kind === "slab" && e.nodes.every(atL));
  const touches = e => { const zs = e.nodes.map(id => N(id).z); return Math.min(...zs) - tol <= level.z && Math.max(...zs) + tol >= level.z; };
  const vert = model.elems.filter(e => (e.kind === "column" || e.kind === "wall") && touches(e));
  // columns/walls whose top is above the previous level and at or below this one (so columns under rafters count too)
  const prevZ = Math.max(-Infinity, ...(opts.levels || []).filter(l => l.z < level.z - tol).map(l => l.z));
  const below = model.elems.filter(e => (e.kind === "column" || e.kind === "wall") && (() => {
    const zs = e.nodes.map(id => N(id).z), top = Math.max(...zs);
    return top <= level.z + tol && top > prevZ + tol && Math.min(...zs) < level.z - tol;
  })());
  const rising = vert.filter(e => Math.abs(Math.min(...e.nodes.map(id => N(id).z)) - level.z) <= tol && Math.max(...e.nodes.map(id => N(id).z)) > level.z + tol);
  // a column or wall below continues above this level when something vertical starts on its top node
  // (node -> what starts there). A concrete column under a steel one counts as stopping: it is shown as an empty box under the H
  const bottoms = new Map(), steel = e => e.matlType === "STEEL" || (!e.matlType && isSteel(model.sects.get(e.sect)));
  for (const e of model.elems) if (e.kind === "column" || e.kind === "wall") { const zb = Math.min(...zr(e)); for (const id of e.nodes) if (N(id).z <= zb + tol) (bottoms.get(id) || bottoms.set(id, []).get(id)).push(e); }
  const contAbove = e => e.nodes.some(id => atL(id) && (bottoms.get(id) || []).some(u => steel(u) === steel(e)));
  // column plan: the columns/walls rising from here, plus those from below that stop here (outline only, no label)
  const stops = new Set(below.filter(e => !contAbove(e)));
  if (!proj && !rising.length) return null; // a column plan needs something rising from this level
  // beam plan: the columns and walls going up from this floor (plan 2F shows the 2F columns); the roof, with nothing above, shows those below
  const verts = proj ? (rising.length ? rising : below) : [...stops, ...rising]; // stopping ones first, so a column rising from the same spot draws over them

  const xs = [...grids.x.map(g => g.v)], ys = [...grids.y.map(g => g.v)];
  for (const e of [...beams, ...slabs, ...verts]) for (const id of e.nodes) { xs.push(N(id).x); ys.push(N(id).y); }
  if (!xs.length) return null;
  const ext = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  const scale = pickScale(ext.x1 - ext.x0, ext.y1 - ext.y0, 32);
  const k = scale / 1000, items = [], A = adders(items, k, opts.fontScale || 1);

  // grids
  const gx0 = ext.x0 - 22 * k, gx1 = ext.x1 + 22 * k, gy0 = ext.y0 - 22 * k, gy1 = ext.y1 + 22 * k;
  const gst = gridSt();
  const nx0 = ext.x0 - 2 * k, nx1 = ext.x1 + 2 * k, ny0 = ext.y0 - 2 * k, ny1 = ext.y1 + 2 * k; // grid lines jog just outside the drawing
  for (const g of grids.x) A.line([g.v, ny0], [g.v, ny1], gst);
  for (const g of grids.y) A.line([nx0, g.v], [nx1, g.v], gst);
  const gxv = grids.x.map(g => g.v), gxl = grids.x.map(g => g.label), gyv = grids.y.map(g => g.v), gyl = grids.y.map(g => g.label);
  A.bubbles(gxv, gxl, ny1, gy1, "h", 1); A.bubbles(gxv, gxl, ny0, gy0, "h", -1); A.bubbles(gyv, gyl, nx0, gx0, "v", -1); A.bubbles(gyv, gyl, nx1, gx1, "v", 1);
  if (grids.x.length > 1) { A.dimChain(gxv, ext.y1 + 8 * k, "h", 1); A.dimChain([gxv[0], gxv[gxv.length - 1]], ext.y1 + 17 * k, "h", 1); }
  if (grids.y.length > 1) { A.dimChain(gyv, ext.x0 - 8 * k, "v", -1); A.dimChain([gyv[0], gyv[gyv.length - 1]], ext.x0 - 17 * k, "v", -1); }

  const legend = new Map();
  const count = e => legend.set(e.sectName, (legend.get(e.sectName) || 0) + 1);
  const tip = (e, extra = "") => `${tagOf(model, e)}\n${KIND_LABEL[e.kind]} · Elem ${e.id}${extra}`;
  const lab = (st, kind) => ({ layer: LABEL_LAYER[kind], color: st.color, aci: st.aci, size: 2 });
  let noRebar = 0;
  // continuing: solid fill on SS00H2; stopping here: outline only
  const fillVert = (pts, e, dark, hov) => {
    if (!stops.has(e)) A.poly(pts, { layer: "SS00H2", color: dark, fill: dark, lw: 0.05, closed: true, solidOnly: true, ...hov });
  };

  // plan outline of a column or wall: [{ pts, holes }]
  const vertParts = e => {
    if (e.kind === "wall") {
      const [p, q] = wallEnds(e.nodes.map(N));
      const t = e.t || 0.2, l = Math.hypot(q.x - p.x, q.y - p.y) || 1, nx = (-(q.y - p.y) / l) * t / 2, ny = ((q.x - p.x) / l) * t / 2;
      return [{ pts: [[p.x + nx, p.y + ny], [q.x + nx, q.y + ny], [q.x - nx, q.y - ny], [p.x - nx, p.y - ny]], holes: [] }];
    }
    const sec = model.sects.get(e.sect) || {}, p = N(e.nodes[0]);
    const H = Math.max(sec.h || 0.3, 1.2 * k), B = Math.max(sec.b || sec.h || 0.3, 1.2 * k);
    // same local axes as the 3D view: section height (w) along local z, width (u) along local y
    const [zv, yv] = colAxes(model, e), toPlan = l => l.map(([u, w]) => [p.x + w * zv[0] + u * yv[0], p.y + w * zv[1] + u * yv[1]]);
    const outl = sec.h ? sectionOutline(sec) : null; // the real shape (H, T, C, pipe…) even when small; a block only when the shape is unknown
    return outl ? outl.map(o => ({ pts: toPlan(o.pts), holes: o.holes.map(toPlan) }))
      : [{ pts: sec.round ? Array.from({ length: 24 }, (_, i) => [p.x + (H / 2) * Math.cos((i * Math.PI) / 12), p.y + (H / 2) * Math.sin((i * Math.PI) / 12)]) : toPlan([[-B / 2, -H / 2], [B / 2, -H / 2], [B / 2, H / 2], [-B / 2, H / 2]]), holes: [] }];
  };

  for (const e of slabs) {
    const st = styleFor(e, opts, colors);
    A.poly(e.nodes.map(id => [N(id).x, N(id).y]), { ...st, fill: mix(st.color, 0.85), color: mix(st.color, 0.5), lw: 0.13, closed: true, nosolid: true, tip: tip(e) });
    count(e);
  }
  for (const e of verts.filter(e => e.kind === "wall")) {
    const st = styleFor(e, opts, colors), pts = vertParts(e)[0].pts;
    A.poly(pts, { ...st, fill: "#ffffff", lw: proj ? 0.25 : 0.35, closed: true, nosolid: true, noDxf: true, tip: tip(e) });
    fillVert(pts, e, opts.colorMode === "section" ? mix(st.color, proj ? 0.6 : 0.3) : proj ? "#9a9a9a" : "#5a5a5a", { tip: tip(e) });
    A.poly(pts, { ...st, lw: proj ? 0.25 : 0.35, closed: true, nosolid: true }); // outline on SS00G5
    if (proj || !stops.has(e)) count(e);
  }
  // wall labels: one per straight wall run, on the opposite side to beam labels
  if (opts.labels && !proj) {
    const walls = verts.filter(e => e.kind === "wall" && !stops.has(e));
    const runs = wallRuns({ elems: walls, nodes: model.nodes }, 0.05);
    for (const [p, q] of runs) {
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const e = walls.find(w => { const [a, b] = wallEnds(w.nodes.map(N)); return Math.abs((b.x - a.x) * (mid.y - a.y) - (b.y - a.y) * (mid.x - a.x)) < 0.05 * Math.hypot(b.x - a.x, b.y - a.y); }) || walls[0];
      const st = styleFor(e, opts, colors), r = textRot(q.x - p.x, q.y - p.y), a = (r * Math.PI) / 180;
      const off = (e.t || 0.2) / 2 + 1.2 * k;
      A.text([mid.x + Math.sin(a) * off, mid.y - Math.cos(a) * off], e.sectName, { ...lab(st, "wall"), align: "center", valign: "top", rot: r });
    }
  }

  const degree = new Map();
  for (const e of [...beams, ...verts]) for (const id of e.nodes) degree.set(id, (degree.get(id) || 0) + 1);
  for (const e of beams) count(e);
  const runs = mergeRuns(beams, model, degree);
  const edges = beamEdges(runs, verts, model, k, e => vertParts(e).map(p => p.pts));
  // beam rebar plan (opts.rebarPlan from rebar.js): single lines, type name above, the bars below; a bar size other than
  // the plan's usual one is written out and coloured
  const rp = opts.rebarPlan, rpStd = rp?.common(runs);
  const rpDir = m => (Math.abs(m.b.x - m.a.x) >= Math.abs(m.b.y - m.a.y) ? "X" : "Y");
  if (rp) for (const m of runs.filter(m => rpDir(m) !== rp.dir)) A.line([m.a.x, m.a.y], [m.b.x, m.b.y], { layer: "AS BALOK", color: "#b4b9c0", lw: 0.13 }); // the other direction, for reference
  // labels are collected first, then placed midspan groups first, each pushed further from its line while it hits one already placed
  const rpLabels = [], rpUsed = new Set();
  if (rp) for (const m of runs.filter(m => rpDir(m) === rp.dir)) {
    const t = tip(m, ` · L=${m.L.toFixed(3)} m`), el = m.ids.join(","), miss = bare(model, m, opts); noRebar += miss;
    A.line([m.a.x, m.a.y], [m.b.x, m.b.y], { layer: "AS BALOK", color: "#000000", lw: 0.3, tip: t, el });
    const r = textRot(m.b.x - m.a.x, m.b.y - m.a.y), a = (r * Math.PI) / 180, off = 0.8 * k;
    // midspan: type then the midspan text above the line, the other below; near each end the support values
    const L2 = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y) || 1, ux = (m.b.x - m.a.x) / L2, uy = (m.b.y - m.a.y) / L2;
    const flip = Math.cos(a) * ux + Math.sin(a) * uy < 0; // text reads the other way
    const at = (u, d) => [m.a.x + ux * u - Math.sin(a) * d, m.a.y + uy * u + Math.cos(a) * d], lines = rp.text(m, rpStd);
    const odd = { layer: "TEXT REBAR KHUSUS", color: RP_ODD, aci: 6 }, std = { layer: "TEXT REBAR", color: "#000000", aci: 7 };
    const face = (p, sgn) => { let f = 0; for (const e of verts) for (const part of vertParts(e)) { const inside = part.pts.some(q => Math.hypot(q[0] - p.x, q[1] - p.y) < 2) && e.nodes.some(id => Math.hypot(N(id).x - p.x, N(id).y - p.y) < 0.05);
      if (inside) for (const q of part.pts) f = Math.max(f, sgn * ((q[0] - p.x) * ux + (q[1] - p.y) * uy)); } return f; };
    // text size: 1.8 mm, smaller on a short beam so the text stays within it (down to 1.2 mm); room = the clear span
    const room = Math.max(L2 - face(m.a, 1) - face(m.b, -1), 0.3 * L2) / k, fit = (parts, share) => Math.max(1.2, Math.min(1.8, (share * room) / (0.82 * (opts.fontScale || 1) * Math.max(...parts.map(q => q.s.length), 1))));
    const grp = { m, u0: face(m.a, 1), u1: L2 - face(m.b, -1) }; // the midspan pair slides along the clear span together
    const label = (prio, u, side, align, parts, h) => { parts = parts.filter(q => q.s); rpLabels.push({ prio, at, u, side, off, r, a, align, parts, h: h || fit(parts, prio ? 0.42 : 0.92), grp, slide: !prio }); };
    const name = { s: tagOf(model, m), st: { ...(miss ? NO_REBAR.text : { layer: "TEXT BEAM", color: "#000000" }), bold: true, font: "ROMAND" } };
    const mt = lines?.mid?.[0], mb = lines?.mid?.[1];
    // a piece too short for its text (e.g. inside a column) is left bare when the piece next to it in line reads the same
    const sig = o => tagOf(model, o) + JSON.stringify(rp.text(o, rpStd)?.mid?.map(c => c?.s)), touch = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 0.05;
    if (room < 0.5 * 0.82 * 1.2 * Math.max(tagOf(model, m).length, mt?.s.length || 0, mb?.s.length || 0) &&
      runs.some(o => o !== m && rpDir(o) === rp.dir && [o.a, o.b].some(p => touch(p, m.a) || touch(p, m.b)) && sig(o) === sig(m))) continue;
    const cs = c => { if (!c.odd) return { s: c.s, st: std }; const [color, aci] = barColor(c.bar); rpUsed.add(c.bar); return { s: c.s, st: { layer: `TEXT REBAR ${c.bar}`, color, aci } }; };
    label(0, L2 / 2, 1, "center", mt ? [cs(mt), name] : [name]);
    if (mb) label(0, L2 / 2, -1, "center", [cs(mb)]);
    // support values start just clear of the column or wall face at each end, reading away from it
    const f0 = face(m.a, 1), f1 = face(m.b, -1);
    if (lines?.ends) [[f0 + 0.8 * k, 0, flip ? "right" : "left"], [L2 - f1 - 0.8 * k, 1, flip ? "left" : "right"]].forEach(([u, i, align]) => {
      const c = lines.ends[i];
      if (c[0]) label(1, u, 1, align, [cs(c[0])]);
      if (c[1]) label(1, u, -1, align, [cs(c[1])]);
    });
  }
  if (rp) {
    const fs = opts.fontScale || 1, placed = [];
    // the grid dimension chains (above and left of the drawing) are kept clear too
    const keep = [...verts.flatMap(e => vertParts(e).map(part => { const X = part.pts.map(q => q[0]), Y = part.pts.map(q => q[1]); return [Math.min(...X), Math.min(...Y), Math.max(...X), Math.max(...Y)]; }))
      .filter(b => b[2] - b[0] < 2 && b[3] - b[1] < 2), // columns
      [ext.x0 - 30 * k, ext.y1 + 4 * k, ext.x1 + 30 * k, ext.y1 + 40 * k], [ext.x0 - 40 * k, ext.y0 - 30 * k, ext.x0 - 4 * k, ext.y1 + 30 * k]];
    const box = (L, d) => { // world bbox of a label group pushed d further out
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const H = L.h * fs * k, GAP = (L.h + 0.8) * fs * k;
      L.parts.forEach((q, j) => {
        const w = q.s.length * H * (q.st.bold ? 0.86 : 0.8), fx = L.align === "center" ? 0.5 : (L.align === "right") ? 1 : 0, dd = L.side * (L.off + d + j * GAP);
        const [px, py] = L.at(L.u, dd), ys = L.side > 0 ? [0, H] : [-H, 0];
        for (const lx of [-fx * w, (1 - fx) * w]) for (const ly of ys) {
          const X = px + lx * Math.cos(L.a) - ly * Math.sin(L.a), Y = py + lx * Math.sin(L.a) + ly * Math.cos(L.a);
          x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
        }
      });
      return [x0, y0, x1, y1];
    };
    const hit = (p, q) => p[0] < q[2] - 0.2 * k && q[0] < p[2] - 0.2 * k && p[1] < q[3] - 0.2 * k && q[1] < p[3] - 0.2 * k;
    // a label box crossed by another beam line (Liang-Barsky clip of the segment against the box)
    const cross = (m, b) => { let t0 = 0, t1 = 1; const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y;
      for (const [p, q] of [[-dx, m.a.x - b[0]], [dx, b[2] - m.a.x], [-dy, m.a.y - b[1]], [dy, b[3] - m.a.y]]) {
        if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
        const t = q / p; if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t); if (t0 > t1) return false; }
      return true; };
    const shrink = b => [b[0] + 0.3 * k, b[1] + 0.3 * k, b[2] - 0.3 * k, b[3] - 0.3 * k];
    for (const L of rpLabels.sort((p, q) => p.prio - q.prio || (p.grp.u1 - p.grp.u0) - (q.grp.u1 - q.grp.u0))) { // short beams first: they have the least room
      // try spots near the line first: slid along the clear span (midspan labels), then pushed further out step by step;
      // a stirrup label may also go to the other side of the line (e.g. away from the dimensions)
      const GAP = (L.h + 0.8) * fs * k, g = L.grp, span = g.u1 - g.u0, hw = 0.45 * L.h * fs * k * Math.max(...L.parts.map(q => q.s.length));
      const bad = b => placed.filter(p => hit(p, b)).length + 3 * keep.some(p => hit(p, b)) + 0.6 * runs.filter(o => o !== g.m && rpDir(o) === rp.dir && cross(o, shrink(b))).length;
      const us = !L.slide ? [L.u] : [...new Set([g.u ?? L.u, L.u, ...[0.12, -0.12, 0.24, -0.24, 0.34, -0.34].map(f => L.u + f * span)])];
      let best = null;
      // a crowded label may also shrink one step (to 75 %, not below 1.2 mm)
      const hs = [...new Set([L.h, Math.max(1.2, 0.75 * L.h)])];
      search: for (let i = 0; i <= 6; i++) for (const h of hs) for (const u of us) for (const side of rp.kind === "main" ? [L.side] : [L.side, -L.side]) {
        const c = { ...L, side, u, h }, gp = (h + 0.8) * fs * k, b = box(c, i * gp), w = hw * h / L.h;
        if (u !== L.u && (u - w < g.u0 || u + w > g.u1)) continue; // stays within the clear span
        const n = bad(b) + (side !== L.side ? 0.5 : 0) + i * 0.25 + (h < L.h ? 0.12 : 0) + Math.abs(u - L.u) / (span || 1) * 0.1;
        if (!best || n < best.n) best = { n, c, d: i * gp, b };
        if (n < 0.45) break search; // clear
      }
      const { c: P, d, b: bx } = best, PG = (P.h + 0.8) * fs * k; placed.push(bx); if (L.slide && g.u == null) g.u = P.u;
      if (d > 0.5 * PG) A.line(P.at(P.u, P.side * P.off * 0.5), P.at(P.u, P.side * (P.off + d - 0.3 * k)), { layer: "TEXT REBAR", color: "#9aa0a8", lw: 0.09 }); // leader back to the line
      P.parts.forEach((q, j) => A.text(P.at(P.u, P.side * (P.off + d + j * PG)), q.s, { ...q.st, size: P.h, align: P.align, valign: P.side > 0 ? "bottom" : "top", rot: P.r }));
    }
  }
  for (const m of rp ? [] : runs) {
    const st = styleFor(m, opts, colors), ed = edges.get(m);
    const t = tip(m, ` · L=${m.L.toFixed(3)} m${m.ids.length > 1 ? ` · ${m.ids.length} elements` : ""}`), el = m.ids.join(",");
    const miss = bare(model, m, opts); noRebar += miss;
    if (miss) A.line([m.a.x, m.a.y], [m.b.x, m.b.y], { color: NO_REBAR.band, lw: Math.max((ed.lines ? ed.w : 0) / k, 1.2), noDxf: true }); // screen / PDF: a light red band under the beam
    if (ed.lines) { // concrete beam: two edge lines (SS00G3) and a thin centreline (AS BALOK) that carries the hover
      for (const [a, b] of ed.lines) A.line(a, b, { ...st, lw: 0.25 });
      A.line([m.a.x, m.a.y], [m.b.x, m.b.y], { layer: "AS BALOK", color: opts.colorMode === "section" ? mix(st.color, 0.4) : "#a3a8b0", lw: 0.09, dash: "center", tip: t, el });
    } else A.line([m.a.x, m.a.y], [m.b.x, m.b.y], { ...st, layer: opts.colorMode !== "section" && ed.steel ? "SS00G6" : st.layer, lw: 0.35, tip: t, el }); // steel, or too narrow at this scale: one line
    if (opts.labels) {
      const r = textRot(m.b.x - m.a.x, m.b.y - m.a.y), a = (r * Math.PI) / 180, off = (ed.lines ? ed.w / 2 : 0) + 1 * k;
      // girder: both ends on a column or wall (TEXT GIRDER), otherwise a secondary beam (TEXT BEAM)
      // a short beam gets a smaller name (down to 60 %) so it stays within the beam
      const nm = tagOf(model, m), Lb = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y), fit = Math.max(0.6, Math.min(1, (0.85 * Lb / k) / (0.82 * nm.length * 2 * (opts.fontScale || 1))));
      A.text([(m.a.x + m.b.x) / 2 - Math.sin(a) * off, (m.a.y + m.b.y) / 2 + Math.cos(a) * off], nm, { ...lab(st, "beam"), size: 2 * fit, ...(miss ? NO_REBAR.text : {}), layer: ed.girder ? "TEXT GIRDER" : "TEXT BEAM", align: "center", valign: "bottom", rot: r });
    }
  }

  const transfer = transferCols(model);
  let anyTransfer = false;
  const colLabels = [], colBars = new Set();
  for (const e of verts.filter(e => e.kind === "column")) {
    const st = styleFor(e, opts, colors), sec = model.sects.get(e.sect) || {}, tr = transfer.has(e.id);
    const p = N(e.nodes[0]), H = Math.max(sec.h || 0.3, 1.2 * k), B = Math.max(sec.b || sec.h || 0.3, 1.2 * k), parts = vertParts(e);
    const t = tip(e, (sec.h ? ` · ${Math.round(sec.h * 1000)}x${Math.round((sec.b || sec.h) * 1000)}` : "") + (tr ? "\nTransfer column (starts on a beam)" : "") + (stops.has(e) ? "\nStops at this level" : ""));
    const dark = opts.colorMode === "section" ? (proj ? mix(st.color, 0.55) : st.color) : proj ? "#9a9a9a" : "#000000";
    const ost = { ...st, color: opts.colorMode === "section" ? st.color : "#000000", lw: proj ? 0.25 : 0.35, closed: true, nosolid: true, tip: t, el: String(e.id) };
    if (tr) anyTransfer = true;
    for (const part of parts) {
      A.poly(part.pts, { ...ost, fill: "#ffffff", noDxf: true }); // white backdrop: hover target
      // transfer column: one half (the triangle below the diagonal) filled on SS00H1, the rest open
      if (tr && !stops.has(e)) { if (part.pts.length === 4) A.poly(part.pts.slice(0, 3), { layer: "SS00H1", color: dark, fill: dark, lw: 0.05, closed: true, solidOnly: true, tip: t, el: String(e.id) });
        else if (part.pts.length === 24) A.poly(part.pts.slice(9, 22), { layer: "SS00H1", color: dark, fill: dark, lw: 0.05, closed: true, solidOnly: true, tip: t, el: String(e.id) }); }
      else fillVert(part.pts, e, dark, { tip: t, el: String(e.id) });
      A.poly(part.pts, { ...ost, tip: undefined }); // outline on SS00G5
      for (const hole of part.holes) A.poly(hole, { ...ost, fill: "#ffffff", tip: undefined });
    }
    if (opts.labels && !proj && !stops.has(e)) {
      const rb = model.colRebar?.get(e.id);
      if (opts.colRebarPlan) { // column rebar plan (Rebar detail tab): name, main bars, ties; placed after all columns, clear of each other
        const X = parts.flatMap(q => q.pts.map(v => v[0])), Y = parts.flatMap(q => q.pts.map(v => v[1]));
        const bar = b => { const [color, aci] = barColor(b); colBars.add(b); return { layer: `TEXT REBAR ${b}`, color, aci }; };
        colLabels.push({ bb: [Math.min(...X), Math.min(...Y), Math.max(...X), Math.max(...Y)], lines: [
          { s: tagOf(model, e), st: { ...lab(st, "column"), bold: true, font: "ROMAND" }, h: 2 },
          ...(rb?.main ? [{ s: rb.main, st: bar(rb.mainBar), h: 1.8 }] : []), ...(rb?.tie ? [{ s: rb.tie, st: bar(rb.tieBar), h: 1.8 }] : [])] });
      } else {
        const lx = p.x + Math.max(H, B) / 2 + 0.8 * k, ly = p.y + Math.max(H, B) / 2;
        A.text([lx, ly + 0.8 * k], tagOf(model, e), { ...lab(st, "column"), align: "left", valign: "bottom" });
      }
    }
    if (proj || !stops.has(e)) count(e);
  }
  if (colLabels.length) { // column rebar plan: each label block tried at the four corners of its column, then pushed out with a leader
    const fs = opts.fontScale || 1, placed = [], cols = colLabels.map(c => c.bb);
    const keep = [[ext.x0 - 30 * k, ext.y1 + 4 * k, ext.x1 + 30 * k, ext.y1 + 40 * k], [ext.x0 - 40 * k, ext.y0 - 30 * k, ext.x0 - 4 * k, ext.y1 + 30 * k]];
    const hit = (p, q) => p[0] < q[2] - 0.2 * k && q[0] < p[2] - 0.2 * k && p[1] < q[3] - 0.2 * k && q[1] < p[3] - 0.2 * k;
    for (const c of colLabels) {
      const gap = 0.6 * fs * k, hs = c.lines.map(l => l.h * fs * k), Hb = hs.reduce((a, b) => a + b, 0) + gap * (hs.length - 1);
      const Wb = Math.max(...c.lines.map((l, i) => l.s.length * hs[i] * (l.st.bold ? 0.86 : 0.8))), [x0, y0, x1, y1] = c.bb, o = 0.8 * k, step = 2.5 * k;
      let best = null;
      // corners: right-top (name level with the column top), right-below, left-top, left-below
      search: for (let i = 0; i <= 6; i++) for (const [j, [sx, sy]] of [[1, 1], [1, -1], [-1, 1], [-1, -1]].entries()) {
        const ax = sx > 0 ? x1 + o + i * step : x0 - o - i * step, ay = sy > 0 ? y1 + hs[0] + o + i * step : y0 - o - i * step; // block top-left / top-right corner
        const b = sx > 0 ? [ax, ay - Hb, ax + Wb, ay] : [ax - Wb, ay - Hb, ax, ay];
        const n = placed.filter(p => hit(p, b)).length + 3 * cols.filter(p => hit(p, b)).length + 3 * keep.some(p => hit(p, b)) + i * 0.3 + j * 0.05;
        if (!best || n < best.n) best = { n, i, sx, sy, ax, ay, b };
        if (n < 0.3) break search;
      }
      const { i, sx, sy, ax, ay, b } = best; placed.push(b);
      if (i > 0) A.line([sx > 0 ? x1 : x0, sy > 0 ? y1 : y0], [sx > 0 ? b[0] : b[2], sy > 0 ? b[1] + Hb - hs[0] * 0.5 : b[3] - hs[0] * 0.5], { layer: "TEXT REBAR", color: "#9aa0a8", lw: 0.09 }); // leader from the column corner
      let y = ay;
      c.lines.forEach((l, li) => { A.text([ax, y], l.s, { ...l.st, size: l.h, align: sx > 0 ? "left" : "right", valign: "top" }); y -= hs[li] + gap; });
    }
  }
  if (anyTransfer) { // key in the bottom-left corner, clear of the grid bubbles
    const s = 3 * k, x = gx0 - 10 * k, y = gy0 - 12 * k;
    const sq = [[x, y - s / 2], [x + s, y - s / 2], [x + s, y + s / 2], [x, y + s / 2]];
    A.poly(sq.slice(0, 3), { layer: "SS00H1", color: "#000000", fill: "#000000", lw: 0.05, closed: true, solidOnly: true });
    A.poly(sq, { layer: "SS00G5", color: "#000000", lw: 0.25, closed: true, nosolid: true });
    A.text([x + s + 1.5 * k, y], "TRANSFER COLUMN", { layer: "TEXT UMUM", size: 2, align: "left", valign: "middle" });
  }

  return {
    kind: "plan", sub: rp ? "beamplanrebar" : opts.colRebarPlan ? "colplanrebar" : mode, id: `plan:${rp ? "rebar-" + rp.kind + rp.dir : opts.colRebarPlan ? "rebar-col" : mode}:${level.name}${level.off ? ":" + level.z.toFixed(3) : ""}`, title: `${rp ? `BEAM REBAR PLAN (${rp.title}) - ${rp.dir} DIRECTION` : proj ? "BEAM" : opts.colRebarPlan ? "COLUMN REBAR PLAN" : "COLUMN"} - ${level.name} (EL. ${fmtEl(level.z)})`, scale, k, items, noRebar, rebarKind: rp?.kind, notes: colBars.size ? ["COLUMN TYPE (BOLD), MAIN BARS, TIES (END / MIDDLE / END)", ...[...colBars].sort((p, q) => parseFloat(p.slice(1)) - parseFloat(q.slice(1))).map(b => ({ s: `${b} BARS IN THIS COLOUR`, color: barColor(b)[0], aci: barColor(b)[1], swatch: true }))] : rp && rpStd ? [...rp.note(rpStd), ...[...rpUsed].sort((p, q) => parseFloat(p.slice(1)) - parseFloat(q.slice(1))).map(b => ({ s: `${b} BARS IN THIS COLOUR`, color: barColor(b)[0], aci: barColor(b)[1], swatch: true }))] : null,
    legend: [...legend].map(([name, n]) => ({ name, n, ...colors.get(name), ...opts.info?.get(name) })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
  };
}

// axis 'x': along grid line x = g.v, horizontal coordinate is Y. axis 'y': along y = g.v, horizontal is X.
export function buildElevation(model, opts, axis, grid) {
  const tol = opts.planeTol ?? 0.1, colors = opts.colors, N = id => model.nodes.get(id);
  const on = id => Math.abs((axis === "x" ? N(id).x : N(id).y) - grid.v) <= tol;
  const U = n => (axis === "x" ? n.y : n.x);
  const els = model.elems.filter(e => e.kind !== "slab" && e.nodes.every(on));
  if (!els.length) return null;
  const cross = axis === "x" ? opts.grids.y : opts.grids.x;
  const lv = opts.levels;
  const us = cross.map(g => g.v), zs = lv.map(l => l.z);
  for (const e of els) for (const id of e.nodes) { us.push(U(N(id))); zs.push(N(id).z); }
  const ext = { u0: Math.min(...us), u1: Math.max(...us), z0: Math.min(...zs), z1: Math.max(...zs) };
  const scale = pickScale(ext.u1 - ext.u0, ext.z1 - ext.z0, 34);
  const k = scale / 1000, items = [], A = adders(items, k, opts.fontScale || 1);

  const gst = gridSt();
  const zb = ext.z0 - 14 * k, zt = ext.z1 + 6 * k;
  const crossIn = cross.filter(g => g.v >= ext.u0 - tol && g.v <= ext.u1 + tol);
  for (const g of crossIn) A.line([g.v, ext.z0 - 1 * k], [g.v, zt], gst);
  A.bubbles(crossIn.map(g => g.v), crossIn.map(g => g.label), ext.z0 - 1 * k, zb, "h", -1);
  if (crossIn.length > 1) A.dimChain(crossIn.map(g => g.v), ext.z0 - 7 * k, "h", -1);

  const lst = { layer: "SS00G1", color: "#0050a0", lw: 0.13, dash: "dashed" };
  const lx0 = ext.u0 - 8 * k, lx1 = ext.u1 + 8 * k;
  const lvIn = lv.filter(l => l.z >= ext.z0 - 0.05 && l.z <= ext.z1 + 0.05);
  for (const l of lvIn) {
    A.line([lx0, l.z], [lx1, l.z], lst);
    const tx = lx0 - 2 * k;
    A.poly([[tx, l.z], [tx - 1.5 * k, l.z + 2.2 * k], [tx + 1.5 * k, l.z + 2.2 * k]], { layer: "SS00G1", color: "#0050a0", lw: 0.18, closed: true });
    A.text([tx - 2.5 * k, l.z + 0.6 * k], l.name, { layer: "TEXT UMUM", color: "#0050a0", size: 2, align: "right", valign: "bottom" });
    A.text([tx - 2.5 * k, l.z - 0.6 * k], "EL. " + fmtEl(l.z), { layer: "TEXT UMUM", color: "#0050a0", size: 2, align: "right", valign: "top" });
  }
  if (lvIn.length > 1) A.dimChain(lvIn.map(l => l.z), lx1 + 6 * k, "v", 1);

  let noRebar = 0;
  const legend = new Map();
  const tip = e => `${tagOf(model, e)}\n${KIND_LABEL[e.kind]} · Elem ${e.id}${e.L ? ` · L=${e.L.toFixed(3)} m` : ""}`;
  for (const e of els.filter(e => e.kind === "wall")) {
    const st = styleFor(e, opts, colors);
    A.poly(e.nodes.map(id => [U(N(id)), N(id).z]), { ...st, fill: mix(st.color, 0.75), color: mix(st.color, 0.3), lw: 0.18, closed: true, tip: tip(e) });
    legend.set(e.sectName, (legend.get(e.sectName) || 0) + 1);
  }
  if (opts.labels) {
    const done = new Set();
    for (const e of els.filter(e => e.kind === "wall")) {
      const ns = e.nodes.map(N), cu = ns.reduce((s, n) => s + U(n), 0) / ns.length, cz = ns.reduce((s, n) => s + n.z, 0) / ns.length;
      const kk = e.sectName + ":" + Math.round(cz * 2);
      if (done.has(kk)) continue; done.add(kk);
      const st = styleFor(e, opts, colors);
      A.text([cu, cz], e.sectName, { layer: "TEXT WALL", color: st.color, aci: st.aci, size: 2, align: "center", valign: "middle" });
    }
  }
  const lines = els.filter(e => e.kind !== "wall");
  const degree = new Map();
  for (const e of lines) for (const id of e.nodes) degree.set(id, (degree.get(id) || 0) + 1);
  for (const e of lines) legend.set(e.sectName, (legend.get(e.sectName) || 0) + 1);
  // members drawn at their real size, like the plan: beams by their depth (offset point included), columns by the width
  // their section shows in this elevation (rotated by β as in the plan); too thin at this scale, or braces: one line
  const band = m => {
    const sec = model.sects.get(m.sect), outl = sec && sec.h ? sectionOutline(m.kind === "beam" && opts.beamTop !== false ? topOf(sec) : sec) : null;
    if (!outl || m.kind === "brace") return null;
    const pts = outl.flatMap(o => o.pts), a = m.a, b = m.b, r = (m.angle || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    let vs;
    if (m.kind === "column") { const [zv, yv] = colAxes(model, m), j = axis === "x" ? 1 : 0; vs = pts.map(([u, w]) => w * zv[j] + u * yv[j]); }
    else vs = pts.map(([u, w]) => (Math.abs(s) > 0.7 ? u * Math.sign(s) : w * Math.sign(c || 1)));
    const lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo < 1.2 * k) return null;
    if (m.kind === "column") return [[U(a) + lo, a.z], [U(a) + hi, a.z], [U(b) + hi, b.z], [U(b) + lo, b.z]];
    const du = U(b) - U(a), dz = b.z - a.z, L = Math.hypot(du, dz) || 1;
    let nu = -dz / L, nz = du / L; if (nz < 0) { nu = -nu; nz = -nz; } // section "up" in the drawing
    return [[U(a) + nu * lo, a.z + nz * lo], [U(b) + nu * lo, b.z + nz * lo], [U(b) + nu * hi, b.z + nz * hi], [U(a) + nu * hi, a.z + nz * hi]];
  };
  const runs = mergeRuns(lines, model, degree).sort((p, q) => (p.kind === "column" ? 0 : 1) - (q.kind === "column" ? 0 : 1)); // beams over the columns at the joints
  for (const m of runs) {
    const st = styleFor(m, opts, colors), a = m.a, b = m.b;
    const lw = m.kind === "column" ? 0.5 : m.kind === "beam" ? 0.35 : 0.25;
    const t = `${tagOf(model, m)}\n${KIND_LABEL[m.kind]} · Elem ${m.ids.length > 1 ? m.ids[0] + "…" + m.ids[m.ids.length - 1] + ` (${m.ids.length} elements)` : m.id} · L=${m.L.toFixed(3)} m`;
    const layer = opts.colorMode !== "section" && m.kind === "beam" && isSteel(model.sects.get(m.sect)) ? "SS00G6" : st.layer, bd = band(m), miss = bare(model, m, opts);
    noRebar += miss;
    if (bd) {
      A.poly(bd, { ...st, layer, fill: miss ? NO_REBAR.band : opts.colorMode === "section" ? mix(st.color, 0.8) : "#ffffff", lw: m.kind === "column" ? 0.35 : 0.3, closed: true, nosolid: true, tip: t, el: m.ids.join(",") });
      A.line([U(a), a.z], [U(b), b.z], { layer: m.kind === "beam" ? "AS BALOK" : "SS00GG", color: opts.colorMode === "section" ? mix(st.color, 0.4) : "#a3a8b0", lw: 0.09, dash: "center" });
    } else {
      if (miss) A.line([U(a), a.z], [U(b), b.z], { color: NO_REBAR.band, lw: 1.2, noDxf: true });
      A.line([U(a), a.z], [U(b), b.z], { ...st, layer, lw, tip: t, el: m.ids.join(",") });
    }
    if (opts.labels) {
      const r = textRot(U(b) - U(a), b.z - a.z), ang = (r * Math.PI) / 180;
      const off = (bd ? Math.max(...bd.map(p => (p[1] - a.z) * Math.cos(ang) - (p[0] - U(a)) * Math.sin(ang))) : 0) + 1 * k;
      A.text([(U(a) + U(b)) / 2 - Math.sin(ang) * off, (a.z + b.z) / 2 + Math.cos(ang) * off], tagOf(model, m), { layer: LABEL_LAYER[m.kind], color: st.color, aci: st.aci, ...(miss ? NO_REBAR.text : {}), size: 2, align: "center", valign: "bottom", rot: r });
    }
  }
  return {
    kind: "elev", id: `elev:${axis}:${grid.label}`, title: `ELEVATION - GRID ${grid.label}`, scale, k, items, noRebar,
    legend: [...legend].map(([name, n]) => ({ name, n, ...colors.get(name), ...opts.info?.get(name) })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
  };
}

// beam plan levels: the stories plus the heights between them that carry level beams
export const planLevels = (model, opts) => [...opts.levels, ...offLevels(model, opts.levels, opts.levelTol ?? 0.05)].sort((a, b) => a.z - b.z);

// Heights of level beams that sit between the stories (stair landings, bordes, canopies): one beam plan each,
// named by the stories either side ("1F-2F"); the title adds the elevation.
export function offLevels(model, levels, tol = 0.05) {
  const N = id => model.nodes.get(id), zs = [];
  for (const e of model.elems) if (e.kind === "beam") {
    const z = e.nodes.map(id => N(id).z);
    if (Math.max(...z) - Math.min(...z) <= tol && !levels.some(l => Math.abs(l.z - z[0]) <= tol)) zs.push(z[0]);
  }
  return cluster(zs, tol).map(z => { const below = [...levels].reverse().find(l => l.z < z); const above = levels.find(l => l.z > z); return { name: [below?.name, above?.name].filter(Boolean).join("-") || fmtEl(z), z, off: true }; });
}

export function buildViews(model, opts) {
  const views = [];
  const beamLevels = planLevels(model, opts);
  for (const mode of ["column", "beam"]) for (const l of mode === "beam" ? beamLevels : opts.levels) {
    const v = buildPlan(model, opts, l, mode);
    // a beam plan needs beams or slabs, a column plan needs columns or walls
    if (v && v.items.some(i => i.tip && (mode === "column" || !/^(Column|Wall)/m.test(i.tip.split("\n")[1] || "")))) views.push(v);
  }
  for (const g of opts.grids.y) { const v = buildElevation(model, opts, "y", g); if (v) views.push(v); }
  for (const g of opts.grids.x) { const v = buildElevation(model, opts, "x", g); if (v) views.push(v); }
  return views;
}

// ---------- extents ----------
export function itemExtents(items) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const it of items) {
    if (it.t === "line") { add(...it.a); add(...it.b); }
    else if (it.t === "poly") it.pts.forEach(p => add(...p));
    else if (it.t === "circle") { add(it.c[0] - it.r, it.c[1] - it.r); add(it.c[0] + it.r, it.c[1] + it.r); }
    else if (it.t === "text") {
      const w = it.s.length * it.h * 0.75, r = ((it.rot || 0) * Math.PI) / 180;
      const fx = it.align === "center" ? 0.5 : it.align === "right" ? 1 : 0;
      const sx = it.p[0] - Math.cos(r) * w * fx, sy = it.p[1] - Math.sin(r) * w * fx;
      add(sx, sy); add(sx + Math.cos(r) * w, sy + Math.sin(r) * w);
      add(it.p[0] - Math.sin(r) * it.h, it.p[1] + Math.cos(r) * it.h); add(it.p[0] + Math.sin(r) * it.h, it.p[1] - Math.cos(r) * it.h);
    }
  }
  return { x0, y0, x1, y1 };
}

// ---------- paper drawing (shared by SVG, canvas, PDF) ----------
// R: { line(x1,y1,x2,y2,st), poly(pts,st), circle(cx,cy,r,st), text(x,y,s,st) } in paper mm, y down.
export function drawPaper(view, R, meta = {}) {
  const k = view.k, e = itemExtents(view.items), A = PAPER.area;
  const ox = (A.x0 + A.x1) / 2 - ((e.x0 + e.x1) / 2) / k, oy = (A.y0 + A.y1) / 2 + ((e.y0 + e.y1) / 2) / k;
  const T = ([x, y]) => [ox + x / k, oy - y / k];
  for (const it of view.items) {
    const st = { color: it.color, fill: it.fill, lw: it.lw, dash: it.dash, tip: it.tip, el: it.el, size: it.h / k, align: it.align, valign: it.valign, rot: it.rot || 0, sect: it.sect, bold: it.bold };
    if (it.t === "line") { const [x1, y1] = T(it.a), [x2, y2] = T(it.b); R.line(x1, y1, x2, y2, st); }
    else if (it.t === "poly") R.poly(it.pts.map(T), { ...st, closed: it.closed });
    else if (it.t === "circle") { const [cx, cy] = T(it.c); R.circle(cx, cy, it.r / k, st); }
    else if (it.t === "text") { const [x, y] = T(it.p); R.text(x, y, it.s, st); }
  }
  if (!view.bare) drawSheet(view, R, meta);
  return { T, e };
}

function drawSheet(view, R, meta) {
  const ink = { color: "#000000", lw: 0.5 }, thin = { color: "#000000", lw: 0.18 };
  const box = (x0, y0, x1, y1, st) => R.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], { ...st, closed: true });
  box(10, 10, 410, 287, ink);
  R.line(330, 10, 330, 287, ink);
  // legend: a table of every section in the view (type, size, material); colour swatches only in colour-by-section mode
  if (view.legend.length) {
    const sw = meta.colorMode === "section", cut = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t), rowH = 5.4, X = [330, 362, 392, 410]; // cut by width at about 1.2 mm a character (1.8 mm text)
    R.text(334, 15, "LEGEND - SECTIONS", { color: "#000000", size: 2.6, align: "left", valign: "middle" });
    const y0 = 19, maxRows = Math.floor((222 - (view.notes ? 6 + 4 * view.notes.length : 0) - y0) / rowH) - 1, rows = view.legend.slice(0, maxRows), more = view.legend.length - rows.length;
    const yEnd = y0 + rowH * (rows.length + 1);
    R.line(330, y0, 410, y0, thin); R.line(330, y0 + rowH, 410, y0 + rowH, thin); R.line(330, yEnd, 410, yEnd, thin);
    for (const x of X.slice(1, 3)) R.line(x, y0, x, yEnd, thin);
    ["TYPE", "SIZE", "MATERIAL"].forEach((h, i) => R.text(X[i] + 1.5, y0 + rowH / 2, h, { color: "#555555", size: 1.7, align: "left", valign: "middle" }));
    rows.forEach((l, i) => {
      const y = y0 + rowH * (i + 1.5), tx = sw ? 337.5 : 331.5;
      if (sw) box(331.5, y - 1.4, 335.5, y + 1.4, { color: l.color, fill: l.color, lw: 0.13 });
      R.text(tx, y, cut(l.name, sw ? 21 : 25), { color: "#000000", size: 1.8, align: "left", valign: "middle" });
      R.text(X[1] + 1.5, y, cut(l.size || "-", 23), { color: "#000000", size: 1.8, align: "left", valign: "middle" });
      R.text(X[2] + 1.5, y, cut(l.matl || "-", 12), { color: "#000000", size: 1.8, align: "left", valign: "middle" });
    });
    if (more > 0) R.text(331.5, yEnd + 3, `+${more} more`, { color: "#555555", size: 1.8, align: "left", valign: "middle" });
  }
  if (view.noRebar) { // marked beams: a key under the legend
    const y = view.legend.length ? 19 + 5.4 * (Math.min(view.legend.length, Math.floor((222 - 19) / 5.4) - 1) + 1) + (view.legend.length > Math.floor((222 - 19) / 5.4) - 1 ? 8 : 4) : 19;
    box(331.5, y - 1.4, 337.5, y + 1.4, { color: NO_REBAR.band, fill: NO_REBAR.band, lw: 0.13 });
    R.text(339, y, NO_REBAR.note(view.noRebar), { color: NO_REBAR.text.color, size: 1.8, align: "left", valign: "middle" });
  }
  if (view.notes) { // notes (beam rebar plans) just above the title block
    const n = view.notes.length, y0 = 222 - 4 * n;
    R.text(333, y0 - 3, "NOTES", { color: "#000000", size: 2.2, align: "left", valign: "middle" });
    view.notes.forEach((t, i) => {
      const y = y0 + 1.5 + i * 4;
      if (t.swatch) R.poly([[333, y - 1.2], [339, y - 1.2], [339, y + 1.2], [333, y + 1.2]], { color: t.color, fill: t.color, lw: 0.1, closed: true });
      R.text(t.swatch ? 341 : 333, y, typeof t === "string" ? t : t.s, { color: t.color || "#000000", size: 1.8, align: "left", valign: "middle" });
    });
  }
  // title block
  R.line(330, 225, 410, 225, ink);
  const rows = [["PROJECT", meta.project || "-"], ["DRAWING", view.title], ["SCALE (A3)", `1:${view.scale}`], ["DATE", meta.date || ""], ["SOURCE", "MIDAS Gen NX model"]];
  rows.forEach(([k, v], i) => {
    const y = 225 + i * 11.6;
    if (i) R.line(330, y, 410, y, thin);
    R.text(333, y + 3.2, k, { color: "#555555", size: 1.6, align: "left", valign: "middle" });
    if (i === 1 && v.length > 34) { // a long drawing title on two lines, broken at a " - " when there is one
      const cut = v.lastIndexOf(" - ", 40) > 8 ? v.lastIndexOf(" - ", 40) : 34, l2 = v.slice(cut).replace(/^ - /, "");
      R.text(333, y + 6.4, v.slice(0, cut), { color: "#000000", size: 2, align: "left", valign: "middle" });
      R.text(333, y + 9.4, l2.length > 40 ? l2.slice(0, 39) + "…" : l2, { color: "#000000", size: 2, align: "left", valign: "middle" });
    } else R.text(333, y + 7.8, v.length > 34 ? v.slice(0, 33) + "…" : v, { color: "#000000", size: i === 1 ? 2.3 : 2.4, align: "left", valign: "middle" });
  });
  R.text(15, 284, "Sketch generated from analysis model - centrelines, verify before issue.", { color: "#777777", size: 1.6, align: "left", valign: "bottom" });
}

// ---------- DXF (R12, opens in AutoCAD / BricsCAD / ZWCAD / LibreCAD) ----------
const layerName = s => s.toUpperCase().replace(/[^A-Z0-9_$ -]/g, "_").slice(0, 31); // spaces kept: the standard has "AS BALOK", "TEXT KOLOM"

// Ear clipping for SOLID fills of polygons with more than four corners (R12 has no HATCH). -> triangles [[a, b, c]]
function triangles(pts) {
  const P = [...pts], area = P.reduce((s, p, i) => { const q = P[(i + 1) % P.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0), sg = Math.sign(area) || 1, out = [];
  const cross = (a, b, c) => ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * sg;
  const inside = (p, a, b, c) => cross(a, b, p) > 1e-12 && cross(b, c, p) > 1e-12 && cross(c, a, p) > 1e-12;
  for (let guard = 0; P.length > 3 && guard < 10000; guard++) {
    let cut = false;
    for (let i = 0; i < P.length; i++) {
      const a = P[(i + P.length - 1) % P.length], b = P[i], c = P[(i + 1) % P.length];
      if (cross(a, b, c) <= 1e-12 || P.some(p => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push([a, b, c]); P.splice(i, 1); cut = true; break;
    }
    if (!cut) break; // degenerate: give up on the rest
  }
  if (P.length === 3) out.push(P);
  return out;
}
const dxfStr = s => String(s).replace(/[^\x20-\x7e]/g, ch => "\\U+" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0"));

export function buildDxf(views, { units = "mm", colorMode = "mono" } = {}) {
  const u = units === "mm" ? 1000 : 1;
  const out = [], layers = new Map();
  const w = (...pairs) => { for (let i = 0; i < pairs.length; i += 2) out.push(String(pairs[i]), String(pairs[i + 1])); };
  const n = v => (Math.round(v * 1e6) / 1e6).toString();
  const useLayer = (name, aci) => { const ln = layerName(name), sd = STD_LAYERS[ln]; if (!layers.has(ln)) layers.set(ln, { aci: aci || sd?.[0] || 7, lt: sd?.[1] || "CONTINUOUS" }); return ln; };
  const ent = [], scales = new Map();
  let offset = 0;
  for (const view of views) {
    const e = itemExtents(view.items), dx = offset - e.x0, dy = -e.y0, k = view.k;
    scales.set(view.scale, (scales.get(view.scale) || 0) + 1);
    const P = ([x, y]) => [(x + dx) * u, (y + dy) * u];
    const head = (type, it) => {
      const ln = useLayer(it.layer || "0", it.aci && colorMode === "section" && String(it.layer).startsWith("SECT_") ? it.aci : null);
      const last = ["0", type, "8", ln]; // entity start; the caller adds the rest and pushes it
      if (it.aci && !String(it.layer).startsWith("SECT_")) last.push("62", String(it.aci));
      if (it.dash === "dashed" && layers.get(ln).lt === "CONTINUOUS") last.push("6", "DASHED");
      return last;
    };
    const solid = (it, [a, b, c, d = c]) => ent.push([...head("SOLID", it), "10", n(a[0]), "20", n(a[1]), "30", "0", "11", n(b[0]), "21", n(b[1]), "31", "0", "12", n(d[0]), "22", n(d[1]), "32", "0", "13", n(c[0]), "23", n(c[1]), "33", "0"]); // SOLID vertex order is 1-2-4-3
    const items = [...view.items];
    // view title (underlined, TEXT JUDUL) and scale (TEXT SKALA) below the drawing, legend on the right, in world space
    items.push({ t: "text", p: [e.x0, e.y0 - 8 * k], s: "%%U" + view.title, h: 3 * k, align: "left", valign: "top", layer: "TEXT JUDUL" });
    items.push({ t: "text", p: [e.x0, e.y0 - 13 * k], s: `SKALA 1 : ${view.scale}`, h: 2 * k, align: "left", valign: "top", layer: "TEXT SKALA" });
    if (view.noRebar) items.push({ t: "text", p: [e.x0, e.y0 - 18 * k], s: NO_REBAR.note(view.noRebar), h: 2 * k, align: "left", valign: "top", layer: "TEXT UMUM", aci: 1 });
    if (view.notes) view.notes.forEach((t, i) => items.push({ t: "text", p: [e.x0, e.y0 - (24 + 4 * i) * k], s: typeof t === "string" ? t : t.s, h: 2 * k, align: "left", valign: "top", layer: t.swatch ? `TEXT REBAR ${t.s.split(" ")[0]}` : "TEXT UMUM", aci: t.aci }));
    if (view.legend.length) { // legend table: TYPE | SIZE | MATERIAL, each column as wide as its longest text (ROMANS 2 mm, width 0.8)
      const lx = e.x1 + 12 * k, sw = colorMode === "section", rh = 5.4 * k, W = [["name", 32], ["size", 26], ["matl", 22]].map(([f, w], i) => Math.max(w, Math.max(...view.legend.map(l => String(l[f] || "-").length)) * 1.7 + (i || !sw ? 3 : 8)) * k), xs = [lx, lx + W[0], lx + W[0] + W[1], lx + W[0] + W[1] + W[2]];
      const top = e.y1 - 4 * k, bot = top - rh * (view.legend.length + 1), tl = { layer: "TEXT UMUM" };
      items.push({ t: "text", p: [lx, e.y1], s: "LEGEND - SECTIONS", h: 2.5 * k, align: "left", valign: "top", layer: "TEXT UMUM" });
      for (const y of [top, top - rh, bot]) items.push({ t: "line", a: [xs[0], y], b: [xs[3], y], ...tl });
      for (const x of xs) items.push({ t: "line", a: [x, top], b: [x, bot], ...tl });
      ["TYPE", "SIZE", "MATERIAL"].forEach((h, i) => items.push({ t: "text", p: [xs[i] + 1.5 * k, top - rh / 2], s: h, h: 2 * k, align: "left", valign: "middle", ...tl }));
      view.legend.forEach((l, i) => {
        const y = top - rh * (i + 1.5), tx = xs[0] + (sw ? 6.5 : 1.5) * k;
        if (sw) items.push({ t: "poly", pts: [[xs[0] + 1.5 * k, y - 1.4 * k], [xs[0] + 5.5 * k, y - 1.4 * k], [xs[0] + 5.5 * k, y + 1.4 * k], [xs[0] + 1.5 * k, y + 1.4 * k]], closed: true, fill: l.color, layer: "SECT_" + l.name, aci: l.aci });
        [[tx, l.name], [xs[1] + 1.5 * k, l.size || "-"], [xs[2] + 1.5 * k, l.matl || "-"]].forEach(([x, s]) => items.push({ t: "text", p: [x, y], s, h: 2 * k, align: "left", valign: "middle", ...tl }));
      });
    }
    for (const it of items) {
      if (it.noDxf) continue; // screen only (hover backdrops)
      if (it.t === "line") {
        const [x1, y1] = P(it.a), [x2, y2] = P(it.b);
        ent.push([...head("LINE", it), "10", n(x1), "20", n(y1), "30", "0", "11", n(x2), "21", n(y2), "31", "0"]);
      } else if (it.t === "poly") {
        const pts = it.pts.map(P);
        if (it.solidOnly) { // fill only: one SOLID, or triangles for more corners
          if (pts.length <= 4) solid(it, pts); else for (const tri of triangles(pts)) solid(it, tri);
          continue;
        }
        if (it.fill && !it.nosolid && (pts.length === 4 || pts.length === 3)) solid(it, pts);
        const h = head("POLYLINE", it); ent.push(h);
        h.push("66", "1", "10", "0", "20", "0", "30", "0", "70", it.closed ? "1" : "0");
        for (const [x, y] of pts) ent.push(["0", "VERTEX", "8", h[3], "10", n(x), "20", n(y), "30", "0"]);
        ent.push(["0", "SEQEND", "8", h[3]]);
      } else if (it.t === "circle") {
        const [x, y] = P(it.c);
        const r = it.r * u;
        ent.push([...head("CIRCLE", it), "10", n(x), "20", n(y), "30", "0", "40", n(r)]);
        if (it.solid) { // filled disc (dimension dots, rebar): a closed two-arc polyline as wide as the radius
          const h = head("POLYLINE", it); ent.push(h);
          h.push("66", "1", "10", "0", "20", "0", "30", "0", "70", "1", "40", n(r), "41", n(r));
          for (const sx of [-1, 1]) ent.push(["0", "VERTEX", "8", h[3], "10", n(x + (sx * r) / 2), "20", n(y), "30", "0", "40", n(r), "41", n(r), "42", "1"]);
          ent.push(["0", "SEQEND", "8", h[3]]);
        }
      } else if (it.t === "text") {
        const [x, y] = P(it.p);
        const hj = it.align === "center" ? 1 : it.align === "right" ? 2 : 0;
        const vj = it.valign === "middle" ? 2 : it.valign === "top" ? 3 : it.valign === "bottom" ? 1 : 0;
        const rec = [...head("TEXT", it), "10", n(x), "20", n(y), "30", "0", "40", n(it.h * u), "1", dxfStr(it.s), "50", n(it.rot || 0), "41", "0.8", "7", it.font || "ROMANS"]; // width 0.8 on the text itself: CAD takes the entity's factor (default 1), not the style's
        if (hj || vj) rec.push("72", String(hj), "73", String(vj), "11", n(x), "21", n(y), "31", "0");
        ent.push(rec);
      }
    }
    offset += e.x1 - e.x0 + 60 * k;
  }
  // the standard's linetypes are defined for LTSCALE 1000 at 1:100 in mm; follow the most used scale of this set
  const ltscale = 10 * ([...scales].sort((a, b) => b[1] - a[1])[0]?.[0] || 100), lts = units === "mm" ? ltscale : ltscale / 1000;
  w(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1009", 9, "$LTSCALE", 40, lts, 9, "$INSBASE", 10, 0, 20, 0, 30, 0, 0, "ENDSEC");
  w(0, "SECTION", 2, "TABLES");
  const ltypes = [["CONTINUOUS", "Solid line", []], ["CENTER", "Center ____ _ ____ _ ____", [1.25, -0.25, 0.25, -0.25]], ["DASHED", "Dashed __ __ __", [0.5, -0.25]], ["DASHDOT2", "Dash dot (.5x) _._._._._._._._._._._._._._._._", [0.25, -0.125, 0, -0.125]]];
  w(0, "TABLE", 2, "LTYPE", 70, ltypes.length);
  for (const [name, desc, pat] of ltypes) {
    w(0, "LTYPE", 2, name, 70, 0, 3, desc, 72, 65, 73, pat.length, 40, pat.reduce((s, v) => s + Math.abs(v), 0));
    for (const v of pat) w(49, v);
  }
  w(0, "ENDTAB");
  w(0, "TABLE", 2, "LAYER", 70, layers.size + 1, 0, "LAYER", 2, "0", 70, 0, 62, 7, 6, "CONTINUOUS");
  for (const [name, l] of layers) w(0, "LAYER", 2, name, 70, 0, 62, l.aci, 6, l.lt);
  w(0, "ENDTAB");
  const styles = [["STANDARD", "txt"], ["ROMANS", "romans"], ["ROMAND", "romand"]]; // the standard writes with romans/romand.shx, width 0.8
  w(0, "TABLE", 2, "STYLE", 70, styles.length);
  for (const [name, font] of styles) w(0, "STYLE", 2, name, 70, 0, 40, 0, 41, 0.8, 50, 0, 71, 0, 42, 2.5, 3, font, 4, "");
  w(0, "ENDTAB");
  w(0, "ENDSEC", 0, "SECTION", 2, "ENTITIES");
  for (const r of ent) out.push(...r);
  w(0, "ENDSEC", 0, "EOF");
  return out.join("\r\n") + "\r\n";
}
