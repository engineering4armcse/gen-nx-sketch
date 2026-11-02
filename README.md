# Gen NX Sketch

Version 3.3. What changed in each version, and who asked for it, is in [CHANGELOG.md](CHANGELOG.md) and on the start page under *What changed in each version*.

Web app that reads a MIDAS Gen NX model through the MIDAS API and draws sketch plans and elevations for drafters.

- **Start page:** enter the project name and MAPI-Key, then *Load model from Gen NX*, *Open a model JSON* or *Try the demo model*. *Change project or model* in the sidebar brings it back.
- **Input:** base URL (default `https://moa-engineers.midasit.com:443/gen`) and your MAPI-Key (Gen NX > Apps > API Settings). Gen NX must be open with the model loaded.
- **Reads:** `/db/NODE`, `/db/ELEM`, `/db/SECT`, `/db/THIK`, `/db/STOR`, `/db/MATL`, `/db/UNIT` (read only).
- **Writes, only on "Send edits to Gen NX":** `/db/REBB` and `/db/REBC`, the edited rebar types (two presses; save the Gen NX model first).
- **Grid:** the Gen NX API has no grid table, so grid lines are made from column positions (and wall ends), merged within a tolerance. Numbers 1,2,3 along X and letters A,B,C along Y (I and O skipped). You can switch to manual grid coordinates.
- **Views:** one plan per story (from Story Data, or from beam levels if there is none) and one elevation per grid line.
- **Display:** monochrome drafting style, or colour by section with a legend. Section name labels can be turned on or off.
- **Exports:** PDF (current view or all views, A3 with title block and scale), DXF R12 (mm or m, layers, colours, linetypes and text styles of the office drawing standard STANDAR GAMBAR: SS00GG grid, SS00G3 beam edges, AS BALOK, SS00G5 columns, SS00H1/SS00H2 hatches, TEXT KOLOM/GIRDER/BEAM, DIM, REBAR; or one layer per section), and a standalone 3D HTML where hovering a member shows its section name.
- **Project file:** *Save project* (Ctrl+S) keeps the model, the rebar edits and the project settings in one `<Project>_project.json`. See *Saving projects* below.

## Rebar detail

- Reads Gen NX *Modify Beam Rebar Data* (`/db/REBB`), *Modify Column Rebar Data* (`/db/REBC`) and *Rebar Input for Checking* (`/db/RCHK`), drawn as schedule tables.
- A section with several rebar arrangements gets one type each, named `B2A3-A`, `B2A3-B`, ... Plans and elevations label those members by type.
- **Double-click** a member in a plan or elevation to open its rebar type (framed in red). Clicking a member in 3D does the same.
- **Edit rebar** (sidebar, Rebar detail tab): pick a type, or double-click a member or a table, change the bars and press Apply. Sections with no rebar in the model can be given some. **Use MIDAS rebar** puts the Gen NX data back for that type (or for all types). Edits are saved in the project file (`REBAR_USER`).

## Saving projects

- **Save project / Ctrl+S:** Chrome and Edge ask once where to save, then Ctrl+S overwrites that file. Other browsers (and phones) download it. **Save as… / Ctrl+Shift+S** writes a new file.
- **The file** is the Model JSON with two extra keys: `GNX_PROJECT` (id, name, saved at, revisions) and `GNX_SETTINGS` (project name, grid, display, text size, slab, DXF units). Gen NX tables and `REBAR_USER` stay at the top level, so older versions still open it. The MAPI-Key is never in the file.
- **Open project** takes a project file, an old Model JSON or a Gen NX database export.
- **Recent projects** on the start page (last 10, in this browser) reopen the file, or the browser copy if the file cannot be read. Unsaved work is autosaved in the browser and offered back with **Restore**.
- **Update model from Gen NX** (sidebar) reads a revised model for the open project, shows what changed, can save the current version first as `_R0.json`, keeps the settings and rebar edits, and lists what needs checking.

## Login (password)

Set the environment variable `APP_PASSWORD` and the site asks for that password before the app and the MIDAS proxy. Without it the site is open.

- Netlify: *Site configuration > Environment variables > Add a variable*: key `APP_PASSWORD`, value the team password. Redeploy (Deploys > Trigger deploy) after adding or changing it.
- Optional `APP_SECRET` (any long random text): changing it, or the password, logs everyone out.
- Local server: `APP_PASSWORD=yourpassword node server.mjs` (Windows cmd: `set APP_PASSWORD=yourpassword` then `node server.mjs`).
- The login lasts 30 days on each device; *Log out* is at the top right. `Gen-NX-Sketch-local.html` (file version) has no login.

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

The browser cannot call the MIDAS API directly because of CORS, so the app calls its own small proxy (`netlify/functions/midas.mjs`); the password gate is an edge function (`netlify/edge-functions/auth.js`, shared code in `auth.mjs`). `netlify.toml` already points Netlify at `public/` and both folders, with no build step. Drag-and-drop deploy at app.netlify.com/drop does **not** run functions, so use the CLI or a Git deploy:

```bash
npm install -g netlify-cli
netlify login
netlify init        # "Create & configure a new site"
netlify env:set APP_PASSWORD "your-team-password"
netlify deploy --build --prod
```

Or put this folder in a GitHub repository and use *Add new site > Import an existing project* on app.netlify.com; set `APP_PASSWORD` under Environment variables before the first deploy.

The proxy only relays `GET /db/<TABLE>` (and `PUT` on `/db/REBB`, `/db/REBC`) to `*.midasit.com` hosts and never stores the key. To allow another host (for example a local Gen NX at `localhost`), set the env var `ALLOWED_HOSTS=localhost`.

## Notes

- Drawings are centreline sketches from the analysis model. Check them before issue.
- Column size in plan uses `vSIZE` from the section, or the size in the section name (e.g. `H300x150x6.5/9`, `K1 600x600`) for DB sections. Column orientation follows the beta angle.
- Collinear beam segments of the same section split by intermediate nodes are joined into one line with one label.
- Libraries are bundled in `public/vendor` (three.js 0.147, jsPDF 2.5.1, MIT licence), so it also works offline.

## Files

- `public/index.html` is the page structure only. Styles are in `style.css`, the start-up check in `boot.js`, the logo in `logo.svg` and the interface icons in `icons.svg`.
- `public/app.js` runs the interface; `project.js` saves and opens project files, the browser copy and the revision summary; `core.js` (plans, elevations, DXF), `rebar.js`, `viewer3d.js`, `render.js` (SVG, PDF), `bundle.js` (HTML export), `zip.js`, `demo.js` and `changelog.js` are its modules.

## Version log

Every release adds an entry at the top of `public/changelog.js` (version, date, who requested it, who edited it, the changes) and bumps `VERSION` there; copy the same entry into `CHANGELOG.md`. The start page shows the list, so drafters can see what changed.
