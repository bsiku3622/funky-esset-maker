# Funky Esset Maker

A set of web tools for making visual assets you can drop straight into slides, handouts, and papers — code listings, equations, tables, data structures, graphs, charts — all wearing the same [`@studio-baeks/funky-ui`](https://www.npmjs.com/package/@studio-baeks/funky-ui) neo-brutalist look, and exported as PNG.

## Tools

| Tool | What it makes |
| --- | --- |
| **Highlighter** | Syntax-highlighted code (Prism.js) |
| **LaTeX Imager** | Equations and prose (KaTeX) |
| **Tabler** | Tables |
| **DS Visualizer** | Data structures |
| **Grapher** | Graphs and diagrams |
| **AI Figure Maker** | Model architecture figures for papers (vector SVG · LaTeX) |
| **Cartesian Plotter** | Function plots |
| **Chart Maker** | Bar · line · pie · scatter |
| **Number Line** | Number lines, intervals, inequalities |
| **Truth Table** | Truth tables |
| **HWP Math** | LaTeX ↔ 한글(HWP) equation script |

The tool you used last is remembered in `localStorage` and reopens on your next visit.

HWP Math is the odd one out: its output is text, not a picture. 한글's equation
editor has its own language — `{a} over {b}` for a fraction, no backslashes,
spaces as term boundaries — so a Korean document cannot take LaTeX directly, and
equations pasted out of one are not LaTeX either. It converts both ways, parsing
each side properly rather than running a table of substitutions over it: going
out, `\frac{a}{b}` needs its two arguments found before `over` can go between
them; coming back, `over` is an infix operator that takes exactly one term on
each side, which is why `10a^3 over b^2 times c` is (10a³/b²)×c and not
10a³/(b²×c). Whatever it has to approximate, it lists, instead of silently
producing something that renders wrong.

Having both directions means the 한글 script can be drawn too: it is read back
into LaTeX and handed to KaTeX, so both panes show their own contents rendered.
Put them side by side and anything the conversion lost is visible rather than
merely reported. (It is this tool's reading of the script, not 한글's — a blind
spot shared by both directions would agree with itself.)

Coverage is measured rather than assumed: 95% of the 496 commands KaTeX knows
convert to 한글, and every name in the reference 한글 table converts back.
한글's symbol palette is much smaller than LaTeX's, so where no command name
exists the character itself goes in — which is what Hancom's own spec does for
symbols it has no name for — and those are listed together, since a glyph
missing from the equation font shows up as a box.

## Two looks

Everything has a **paper mode** alongside the funky one, switched in the sidebar and applied to every tool at once:

| | funky | paper |
| --- | --- | --- |
| for | slides, handouts | papers, journals, reports |
| lines | 2–3px black, hard shadows | hairlines, no shadow |
| type | Pretendard, bold labels | Times / Helvetica, no bold data labels |
| colour | neon | Okabe–Ito (colour-vision-safe) |
| tables | full grid, coloured header | booktabs — three rules, no verticals |

It is a *render* mode, not a second document. Colour choices stay in the file; paper mode just does not paint them, so switching back restores the slide look exactly. A saved project records which mode it was exported from.

## Exporting

Every tool that makes a picture exports PNG (`⌘E`) and copies to the clipboard (`⌘⇧C`), with a transparent background by default.

Beyond that, each tool exports whatever its content actually is:

| | also exports |
| --- | --- |
| Cartesian Plotter · Chart Maker · Number Line · AI Figure Maker | **vector SVG** (`⌘⇧E`) — physical width in millimetres, so `\includegraphics` lands on the column width. Their PNG is rasterised from that same SVG at up to 1200 dpi (2400 in AI Figure Maker) |
| Tabler · Truth Table | **booktabs LaTeX** — a table belongs in a paper as source, not as a picture of a table |
| Highlighter | **`listings` block** |
| AI Figure Maker | approximate **TikZ** |
| HWP Math | **한글 equation script**, or **LaTeX** back out of one — copied as text (`⌘⇧C`); there is no image |

The four SVG tools also carry a printed-width preset (ICML, CVPR, Nature, …) and show the resulting point size in the toolbar, turning red below 6 pt — the failure mode is otherwise invisible until the PDF comes back.

## Projects

Every tool saves to the same JSON envelope, and the file says which tool it belongs to:

```json
{ "app": "funky-esset-maker", "format": 1, "tool": "tabler", "data": { } }
```

So opening is one command regardless of what made the file — **열기** (⌘O) in the sidebar, or drag the `.json` anywhere onto the window. The app switches to the owning tool and loads it. `data` is that tool's own state, and anything you leave out falls back to its default.

| Shortcut | |
| --- | --- |
| `⌘O` | open a project |
| `⌘S` | save the current tool as a project |
| `⌘E` | export PNG |
| `⌘⇧E` | export vector SVG (the SVG tools) |
| `⌘⇧C` | copy PNG to the clipboard |
| `⌘Z` / `⌘⇧Z` | undo / redo |

Undo is deliberately not intercepted while a text field has focus: inside a textarea the browser's own undo is the one you mean. The toolbar buttons work either way.

### Written by an assistant

Because a project is just JSON with defaults for everything unset, an assistant can write one for you — a table, a plot, a figure — and you open it. [`public/llms.txt`](./public/llms.txt) documents every tool's schema and input grammar for exactly that, and is served at `/llms.txt`. There is also a Claude Code skill under `.claude/skills/esset/`.

## Getting started

```bash
npm install
npm run dev
```

Opens at `http://localhost:5178`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server (runs `gen:css` first) |
| `npm run build` | Type-check, then build for production |
| `npm test` | Run the test suite (Vitest) |
| `npm run lint` | Run ESLint |
| `npm run preview` | Preview the production build |
| `npm run gen:css` | Regenerate the per-tool scoped CSS |

## Layout

```
src/
  App.tsx          sidebar navigation · tool switching · project open/save · render mode
  project.ts       the project envelope, and each tool's storage key
  theme.ts         the funky/paper mode and its context
  paper.css        paper-mode restyle for the HTML-rendered tools
  tools/           one file per tool (UI · toolbar · export) + generated scoped CSS
    shell.css      the toolbar / stage / editor / hint / toast every tool wears
    hooks.ts       shared machinery: persistence, undo/redo, preview fit, PNG + SVG export
    svg.ts         serialise a live <svg> into a standalone file; rasterise it at any dpi
    paper.ts       printed-width presets, dpi, px→pt
    tex.ts         booktabs tables and listings blocks
    Inspector.tsx  the shared property panel
    PrintBar.tsx   printed width · dpi · point-size readout
    UndoRedo.tsx   the undo/redo pair, same place in every toolbar
    BgPicker.tsx   the background swatches (+ bg.ts for the constants)
    NumField.tsx   numeric input that lets you finish typing before committing
    aifig/         AI Figure Maker modules (document model · shapes · routing · LaTeX · export)
  cores/           pure render components (CodeBlock · Diagram · Chart) + figure tokens
public/
  llms.txt         tool schemas and input grammars, for an assistant
tool-sources/      original App.css for five tools (source for the scoped CSS)
scripts/
  gen-scoped-css.mjs   prefixes tool-sources CSS with a scope class into src/tools
```

### Saving without touching the tools

A tool's project payload *is* its localStorage state, so saving reads the key the tool already writes and loading writes it back and remounts the tool. No tool implements import or export, and none can drift out of step with the format. The keys in `project.ts` are therefore a compatibility surface: changing one orphans every saved file and everyone's in-progress work.

### Vector export

A tool that draws SVG does not re-draw itself to export — `svg.ts` serialises the element on screen. A second renderer is a second thing that can disagree with what the user approved, which is the bug AI Figure Maker was built to avoid and the rest now inherit.

⚠️ A standalone SVG has no stylesheet and no `:root`. Anything that resolved through a class or a custom property on screen is simply *absent* in the file — the plotters used to write `fontFamily="var(--mono)"` into their `<text>`, which looked right in the app and fell back to the browser's default serif in every exported file. Figure fonts are concrete stacks in `cores/figure.ts` for that reason, and nothing may put a CSS variable back into exported markup. Editor chrome (selection rings, fat invisible hit targets) is marked `data-ui` and stripped on the way out.

### Shared machinery

The eight PNG tools each began as a separate project, so each carried its own copy of the same three mechanisms — restore state from `localStorage`, fit the preview into the stage, rasterise to PNG. They now share `src/tools/hooks.ts`; the copies differed only in a pixel ratio and a file name.

The same was true of the chrome. Ten copies of a toolbar, a checkerboard stage, an editor strip, a hint line and a toast — already drifted (one stage had a dot grid, toasts sat at three different heights, one toolbar floated over its canvas). They live once in `src/tools/shell.css`, keyed off the `.femtool` wrapper; a tool's own stylesheet keeps only the artwork inside `.shot` and the controls no other tool has.

⚠️ `shell.css` has to load *before* the per-tool CSS — the selectors have equal specificity, so the later one wins. It is imported from `App.tsx`, which is in the main chunk, while the tools are lazy-loaded. Importing it from a tool would silently invert the cascade.

`.shot` carries no frame of its own, on purpose: it is the element that gets exported, so a border drawn there shows on screen and not in the file.

### Render cores

`src/cores/` holds the display-only half of a tool, with the toolbar and export machinery stripped out, so another app (e.g. Funky Slide) can import it. Chart Maker renders through `cores/Chart` directly. Highlighter and Grapher are editors — a display-only component cannot replace them — so they share the parts that must not drift instead: the Prism highlighting step (`cores/highlight.ts`) and the node palette (`cores/palette.ts`).

### Scoped CSS

Five tools (Highlighter · LaTeX Imager · Tabler · DS Visualizer · Grapher) started life as standalone projects whose `App.css` used global class names like `.toolbar` and `.stage` — which collide once the tools share a page. So the original CSS lives in `tool-sources/<Tool>/App.css`, and `gen-scoped-css.mjs` prefixes every selector with that tool's scope class (`.scope-highlighter .toolbar { … }`) to produce `src/tools/*.css`. Plain CSS; no `@scope`.

**`tool-sources/` is the source of truth for those five.** Edit there and run `npm run gen:css`. The generated files are committed, so a build works without the script — and CI fails if they drift out of sync. `AiFigureMaker.css` and `ChartMaker.css` are hand-authored and not generated.

> These five also existed as separate repositories. Their code had become identical to this app's copy, so they were archived on 2026-08-07 (`funky-essets-*`). This repository is the only original.

## AI Figure Maker

A dedicated editor for the model architecture figures that go into AI/ML papers. Unlike the other tools it renders its canvas **directly as SVG**, and on export serialises the very `<g>` element on screen — so the file cannot disagree with what you saw.

- **Paper-spec canvas** — real column-width presets for NeurIPS/ICLR, ICML, CVPR, ACL, IEEE, Nature, Science and others. It computes the printed point size live and warns below 6 pt.
- **Shapes built for AI figures** — 3D tensor blocks, repeated blocks (N×), MLP neuron fans, patch/attention heatmaps, encoder/decoder trapezoids, operator tokens (⊕ ⊗ ⊙ ‖), braces, activation mini-plots.
- **LaTeX** — `$…$` in any label. Rendered through MathJax's SVG output, so formulas become real `<path>` glyphs: they open correctly in Illustrator and Inkscape with no font embedding.
- **Connectors** — straight, orthogonal, curved and arc routing, editable waypoints, six arrowheads, labels (math allowed). Orthogonal routing keeps its corner radius fixed and detours the path when a corner will not fit, rather than shaving the radius.
- **Images** — drag and drop onto the canvas, or paste with `⌘V`, and the bitmap comes in at its natural aspect ratio. Drop several at once and they line up side by side, ready as a qualitative comparison panel. Anything past 2400 px on the long edge (4″ at 600 dpi) is downsampled, and fill modes (stretch / fit / cover) plus a reset-to-original-ratio are available. Bitmaps are embedded as data URLs, so an exported SVG has no sidecar files.
- **Palettes** — matplotlib tab10, Nature muted, greyscale + accent, Okabe–Ito and Paul Tol (colour-vision-deficiency safe). Switching palettes recolours an existing figure while preserving which shape maps to which colour.
- **Templates** — 16 of them: Transformer, Attention, ViT, ResNet, U-Net, CNN pipeline, encoder–decoder, GAN, diffusion, DeepONet, PINN, training loop, and more.
- **Export** — vector SVG (physical size written in mm, so `\includegraphics` lands exactly on the column width), PNG up to 2400 dpi (sRGB-tagged), project JSON, and approximate TikZ.

MathJax is heavy, so it is lazy-loaded in its own chunk the first time this tool is opened. Until it arrives, formulas show briefly as their LaTeX source and are then replaced.

## Deploying (Vercel)

Connect the repository to Vercel and it deploys per `vercel.json` (framework `vite`, build `npm run build`, output `dist`). From the CLI:

```bash
npm i -g vercel
vercel        # preview
vercel --prod # production
```

The project vendors the original CSS under `tool-sources/`, so it builds on its own without any sibling projects.

## Stack

React 19 · TypeScript · Vite · `@studio-baeks/funky-ui` · Prism.js · KaTeX · MathJax (SVG output) · MathLive · html-to-image · Vitest

## License

[MIT](./LICENSE)
