# Changelog

Newest first. *Requested by* is who asked for the change, *edited by* who made it. The same list is in `public/changelog.js` and on the start page.

## 3.3.2 (2026-11-02)

Requested by Kevin · edited by Claude

- Start page: Open project is a large main button right under Load model from Gen NX (was a small link at the bottom).

## 3.3.1 (2026-11-02)

Requested by Kevin · edited by Claude

- Login page uses the app's colours and font: ink-black background, yellow Log in button, Geist, same layout as the start page (was white with a red button).

## 3.3 (2026-11-02)

Requested by Kevin · edited by Claude

- Save project (Ctrl+S) and Save as (Ctrl+Shift+S) replace Model JSON. The project file holds the Gen NX tables, the rebar edits and now also the project settings: project name, manual grid, grid tolerance, display, text size, slab thickness, beam top, red marks, DXF units. The MAPI-Key is never saved in it.
- Chrome and Edge write to the chosen file: the first save asks where, the next Ctrl+S overwrites the same file. Other browsers download the file. If the file was changed on disk after it was opened, Save asks before overwriting.
- Open project opens a project file, an old Model JSON (it becomes a project on the next save) or a Gen NX database export. A project file brings back all its settings.
- Start page: Recent projects (last 10, kept in this browser) open the file again, or the copy kept in the browser when the file cannot be read. A banner offers to restore changes that were not saved when the tab closed (autosave 2 s after each change).
- The model chip and the tab title show a dot while the project has unsaved changes; closing the tab then asks first.
- Update model from Gen NX: reads the model again for the open project, shows what changed (elements, nodes, sections, stories, Gen NX rebar), offers to save the current version first (_R0, _R1 ...), keeps the settings and rebar edits, lists edits whose section is gone, types whose rebar Gen NX also changed and columns off the manual grid, and records the revision in the file.
- Rebar edits follow the Gen NX arrangement they were made on, not only its position in the section, so a revision that adds or drops an arrangement does not move an edit to another type. Edits are kept per project (no longer shared between projects with the same section names).
- Login: set APP_PASSWORD on Netlify (or when starting node server.mjs) and the site asks for the password before the app and the MIDAS proxy; the login lasts 30 days on that device, Log out in the header. Works on phones.
- Netlify: netlify.toml now also deploys the password gate (netlify/edge-functions/auth.js).

## 3.2 (2026-10-29)

Requested by Kevin · edited by Claude

- Send edits to Gen NX: the status line says what is being sent and that Gen NX may show "Not Responding" while it updates the rebar, and at the end how long Gen NX took.

## 3.1 (2026-10-29)

Requested by Kevin · edited by Claude

- Edit rebar (beams): new choice "Rebar along the span": Each sector (I / midspan / J), Both ends (I = J) + midspan, or All span (one arrangement). Both ends shows one support block for I and J; All span shows one block for the whole beam. Apply copies it to the sectors it covers.
- The form opens on the choice that fits the type: All span when I, midspan and J are the same, Both ends when I = J.

## 3.0 (2026-10-29)

Requested by Kevin · edited by Claude

- Rebar detail > Edit rebar: new button "Send edits to Gen NX" writes the edited types to Modify Beam Rebar Data (REBB) and Modify Column Rebar Data (REBC) of the model open in Gen NX. Press twice to send; save the Gen NX model first.
- Each type rewrites only its own item of the section, in the Gen NX format (LAYER1/LAYER2 bars, DT/DB/DO covers, spacing in model units); sub-sections keep their elements. After sending, the tables are read back and each edit Gen NX now holds is cleared.
- Not sent: types from Rebar Input for Checking (per element) and a new type on a section that already has Gen NX rebar; the status line names them.
- The proxy (server.mjs / Netlify) still reads every table but now also relays PUT, only for /db/REBB and /db/REBC.
- Round columns: the bar count is read as the total (ROW no longer splits it), so the edit form shows e.g. 6 instead of 3.

## 2.9 (2026-10-29)

Requested by Kevin · edited by Claude

- Plans and elevations mark concrete beams that have no rebar detail yet: red label (colour 1 in the DXF) over a light red band, with a key "RED: BEAM WITHOUT REBAR DETAIL (n)" under the legend and under the scale in the DXF.
- New option in Drawing: "Mark beams without rebar detail (red)", on by default. A beam stops being red once its type gets rebar (Gen NX or Edit rebar).

## 2.8 (2026-10-28)

Requested by Arnold · edited by Claude

- Rebar types of one section are named from the section: the first type keeps its name (B2), the next ones are B2-A, B2-B ... (was B2-A, B2-B, B2-C).
- 3D labels and hover tips show the type name (B2, B2-A) as plans and elevations do.

## 2.7 (2026-10-27)

Requested by Kevin · edited by Claude

- DXF column and beam tables: cells are sized for ROMANS text, and every text carries width factor 0.8, so ties such as D10-100/150/100 stay inside their cells in CAD.
- Text sizes follow STANDAR GAMBAR (5. TEXT SIZE): text is 2 mm on paper times the scale (1:100 = 200, 1:150 = 300), titles 3 mm, grid bubbles 3 mm.
- Text size is now set in mm on paper (default 2, the standard). It replaces the px field, which gave 2.12 mm.
- Rebar tables: values ROMANS 2 mm and names / headers ROMAND 2.4 mm (50 and 60 at 1:25, as in the standard).
- Scales are taken from the standard's list only (1:20, 25, 40, 50, 75, 100, 150, 200, 250, 300, 400 ...). 1:125, 1:15 and 1:30 are no longer used.
- Legend table, notes and level names are 2 mm.

