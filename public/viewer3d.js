// Builds a standalone 3D structure page (three.js) with hover tooltips showing the section name.
// scripts: { three, orbit } each either { src: url } or { code: "..." } (inlined so the file works offline).
import { KIND_LABEL, mergeRuns, sectionInfo, sectionOutline, bubbleRows, topOf, tagOf } from "./core.js";

const KINDS = ["column", "beam", "brace", "wall", "slab"];
const KIND_COLORS = { column: "#c0392b", beam: "#2471a3", brace: "#7d3c98", wall: "#7f8c8d", slab: "#b7950b" };

export function model3dData(model, colors, grids, levels, { beamTop = true } = {}) {
  const info = sectionInfo(model), sects = [...colors.keys()], sIdx = new Map(sects.map((n, i) => [n, i]));
  const r = v => Math.round(v * 1e4) / 1e4;
  const members = [], plates = [];
  for (const e of model.elems) {
    const k = KINDS.indexOf(e.kind), s = sIdx.get(e.sectName);
    if (e.nodes.length === 2 && k <= 2) {
      const a = model.nodes.get(e.nodes[0]), b = model.nodes.get(e.nodes[1]);
      members.push([e.id, k, s, r(a.x), r(a.y), r(a.z), r(b.x), r(b.y), r(b.z), e.angle, e.matl, e.matlType]);
    } else if (k >= 3) {
      const pts = [];
      for (const id of e.nodes) { const n = model.nodes.get(id); pts.push(r(n.x), r(n.y), r(n.z)); }
      plates.push([e.id, k, s, e.t ? Math.round(e.t * 1000) : 0, pts, e.matl, e.matlType]);
    }
  }
  // one label per merged run (same section, collinear, same design member) at its mid point
  const lineEls = model.elems.filter(e => e.nodes.length === 2), degree = new Map();
  for (const e of lineEls) for (const id of e.nodes) degree.set(id, (degree.get(id) || 0) + 1);
  // [x, y, z, section, kind, dx, dy, dz, type]: mid point, member direction (names of beams and braces follow it), rebar type name (B2, B2-A ...)
  const labels = mergeRuns(lineEls, model, degree).map(m => [r((m.a.x + m.b.x) / 2), r((m.a.y + m.b.y) / 2), r((m.a.z + m.b.z) / 2), sIdx.get(m.sectName), KINDS.indexOf(m.kind), r(m.b.x - m.a.x), r(m.b.y - m.a.y), r(m.b.z - m.a.z), tagOf(model, m)]);
  const types = Object.fromEntries(model.elems.map(e => [e.id, tagOf(model, e)]).filter(([, n], i) => n !== model.elems[i].sectName)); // elem id -> type name, where it differs from the section
  const wallSeen = new Set();
  for (const e of model.elems.filter(e => e.kind === "wall" || e.kind === "slab")) {
    const ns = e.nodes.map(id => model.nodes.get(id)), c = ["x", "y", "z"].map(k => ns.reduce((s, n) => s + n[k], 0) / ns.length);
    const key = e.sectName + ":" + Math.round(c[2] * 2);
    if (wallSeen.has(key)) continue; wallSeen.add(key);
    labels.push([r(c[0]), r(c[1]), r(c[2]), sIdx.get(e.sectName), KINDS.indexOf(e.kind)]);
  }
  const secByName = new Map([...model.sects.values()].map(x => [x.name, x])), kindCount = new Map();
  for (const e of model.elems) { const c = kindCount.get(e.sectName) || Array(KINDS.length).fill(0); c[KINDS.indexOf(e.kind)]++; kindCount.set(e.sectName, c); }
  return {
    labels, types,
    sections: sects.map(n => {
      const sec = secByName.get(n), kc = kindCount.get(n) || [];
      const rr = l => l.map(([u, w]) => [Math.round(u * 1e5) / 1e5, Math.round(w * 1e5) / 1e5]);
      const out = s => (sectionOutline(s) || null)?.map(p => ({ pts: rr(p.pts), holes: p.holes.map(rr) })) || null;
      // beams use outlineTop: top of the beam at the node, so beam tops line up with the column tops
      return { name: n, color: colors.get(n).color, ...info.get(n), shape: sec?.poly ? "GEN" : sec?.shape, outline: out(sec), outlineTop: beamTop ? out(topOf(sec)) : null, kind: kc.length ? kc.indexOf(Math.max(...kc.filter(Boolean))) : 1 }; // the section's most common member kind
    }),
    kinds: KINDS.map(k => ({ name: KIND_LABEL[k], color: KIND_COLORS[k] })),
    members, plates,
    grids: { x: grids.x, y: grids.y }, base: levels.length ? levels[0].z : 0,
    levels: levels.map(l => ({ name: l.name, z: r(l.z) })), tol: 0.1,
  };
}

