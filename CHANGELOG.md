# Changelog

Newest first. *Requested by* is who asked for the change, *edited by* who made it. The same list is in `public/changelog.js` and on the start page.

## 3.33 (2026-11-13)

Requested by Arnold · edited by Claude

- Rebar detail > beam sections: ground beams (FG / FB / TB) follow the office's typical detail. Brick walls each side of the web with a green outline and 45° hatch; under the beam, top to bottom, lean concrete (lantai kerja 50, concrete hatch), backfill sand (pasir urug 100, sand dots) and compacted soil (tanah dipadatkan 150, herringbone hatch), each in a red outline.
- Stirrups and ties wrap the corner bars (corner radius = bar radius + half the stirrup), and both ends of the 135° hook bend round the top corner main bar and run max(6 db, 75 mm) inward, so the hook holds the bar.
- Inner stirrup legs (beams) and cross ties (columns) are hooked 135° round a main bar at both ends.

## 3.32 (2026-11-11)

Requested by Arnold · edited by Claude

- Fixed "Out of Memory" when loading a model with stirrups or ties without spacing (DIST 0 or 1e-6); they are left out of the shop drawings and BBS and named in the rebar note.
- Bars with a lap longer than the stock length no longer loop when split.

## 3.31 (2026-11-11)

Requested by Arnold · edited by Claude

- One Save project button (Ctrl+S) that always downloads `<Project>_project.json`. Save as… removed.
- Open JSON file uses the browser's plain file dialog.
- Element list CSV removed.

## 3.30 (2026-11-11)

Requested by Arnold · edited by Claude

- Start page: choose From Gen NX (API) or From a JSON file; each shows only its own fields and button. The choice is remembered.
- Opening a JSON file no longer fails silently: if the file dialog cannot open, the page says so and offers the other dialog. A JSON file can be dropped on the start page. Wrong files say why.
- Concrete Design (paste) chosen on the start page also applies when a JSON file is opened.

## 3.29 (2026-11-11)

Requested by Arnold · edited by Claude

- "The app did not start" now says why: which app file is missing (e.g. design.js, added in 3.26, when a folder was only partly updated), whether index.html is older than app.js, and the script error itself. It is checked when the page has finished loading instead of after 3 seconds, so a slow connection no longer shows the message while the app is still loading, and it is cleared if the app starts late.

## 3.28 (2026-11-04)

Requested by Arnold · edited by Claude

- Concrete Design with Member Assignment, take 2: Gen NX lists each assigned member under the number of one of its elements (member 240-246 as "240"), not under the member number. A row whose element belongs to an assigned member now covers every element of that member (TB46-C along the whole span instead of TB46 in red on 241-246). Rows designed per element (several rows in one member) keep their own element. Checked on VIHARA KOSAMBI: all 1475 concrete beams get a type.

## 3.27 (2026-11-04)

Requested by Arnold · edited by Claude

- Concrete Design rebar with Member Assignment: MEMB in the pasted Beam / Column Design table is now read as the design member (all its elements) when members were assigned in Gen NX, decided for the whole table by which reading matches the sections. Before, a member's bars went only to the element that happened to have the same number, so the rest of the member showed the plain section name in red (e.g. TB46 instead of TB46-C, G613 instead of G613-B).

## 3.26 (2026-11-04)

Requested by Arnold · edited by Claude

- Rebar source for beams and for columns, each on its own: the rebar tables (Modify Beam / Column Rebar Data, Rebar Input for Checking) as before, or the Gen NX Concrete Design output. Chosen on the start page next to the MAPI-Key (Beam rebar from / Column rebar from); with Concrete Design a dialog opens after the model is read to paste the result tables. Later: Rebar source… in the Model panel.
- Beam Design table (Design > Concrete Code Design > Beam Design, Ctrl+A, Ctrl+C in the result table): top and bottom bars and stirrups at I, M and J of each member; "6-2-D19" = two layers of 6 and 2 D19, "2-D10 @280" = 2 legs D10 at 280 mm; Failure rows are counted and drawn without stirrups.
- Column Design table: main bars "18-5-D22" = 18 D22 in all, 5 on each face along H (as NUM / ROW in Modify Column Rebar Data); ties "5-D13 @320" = 5 legs of D13 at the ends and at mid-height.
- MEMB is read as the element id (design per element), or as the design member and its elements when the section only matches that way. Elements of one section with different designed bars become separate types (B2A3, B2A3-A, B2A3-B ...), in the plans, sections, schedule, shop drawings and BBS.
- The pasted tables are kept in the project file (CDESIGN) and stay through Update model from Gen NX; paste again after a new design run. Rebar edits made here still apply on top.

