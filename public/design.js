// Rebar from the Gen NX Concrete Design results (3.26), pasted from the result table, instead of the rebar tables
// (REBB Modify Beam Rebar Data / RCHK Rebar Input for Checking). The Gen NX API has no table with the designed bars, so
// the table is copied in Gen NX (Design > Concrete Code Design > Beam Design, result table: Ctrl+A, Ctrl+C) and pasted here.
//
// Beam Design table, tab separated, 3 header lines then 3 rows per member (I, M, J):
//   MEMB  SEL  Section  C    fc   POS  N(-) Mu  LCB  AsTop  Rebar   P(+) Mu  LCB  AsBot  Rebar   Vu  LCB  AsV  Stirrup     Tu ...
//   SECT       Bc       Hc   fy
//   Span       bf       hf   fys
// row 1: member id, SEL, section name, fc, "I", ... top bars "5-D19", bottom bars "2-D19", stirrups "2-D10 @280"
// row 2: section id, Bc, Hc, fy, "M", ...      row 3: span length, bf, hf, fys, "J", ...
// Bars "6-2-D19" = two layers, 6 then 2 bars of D19. Stirrups "2-D10 @280" = 2 legs of D10 at 280 mm. "Failure" = no bars.
// MEMB is the element id when the design is per element, else the design member (MEMB table) and its elements.

import { tableOf } from "./core.js";