const tag = s => (s.code ? `<script>${s.code.replace(/<\/script/gi, "<\\/script")}</script>` : `<script src="${s.src}"></script>`);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function build3dHtml(data, { title = "3D Structure", scripts, colorMode = "section" }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#eef0f3;color:#1d232b}
  #c{position:fixed;inset:0}
  .panel{position:fixed;background:#fff;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.12)}
  #bar{top:10px;left:10px;padding:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .ttl{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 6px 0 4px}
  button,select{font:inherit;height:30px;padding:0 10px;border:0;border-radius:4px;background:#f1f2f4;cursor:pointer;color:inherit}
  select{padding-right:4px;width:112px}
  button:hover,select:hover{background:#e4e6e9}
  button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #1d232b;outline-offset:1px}
  label{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
  input[type=checkbox]{accent-color:#1d232b}
  input[type=range]{width:110px;accent-color:#1d232b}
  .seg{display:inline-flex;background:#f1f2f4;border-radius:4px;padding:2px;gap:2px}
  .seg button{height:26px;padding:0 9px;background:none}
  .seg button:hover{background:#fff}
  .seg [aria-pressed=true]{background:#1d232b;color:#fff}
  .ic{width:30px;padding:0!important;display:inline-grid;place-items:center}
  .ic svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linejoin:round}
  .ic svg .f{fill:currentColor;stroke:none}
  #persp[aria-pressed=true] .off,#persp[aria-pressed=false] .on{display:none}
  .dd{position:relative}
  #optBtn{padding-right:26px;position:relative}
  #optBtn::after,#secBtn::after{content:"";position:absolute;right:11px;top:50%;width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-70%) rotate(45deg)}
  #optBtn[aria-expanded=true]::after,#secBtn[aria-expanded=true]::after{transform:translateY(-20%) rotate(-135deg)}
  .pop{position:absolute;top:36px;left:0;z-index:6;background:#fff;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:10px 12px;display:flex;flex-direction:column;gap:8px;width:220px}
  .pop .row{justify-content:space-between}
  .pop .sub{margin:4px 0 0;color:#6b7480;font-size:12px}
  #kinds{display:flex;flex-direction:column;gap:6px}
  #bar{right:10px;max-width:none}
  .pop[hidden]{display:none}
  .sec{margin-left:auto}
  #secBtn{text-align:left;font-weight:600;padding:0 28px 0 10px;position:relative}
  #secPanel{left:auto;right:0;width:260px;gap:6px}
  #secQ{width:100%;box-sizing:border-box;font:inherit;height:30px;padding:0 8px;border:1px solid #c5cbd3;border-radius:4px}
  .acts{display:flex;gap:6px;margin:0}.acts button{flex:1;height:26px;font-size:12px}
  #secList{max-height:calc(100vh - 170px);overflow:auto}
  #secNone{margin:6px 2px;color:#6b7480;font-size:12px}
  .li[hidden]{display:none}
  .li{display:flex;align-items:center;gap:6px;padding:2px 0}
  .sw{width:14px;height:14px;border-radius:3px;flex:none;border:1px solid rgba(0,0,0,.2)}
  .li span.n{margin-left:auto;color:#6b7480;font-size:11px}
  .nm small{display:block;color:#6b7480;font-size:11px}
  #hint{left:10px;bottom:10px;padding:4px 9px;font-size:11px;color:#6b7480}
  #tip{position:fixed;pointer-events:none;padding:6px 9px;background:#1d232b;color:#fff;border-radius:6px;font-size:12px;display:none;white-space:nowrap;z-index:5}
  #tip b{font-size:13px}
  #tip .rb{margin-top:6px}
  #tip .rb svg{display:block;max-width:min(520px,90vw);height:auto;border-radius:3px}
  #tip .rb i{display:block;margin-top:4px;color:#c9ced4}
  @media (max-width:700px){.sec{margin-left:0}#secPanel{right:auto;left:0}}
</style></head><body>
<div id="c"></div>
<div id="bar" class="panel">
  <span class="seg" role="group" aria-label="View"><button id="v3d" aria-pressed="true">3D</button><button data-v="iso">Iso</button><button data-v="top">Top</button><button data-v="front">Front</button><button data-v="side">Side</button></span>
  <select id="planSel" title="Plan" aria-label="Plan"></select><select id="elevSel" title="Elevation" aria-label="Elevation"></select>
  <span class="seg" role="group" aria-label="Display">
    <button class="ic" data-disp="lines" title="Lines only" aria-label="Lines only"><svg viewBox="0 0 20 20"><path d="M4 17V4m12 13V4M4 4h12M4 10.5h12"/></svg></button>
    <button class="ic" data-disp="mixed" title="Lines, extruded columns" aria-label="Lines, extruded columns"><svg viewBox="0 0 20 20"><path d="M4 4h12M4 10.5h12"/><rect x="2.5" y="3" width="3" height="14" class="f"/><rect x="14.5" y="3" width="3" height="14" class="f"/></svg></button>
    <button class="ic" data-disp="solid" title="Extrude all members to their section shape" aria-label="Extrude all"><svg viewBox="0 0 20 20"><path d="M3 5.5h14v3h-5.5v8h3v1.5h-9v-1.5h3v-8H3z" class="f"/></svg></button>
    <button class="ic" id="persp" title="Perspective on/off" aria-label="Perspective" aria-pressed="false"><svg class="on" viewBox="0 0 20 20"><path d="M2.5 3.5l15 3v7l-15 3zM2.5 3.5v13M17.5 6.5v7"/></svg><svg class="off" viewBox="0 0 20 20"><path d="M3 5h11v11H3zM3 5l3-3h11v11l-3 3M14 5l3-3"/></svg></button>
  </span>
  <span class="dd"><button id="optBtn" type="button" aria-expanded="false" aria-controls="optPanel">Display</button>
    <div id="optPanel" class="pop" hidden>
      <label class="row">Colour <select id="mode"><option value="section">By section</option><option value="kind">By member type</option></select></label>
      <label><input type="checkbox" id="gridchk" checked> Grid</label>
      <label><input type="checkbox" id="names"> Section names</label>
      <label class="row">Font <input type="range" id="font" min="0.4" max="3" step="0.1" value="1"></label>
      <p class="sub">Show</p>
      <span id="kinds"><label><input type="checkbox" data-kind="1" checked> Beams</label><label><input type="checkbox" data-kind="0" checked> Columns</label><label><input type="checkbox" data-kind="2" checked> Braces</label><label><input type="checkbox" data-kind="3" checked> Walls</label><label><input type="checkbox" data-kind="4" checked> Slabs</label></span>
    </div></span>
  <span class="dd sec" id="legend"><button id="secBtn" type="button" aria-expanded="false" aria-controls="secPanel">Sections</button>
  <div id="secPanel" class="pop" hidden><input id="secQ" type="search" placeholder="Search name, size or material" aria-label="Search sections" autocomplete="off">
    <p class="acts"><button type="button" id="secAll">Show these</button><button type="button" id="secOff">Hide these</button></p>
    <div id="secList"></div><p id="secNone" hidden>No section matches.</p></div></span>
</div>
<div id="tip"></div>
<div id="hint" class="panel"><b>${esc(title)}</b> · Drag or wheel-drag: rotate · Wheel: zoom · Right-drag: pan</div>
${tag(scripts.three)}
${tag(scripts.orbit)}
<script>
const D = ${json};
${bubbleRows.toString()}
const KIND_LBL = D.kinds.map(k => k.name);
const $ = id => document.getElementById(id);
const host = $("c");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
host.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xeef0f3);
const pCam = new THREE.PerspectiveCamera(40, 1, 0.05, 1e5); pCam.up.set(0, 0, 1);
const oCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e5, 1e5); oCam.up.set(0, 0, 1);
let camera = pCam;
const controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }; // wheel drag rotates, wheel turn zooms, right drag pans
renderer.domElement.addEventListener("mousedown", e => { if (e.button === 1) e.preventDefault(); }); // no browser autoscroll on middle click
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 0.85));
const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(1, -1.5, 2); scene.add(sun);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---- objects: every element has a solid form (extruded real section) and a line form; one is shown depending on Display ----
const solid = c => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide });
const glass = (c, o) => new THREE.MeshLambertMaterial({ color: c, transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false });
const lmat = c => new THREE.LineBasicMaterial({ color: c });
const pal = { section: D.sections.map(s => s.color), kind: D.kinds.map(k => k.color) };
const M = {};
for (const m of ["section", "kind"]) M[m] = { solid: pal[m].map(solid), wall: pal[m].map(c => glass(c, 0.8)), slab: pal[m].map(c => glass(c, 0.45)), line: pal[m].map(lmat) };
const HI = { solid: solid(0xffb300), glass: glass(0xffb300, 0.9), line: lmat(0xff8c00) };
const objs = [];
const MATL_TYPE = { CONC: "Concrete", STEEL: "Steel", SRC: "Composite", USER: "User" };
const SHAPE_NAME = { H: "H / I-section", T: "T-section", B: "Box", P: "Pipe", SR: "Solid round", SB: "Solid rectangle", L: "Angle", "2L": "Double angle", C: "Channel", CC: "Lipped channel", GEN: "General section" };

// one unit-length extrusion per section, shifted for the MIDAS offset point (e.g. CT = node at centre-top)
const geoCache = new Map();
function sectionGeo(si, top) {
  const ck = si + (top ? "t" : "");
  if (geoCache.has(ck)) return geoCache.get(ck);
  const V2 = l => l.map(([u, w]) => new THREE.Vector2(u, w));
  const S = D.sections[si], parts = (S && ((top && S.outlineTop) || S.outline)) || [{ pts: [[-0.15, -0.15], [0.15, -0.15], [0.15, 0.15], [-0.15, 0.15]], holes: [] }];
  const shapes = parts.map(p => { const sh = new THREE.Shape(V2(p.pts)); for (const h of p.holes) sh.holes.push(new THREE.Path(V2(h))); return sh; });
  const g = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });
  geoCache.set(ck, g); return g;
}

for (const m of D.members) {
  const [id, k, s, ax, ay, az, bx, by, bz, beta, matl, mtype] = m;
  const a = V(ax, ay, az), b = V(bx, by, bz), x = b.clone().sub(a), L = x.length(); x.normalize();
  let z = Math.abs(x.z) > 0.98 ? V(1, 0, 0) : V(0, 0, 1).sub(x.clone().multiplyScalar(x.z)).normalize();
  const t = (beta || 0) * Math.PI / 180;
  z = z.clone().multiplyScalar(Math.cos(t)).add(x.clone().cross(z).multiplyScalar(Math.sin(t))).normalize();
  const y = z.clone().cross(x).normalize();
  const mesh = new THREE.Mesh(sectionGeo(s, k === 1));
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(new THREE.Matrix4().makeBasis(y, z, x).scale(V(1, 1, L)).setPosition(a)); // shape (u,w) -> local (y,z), extrusion -> member axis
  const lg = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(lg);
  const u = { id, k, s, matl, mtype, L, plate: false, pts: [a, b] };
  mesh.userData = line.userData = u;
  scene.add(mesh); scene.add(line);
  objs.push({ u, mesh, line });
}
for (const p of D.plates) {
  const [id, k, s, t, pts, matl, mtype] = p;
  const n = pts.length / 3, idx = [], P = [];
  for (let i = 0; i < n; i++) P.push(V(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]));
  for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)); g.setIndex(idx); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g);
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.35 })));
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(P));
  const u = { id, k, s, matl, mtype, t, plate: true, pts: P };
  mesh.userData = line.userData = u;
  scene.add(mesh); scene.add(line);
  objs.push({ u, mesh, line });
}
const box0 = new THREE.Box3(); objs.forEach(o => { o.mesh.updateMatrixWorld(true); box0.expandByObject(o.mesh); });
const R0 = Math.max(box0.getSize(V()).x, box0.getSize(V()).y, box0.getSize(V()).z, 1);

