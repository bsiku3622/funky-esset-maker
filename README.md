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

Most tools rasterise their result to PNG with `html-to-image`. **AI Figure Maker** is the exception: it draws its canvas as SVG and serialises that same DOM, so it can export true vector SVG, high-resolution PNG, and TikZ. The tool you used last is remembered in `localStorage` and reopens on your next visit.

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
  App.tsx          sidebar navigation + tool switching
  tools/           one file per tool (UI · toolbar · export) + generated scoped CSS
    hooks.ts       shared machinery: persistence, preview fit, PNG export
    NumField.tsx   numeric input that lets you finish typing before committing
    aifig/         AI Figure Maker modules (document model · shapes · routing · LaTeX · export)
  cores/           pure render components (CodeBlock · Diagram · Chart) + shared palette
tool-sources/      original App.css for five tools (source for the scoped CSS)
scripts/
  gen-scoped-css.mjs   prefixes tool-sources CSS with a scope class into src/tools
```

### Shared machinery

The eight PNG tools each began as a separate project, so each carried its own copy of the same three mechanisms — restore state from `localStorage`, fit the preview into the stage, rasterise to PNG. They now share `src/tools/hooks.ts`; the copies differed only in a pixel ratio and a file name.

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
