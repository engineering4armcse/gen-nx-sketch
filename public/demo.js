// Demo building in the exact JSON shape Gen NX's /db/* endpoints return, for trying the app without a MAPI-Key.
export function demoModel() {
  const X = [0, 6, 12, 18], Y = [0, 7.5, 15], Z = [0, 4, 7.5, 11, 14.5];
  const STORY = ["1F", "2F", "3F", "4F", "ROOF"];
  const NODE = {}, ELEM = {};
  let nid = 0, eid = 0;
  const key = new Map();
  const node = (x, y, z) => {
    const k = `${x},${y},${z}`;
    if (!key.has(k)) { key.set(k, ++nid); NODE[nid] = { X: x, Y: y, Z: z }; }
    return key.get(k);
  };
  const beam = (a, b, sect, matl = 1, angle = 0) => { ELEM[++eid] = { TYPE: "BEAM", MATL: matl, SECT: sect, NODE: [a, b, 0, 0, 0, 0, 0, 0], ANGLE: angle, STYPE: 0 }; };
  const plate = (type, ns, thk) => { ELEM[++eid] = { TYPE: type, MATL: 1, SECT: thk, NODE: [...ns, 0, 0, 0, 0], ANGLE: 0, STYPE: 1 }; };

  for (let s = 0; s < Z.length - 1; s++) {
    for (const x of X) for (const y of Y) {
      beam(node(x, y, Z[s]), node(x, y, Z[s + 1]), s < 2 ? 1 : 2, 1, x === 18 ? 90 : 0);
    }
  }
  for (let s = 1; s < Z.length; s++) {
    const z = Z[s], roof = s === Z.length - 1;
    for (const y of Y) for (let i = 0; i < X.length - 1; i++) {
      const m = node((X[i] + X[i + 1]) / 2, y, z); // analysis node at mid-span (secondary beam support)
      beam(node(X[i], y, z), m, roof ? 5 : 3);
      beam(m, node(X[i + 1], y, z), roof ? 5 : 3);
    }
    for (const x of X) for (let j = 0; j < Y.length - 1; j++) beam(node(x, Y[j], z), node(x, Y[j + 1], z), roof ? 5 : 4);
    if (roof) for (let i = 0; i < X.length - 1; i++) for (let j = 0; j < Y.length - 1; j++)
      plate("PLATE", [node(X[i], Y[j], z), node(X[i + 1], Y[j], z), node(X[i + 1], Y[j + 1], z), node(X[i], Y[j + 1], z)], 2);
  }
  // core wall on grid 1 between A and B, split into two panels per storey
  for (let s = 0; s < Z.length - 1; s++) for (const [y0, y1] of [[0, 3.75], [3.75, 7.5]])
    plate("WALL", [node(0, y0, Z[s]), node(0, y1, Z[s]), node(0, y1, Z[s + 1]), node(0, y0, Z[s + 1])], 1);
  // X bracing on grid C, middle bay, first storey
  beam(node(6, 15, 0), node(12, 15, 4), 6, 2);
  beam(node(12, 15, 0), node(6, 15, 4), 6, 2);

  const sector = (top, bot, bar, leg, dist, skin = "", skinN = 0) => ({ vMAIN_BAR_TOP: top.map(([NAME, NUM]) => ({ NAME, NUM })), vMAIN_BAR_BOT: bot.map(([NAME, NUM]) => ({ NAME, NUM })), SHEAR_BAR: { NAME: bar, LEG: leg, DIST: 0 }, SKIN_BAR_NAME: skin, SKIN_BAR_NUM: skinN });
  // support top/bottom, midspan top/bottom; stirrups closer at the supports
  const rebb = (sTop, sBot, mTop, mBot, bar, leg, dS, dM, skin, skinN) => {
    const end = { ...sector(sTop, sBot, bar, leg, dS, skin, skinN) }; end.SHEAR_BAR.DIST = dS;
    const mid = sector(mTop, mBot, bar, leg, dM, skin, skinN); mid.SHEAR_BAR.DIST = dM;
    return { ID: 0, BAR_SECTOR_I: end, BAR_SECTOR_M: mid, BAR_SECTOR_J: JSON.parse(JSON.stringify(end)), MAIN_BAR_DC_TOP: 0.06, MAIN_BAR_DC_BOT: 0.06, bSAME_SIZE_TOP_BOT: false, bSAME_SIZE_IMJ: false, bSAME_SIZE_LAYER: true };
  };
  const rect = (name, h, b, off = "CC") => ({ SECTTYPE: "DBUSER", SECT_NAME: name, SECT_BEFORE: { OFFSET_PT: off, SHAPE: "SB", DATATYPE: 2, SECT_I: { vSIZE: [h, b] } } });
  return {
    UNIT: { UNIT: { 1: { FORCE: "KN", DIST: "M", HEAT: "KJ", TEMPER: "C" } } },
    NODE: { NODE },
    ELEM: { ELEM },
    SECT: { SECT: {
      1: rect("K1 700x700", 0.7, 0.7), 2: rect("K2 600x600", 0.6, 0.6), 3: rect("B1 300x600", 0.6, 0.3, "CT"),
      4: rect("B2 350x700", 0.7, 0.35, "CT"), 5: rect("RB 250x500", 0.5, 0.25, "CT"),
      6: { SECTTYPE: "DBUSER", SECT_NAME: "BR P216.3x8.2", SECT_BEFORE: { SHAPE: "P", DATATYPE: 1, SECT_I: { DB_NAME: "JIS", SECT_NAME: "P 216.3x8.2" } } },
    } },
    THIK: { THIK: { 1: { NAME: "SW 250", TYPE: "VALUE", bINOUT: false, T_IN: 0.25 }, 2: { NAME: "S 150", TYPE: "VALUE", bINOUT: false, T_IN: 0.15 } } },
    MATL: { MATL: { 1: { TYPE: "CONC", NAME: "fc' 30" }, 2: { TYPE: "STEEL", NAME: "BJ 41" } } },
    // design rebar in the shape of /db/REBB (beams, per section) and /db/RCHK (columns, per element)
    REBB: { REBB: {
      3: { ITEMS: [rebb([["D19", 4], ["D19", 2]], [["D19", 3]], [["D19", 2]], [["D19", 4]], "D10", 2, 0.1, 0.15)] },
      4: { ITEMS: [rebb([["D22", 4], ["D22", 2]], [["D22", 3]], [["D22", 3]], [["D22", 5]], "D13", 3, 0.1, 0.15, "D13", 1)] },
      5: { ITEMS: [rebb([["D16", 3]], [["D16", 2]], [["D16", 2]], [["D16", 3]], "D10", 2, 0.125, 0.2)] },
    } },
    RCHK: { RCHK: Object.fromEntries(Object.entries(ELEM).filter(([, e]) => e.TYPE === "BEAM" && (e.SECT === 1 || e.SECT === 2)).map(([id, e]) => [id, {
      MEMBTYPE: "COLUMN", ENVTYPE: 0,
      COLM: { vLAYER: [{ INDEX: 1, dDc: 0.06, vPOSITION: e.SECT === 1 ? [{ POSITION: "P1", BAR_NUM: 6, BAR_NAME1: "D25" }, { POSITION: "P2", BAR_NUM: 6, BAR_NAME1: "D25" }] : [{ POSITION: "P1", BAR_NUM: 5, BAR_NAME1: "D22" }, { POSITION: "P2", BAR_NUM: 5, BAR_NAME1: "D22" }] }],
        SUB_BAR: { SUBBAR_NAME: "D13", SUBBAR_DIST: e.SECT === 1 ? 0.1 : 0.15, SUBBAR_NUM: 4, SUBBAR_NAME_Y: "D13", SUBBAR_NAME_Z: "D13", SUBBAR_NUM_Y: 4, SUBBAR_NUM_Z: 4 } },
    }])) },
    STOR: { STOR: Object.fromEntries(Z.map((z, i) => [i + 1, { STORY_NAME: STORY[i], STORY_LEVEL: z, bFLOOR_DIAPHRAGM: true }])) },
  };
}
