// Paper renderers for a view: SVG (screen preview) and jsPDF (PDF). All work in A3 millimetres.
import { drawPaper, PAPER } from "./core.js";

const DASH = { center: [8, 2, 1.5, 2], dashed: [3, 1.5], grid: [4, 2.5] };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const f = v => Math.round(v * 1000) / 1000;
const FONT_RATIO = 0.72; // cap height / font size

export function toSvg(view, meta) {
  const out = [];
  const stroke = st => `stroke="${st.color || "#000"}" stroke-width="${st.lw || 0.18}"${st.dash ? ` stroke-dasharray="${DASH[st.dash].join(" ")}"` : ""}`;
  const tip = st => (st.tip ? ` class="el" data-tip="${esc(st.tip)}"${st.el ? ` data-el="${st.el}"` : ""}` : "");
  const R = {
    line(x1, y1, x2, y2, st) {
      const xy = `x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"`;
      out.push(`<line ${xy} ${stroke(st)} stroke-linecap="round"/>`);
      if (st.tip) out.push(`<line ${xy} stroke="transparent" stroke-width="2"${tip(st)}/>`); // wider hover target
    },
    poly(pts, st) {
      out.push(`<${st.closed ? "polygon" : "polyline"} points="${pts.map(p => f(p[0]) + "," + f(p[1])).join(" ")}" fill="${st.fill || "none"}" ${stroke(st)} stroke-linejoin="round"${tip(st)}/>`);
    },
    circle(cx, cy, r, st) {
      out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${st.fill || "none"}" ${stroke(st)}${tip(st)}/>`);
    },
    text(x, y, s, st) {
      const anchor = st.align === "center" ? "middle" : st.align === "right" ? "end" : "start";
      const base = st.valign === "middle" ? "central" : st.valign === "top" ? "hanging" : "alphabetic";
      const rot = st.rot ? ` transform="rotate(${f(-st.rot)} ${f(x)} ${f(y)})"` : "";
      out.push(`<text x="${f(x)}" y="${f(y)}" font-size="${f(st.size / FONT_RATIO)}"${st.bold ? ' font-weight="bold"' : ""} fill="${st.color || "#000"}" text-anchor="${anchor}" dominant-baseline="${base}"${rot}>${esc(s)}</text>`);
    },
  };
  const { T, e } = drawPaper(view, R, meta);
  if (view.bare) { // cropped to the drawing, 4 px per paper mm
    const [x0, y1] = T([e.x0, e.y0]), [x1, y0] = T([e.x1, e.y1]), vb = [x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2].map(f);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(" ")}" width="${f(vb[2] * 4)}" height="${f(vb[3] * 4)}" font-family="Arial, Helvetica, sans-serif"><rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#ffffff"/>${out.join("")}</svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAPER.w} ${PAPER.h}" font-family="Arial, Helvetica, sans-serif"><rect width="${PAPER.w}" height="${PAPER.h}" fill="#ffffff"/>${out.join("")}</svg>`;
}

const rgb = hex => { const n = parseInt((hex || "#000000").slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const latin = s => String(s).replace(/…/g, "...").replace(/×/g, "x").replace(/[^\x20-\xff]/g, "?");

export function toPdf(views, meta) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const pen = st => { doc.setDrawColor(...rgb(st.color)); doc.setLineWidth(st.lw || 0.18); doc.setLineDashPattern(st.dash ? DASH[st.dash] : [], 0); };
  const R = {
    line(x1, y1, x2, y2, st) { pen(st); doc.line(x1, y1, x2, y2); },
    poly(pts, st) {
      pen(st);
      if (st.fill) doc.setFillColor(...rgb(st.fill));
      const rel = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
      doc.lines(rel, pts[0][0], pts[0][1], [1, 1], st.fill ? "FD" : "S", !!st.closed);
    },
    circle(cx, cy, r, st) { pen(st); if (st.fill) doc.setFillColor(...rgb(st.fill)); doc.circle(cx, cy, r, st.fill ? "FD" : "S"); },
    text(x, y, s, st) {
      s = latin(s);
      doc.setFont("helvetica", st.bold ? "bold" : "normal");
      doc.setFontSize((st.size / FONT_RATIO) * 2.8346);
      doc.setTextColor(...rgb(st.color));
      // jsPDF alignment with rotation is unreliable, so place the baseline start point ourselves.
      const a = ((st.rot || 0) * Math.PI) / 180, dir = [Math.cos(a), -Math.sin(a)], up = [-Math.sin(a), -Math.cos(a)];
      const w = doc.getTextWidth(s), fx = st.align === "center" ? 0.5 : st.align === "right" ? 1 : 0;
      const fy = st.valign === "middle" ? 0.5 : st.valign === "top" ? 1 : 0;
      const sx = x - dir[0] * w * fx - up[0] * st.size * fy, sy = y - dir[1] * w * fx - up[1] * st.size * fy;
      doc.text(s, sx, sy, { angle: st.rot || 0 });
    },
  };
  views.forEach((v, i) => { if (i) doc.addPage("a3", "landscape"); drawPaper(v, R, meta); });
  return doc;
}