// ---- grid and level annotation (rebuilt for each view) ----
const gridGroup = new THREE.Group(); scene.add(gridGroup);
const GRID = 0x9aa0a6;
function bubble(text) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.strokeStyle = "#8a9096"; g.lineWidth = 6;
  g.beginPath(); g.arc(64, 64, 56, 0, 7); g.fill(); g.stroke();
  g.fillStyle = "#3c4046"; g.font = "bold 56px Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 64, 68);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sp.renderOrder = 9; sp.userData.bubble = true; return sp;
}
function levelTag(text) { const sp = nameSprite(text, "#24508a"); sp.userData.tag = true; return sp; }
// segments: [[x,y,z,x,y,z], ...]
function addLines(segs) {
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(segs.flat(), 3));
  gridGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: GRID })));
}
function annotate(b) {
  gridGroup.clear();
  const e = R * 0.08, gx = D.grids.x, gy = D.grids.y, segs = [];
  const x0 = Math.min(b.min.x, ...gx.map(g => g.v)) - e, x1 = Math.max(b.max.x, ...gx.map(g => g.v)) + e;
  const y0 = Math.min(b.min.y, ...gy.map(g => g.v)) - e, y1 = Math.max(b.max.y, ...gy.map(g => g.v)) + e;
  const put = (sp, x, y, z) => { sp.position.set(x, y, z); gridGroup.add(sp); };
  // bubble row at the end (at) of grid lines vs, outward along out; close grids pushed apart with a kinked leader. P(u, w) -> [x, y, z]
  const f = Math.max(1, +$("font").value), off = R * 0.025 * f;
  // straight lines from the model (near) out to the bubbles; close grids staggered, every other one a bubble further out
  const row = (list, near, at, out, P) => {
    const gap = R * 0.037 * f, rows = bubbleRows(list.map(g => g.v), gap);
    list.forEach((g, i) => {
      const end = at + out * rows[i] * gap;
      segs.push([...P(g.v, near), ...P(g.v, end)]);
      put(bubble(g.label), ...P(g.v, end + out * off));
    });
  };
  if (filter.type === "elev") {
    // vertical grid lines in the elevation plane, bubbles below; one line and tag per level
    const cross = filter.axis === "y" ? gx : gy, P = (u, z) => (filter.axis === "y" ? [u, filter.v, z] : [filter.v, u, z]);
    const u0 = filter.axis === "y" ? x0 : y0, u1 = filter.axis === "y" ? x1 : y1, z0 = b.min.z - e, z1 = b.max.z + e * 0.5;
    const zn = b.min.z - e * 0.2;
    for (const g of cross) segs.push([...P(g.v, zn), ...P(g.v, z1)]);
    row(cross, zn, z0, -1, P);
    for (const l of D.levels) if (l.z >= b.min.z - 0.05 && l.z <= b.max.z + 0.05) {
      segs.push([...P(u0, l.z), ...P(u1, l.z)]);
      put(levelTag(l.name + "  EL " + (l.z >= 0 ? "+" : "") + l.z.toFixed(3)), ...P(u0 - R * 0.08, l.z));
    }
  } else {
    const z = filter.type === "plan" ? filter.z : D.base;
    const yn = y0 + e * 0.8, xn = x0 + e * 0.8; // just outside the model
    for (const g of gx) segs.push([g.v, yn, z, g.v, y1, z]);
    for (const g of gy) segs.push([xn, g.v, z, x1, g.v, z]);
    row(gx, yn, y0, -1, (u, w) => [u, w, z]); row(gy, xn, x0, -1, (u, w) => [w, u, z]);
  }
  addLines(segs);
}

