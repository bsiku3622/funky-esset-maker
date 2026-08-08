import { lazy, Suspense, useState, type ComponentType } from 'react'
import './App.css'

type ToolId =
  | 'highlighter'
  | 'latex'
  | 'tabler'
  | 'dsviz'
  | 'grapher'
  | 'aifig'
  | 'cartesian'
  | 'chart'
  | 'numline'
  | 'truth'

type Tool = {
  id: ToolId
  label: string
  desc: string
  /** shown alone when the sidebar is collapsed */
  icon: string
  scope: string
  Component: ComponentType
}

// Each tool is code-split into its own chunk so heavy deps (KaTeX, Prism, …)
// load only when that tool is first opened, not on initial page load.
const TOOLS: Tool[] = [
  { id: 'highlighter', label: 'Highlighter', desc: '코드 하이라이트', icon: '<>', scope: 'scope-highlighter', Component: lazy(() => import('./tools/Highlighter')) },
  { id: 'latex', label: 'LaTeX Imager', desc: '수식 · 문서', icon: '∑', scope: 'scope-latex', Component: lazy(() => import('./tools/LatexImager')) },
  { id: 'tabler', label: 'Tabler', desc: '표', icon: '▦', scope: 'scope-tabler', Component: lazy(() => import('./tools/Tabler')) },
  { id: 'dsviz', label: 'DS Visualizer', desc: '자료구조', icon: '⊞', scope: 'scope-dsviz', Component: lazy(() => import('./tools/DsVisualizer')) },
  { id: 'grapher', label: 'Grapher', desc: '그래프 · 다이어그램', icon: '◈', scope: 'scope-grapher', Component: lazy(() => import('./tools/Grapher')) },
  { id: 'aifig', label: 'AI Figure Maker', desc: '논문용 모델 구조도', icon: '▤', scope: 'scope-aifig', Component: lazy(() => import('./tools/AiFigureMaker')) },
  { id: 'cartesian', label: 'Cartesian Plotter', desc: '함수 그래프', icon: '∿', scope: 'scope-cartesian', Component: lazy(() => import('./tools/CartesianPlotter')) },
  { id: 'chart', label: 'Chart Maker', desc: '막대 · 선 · 원 · 산점도', icon: '▮', scope: 'scope-chart', Component: lazy(() => import('./tools/ChartMaker')) },
  { id: 'numline', label: 'Number Line', desc: '수직선 · 구간 · 부등식', icon: '⊢', scope: 'scope-numline', Component: lazy(() => import('./tools/NumberLine')) },
  { id: 'truth', label: 'Truth Table', desc: '진리표', icon: '⊤', scope: 'scope-truth', Component: lazy(() => import('./tools/TruthTable')) },
]

const KEY = 'funky-esset-maker.active'
const NAV_KEY = 'funky-esset-maker.nav'
/** below this the sidebar starts collapsed — the tools need the width more
 *  than the labels are worth */
const NAV_AUTO_COLLAPSE = 1100

export default function App() {
  const [active, setActive] = useState<ToolId>(() => {
    const s = localStorage.getItem(KEY) as ToolId | null
    return s && TOOLS.some((t) => t.id === s) ? s : 'highlighter'
  })

  /* Collapsed sidebar: remembered across visits, and started collapsed on a
     narrow window so the tool gets the width. An explicit choice always wins
     over the width heuristic. */
  const [navOpen, setNavOpen] = useState(() => {
    const saved = localStorage.getItem(NAV_KEY)
    if (saved === 'open') return true
    if (saved === 'collapsed') return false
    return window.innerWidth >= NAV_AUTO_COLLAPSE
  })

  const toggleNav = () => {
    setNavOpen((open) => {
      try {
        localStorage.setItem(NAV_KEY, open ? 'collapsed' : 'open')
      } catch {
        /* ignore */
      }
      return !open
    })
  }

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
      <aside className={`fem__nav${navOpen ? '' : ' is-collapsed'}`}>
        <div className="fem__brand">
          <span className="fem__logo" aria-hidden="true">
            ▣
          </span>
          <span className="fem__name">
            Funky
            <br />
            Esset Maker
          </span>
          <button
            type="button"
            className="fem__toggle"
            onClick={toggleNav}
            aria-expanded={navOpen}
            title={navOpen ? '사이드바 접기' : '사이드바 펼치기'}
          >
            {navOpen ? '«' : '»'}
          </button>
        </div>
        <nav className="fem__list">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`fem__item${active === t.id ? ' is-active' : ''}`}
              onClick={() => choose(t.id)}
              title={navOpen ? undefined : `${t.label} — ${t.desc}`}
            >
              <span className="fem__item-icon" aria-hidden="true">
                {t.icon}
              </span>
              <span className="fem__item-label">{t.label}</span>
              <span className="fem__item-desc">{t.desc}</span>
            </button>
          ))}
        </nav>

        <footer className="fem__footer">
          <a
            className="fem__gh"
            href="https://github.com/bsiku3622/funky-esset-maker"
            target="_blank"
            rel="noreferrer"
          >
            <span className="fem__gh-icon" aria-hidden="true">
              ★
            </span>
            <span className="fem__gh-text">GitHub</span>
          </a>
          <span className="fem__credit">by Jaewon Baek</span>
        </footer>
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