## 3.25 (2026-11-04)

Requested by Arnold · edited by Claude

- Fixed the error "Cannot read properties of undefined (reading 'sect')" when building the beam shop drawings (a span with no element of its own, e.g. two supports at the same point). The same line passed a section number where the rebar type was expected, so every beam in the shop drawings and the BBS was drawn and measured as 300 x 500 instead of its own section: now each span uses its real B x H (stirrup and bar lengths in the BBS change with it).
- Model unit: when the model has no unit (Gen NX did not return the UNIT table, or a file saved without it) the app no longer assumes metres, which drew a model in mm 1000 times too large. It guesses M, CM or MM from the section sizes (or the element lengths) and says so in red next to the unit in the Model panel.

## 3.24 (2026-11-04)

Requested by Arnold · edited by Claude

- Rebar detail: Beam plans: main bars, Beam plans: stirrups and Beam sections no longer disappear when the model has no beam rebar (Gen NX Modify Beam Rebar Data / Rebar Input for Checking empty). They stay in the row with 0 sheets and say why they are empty and how to add the rebar; if reading the beam rebar (REBB) from Gen NX failed, the error is shown there too.

## 3.23 (2026-11-02)

Requested by Kevin · edited by Claude

- PDF and DXF export: new choice between This view and All views that exports only the sheets of the drawing type picked above, e.g. "Column schedule & sections (6 sheets)" or "Beam plans: stirrups". The file is named after that drawing type.

## 3.22 (2026-11-02)

Requested by Arnold · edited by Claude

- Merged in Kevin's versions 3.3 to 3.3.2 (made in parallel from 3.2): project files, recent projects, model revisions, login, and the items below.
- Save project (Ctrl+S) and Save as (Ctrl+Shift+S) replace Model JSON. The project file holds the Gen NX tables, the rebar edits and now also the project settings: project name, manual grid, grid tolerance, display, text size, slab thickness, beam top, red marks, DXF units. The MAPI-Key is never saved in it.
- Chrome and Edge write to the chosen file: the first save asks where, the next Ctrl+S overwrites the same file. Other browsers download the file. If the file was changed on disk after it was opened, Save asks before overwriting.
- Open project opens a project file, an old Model JSON (it becomes a project on the next save) or a Gen NX database export. A project file brings back all its settings.
- Start page: Recent projects (last 10, kept in this browser) open the file again, or the copy kept in the browser when the file cannot be read. A banner offers to restore changes that were not saved when the tab closed (autosave 2 s after each change).
- The model chip and the tab title show a dot while the project has unsaved changes; closing the tab then asks first.
- Update model from Gen NX: reads the model again for the open project, shows what changed (elements, nodes, sections, stories, Gen NX rebar), offers to save the current version first (_R0, _R1 ...), keeps the settings and rebar edits, lists edits whose section is gone, types whose rebar Gen NX also changed and columns off the manual grid, and records the revision in the file.
- Rebar edits follow the Gen NX arrangement they were made on, not only its position in the section, so a revision that adds or drops an arrangement does not move an edit to another type. Edits are kept per project (no longer shared between projects with the same section names).
- Login: set APP_PASSWORD on Netlify (or when starting node server.mjs) and the site asks for the password before the app and the MIDAS proxy; the login lasts 30 days on that device, Log out in the header. Works on phones.
- Netlify: netlify.toml now also deploys the password gate (netlify/edge-functions/auth.js).
- Login page uses the app's colours and font: ink-black background, yellow Log in button, Geist, same layout as the start page (was white with a red button).
- Start page: Open project is a large main button right under Load model from Gen NX (was a small link at the bottom).

## 3.21 (2026-11-02)

Requested by Arnold · edited by Claude

- Column schedule: main bars and ties coloured by bar size (as the rebar plans), with the colour legend in the notes.

## 3.20 (2026-11-02)

Requested by Arnold · edited by Claude

- Column rebar plans: main bars and ties coloured by bar size (same colours as the beam rebar plans), with the colour legend in the notes; column type in bold.
- Column rebar plans: each label is tried at the four corners of its column, clear of other labels, columns and the grid dimensions, and pushed further out with a thin leader to the column when crowded.

## 3.19 (2026-11-02)

Requested by Arnold · edited by Claude

- Fix: the drawing-type buttons above the drawing now switch the type (they stayed on the first one in 3.18).

## 3.18 (2026-11-02)

Requested by Arnold · edited by Claude

