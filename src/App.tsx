import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type DragEvent,
} from 'react'
import {
  applyProject,
  buildProject,
  downloadProject,
  parseProject,
  pickJsonFile,
  type ToolId,
} from './project'
import './App.css'

type Tool = {
  id: ToolId
  label: string
  desc: string
  /** shown alone when the sidebar is collapsed */
  icon: string
  scope: string
  /** default base name for a saved project file */
  file: string
  Component: ComponentType
}

// Each tool is code-split into its own chunk so heavy deps (KaTeX, Prism, …)
// load only when that tool is first opened, not on initial page load.
const TOOLS: Tool[] = [
  { id: 'highlighter', label: 'Highlighter', desc: '코드 하이라이트', icon: '<>', scope: 'scope-highlighter', file: 'code', Component: lazy(() => import('./tools/Highlighter')) },
  { id: 'latex', label: 'LaTeX Imager', desc: '수식 · 문서', icon: '∑', scope: 'scope-latex', file: 'equation', Component: lazy(() => import('./tools/LatexImager')) },
  { id: 'tabler', label: 'Tabler', desc: '표', icon: '▦', scope: 'scope-tabler', file: 'table', Component: lazy(() => import('./tools/Tabler')) },
  { id: 'dsviz', label: 'DS Visualizer', desc: '자료구조', icon: '⊞', scope: 'scope-dsviz', file: 'ds', Component: lazy(() => import('./tools/DsVisualizer')) },
  { id: 'grapher', label: 'Grapher', desc: '그래프 · 다이어그램', icon: '◈', scope: 'scope-grapher', file: 'graph', Component: lazy(() => import('./tools/Grapher')) },
  { id: 'aifig', label: 'AI Figure Maker', desc: '논문용 모델 구조도', icon: '▤', scope: 'scope-aifig', file: 'figure', Component: lazy(() => import('./tools/AiFigureMaker')) },
  { id: 'cartesian', label: 'Cartesian Plotter', desc: '함수 그래프', icon: '∿', scope: 'scope-cartesian', file: 'plot', Component: lazy(() => import('./tools/CartesianPlotter')) },
  { id: 'chart', label: 'Chart Maker', desc: '막대 · 선 · 원 · 산점도', icon: '▮', scope: 'scope-chart', file: 'chart', Component: lazy(() => import('./tools/ChartMaker')) },
  { id: 'numline', label: 'Number Line', desc: '수직선 · 구간 · 부등식', icon: '⊢', scope: 'scope-numline', file: 'numberline', Component: lazy(() => import('./tools/NumberLine')) },
  { id: 'truth', label: 'Truth Table', desc: '진리표', icon: '⊤', scope: 'scope-truth', file: 'truthtable', Component: lazy(() => import('./tools/TruthTable')) },
]

const KEY = 'funky-esset-maker.active'
const NAV_KEY = 'funky-esset-maker.nav'
/** below this the sidebar starts collapsed — the tools need the width more
 *  than the labels are worth */
const NAV_AUTO_COLLAPSE = 1100
const TOAST_MS = 2200