## 2.6 (2026-10-27)

Requested by Kevin · edited by Claude

- Rebar sections: the 135° hook is drawn with its bend at the stirrup corner and both legs running into the section, as in the office standard.
- Beam rebar tables list ground beams first (FG, FB, TB), then the other types alphabetically (B..., G...).
- Desktop shortcut: gen-nx-sketch-app.ico (app logo) and BUAT SHORTCUT DESKTOP.bat; BUKA INI.bat only opens the browser when the server is already running.

## 2.5 (2026-10-27)

Requested by Arnold · edited by Claude

- 3D toolbar in one compact row: view buttons, Plan and Elevation pickers, display icons, a Display menu (colour, grid, names, font, member types) and the Sections menu.
- The workspace fits one screen at any desktop size: the drawing scales into its pane and only the side panels scroll.

## 2.4 (2026-10-27)

Requested by Arnold · edited by Claude

- Elevation: column names sit beside the column outline instead of on top of its line.
- Beam top at floor level (top-centre), on by default: elevations and 3D hang every beam below its node, so the beam top meets the column top.
- 3D: the section list is a dropdown with a search box (name, size or material) and Show these / Hide these.
- Rebar detail: double-click a type in the tables to jump straight to Edit rebar with that type loaded.
- Plans draw steel and other shaped columns in their real section shape at any scale, not as a block.

## 2.3 (2026-10-27)

Requested by Arnold · edited by Claude

- Start page: a progress bar with a percentage fills table by table (nodes, elements, sections, rebar…) while the model is read from Gen NX.

## 2.2 (2026-10-27)

Requested by Arnold · edited by Claude

- Start page cut down to one centred card: logo, project name, MAPI-Key, connection settings and version history (Open JSON and Demo as small links).
- Elevations draw members at their real size like the plans: beams by their depth (offset point included), columns by their width.
- Text size is a number in px (8 px = the standard 2 mm text).
- Sheet legend is a table: type, size, material (also in the DXF).
- Manual grid is edited in a table per axis (label and coordinate), with add and remove.
- Beam plans show the columns going up from that floor (the 2F plan shows the 2F columns); the roof plan shows the columns below.
- Rebar sections: stirrup and tie hooks moved to the top right, as in the office's typical section.
- 3D: starts with perspective off and lines only; separate 3D, Plan and Elevation pickers.
- 3D and elevations hang beams with a top-centre offset (CT) below their node; the demo beams now use CT.
- index.html holds only the page structure: start-up check in boot.js, logo in logo.svg, icons in icons.svg.

## 2.1 (2026-10-27)

Requested by Arnold · edited by Claude

- Start page: enter the project name and MAPI-Key first, then load from Gen NX, open a JSON or try the demo.
- The sketch on the start page fills its title block with your project name as you type.
- New logo and a new look: ink and paper colours with safety-yellow actions, square-cut controls, no shadows.
- Version log on the start page (this list), also kept in CHANGELOG.md.
- Change model button in the sidebar brings the start page back without losing the loaded model.

## 2.0 (2026-10-26)

Requested by Arnold · edited by Claude

- Rebar detail tab: beam and column schedules from Gen NX (REBB, REBC, RCHK), one type per arrangement (B2A3-A, B2A3-B).
- Double-click a member in 2D, or click it in 3D, to open its rebar type.
- Edit rebar in the sidebar, with Use MIDAS rebar to go back; edits are saved in the Model JSON.
- DXF follows the office drawing standard STANDAR GAMBAR (layers, colours, linetypes, text styles).
- Output Sketch: one ZIP with PDF, DXF and HTML folders.
- Gen-NX-Sketch-local.html: the whole app in one file, no server needed (build-local.mjs).
- Three-column workspace with tabs for 2D sketch, Rebar detail and 3D model.

## 1.4 (2026-10-26)

Requested by Arnold · edited by Claude

- 2D plans draw columns in their real section shape (H, T, C, CC, L, pipe, box, round).
- Irregular (GEN) columns use the polygon stored in Gen NX instead of a square.

## 1.3 (2026-10-26)

Requested by Arnold · edited by Claude

- 3D: lines only except columns, plan and elevation views, extrude by section shape, perspective and extrude as icons, scroll to rotate.
- 2D: view picker in the middle with plan and elevation dropdowns, story labels on elevations, fine grey grid lines.
- 2D legend with size and material, colour by section or default, text size small, medium, large.

## 1.2 (2026-10-26)

Requested by Arnold · edited by Claude

- Collinear pieces of one Gen NX member (for example HC525 rafters) are joined into one labelled member.
- 3D toggles for section names, beams, columns, slabs and perspective.
- Separate column and beam plans, with the columns still shown on the beam plan; vertical dimensions no longer overlap lines.
- Show key button fixed; Model JSON and element list downloads after a successful load.

## 1.1 (2026-10-26)

Requested by Arnold · edited by Claude

- Interface cleanup: sentence-case titles, clearer labels, visible keyboard focus, better phone layout.

## 1.0 (2026-10-26)

Requested by Arnold · edited by Claude

- First version: reads a Gen NX model through the MIDAS API (read only) and draws a plan per story and an elevation per grid line.
- Grid from column positions when the model has none; manual grid coordinates.
- PNG, PDF, DXF and a 3D HTML where hovering a member shows its section.