const POS = { I: "I", M: "M", J: "J" };
// "6-2-D19" -> [{ n: 6, bar: "D19" }, { n: 2, bar: "D19" }]; "5-D19" -> [{ n: 5, bar: "D19" }]
export function parseBarText(t) {
  const m = /^\s*(\d+(?:\s*-\s*\d+)*)\s*-\s*([A-Z#Ø]*\s*\d+(?:\.\d+)?)\s*$/i.exec(String(t || ""));
  if (!m) return [];
  const bar = m[2].replace(/\s+/g, "").toUpperCase();
  return m[1].split("-").map(n => +n.trim()).filter(n => n > 0).map(n => ({ n, bar }));
}
// "2-D10 @280" -> { leg: 2, bar: "D10", s: 0.28 } (spacing in mm, as Gen NX prints it)
export function parseStirText(t) {
  const m = /^\s*(\d+)\s*-\s*([A-Z#Ø]*\s*\d+(?:\.\d+)?)\s*@\s*(\d+(?:\.\d+)?)\s*$/i.exec(String(t || ""));
  return m ? { leg: +m[1], bar: m[2].replace(/\s+/g, "").toUpperCase(), s: +m[3] / 1000 } : null;
}

// pasted text -> { beams: { [memb]: { sect, name, I: { top, bot, stir }, M, J } }, count, failed, errors: [] }
export function parseBeamDesign(text) {
  const lines = String(text || "").split(/\r?\n/).map(l => l.split("\t"));
  const out = { beams: {}, count: 0, failed: 0, errors: [] };
  // find the column positions from the header (falls back to the standard layout)
  const head = lines.find(r => r.some(c => /^\s*MEMB\s*$/i.test(c)) && r.some(c => /Rebar/i.test(c)));
  const idx = name => head ? head.findIndex(c => c.trim().toUpperCase() === name) : -1;
  let iPos = idx("POS"), iStir = idx("STIRRUP");
  const rebarCols = head ? head.map((c, i) => (/^\s*Rebar\s*$/i.test(c) ? i : -1)).filter(i => i >= 0) : [];
  if (iPos < 0) iPos = 5;
  const [iTop, iBot] = rebarCols.length >= 2 ? rebarCols : [9, 13];
  if (iStir < 0) iStir = 17;
  if (!head) out.errors.push("No header line with MEMB and Rebar: read with the standard Gen NX column order.");
  const rows = lines.filter(r => r.length > iStir && POS[String(r[iPos]).trim().toUpperCase()]);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], pos = String(r[iPos]).trim().toUpperCase();
    if (pos !== "I") continue;
    const m = rows[i + 1], j = rows[i + 2];
    if (!m || !j || String(m[iPos]).trim().toUpperCase() !== "M" || String(j[iPos]).trim().toUpperCase() !== "J") { out.errors.push(`Member ${String(r[0]).trim()}: the I, M, J rows are not together.`); continue; }
    const id = String(r[0]).trim(), sect = +String(m[0]).trim();
    if (!/^\d+$/.test(id)) continue;
    const part = row => {
      const stirTxt = String(row[iStir]).trim();
      if (/fail/i.test(stirTxt)) out.failed++;
      return { top: parseBarText(row[iTop]), bot: parseBarText(row[iBot]), stir: parseStirText(stirTxt) };
    };
    out.beams[id] = { sect: sect || null, name: String(r[2]).trim(), I: part(r), M: part(m), J: part(j) };
    out.count++;
    i += 2;
  }
  if (!out.count) out.errors.push("No beam found. Copy the whole Beam Design result table in Gen NX (click the table, Ctrl+A, Ctrl+C).");
  return out;
}

// Column Design table, tab separated, 2 header lines then 2 rows per member:
//   MEMB  SEL  Section  C   fc      fy   LCB  Pu     Mc     Ast  V-Rebar   LCB  Vu.end  Rat-V.end  As-H.end  H-Rebar.end
//   SECT       Bc       Hc  Height  fys       Rat-P  Rat-M            LCB  Vu.mid  Rat-V.mid  As-H.mid  H-Rebar.mid
// V-Rebar "18-5-D22" = 18 bars of D22 in all, 5 on each face along H (corners included), as NUM / ROW in Modify Column
// Rebar Data. H-Rebar "5-D13 @320" = ties of D13 with 5 legs at 320 mm, at the ends (row 1) and at mid-height (row 2).
// -> { cols: { [memb]: { sect, name, main: { n, row, bar }, tieEnd, tieMid } }, count, failed, errors }
export function parseColumnDesign(text) {
  const lines = String(text || "").split(/\r?\n/).map(l => l.split("\t"));
  const out = { cols: {}, count: 0, failed: 0, errors: [] };
  const head = lines.find(r => r.some(c => /^\s*MEMB\s*$/i.test(c)) && r.some(c => /V-Rebar/i.test(c)));
  const at = (re, d) => { const i = head ? head.findIndex(c => re.test(c.trim())) : -1; return i >= 0 ? i : d; };
  const iV = at(/^V-Rebar$/i, 10), iH = at(/^H-Rebar/i, 15);
  if (!head) out.errors.push("No header line with MEMB and V-Rebar: read with the standard Gen NX column order.");
  const data = lines.filter(r => r.length > iH && /^\s*\d+\s*$/.test(r[0] || ""));
  for (let i = 0; i + 1 < data.length; i++) {
    const r = data[i], m = data[i + 1];
    if (!/^\s*-?\d|D\d/i.test(r[iV] || "") || !/[A-Z]/i.test(r[2] || "")) continue; // first row of a member: has the section name and bars
    const v = /^\s*(\d+)\s*-\s*(\d+)\s*-\s*([A-Z#Ø]*\s*\d+(?:\.\d+)?)\s*$/i.exec(r[iV]) || /^\s*(\d+)\s*-\s*()([A-Z#Ø]*\s*\d+(?:\.\d+)?)\s*$/i.exec(r[iV]);
    const id = String(r[0]).trim();
    if (!v) { out.failed++; out.errors.push(`Column ${id}: main bars "${String(r[iV]).trim()}" not read.`); i++; continue; }
    const tie = t => { const x = parseStirText(t); return x ? { bar: x.bar, s: x.s, ny: x.leg, nz: x.leg } : null; };
    if (/fail/i.test(r[iH] + m[iH])) out.failed++;
    out.cols[id] = { sect: +String(m[0]).trim() || null, name: String(r[2]).trim(), main: { n: +v[1], row: +v[2] || 0, bar: v[3].replace(/\s+/g, "").toUpperCase() }, tieEnd: tie(r[iH]), tieMid: tie(m[iH]) };
    out.count++; i++;
  }
  if (!out.count) out.errors.push("No column found. Copy the whole Column Design result table in Gen NX (click the table, Ctrl+A, Ctrl+C).");
  return out;
}

// the elements a design row stands for: the element with that id when its section matches (design per element),
// else the elements of design member MEMB
export function designElems(id, d, model, raw) {
  const byId = new Map(model.elems.map(e => [e.id, e]));
  const e = byId.get(+id), members = tableOf(raw.MEMB, "MEMB");
  const memb = (members[id]?.AELEM || []).map(Number).filter(x => byId.has(x));
  if (e && (!d.sect || e.sect === d.sect)) return [e.id];
  if (memb.length && (!d.sect || memb.every(x => byId.get(x).sect === d.sect))) return memb;
  if (e) return [e.id];
  return memb;
}