- Rebar detail tab has its own column plans (Column plans): each column with its main bars and ties under its name. The 2D sketch column plans show the column names only again.
- Easier navigation: the drawing types of each tab are a row of buttons above the drawing (with the number of sheets), then the sheet list with previous / next. Rebar detail: Column plans, Column schedule & sections, Beam plans: main bars, Beam plans: stirrups, Beam sections. Shop drawing: Column, Beam, Bar bending schedule. Sheet names no longer repeat the drawing type.
- Output Sketch: file names in the ZIP start with the tab (Sketch - / Rebar - / Shop -).

## 3.17 (2026-11-02)

Requested by Arnold · edited by Claude

- Column plans: the main bars and ties of each column (Gen NX column rebar data) are written under its name, e.g. K5-78 / 16D25 / D10-230; ties end / middle / end when the data has them.
- Column schedule: each run also lists its main bars and ties under type, size and concrete; a change of rebar up the building starts a new run, and positions are only merged when their rebar is the same too.

## 3.16 (2026-11-02)

Requested by Arnold · edited by Claude

- Beam rebar plans (main bars and stirrups): a label that would overlap first slides along its own span and may shrink one step (75 %, not below 1.2 mm) before it is pushed away from its line, so labels stay next to their own beam. Shorter beams are labelled first; a label is also kept off the other beam lines of the same direction.
- Beam plans: on a short beam the type name gets smaller (down to 60 %) so it stays within the beam.

## 3.15 (2026-11-02)

Requested by Arnold · edited by Claude

- Grid lines: even dashes (no more long-short dash-dot), on screen, in the PDF and in the DXF (layer SS00GG, linetype DASHED).

## 3.14 (2026-11-02)

Requested by Arnold · edited by Claude

- Grid lines are thin dash-dot lines; their strength is set with Drawing > Grid line strength (10-100 %, default 60 %).
- Beam rebar plans: on a short beam the text gets smaller (down to 1.2 mm) so it fits the clear span; a piece too short for its text (e.g. inside a column) is left bare when the piece next to it reads the same.
- Plan labels also keep clear of columns and of the grid dimensions; a stirrup label that cannot clear on its own side goes to the other side of the line.

## 3.13 (2026-11-02)

Requested by Arnold · edited by Claude

- Stirrup plan: one text per span with the size always written and the spacing at I-end / midspan / J-end, e.g. D10-100/150/100 (D10-100/100/100 when the same along the span); more than 2 legs as legs / 2 in front of the size (3 legs: 1.5D13-100/150/100, 4 legs: 2D13-...). Skin bars below the line. Colour legend reads 'D13 BARS IN THIS COLOUR'.

## 3.12 (2026-11-02)

Requested by Arnold · edited by Claude

- Beam rebar plans: support values start just clear of the column or wall face (no longer hidden under the column), reading away from it.
- Labels that would overlap are pushed further from their line, with a thin leader back to it; midspan labels are placed first.
- Each bar size other than the main one has its own colour (D16 green, D19 blue, D25 red, D13 cyan, D29 orange, D32 purple), with a colour legend in the notes; in the DXF each size is on its own layer (TEXT REBAR D19 ...).

## 3.11 (2026-11-02)

Requested by Arnold · edited by Claude

- Beam rebar plans split by direction: X and Y on separate sheets per level (BEAM REBAR PLAN (MAIN BARS) - X DIRECTION - 2F); beams of the other direction drawn thin grey for reference.
- Type names in bold (ROMAND in the DXF, bold in PDF and on screen). Support values near the ends only when they differ from midspan; a span with the same bars all along shows the midspan text only.
- The main bar size is one for the whole project (the most used, e.g. D22) and is never written on the plan, only in the notes: counts only (5 / 3); other sizes written out in magenta (6D25). Same for the stirrup size.

## 3.10 (2026-11-02)

Requested by Arnold · edited by Claude

- Beam rebar plans laid out like the office sample: at midspan the type, the midspan top bars above the line and the bottom bars below, with their size (3D22 / 6D22); near each end the support bars, top above and bottom below, as one count of all layers (no +), with the size only when it differs from midspan. Stirrup plan the same: D10-150 at midspan, 100 near the ends, skin bars below. I and J follow the drawing direction.

## 3.9 (2026-11-02)

Requested by Arnold · edited by Claude

- Rebar detail: new Beam rebar plans per level (the stories and the heights between them), in two sets: MAIN BARS (type and top bars above each span, bottom bars below, counts at I-end / midspan / J-end, + for the next layer) and STIRRUPS & SKIN (spacing at I / midspan / J, legs when more than 2, skin bars each side). Beams as single lines, one label per span.
- Each plan states its usual bar size once in the notes (MAIN BARS D19 UNLESS NOTED, STIRRUPS D10 UNLESS NOTED); any other size is written out (7+2/7/7+2 D22) in magenta, on layer TEXT REBAR KHUSUS in the DXF. Notes sit above the title block (and under the drawing in the DXF).

