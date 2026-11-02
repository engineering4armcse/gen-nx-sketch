// Project files (3.3): one JSON holds the Gen NX tables, the rebar edits (REBAR_USER), the drawing settings (GNX_SETTINGS)
// and who/when (GNX_PROJECT). The tables stay at the top level, so a project file still opens as a plain Model JSON in
// older versions, and an old Model JSON opens here as a project without settings.
// Saving: Chrome / Edge write to the chosen file (File System Access API; Ctrl+S overwrites it), other browsers download.
// A copy of every open project is kept in this browser (IndexedDB) for "Recent projects" and to restore unsaved work.

export const FORMAT = "gnx-sketch-project", FORMAT_VERSION = 1;
export const META_KEYS = ["GNX_PROJECT", "GNX_SETTINGS"];

export const newId = () => "p-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 8);
export const canPickFiles = () => typeof window.showSaveFilePicker === "function" && typeof window.showOpenFilePicker === "function";

// ---------- file <-> project ----------
// -> { raw (tables + REBAR_USER), project (GNX_PROJECT or null), settings (GNX_SETTINGS or null) }
export function readProject(json) {
  let raw = json;
  // a full Gen NX database export {"DBG": {"NODE": {...}, ...}}: give each table its usual {"NODE": {...}} wrapper
  if (raw.DBG && !raw.NODE) raw = Object.fromEntries(Object.entries(raw.DBG).map(([k, v]) => [k, { [k]: v }]));
  const project = raw.GNX_PROJECT && raw.GNX_PROJECT.format === FORMAT ? raw.GNX_PROJECT : null;
  const settings = project ? raw.GNX_SETTINGS || {} : null;
  const tables = Object.fromEntries(Object.entries(raw).filter(([k]) => !META_KEYS.includes(k)));
  return { raw: tables, project, settings, newer: !!project && +project.formatVersion > FORMAT_VERSION };
}
export function buildProject(raw, project, settings, appVersion) {
  return { GNX_PROJECT: { ...project, format: FORMAT, formatVersion: FORMAT_VERSION, appVersion, savedAt: new Date().toISOString() }, GNX_SETTINGS: settings, ...raw };
}

