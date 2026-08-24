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
  STORE_KEYS,
  applyProject,
  buildProject,
  downloadProject,
  parseProject,
  pickJsonFile,
  type ToolId,
} from './project'
import { THEME_KEY, ThemeCtx, readTheme, type Theme } from './theme'
import ToolBoundary from './ToolBoundary'
import './App.css'
/* The shared tool chrome. Imported here rather than from a tool because the
   selectors match the per-tool ones and the later stylesheet wins — App is in
   the main chunk, the tools are lazy, so this always lands first. */
import './tools/shell.css'
import './paper.css'

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
  { id: 'hwpmath', label: 'HWP Math', desc: 'LaTeX → 한글 수식', icon: '⇄', scope: 'scope-hwpmath', file: 'hwp-equation', Component: lazy(() => import('./tools/HwpMath')) },
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
  /** the paste box's text, or null when it is closed */
  const [pasting, setPasting] = useState<string | null>(null)

  /* Render mode. App-level rather than per-tool: it answers "what am I making
     today", and that does not change when you switch from the table to the
     plot. Tools read it from context; the HTML-rendered ones are restyled by
     paper.css off the attribute on the root. */
  const [theme, setTheme] = useState<Theme>(readTheme)

  const pickTheme = useCallback((next: Theme) => {
    setTheme(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

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
    const project = buildProject(current.id, { theme })
    if (!project) {
      flash('저장할 내용이 아직 없습니다')
      return
    }
    downloadProject(project, current.file)
    flash(`${current.label} 프로젝트를 저장했습니다`)
  }, [active, theme, flash])

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
      // a file saved before paper mode existed carries no theme; leave the
      // app in whatever mode it is already in rather than guessing
      if (project.theme) pickTheme(project.theme)
      choose(project.tool)
      setReloadNonce((n) => n + 1)
      flash(`${target.label}(으)로 불러왔습니다`)
    },
    [active, choose, flash, pickTheme],
  )

  const openProject = useCallback(async () => {
    const picked = await pickJsonFile()
    if (picked) loadText(picked.text)
  }, [loadText])

  /* The way out when a tool cannot render what it was handed. The payload lives
     in localStorage, so a reload would only replay the crash — the slot has to
     go before the remount. */
  const clearTool = useCallback(
    (id: ToolId) => {
      try {
        localStorage.removeItem(STORE_KEYS[id])
      } catch {
        /* ignore */
      }
      setReloadNonce((n) => n + 1)
      flash('저장된 내용을 지우고 새로 시작했습니다')
    },
    [flash],
  )

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
      data-fem-theme={theme}
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

        {/* Render mode. Above the project actions because it changes what every
            tool draws, and one switch beats ten toolbar toggles. */}
        <div className="fem__mode">
          <span className="fem__project-label">모드</span>
          <div className="fem__modeswitch" role="group" aria-label="렌더 모드">
            <button
              type="button"
              className={`fem__modebtn${theme === 'funky' ? ' is-on' : ''}`}
              onClick={() => pickTheme('funky')}
              aria-pressed={theme === 'funky'}
              title="펑키 — 네온과 굵은 테두리, 슬라이드용"
            >
              <span className="fem__modebtn-icon" aria-hidden="true">
                ◆
              </span>
              <span className="fem__modebtn-text">펑키</span>
            </button>
            <button
              type="button"
              className={`fem__modebtn${theme === 'paper' ? ' is-on' : ''}`}
              onClick={() => pickTheme('paper')}
              aria-pressed={theme === 'paper'}
              title="논문 — 가는 괘선과 세리프, 색각 이상 안전 팔레트"
            >
              <span className="fem__modebtn-icon" aria-hidden="true">
                ▤
              </span>
              <span className="fem__modebtn-text">논문</span>
            </button>
          </div>
        </div>

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
            {/* A project often arrives as text rather than as a file — pasted
                out of a chat with a model, or out of a message. Making that
                round trip through Save-as-file and Open-file is a detour
                around something the clipboard already had. */}
            <button
              type="button"
              className="fem__action"
              onClick={() => setPasting('')}
              title="JSON을 붙여넣어 불러오기"
            >
              <span className="fem__action-icon" aria-hidden="true">
                ⌘V
              </span>
              <span className="fem__action-text">붙여넣기</span>
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
          {/* Outside Suspense so a chunk that fails to load is caught too. */}
          <ToolBoundary
            resetKey={`${tool.id}:${reloadNonce}`}
            toolLabel={tool.label}
            onClear={() => clearTool(tool.id)}
          >
            <Suspense fallback={<div className="fem__loading">로딩 중…</div>}>
              {/* keyed so loading a project remounts the tool */}
              <ThemeCtx value={theme}>
                <ToolComponent key={`${tool.id}:${reloadNonce}`} />
              </ThemeCtx>
            </Suspense>
          </ToolBoundary>
        </div>
      </main>

      {dropping && (
        <div className="fem__dropzone" aria-hidden="true">
          <span>프로젝트 .json 놓기</span>
        </div>
      )}
      {pasting !== null && (
        <div
          className="fem__paste"
          role="dialog"
          aria-label="JSON 붙여넣기"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setPasting(null)
          }}
        >
          <div className="fem__paste-box">
            <h2>JSON 붙여넣기</h2>
            <textarea
              autoFocus
              value={pasting}
              placeholder='{"tool":"aifig", …} 또는 도구의 원본 JSON'
              onChange={(e) => setPasting(e.target.value)}
              /* ⌘Enter loads without reaching for the mouse; Escape closes.
                 Plain Enter is a newline — this is a text field holding a
                 document, not a search box. */
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') setPasting(null)
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  loadText(pasting)
                  setPasting(null)
                }
              }}
            />
            <p className="fem__paste-note">
              현재 도구의 원본 JSON도 됩니다 — 도구 이름이 없으면 지금 열린 도구로 읽습니다.
            </p>
            <div className="fem__paste-row">
              <button type="button" className="fem__action" onClick={() => setPasting(null)}>
                취소
              </button>
              <button
                type="button"
                className="fem__action fem__action--go"
                disabled={!pasting.trim()}
                onClick={() => {
                  loadText(pasting)
                  setPasting(null)
                }}
              >
                불러오기 (⌘↵)
              </button>
            </div>
          </div>
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
