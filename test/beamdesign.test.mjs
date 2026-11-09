// npm test — hand calculations for public/beamdesign.js (SNI 2847:2019)
import test from "node:test";
import assert from "node:assert/strict";
import { asRequired, perLayer, chooseBars, designShear, designBeam, rationalize, beamWeight, DEFAULTS } from "../public/beamdesign.js";

const o = { ...DEFAULTS };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("flexure As for 300x600, fc 30, fy 420, Mu 200 kN·m (hand calc 1033 mm²)", () => {
  // d = 600 - 40 - 10 - 19/2 = 540.5; Rn = 2.5356 MPa; rho = 0.0063715; As = 1033 mm²; As,min = 1.4/420·b·d = 540.5 mm²
  const r = asRequired(200, 300, 540.5, o);
  near(r.As, 1033.1, 1, "As");
  near(r.asMin, 540.5, 0.5, "As,min");
  assert.equal(r.reason, null);
});
test("small moment uses 4/3 As instead of As,min (9.6.1.3)", () => {
  const r = asRequired(20, 300, 540.5, o);
  assert.ok(r.As < r.asMin && r.As > 0);
});
test("moment beyond tension controlled is flagged", () => {
  assert.ok(asRequired(900, 300, 540.5, o).reason);
});
test("bars per layer: 300 wide, cover 40, D10 stirrup, D19 -> 4 (gap 26.7 mm for 20 mm aggregate)", () => {
  // clear 200; (200 + 26.7) / (19 + 26.7) = 4.96 -> 4
  assert.equal(perLayer(300, 19, 10, o), 4);
});
test("chooseBars 1033 mm² with D19 -> 4 D19 in one layer", () => {
  const c = chooseBars(1033, 300, 10, o, "D19");
  assert.deepEqual([c.n, c.layers], [4, [4]]);
});
test("shear Vu 250 kN on 300x540.5 -> 2-D10 @175 (hand calc s = 195 mm)", () => {
  // Vc = 0.17·√30·300·540.5 = 150.98 kN; Vs = 250/0.75 - Vc = 182.35 kN; Av/s = 0.8033; s = 157.08/0.8033 = 195.5
  const s = designShear(250, 300, 540.5, o);
  near(s.Vc, 150.98, 0.05, "Vc");
  assert.deepEqual([s.leg, s.bar, s.s], [2, "D10", 175]);
});
test("shear spacing capped at d/2 for small Vu", () => {
  assert.equal(designShear(50, 300, 540.5, o).s, 250); // d/2 = 270 -> 250 on a 25 mm step
});
test("SRPMK hoops at the ends: min(d/4, 6db, 150) -> 100 for D19", () => {
  const d = designBeam({ I: { Mneg: 200, Mpos: 80, V: 120 }, M: { Mneg: 0, Mpos: 120, V: 30 }, J: { Mneg: 200, Mpos: 80, V: 120 } }, 300, 600, { srpmk: true, bars: ["D19"] });
  assert.equal(d.I.stir.s, 0.1); // 6·19 = 114 -> 100
  // 18.6.3.2: bottom at the face ≥ half the top
  const area = gs => gs.reduce((a, g) => a + g.n * Math.PI * 19 * 19 / 4, 0);
  assert.ok(area(d.I.bot) >= area(d.I.top) / 2);
});
test("designBeam gives the pasted-design shape", () => {
  const d = designBeam({ I: { Mneg: 150, V: 140 }, M: { Mpos: 110, V: 40 }, J: { Mneg: 160, V: 150 } }, 300, 600);
  for (const p of ["I", "M", "J"]) { assert.ok(Array.isArray(d[p].top) && d[p].top.length); assert.ok(d[p].stir.s > 0); }
});
test("rationalize: per-beam design weighs less than one type for all, and k=1 equals the envelope", () => {
  const mk = (id, m) => ({ id, L: 6, b: 300, h: 600, d: designBeam({ I: { Mneg: m, V: m * 0.9 }, M: { Mpos: m * 0.6, V: 30 }, J: { Mneg: m, V: m * 0.9 } }, 300, 600) });
  const beams = [mk(1, 60), mk(2, 90), mk(3, 120), mk(4, 180), mk(5, 240)];
  const one = rationalize(beams, 1), three = rationalize(beams, 3), each = beams.reduce((a, x) => a + beamWeight(x.d, x.L, 300, 600), 0);
  assert.equal(one.types.length, 1);
  assert.ok(three.weight <= one.weight + 1e-9 && each <= three.weight + 1e-9, `${each} ≤ ${three.weight} ≤ ${one.weight}`);
  assert.deepEqual(three.types.flatMap(t => t.ids).sort(), [1, 2, 3, 4, 5]);
});