// ---------- browser copy (IndexedDB) ----------
const DB = "gnx-sketch", STORE = "projects", KEEP = 10;
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((ok, no) => {
    if (!window.indexedDB) return no(new Error("no IndexedDB"));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((ok, no) => { const t = d.transaction(STORE, mode), s = t.objectStore(STORE), r = fn(s); t.oncomplete = () => ok(r?.result); t.onerror = () => no(t.error); });
}
// rec: { id, name, fileName, handle?, savedAt?, changedAt, unsaved, data }
export async function putRecent(rec) {
  try {
    const old = (await getRecent(rec.id)) || {};
    // a handle that cannot be stored (some browsers) is dropped; the copy of the data is enough to reopen
    const next = { ...old, ...rec, seenAt: Date.now() };
    try { await tx("readwrite", s => s.put(next)); } catch { delete next.handle; await tx("readwrite", s => s.put(next)); }
    const all = await listRecent();
    for (const r of all.slice(KEEP)) await tx("readwrite", s => s.delete(r.id));
  } catch {}
}
export async function getRecent(id) { try { return await tx("readonly", s => s.get(id)); } catch { return null; } }
export async function delRecent(id) { try { await tx("readwrite", s => s.delete(id)); } catch {} }
// newest first, without the data (the list only needs names and times)
export async function listRecent() {
  try { return ((await tx("readonly", s => s.getAll())) || []).sort((a, b) => b.seenAt - a.seenAt); } catch { return []; }
}

// ---------- files on disk ----------
async function writable(handle) {
  const o = { mode: "readwrite" };
  if (handle.queryPermission && (await handle.queryPermission(o)) === "granted") return true;
  return handle.requestPermission ? (await handle.requestPermission(o)) === "granted" : true;
}
export async function readable(handle) {
  const o = { mode: "read" };
  if (handle.queryPermission && (await handle.queryPermission(o)) === "granted") return true;
  return handle.requestPermission ? (await handle.requestPermission(o)) === "granted" : true;
}
export async function writeHandle(handle, text) {
  if (!(await writable(handle))) throw new Error("Permission to write the file was not given");
  const w = await handle.createWritable(); await w.write(text); await w.close();
  return (await handle.getFile()).lastModified;
}
const TYPES = [{ description: "Gen NX Sketch project", accept: { "application/json": [".json"] } }];
// -> handle, or null when the person closed the dialog
export async function pickSaveFile(suggestedName) {
  try { return await window.showSaveFilePicker({ suggestedName, types: TYPES, id: "gnx-project" }); }
  catch (e) { if (e.name === "AbortError") return null; throw e; }
}
export async function pickOpenFile() {
  try { const [h] = await window.showOpenFilePicker({ types: TYPES, id: "gnx-project", multiple: false }); return h; }
  catch (e) { if (e.name === "AbortError") return null; throw e; }
}

// ---------- model revision: what changed between two sets of Gen NX tables ----------
const tab = (raw, t) => { const o = raw?.[t] || {}; return o[t] && typeof o[t] === "object" ? o[t] : o; };
export function diffModels(a, b) {
  const keys = t => new Set(Object.keys(tab(a, t))), keysB = t => new Set(Object.keys(tab(b, t)));
  const ea = keys("ELEM"), eb = keysB("ELEM");
  const sn = raw => new Set(Object.values(tab(raw, "SECT")).map(s => String(s.SECT_NAME ?? s.NAME ?? "")).filter(Boolean));
  const sa = sn(a), sb = sn(b), na = tab(a, "NODE"), nb = tab(b, "NODE");
  let moved = 0;
  for (const [id, n] of Object.entries(nb)) { const o = na[id]; if (o && (Math.abs(o.X - n.X) > 1e-6 || Math.abs(o.Y - n.Y) > 1e-6 || Math.abs(o.Z - n.Z) > 1e-6)) moved++; }
  let changedElems = 0; const A = tab(a, "ELEM"), B = tab(b, "ELEM");
  for (const id of eb) if (ea.has(id) && JSON.stringify(A[id]) !== JSON.stringify(B[id])) changedElems++;
  const rebar = ["REBB", "REBC", "RCHK"].filter(t => JSON.stringify(tab(a, t)) !== JSON.stringify(tab(b, t)));
  return {
    elemsAdded: [...eb].filter(x => !ea.has(x)).length, elemsRemoved: [...ea].filter(x => !eb.has(x)).length, elemsChanged: changedElems,
    nodesMoved: moved, sectsAdded: [...sb].filter(x => !sa.has(x)), sectsRemoved: [...sa].filter(x => !sb.has(x)),
    stories: [Object.keys(tab(a, "STOR")).length, Object.keys(tab(b, "STOR")).length], rebarTables: rebar,
  };
}
export function diffText(d) {
  const p = [];
  if (d.elemsAdded) p.push(`+${d.elemsAdded} elements`);
  if (d.elemsRemoved) p.push(`−${d.elemsRemoved} elements`);
  if (d.elemsChanged) p.push(`${d.elemsChanged} elements changed`);
  if (d.nodesMoved) p.push(`${d.nodesMoved} nodes moved`);
  if (d.sectsAdded.length) p.push(`new sections ${d.sectsAdded.join(", ")}`);
  if (d.sectsRemoved.length) p.push(`sections removed ${d.sectsRemoved.join(", ")}`);
  if (d.stories[0] !== d.stories[1]) p.push(`stories ${d.stories[0]} → ${d.stories[1]}`);
  if (d.rebarTables.length) p.push(`Gen NX rebar changed (${d.rebarTables.join(", ")})`);
  return p.length ? p.join(" · ") : "no change in the model";
}
