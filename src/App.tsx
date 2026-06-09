import { lazy, Suspense, useState, type ComponentType } from 'react'
import './App.css'

type ToolId =
  | 'highlighter'
  | 'latex'
  | 'tabler'
  | 'dsviz'
  | 'grapher'
  | 'cartesian'
  | 'chart'
  | 'numline'
  | 'truth'

type Tool = {
  id: ToolId
  label: string
  desc: string
  scope: string
  Component: ComponentType
}

// Each tool is code-split into its own chunk so heavy deps (KaTeX, Prism, …)
// load only when that tool is first opened, not on initial page load.
const TOOLS: Tool[] = [
  { id: 'highlighter', label: 'Highlighter', desc: '코드 하이라이트', scope: 'scope-highlighter', Component: lazy(() => import('./tools/Highlighter')) },
  { id: 'latex', label: 'LaTeX Imager', desc: '수식 · 문서', scope: 'scope-latex', Component: lazy(() => import('./tools/LatexImager')) },
  { id: 'tabler', label: 'Tabler', desc: '표', scope: 'scope-tabler', Component: lazy(() => import('./tools/Tabler')) },
  { id: 'dsviz', label: 'DS Visualizer', desc: '자료구조', scope: 'scope-dsviz', Component: lazy(() => import('./tools/DsVisualizer')) },
  { id: 'grapher', label: 'Grapher', desc: '그래프 · 다이어그램', scope: 'scope-grapher', Component: lazy(() => import('./tools/Grapher')) },
  { id: 'cartesian', label: 'Cartesian Plotter', desc: '함수 그래프', scope: 'scope-cartesian', Component: lazy(() => import('./tools/CartesianPlotter')) },
  { id: 'chart', label: 'Chart Maker', desc: '막대 · 선 · 원 · 산점도', scope: 'scope-chart', Component: lazy(() => import('./tools/ChartMaker')) },
  { id: 'numline', label: 'Number Line', desc: '수직선 · 구간 · 부등식', scope: 'scope-numline', Component: lazy(() => import('./tools/NumberLine')) },
  { id: 'truth', label: 'Truth Table', desc: '진리표', scope: 'scope-truth', Component: lazy(() => import('./tools/TruthTable')) },
]

const KEY = 'funky-esset-maker.active'

export default function App() {
  const [active, setActive] = useState<ToolId>(() => {
    const s = localStorage.getItem(KEY) as ToolId | null
    return s && TOOLS.some((t) => t.id === s) ? s : 'highlighter'
  })

  const choose = (id: ToolId) => {
    setActive(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* ignore */
    }
  }

  const tool = TOOLS.find((t) => t.id === active) ?? TOOLS[0]
  const ToolComponent = tool.Component

  return (
    <div className="fem">
      <aside className="fem__nav">
        <div className="fem__brand">
          <span className="fem__logo" aria-hidden="true">
            ▣
          </span>
          <span className="fem__name">
            Funky
            <br />
            Esset Maker
          </span>
        </div>
        <nav className="fem__list">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`fem__item${active === t.id ? ' is-active' : ''}`}
              onClick={() => choose(t.id)}
            >
              <span className="fem__item-label">{t.label}</span>
              <span className="fem__item-desc">{t.desc}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="fem__content">
        <div className={`femtool ${tool.scope}`}>
          <Suspense fallback={<div className="fem__loading">로딩 중…</div>}>
            <ToolComponent />
          </Suspense>
        </div>
      </main>
    </div>
  )
}