## 3.8 (2026-10-30)

Requested by Arnold · edited by Claude

- Beam plans: level beams between the stories (stair landings / bordes, canopies) get a plan of their own, named by the stories either side and the elevation (BEAM PLAN - 2F-3F (EL. +9.300)), instead of stacking on the plan of the story above. Sloped beams (rafters) still show on the first story at or above their top.

## 3.7 (2026-10-29)

Requested by Arnold · edited by Claude

- Shop drawing tab now draws the sheets, by the standard detail (STD T-01 to T-11): Beam shop drawings per beam line and level, Column shop drawings per column stack, and Bar bending schedule. Each sheet exports as PDF and DXF (open the DXF in AutoCAD and save as DWG) and goes into Output Sketch.
- Laps, development and hooked anchorage (ld, ls, ldh) from Table 1.5 (TS-420B) by concrete grade: fc' is read from each member's material name (Fc30, C30, K-300), or set for all in the fc' box.
- Beam sheet: elevation with column stubs, stirrup zones A = max(0.25 Ln, 2H) with spacing, exploded top and bottom bars with marks and cut lengths, support extras 0.33 Ln, midspan extras, end hooks F + G >= 40db, top splices at midspan and bottom splices outside 2H, web bars by 4.2, grid bubbles, spans, keyplan and BBS (MARK, BENTUK, DIA, PANJANG, JUMLAH, TOTAL, BERAT). Identical lines on other levels share one sheet. Short lines at 1:25, long ones at 1:50 over several sheets with match lines and the BBS on its own sheet.
- Column sheet: elevation over all stories with levels, beams, Ln, tie zones B = max(b, h, 500, Ho/6) and ties at <= 100 along the laps, exploded main bars (starter 40db with a 15db foot, laps at mid-height, top hook into the beam), section table per type at 1:30 (TABEL PENULANGAN KOLOM), keyplan and BBS.
- The Bar bending schedule tables and BBS CSV now come from the sheets, so their numbers match the drawings. Each beam line or column stack has a Sheet button that opens its drawing.
- Long drawing titles wrap to two lines in the title block. Off-grid lines are named from the nearest grid (3 +1625).

## 3.6 (2026-10-29)

Requested by Arnold · edited by Claude

- New tab Shop drawing (after 3D model): bar bending schedule per beam type and per column type, with mark, bar, shape sketch, cutting length, bars per span / column, number of spans / columns, total length and weight.
- Beams are split into spans between columns, walls or crossing beams; continuous top and bottom bars, support extras (top Ln/3, bottom Ln/4), midspan extras, stirrups by zone (I / midspan / J) and cross ties, skin bars.
- Columns per story height: main bars lapped above when the column continues, hooked into the beam at the top; hoops with lo end zones and cross ties.
- Totals per bar size (beams, columns, with waste, number of stock bars). Lap (d), hook (d), stock length and waste are set in the bar; BBS CSV exports every row for Excel.
- 3D > Sections: ticking or unticking a section now takes effect with the new Apply button (ticked shown, the rest hidden); Show these / Hide these still act on the sections the search lists.

## 3.5 (2026-10-29)

Requested by Arnold · edited by Claude

- Column rotation in plans and elevations: a column modelled top to bottom (i node above j) turns its β the other way, as Gen NX and the 3D view do. K7 / K7A now sit parallel to the K8 next to them.

## 3.4 (2026-10-29)

Requested by Arnold · edited by Claude

- Column schedule: one line per column position (same x, y). A column that changes size up the building (K1-95x95 to K1-88, or concrete to H) stays on one line, each run at its own width and labelled with its type, size and material; positions with the same types on the same levels are shown once, and the box under the line lists the types, top first.
- Short runs stack their labels upward so they never overlap.
- Legend: wider SIZE column, so steel designations (H 400x400x13/21) and long type names show in full (PDF); the DXF legend columns fit their longest text.
- Column plans: a concrete column that stops under a steel column is drawn as an empty box under the H, as a column that stops.

## 3.3 (2026-10-29)

Requested by Arnold · edited by Claude

- Rebar detail > Column rebar: new COLUMN SCHEDULE sheet. Every column type side by side, drawn at its width from the level it starts on to the level it stops at, with the levels, story heights, size and material, and the type name boxed under the base. Also in the PDF and DXF.
- Legend SIZE follows the section type Gen NX gives: the DB designation for catalogue sections (H 350x175x7/11, P 216.3x8.2), the shape and plates for user steel sections, B x H for concrete.
- 3D > Display: "Rebar detail on hover" turns the rebar table in the hover tip off (the section tip stays).

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
