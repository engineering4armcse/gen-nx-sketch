# Gen NX Sketch

Version 3.21. What changed in each version, and who asked for it, is in [CHANGELOG.md](CHANGELOG.md) and on the start page under *What changed in each version*.

Web app that reads a MIDAS Gen NX model through the MIDAS API and draws sketch plans and elevations for drafters.

- **Start page:** enter the project name and MAPI-Key, then *Load model from Gen NX*, *Open a model JSON* or *Try the demo model*. *Change project or model* in the sidebar brings it back.
- **Input:** base URL (default `https://moa-engineers.midasit.com:443/gen`) and your MAPI-Key (Gen NX > Apps > API Settings). Gen NX must be open with the model loaded.
- **Reads:** `/db/NODE`, `/db/ELEM`, `/db/SECT`, `/db/THIK`, `/db/STOR`, `/db/MATL`, `/db/UNIT` (read only).
- **Writes, only on "Send edits to Gen NX":** `/db/REBB` and `/db/REBC`, the edited rebar types (two presses; save the Gen NX model first).
- **Grid:** the Gen NX API has no grid table, so grid lines are made from column positions (and wall ends), merged within a tolerance. Numbers 1,2,3 along X and letters A,B,C along Y (I and O skipped). You can switch to manual grid coordinates.
- **Views:** one plan per story (from Story Data, or from beam levels if there is none) and one elevation per grid line.
- **Display:** monochrome drafting style, or colour by section with a legend. Section name labels can be turned on or off.
- **Exports:** PDF (current view or all views, A3 with title block and scale), DXF R12 (mm or m, layers, colours, linetypes and text styles of the office drawing standard STANDAR GAMBAR: SS00GG grid, SS00G3 beam edges, AS BALOK, SS00G5 columns, SS00H1/SS00H2 hatches, TEXT KOLOM/GIRDER/BEAM, DIM, REBAR; or one layer per section), and a standalone 3D HTML where hovering a member shows its section name.
- **Model JSON:** saves the fetched model so you can reopen it later without the API.

## Rebar detail

- Reads Gen NX *Modify Beam Rebar Data* (`/db/REBB`), *Modify Column Rebar Data* (`/db/REBC`) and *Rebar Input for Checking* (`/db/RCHK`), drawn as schedule tables.
- A section with several rebar arrangements gets one type each, named `B2A3-A`, `B2A3-B`, ... Plans and elevations label those members by type.
- **Double-click** a member in a plan or elevation to open its rebar type (framed in red). Clicking a member in 3D does the same.
- **Edit rebar** (sidebar, Rebar detail tab): pick a type, or double-click a member or a table, change the bars and press Apply. Sections with no rebar in the model can be given some. **Use MIDAS rebar** puts the Gen NX data back for that type (or for all types). Edits are saved in the Model JSON (`REBAR_USER`) and in the browser.

## Output Sketch

The **Output Sketch** button saves one ZIP with every drawing:
`<Project>_Sketch/PDF/` (one PDF per drawing type), `DXF/` (one DXF per drawing type) and `HTML/` (the 2D, rebar and 3D views in one file).

## Local file version (no server)

`Gen-NX-Sketch-local.html` is the whole app in one file: double-click it, no Node.js needed, works offline with **Open JSON** and the demo model. Without the server there is no API proxy, so **Load model from Gen NX** only works if the browser is allowed to call the API directly; otherwise save a Model JSON with the server version (or export it from Gen NX) and open that. After changing files in `public/`, rebuild it with `node build-local.mjs`.

## Run on your computer (quickest)

Needs Node.js 18 or newer. No `npm install` needed.

```bash
node server.mjs
```

Open http://localhost:8080. The local server also contains the API proxy.

## Deploy to Netlify

The browser cannot call the MIDAS API directly because of CORS, so the app calls its own small proxy (`netlify/functions/midas.mjs`). Drag-and-drop deploy at app.netlify.com/drop does **not** run functions, so use the CLI or a Git deploy:

```bash
npm install -g netlify-cli
netlify login
netlify init        # "Create & configure a new site"
netlify deploy --build --prod
```

The proxy only relays `GET /db/<TABLE>` (and `PUT` on `/db/REBB`, `/db/REBC`) to `*.midasit.com` hosts and never stores the key. To allow another host (for example a local Gen NX at `localhost`), set the env var `ALLOWED_HOSTS=localhost`.

## Notes

- Drawings are centreline sketches from the analysis model. Check them before issue.
- Column size in plan uses `vSIZE` from the section, or the size in the section name (e.g. `H300x150x6.5/9`, `K1 600x600`) for DB sections. Column orientation follows the beta angle.
- Collinear beam segments of the same section split by intermediate nodes are joined into one line with one label.
- Libraries are bundled in `public/vendor` (three.js 0.147, jsPDF 2.5.1, MIT licence), so it also works offline.

## Files

- `public/index.html` is the page structure only. Styles are in `style.css`, the start-up check in `boot.js`, the logo in `logo.svg` and the interface icons in `icons.svg`.
- `public/app.js` runs the interface; `core.js` (plans, elevations, DXF), `rebar.js`, `shop.js` (shop drawing sheets and bar bending schedule by the standard detail), `viewer3d.js`, `render.js` (SVG, PDF), `bundle.js` (HTML export), `zip.js`, `demo.js` and `changelog.js` are its modules.

## Version log

Every release adds an entry at the top of `public/changelog.js` (version, date, who requested it, who edited it, the changes) and bumps `VERSION` there; copy the same entry into `CHANGELOG.md`. The start page shows the list, so drafters can see what changed.