export default function App() {
  const [active, setActive] = useState<ToolId>(() => {
    const s = localStorage.getItem(KEY) as ToolId | null
    return s && TOOLS.some((t) => t.id === s) ? s : 'highlighter'
  })

  /* Loading a project writes the tool's localStorage slot and bumps this, which
     remounts the tool so it re-reads the slot from its initialisers. Tools hold
     their state in useState, so there is nothing to push into them. */
  const [reloadNonce, setReloadNonce] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)

  /* Collapsed sidebar: remembered across visits, and started collapsed on a
     narrow window so the tool gets the width. An explicit choice always wins
     over the width heuristic. */
  const [navOpen, setNavOpen] = useState(() => {
    const saved = localStorage.getItem(NAV_KEY)
    if (saved === 'open') return true
    if (saved === 'collapsed') return false
    return window.innerWidth >= NAV_AUTO_COLLAPSE
  })

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), TOAST_MS)
  }, [])

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

  const choose = useCallback((id: ToolId) => {
    setActive(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* ignore */
    }
  }, [])

  const tool = TOOLS.find((t) => t.id === active) ?? TOOLS[0]
  const ToolComponent = tool.Component

  /* ---------- project save / open ---------- */

  const saveProject = useCallback(() => {
    const current = TOOLS.find((t) => t.id === active) ?? TOOLS[0]
    const project = buildProject(current.id)
    if (!project) {
      flash('저장할 내용이 아직 없습니다')
      return
    }
    downloadProject(project, current.file)
    flash(`${current.label} 프로젝트를 저장했습니다`)
  }, [active, flash])

  /** Load from raw text — shared by the file picker and drag-and-drop. */
  const loadText = useCallback(
    (text: string) => {
      // a bare (pre-envelope) payload can only be read as the current tool
      const parsed = parseProject(text, active)
      if (!parsed.ok) {
        flash(parsed.error)
        return
      }
      const { project } = parsed
      const target = TOOLS.find((t) => t.id === project.tool)
      if (!target) {
        flash('모르는 도구입니다')
        return
      }
      if (!applyProject(project)) {
        flash('불러오기 실패 — 저장 공간이 가득 찼습니다')
        return
      }
      choose(project.tool)
      setReloadNonce((n) => n + 1)
      flash(`${target.label}(으)로 불러왔습니다`)
    },
    [active, choose, flash],
  )

  const openProject = useCallback(async () => {
    const picked = await pickJsonFile()
    if (picked) loadText(picked.text)
  }, [loadText])

  /* ---------- drop a .json anywhere ---------- */

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return
    // tools that take their own drops (AI Figure Maker takes images) mark the
    // event; leave those alone
    if (e.defaultPrevented) return
    e.preventDefault()
    setDropping(true)
  }

  const onDragLeave = (e: DragEvent) => {
    if (e.currentTarget === e.target) setDropping(false)
  }

  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e) || e.defaultPrevented) return
    const file = Array.from(e.dataTransfer.files).find(
      (f) => f.type === 'application/json' || f.name.endsWith('.json'),
    )
    if (!file) return // not ours — an image drop belongs to the tool
    e.preventDefault()
    setDropping(false)
    void file.text().then(loadText)
  }

  /* ---------- shortcuts ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        saveProject()
      } else if (k === 'o') {
        e.preventDefault()
        void openProject()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveProject, openProject])

  return (
    <div
      className={`fem${dropping ? ' is-dropping' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
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

        <nav className="fem__list" aria-label="도구">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`fem__item${active === t.id ? ' is-active' : ''}`}
              onClick={() => choose(t.id)}
              aria-current={active === t.id ? 'page' : undefined}
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

        {/* project actions live here, not in each tool's toolbar, so they are
            in the same place whichever tool is open */}
        <div className="fem__project">
          <span className="fem__project-label">프로젝트</span>
          <div className="fem__project-row">
            <button
              type="button"
              className="fem__action"
              onClick={openProject}
              title="프로젝트 열기 (⌘O) — .json을 창에 끌어다 놓아도 됩니다"
            >
              <span className="fem__action-icon" aria-hidden="true">
                ↥
              </span>
              <span className="fem__action-text">열기</span>
            </button>
            <button
              type="button"
              className="fem__action"
              onClick={saveProject}
              title="프로젝트 저장 (⌘S)"
            >
              <span className="fem__action-icon" aria-hidden="true">
                ↧
              </span>
              <span className="fem__action-text">저장</span>
            </button>
          </div>
        </div>

        <footer className="fem__footer">
          {/* the JSON format is the app's other input method — an assistant can
              write a project file — but nobody would guess that unaided */}
          <a className="fem__link" href="/llms.txt" target="_blank" rel="noreferrer">
            <span className="fem__link-icon" aria-hidden="true">
              ✦
            </span>
            <span className="fem__link-text">AI로 만들기</span>
          </a>
          <a
            className="fem__link"
            href="https://github.com/bsiku3622/funky-esset-maker"
            target="_blank"
            rel="noreferrer"
          >
            <span className="fem__link-icon" aria-hidden="true">
              ★
            </span>
            <span className="fem__link-text">GitHub</span>
          </a>
          <span className="fem__credit">by Jaewon Baek</span>
        </footer>
      </aside>

      <main className="fem__content">
        <div className={`femtool ${tool.scope}`}>
          <Suspense fallback={<div className="fem__loading">로딩 중…</div>}>
            {/* keyed so loading a project remounts the tool */}
            <ToolComponent key={`${tool.id}:${reloadNonce}`} />
          </Suspense>
        </div>
      </main>

      {dropping && (
        <div className="fem__dropzone" aria-hidden="true">
          <span>프로젝트 .json 놓기</span>
        </div>
      )}
      {toast && (
        <div className="fem__toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