// ---- section name labels ----
const nameGroup = new THREE.Group(); nameGroup.visible = false; scene.add(nameGroup);
function nameSprite(text, color = "#1d232b") {
  const fs = 44, pad = 10, c = document.createElement("canvas"), g = c.getContext("2d");
  g.font = "600 " + fs + "px Arial"; const w = Math.ceil(g.measureText(text).width) + pad * 2, h = fs + pad * 2;
  c.width = w; c.height = h; g.font = "600 " + fs + "px Arial";
  g.fillStyle = "rgba(255,255,255,0.85)"; g.fillRect(0, 0, w, h);
  g.fillStyle = color; g.textBaseline = "middle"; g.fillText(text, pad, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.renderOrder = 10; sp.userData.aspect = w / h; return sp;
}
for (const [x, y, z, s, k, dx, dy, dz, type] of D.labels) {
  const sp = nameSprite(type || D.sections[s].name); sp.position.set(x, y, z); sp.userData.s = s; sp.userData.k = k;
  if (dx !== undefined && k !== 0) sp.userData.dir = new THREE.Vector3(dx, dy, dz); // columns keep level text
  nameGroup.add(sp);
}
// turn each beam/brace name to its member's direction on screen, kept readable (never upside down)
const pa = new THREE.Vector3(), pb = new THREE.Vector3();
function alignNames() {
  if (!nameGroup.visible) return;
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  for (const sp of nameGroup.children) {
    const d = sp.userData.dir; if (!d) continue;
    pa.copy(sp.position).project(camera); pb.copy(sp.position).add(d).project(camera);
    let a = Math.atan2((pb.y - pa.y) * h, (pb.x - pa.x) * w);
    if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
    sp.material.rotation = a;
  }
}

// ---- view filter: whole model, one plan level, or one grid line ----
const tol = D.tol || 0.1;
let filter = { type: "all" };
{
  // three pickers: 3D (whole model), Plan (one level), Elevation (one grid line)
  const ps = $("planSel"), es = $("elevSel");
  ps.add(new Option("Plan…", "")); es.add(new Option("Elevation…", ""));
  D.levels.forEach((l, i) => ps.add(new Option(l.name + " (EL " + (l.z >= 0 ? "+" : "") + l.z.toFixed(3) + ")", "L" + i)));
  D.grids.y.forEach((g, i) => es.add(new Option("Grid " + g.label, "Y" + i)));
  D.grids.x.forEach((g, i) => es.add(new Option("Grid " + g.label, "X" + i)));
}
function inFilter(pts) {
  if (filter.type === "all") return true;
  if (filter.type === "plan") { const top = Math.max(...pts.map(p => p.z)); return top <= filter.z + tol / 2 && top > filter.prev + tol / 2; }
  return pts.every(p => Math.abs((filter.axis === "x" ? p.x : p.y) - filter.v) <= tol);
}

// ---- colour mode, legend, visibility ----
let mode = ${JSON.stringify(colorMode)}, display = "lines"; // lines only until extrude is picked
const hidden = new Set(), kindOff = new Set(); // hidden: section indexes switched off in the legend
const shown = u => !hidden.has(u.s) && !kindOff.has(u.k) && inFilter(u.pts);
const asLine = u => display === "lines" || (display === "mixed" && u.k !== 0); // columns stay solid in "mixed"
function matFor(o) {
  const i = mode === "section" ? o.u.s : o.u.k;
  return { mesh: o.u.plate ? M[mode][o.u.k === 4 ? "slab" : "wall"][i] : M[mode].solid[i], line: M[mode].line[i] };
}
function refresh() {
  for (const o of objs) {
    const m = matFor(o), v = shown(o.u);
    o.mesh.material = m.mesh; o.line.material = m.line;
    o.mesh.visible = v && !asLine(o.u); o.line.visible = v && asLine(o.u);
  }
  for (const sp of nameGroup.children) sp.visible = !hidden.has(sp.userData.s) && !kindOff.has(sp.userData.k) && inFilter([sp.position]);
  hot = null;
}
// legend: every section with B x H and material; swatch = section colour, or its member-type colour in default mode
function legend() {
  const counts = new Map(), esc = t => String(t).replace(/[&<]/g, c => (c === "&" ? "&amp;" : "&lt;"));
  for (const o of objs) counts.set(o.u.s, (counts.get(o.u.s) || 0) + 1);
  const used = D.sections.map((it, i) => i).filter(i => counts.has(i)), on = used.filter(i => !hidden.has(i)).length;
  $("secBtn").textContent = "Sections " + (on === used.length ? used.length : on + "/" + used.length);
  $("secList").innerHTML = used.map(i => { const it = D.sections[i];
    return '<label class="li" data-q="' + esc((it.name + " " + (it.size || "") + " " + (it.matl || "")).toLowerCase()) + '"><input type="checkbox" data-i="' + i + '"' + (hidden.has(i) ? "" : " checked") + '><span class="sw" style="background:' + (mode === "section" ? it.color : D.kinds[it.kind].color) + '"></span>' +
      '<span class="nm">' + esc(it.name) + "<small>" + esc([it.size, it.matl].filter(Boolean).join(" · ")) + '</small></span><span class="n">' + counts.get(i) + "</span></label>"; }).join("");
  filterList();
}
// section dropdown: closed by default, a search box filters by name, size or material
function filterList() {
  const q = $("secQ").value.trim().toLowerCase();
  let n = 0;
  for (const l of $("secList").children) { const ok = !q || l.dataset.q.includes(q); l.hidden = !ok; if (ok) n++; }
  $("secNone").hidden = n > 0;
}
$("optBtn").onclick = () => { const open = $("optPanel").hidden; $("optPanel").hidden = !open; $("optBtn").setAttribute("aria-expanded", open); };
addEventListener("pointerdown", e => { // a press anywhere else closes the menus
  if (!e.target.closest("#optBtn, #optPanel")) { $("optPanel").hidden = true; $("optBtn").setAttribute("aria-expanded", false); }
  if (!e.target.closest("#legend")) { $("secPanel").hidden = true; $("secBtn").setAttribute("aria-expanded", false); }
}, true);
addEventListener("keydown", e => { if (e.key === "Escape" && !$("optPanel").hidden) { $("optPanel").hidden = true; $("optBtn").setAttribute("aria-expanded", false); $("optBtn").focus(); } });
$("secBtn").onclick = () => { const open = $("secPanel").hidden; $("secPanel").hidden = !open; $("secBtn").setAttribute("aria-expanded", open); if (open) $("secQ").focus(); };
$("secQ").oninput = filterList;
$("secQ").onkeydown = e => { if (e.key === "Escape") { $("secPanel").hidden = true; $("secBtn").setAttribute("aria-expanded", false); $("secBtn").focus(); } };
const setShown = all => { for (const l of $("secList").children) if (!l.hidden) { const i = +l.firstChild.dataset.i; all ? hidden.delete(i) : hidden.add(i); } legend(); refresh(); };
$("secAll").onclick = () => setShown(true); $("secOff").onclick = () => setShown(false);
$("mode").value = mode;
$("mode").onchange = e => { mode = e.target.value; legend(); refresh(); };
const dispBtns = document.querySelectorAll("[data-disp]");
const setDisplay = v => { display = v; dispBtns.forEach(b => b.setAttribute("aria-pressed", b.dataset.disp === v)); refresh(); };
dispBtns.forEach(b => (b.onclick = () => setDisplay(b.dataset.disp)));
$("gridchk").onchange = e => { gridGroup.visible = e.target.checked; };
$("names").onchange = e => { nameGroup.visible = e.target.checked; };
document.querySelectorAll("[data-kind]").forEach(cb => {
  if (!objs.some(o => o.u.k === +cb.dataset.kind)) cb.parentElement.style.display = "none";
  cb.onchange = () => { cb.checked ? kindOff.delete(+cb.dataset.kind) : kindOff.add(+cb.dataset.kind); refresh(); };
});

// ---- cameras ----
let center = box0.getCenter(V()), R = R0;
function fitBox() {
  const b = new THREE.Box3();
  for (const o of objs) if (shown(o.u)) for (const p of o.u.pts) b.expandByPoint(p);
  if (b.isEmpty()) b.copy(box0);
  center = b.getCenter(V()); const s = b.getSize(V()); R = Math.max(s.x, s.y, s.z, 1);
  annotate(b);
}
// orthographic frustum matches the perspective view at distance oDist (zoom 1)
let oDist = 1;
function frustum() {
  const h = innerWidth / innerHeight, half = Math.tan((pCam.fov * Math.PI) / 360) * oDist;
  oCam.left = -half * h; oCam.right = half * h; oCam.top = half; oCam.bottom = -half; oCam.updateProjectionMatrix();
}
function useCam(next) {
  if (next === camera) return;
  // keep the view: same direction and target, distance from the current camera (ortho zoom turns into distance)
  const t = controls.target, dir = camera.position.clone().sub(t).normalize();
  const d = camera === pCam ? camera.position.distanceTo(t) : oDist / oCam.zoom;
  if (next === oCam) { oDist = d; oCam.zoom = 1; frustum(); }
  next.position.copy(t).add(dir.multiplyScalar(d)); next.quaternion.copy(camera.quaternion); next.updateProjectionMatrix();
  camera = next; controls.object = next; controls.update();
  $("persp").setAttribute("aria-pressed", next === pCam);
}
function view(v) {
  const d = R * 2.2, dirs = { iso: V(1, -1.3, 0.9), top: V(0, -0.001, 1), front: V(0, -1, 0.001), side: V(1, 0, 0.001) };
  for (const c of [pCam, oCam]) { c.position.copy(center).add(dirs[v].clone().normalize().multiplyScalar(d)); c.zoom = 1; }
  controls.target.copy(center); oDist = d; frustum(); camera.updateProjectionMatrix(); controls.update();
  sizeSprites();
}
$("persp").onclick = () => useCam(camera === pCam ? oCam : pCam);
document.querySelectorAll("[data-v]").forEach(b => (b.onclick = () => view(b.dataset.v)));
function pickView(v) {
  if (v === "all") filter = { type: "all" };
  else if (v[0] === "L") { const i = +v.slice(1); filter = { type: "plan", z: D.levels[i].z, prev: i ? D.levels[i - 1].z : -Infinity }; }
  else { const g = (v[0] === "X" ? D.grids.x : D.grids.y)[+v.slice(1)]; filter = { type: "elev", axis: v[0] === "X" ? "x" : "y", v: g.v }; }
  $("planSel").value = v[0] === "L" ? v : ""; $("elevSel").value = v[0] === "X" || v[0] === "Y" ? v : ""; $("v3d").setAttribute("aria-pressed", v === "all");
  tip.style.display = "none"; refresh(); fitBox();
  useCam(oCam); // plans and elevations are flat; the 3D view keeps perspective off too until it is switched on
  view(filter.type === "all" ? "iso" : filter.type === "plan" ? "top" : filter.axis === "x" ? "side" : "front");
}
$("v3d").onclick = () => pickView("all");
$("planSel").onchange = e => pickView(e.target.value || "all");
$("elevSel").onchange = e => pickView(e.target.value || "all");

// ---- font size (section names and grid bubbles) ----
function sizeSprites() {
  const f = +$("font").value, sh = R * 0.02 * f;
  for (const sp of nameGroup.children) sp.scale.set(sh * sp.userData.aspect, sh, 1);
  for (const sp of gridGroup.children) if (sp.isSprite) sp.userData.bubble ? sp.scale.set(R * 0.035 * f, R * 0.035 * f, 1) : sp.scale.set(sh * sp.userData.aspect, sh, 1);
}
$("font").oninput = () => { fitBox(); sizeSprites(); }; // bubble spacing follows the font size

// ---- hover -> section name ----
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), tip = $("tip");
let hot = null;
renderer.domElement.addEventListener("pointermove", e => {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.params.Line.threshold = (camera === oCam ? (oCam.top - oCam.bottom) / oCam.zoom : pCam.position.distanceTo(controls.target)) * 0.008;
  ray.setFromCamera(mouse, camera);
  const targets = objs.map(o => (o.line.visible ? o.line : o.mesh)).filter(t => t.visible);
  const hit = ray.intersectObjects(targets, false)[0], m = hit ? hit.object : null;
  if (m !== hot) {
    if (hot) { const o = objs.find(o => o.mesh === hot || o.line === hot), mm = matFor(o); hot.material = hot === o.line ? mm.line : mm.mesh; }
    hot = m;
    if (m) m.material = m.isLine ? HI.line : m.userData.plate ? HI.glass : HI.solid;
  }
  if (!m) { tip.style.display = "none"; renderer.domElement.style.cursor = ""; return; }
  const u = m.userData, S = D.sections[u.s], h = t => String(t).replace(/[&<]/g, c => (c === "&" ? "&amp;" : "&lt;"));
  const shape = SHAPE_NAME[S.shape];
  tip.innerHTML = "<b>" + h((D.types || {})[u.id] || S.name) + "</b><br>" + KIND_LBL[u.k] + " &middot; Elem " + u.id +
    (S.desc ? "<br>Section " + h(S.desc) + (shape ? " (" + shape + ")" : "") + " mm" : u.t ? "<br>Thickness " + u.t + " mm" : "") +
    (u.matl ? "<br>Material " + h((MATL_TYPE[u.mtype] ? MATL_TYPE[u.mtype] + " " : "") + u.matl) : "") +
    (u.L ? "<br>L = " + u.L.toFixed(3) + " m" : "") +
    (hasRebar(u.id) ? '<div class="rb">' + D.rebar.svg[D.rebar.of[u.id]] + (inApp ? '<i>Click: open rebar detail</i>' : "") + "</div>" : "");
  renderer.domElement.style.cursor = inApp && hasRebar(u.id) ? "pointer" : "";
  tip.style.display = "block";
  tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
  tip.style.top = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8) + "px";
});
// inside the app, a click (not a drag) on an element with rebar opens its rebar sheet
const inApp = window.parent !== window, hasRebar = id => !!D.rebar && D.rebar.of[id] !== undefined;
let downAt = null;
renderer.domElement.addEventListener("pointerdown", e => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", e => {
  if (!inApp || !hot || e.button !== 0 || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const id = hot.userData.id;
  if (hasRebar(id)) parent.postMessage({ gnxRebar: id }, "*");
});
renderer.domElement.addEventListener("pointerleave", () => { tip.style.display = "none"; });

function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h); pCam.aspect = w / h; pCam.updateProjectionMatrix(); if (camera === oCam) frustum(); }
addEventListener("resize", resize); resize();
legend(); setDisplay(display); fitBox(); view("iso"); useCam(oCam); // perspective off at start
// draw only when something can have changed: camera motion (update() is true while damping settles) or any user input
let dirty = true;
for (const ev of ["pointermove", "pointerdown", "pointerup", "wheel", "keydown", "click", "change", "input", "resize", "message"]) addEventListener(ev, () => { dirty = true; }, { passive: true, capture: true });
(function loop() { if (controls.update() || dirty) { dirty = false; alignNames(); renderer.render(scene, camera); } requestAnimationFrame(loop); })();
</script></body></html>`;
}
