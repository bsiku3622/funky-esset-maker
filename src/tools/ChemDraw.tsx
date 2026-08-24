/* Chem Draw — structural formulas.
 *
 * The one thing that makes a structure editor feel like one is that it never
 * lets you draw a bond at a wrong angle or a wrong length. Everything here is
 * in service of that: a drag snaps to 30°, a click extends the zig-zag by
 * itself, a ring arrives as a finished polygon, and a ring dropped on a bond
 * fuses to it.
 *
 * ⚠️ Pointer handling is done here against the model rather than with handlers
 * on each shape. A drag that starts on empty canvas still has to know where it
 * started, and a bond dropped near an atom has to find it — both are hit tests,
 * and doing half of it with DOM events and half with geometry is how the two
 * end up disagreeing about what was clicked. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Text } from '@studio-baeks/funky-ui'
import { useFitScale, useHistory, usePersist, useStored, useSvgExport } from './hooks'
import BgPicker from './BgPicker'
import { BG_HEX, type BgKey } from './bg'
import { ptOf, printWidthIn as widthInOf } from './paper'
import { useTheme } from '../theme'
import Inspector, { Field, Group, Row } from './Inspector'
import PrintBar from './PrintBar'
import UndoRedo from './UndoRedo'
import SharedNumField from './NumField'
import ChemView, { type ChemPick } from './chem/render'
import { chemStyle } from './chem/style'
import {
  BOND,
  KNOWN_ELEMENTS,
  addAtom,
  addBond,
  along,
  angleOf,
  atomAt,
  bounds,
  cid,
  dist,
  freeAngle,
  fuseRing,
  hitAtom,
  hitBond,
  placeRing,
  removeAtom,
  removeBond,
  snapAngle,
  type ArrowKind,
  type BondStyle,
  type Molecule,
  type Pt,
} from './chem/model'
import { CHEM_PRESETS, chemPresetById } from './chem/presets'
import './ChemDraw.css'

const STORE_KEY = 'fem.chem.v1'

type ToolId = 'select' | 'bond' | 'ring' | 'atom' | 'arrow' | 'text' | 'erase'

const TOOLS: { id: ToolId; label: string; hint: string }[] = [
  { id: 'select', label: '선택', hint: '끌어서 이동 · 클릭해 편집' },
  { id: 'bond', label: '결합', hint: '원자에서 끌면 결합 · 클릭하면 지그재그로 이어짐 · 결합을 클릭하면 차수' },
  { id: 'ring', label: '고리', hint: '빈 곳을 클릭하면 고리 · 결합을 클릭하면 그 변에 융합' },
  { id: 'atom', label: '원소', hint: '원자를 클릭하면 그 원소로 바뀝니다' },
  { id: 'arrow', label: '화살표', hint: '끌어서 반응 화살표' },
  { id: 'text', label: '글자', hint: '클릭한 곳에 글자' },
  { id: 'erase', label: '지우개', hint: '원자나 결합을 클릭하면 지웁니다' },
]

const ARROWS: { id: ArrowKind; label: string }[] = [
  { id: 'forward', label: '→' },
  { id: 'equilibrium', label: '⇌' },
  { id: 'resonance', label: '↔' },
  { id: 'curly', label: '↷' },
]

const BOND_STYLES: { id: BondStyle; label: string }[] = [
  { id: 'plain', label: '평면' },
  { id: 'wedge', label: '쐐기' },
  { id: 'dash', label: '점선' },
  { id: 'wavy', label: '물결' },
]

interface Persisted {
  mol: Molecule
  figW: number
  figH: number
  bg: BgKey
  widthId: string
  dpi: number
  lonePairs: boolean
  sizeScale: number
}

const DEFAULTS: Persisted = {
  mol: CHEM_PRESETS[0].mol,
  figW: 560,
  figH: 420,
  bg: 'transparent',
  widthId: 'screen',
  dpi: 600,
  lonePairs: false,
  sizeScale: 1,
}

type Drag =
  | { kind: 'bond'; fromId: string; to: Pt; moved: boolean }
  | { kind: 'move'; id: string; what: ChemPick['kind']; ox: number; oy: number; moved: boolean }
  | { kind: 'arrow'; from: Pt; to: Pt }
  | null

export default function ChemDrawTool() {
  const theme = useTheme()
  const initial = useStored<Persisted>(STORE_KEY, DEFAULTS)

  const [mol, setMol] = useState<Molecule>(initial.mol)
  const [figW, setFigW] = useState(initial.figW)
  const [figH, setFigH] = useState(initial.figH)
  const [bg, setBg] = useState<BgKey>(initial.bg)
  const [widthId, setWidthId] = useState(initial.widthId)
  const [dpi, setDpi] = useState(initial.dpi)
  const [lonePairs, setLonePairs] = useState(initial.lonePairs)
  const [sizeScale, setSizeScale] = useState(initial.sizeScale)

  const [tool, setTool] = useState<ToolId>('bond')
  const [ringSize, setRingSize] = useState(6)
  const [aromatic, setAromatic] = useState(true)
  const [element, setElement] = useState('O')
  const [arrowKind, setArrowKind] = useState<ArrowKind>('forward')
  const [sel, setSel] = useState<ChemPick | null>(null)
  const [drag, setDrag] = useState<Drag>(null)
  const [presetId, setPresetId] = useState('')

  /* ⚠️ The molecule and the drag are read through refs inside the pointer
     handlers, not from the render closure.
     pointerdown and pointerup can both run before React has re-rendered — a
     fast click, or any synthetic event — and then pointerup sees `drag` as null
     and the click draws nothing. Writing through a ref makes the handlers see
     what the last one did, however soon after it they run. */
  const molRef = useRef(mol)
  const dragRef = useRef<Drag>(null)
  const commit = useCallback((next: Molecule | ((m: Molecule) => Molecule)) => {
    const value = typeof next === 'function' ? next(molRef.current) : next
    molRef.current = value
    setMol(value)
  }, [])
  const beginDrag = useCallback((d: Drag) => {
    dragRef.current = d
    setDrag(d)
  }, [])

  const stageRef = useRef<HTMLDivElement>(null)
  const shotRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const bgHex = BG_HEX[bg]
  const st = chemStyle(theme, bg === 'dark', sizeScale)

  const persisted: Persisted = { mol, figW, figH, bg, widthId, dpi, lonePairs, sizeScale }
  usePersist(STORE_KEY, persisted)

  // undo, a loaded project and the preset picker all bypass `commit`
  useEffect(() => {
    molRef.current = mol
  }, [mol])

  const history = useHistory(persisted, (s) => {
    setMol(s.mol)
    setFigW(s.figW)
    setFigH(s.figH)
    setBg(s.bg)
    setWidthId(s.widthId)
    setDpi(s.dpi)
    setLonePairs(s.lonePairs)
    setSizeScale(s.sizeScale)
  })

  const { scale, nat } = useFitScale({
    stageRef,
    shotRef,
    signature: `${figW}|${figH}|${bg}|${theme}|${sizeScale}`,
  })

  const printIn = widthInOf(widthId, figW)

  const { saveSvg, savePng, copyPng, pixels, busy, toast } = useSvgExport({
    svgRef,
    filename: 'structure',
    printWidthIn: printIn,
    figPxWidth: figW,
    figPxHeight: figH,
    bg: bgHex,
    fontFamily: st.font,
    dpi,
    title: 'Made with Funky Esset Maker — Chem Draw',
  })

  /* ---------- pointer ---------- */

  /** Client coordinates to model coordinates, through whatever the stage's
   *  fit-to-window scale currently is. */
  const toModel = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const r = svg.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) * figW) / (r.width || 1),
      y: ((e.clientY - r.top) * figH) / (r.height || 1),
    }
  }, [figW, figH])

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const mol = molRef.current
    const p = toModel(e)
    // capture so a drag that leaves the canvas still ends here; a pointer id
    // that is not actually down (a synthetic event) makes this throw, and the
    // draw that follows is worth more than the capture
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* not capturable */
    }
    const atom = hitAtom(mol, p)
    const bond = atom ? null : hitBond(mol, p)

    if (tool === 'erase') {
      if (atom) commit(removeAtom(mol, atom.id))
      else if (bond) commit(removeBond(mol, bond.id))
      setSel(null)
      return
    }

    if (tool === 'ring') {
      commit(bond ? fuseRing(mol, bond, ringSize, aromatic) : placeRing(mol, p, ringSize, aromatic))
      return
    }

    if (tool === 'text') {
      const id = cid('t')
      commit({ ...mol, labels: [...mol.labels, { id, x: p.x, y: p.y, text: '글자' }] })
      setSel({ kind: 'label', id })
      return
    }

    if (tool === 'atom') {
      if (atom) {
        commit({
          ...mol,
          atoms: mol.atoms.map((a) => (a.id === atom.id ? { ...a, el: element === 'C' ? '' : element } : a)),
        })
        setSel({ kind: 'atom', id: atom.id })
      } else {
        const [next, made] = addAtom(mol, p, element === 'C' ? '' : element)
        commit(next)
        setSel({ kind: 'atom', id: made.id })
      }
      return
    }

    if (tool === 'arrow') {
      beginDrag({ kind: 'arrow', from: p, to: p })
      return
    }

    if (tool === 'bond') {
      if (bond) {
        // a click on a bond raises its order, 1 → 2 → 3 → 1
        commit({
          ...mol,
          bonds: mol.bonds.map((b) =>
            b.id === bond.id ? { ...b, order: ((b.order % 3) + 1) as 1 | 2 | 3, aromatic: false } : b,
          ),
        })
        setSel({ kind: 'bond', id: bond.id })
        return
      }
      if (atom) {
        beginDrag({ kind: 'bond', fromId: atom.id, to: p, moved: false })
        return
      }
      const [next, made] = addAtom(mol, p)
      commit(next)
      beginDrag({ kind: 'bond', fromId: made.id, to: p, moved: false })
      return
    }

    // select
    const arrow = mol.arrows.find(
      (a) => dist(p, { x: (a.x1 + a.x2) / 2, y: (a.y1 + a.y2) / 2 }) < 22,
    )
    const label = mol.labels.find((l) => dist(p, l) < 24)
    if (atom) {
      setSel({ kind: 'atom', id: atom.id })
      beginDrag({ kind: 'move', id: atom.id, what: 'atom', ox: p.x - atom.x, oy: p.y - atom.y, moved: false })
    } else if (label) {
      setSel({ kind: 'label', id: label.id })
      beginDrag({ kind: 'move', id: label.id, what: 'label', ox: p.x - label.x, oy: p.y - label.y, moved: false })
    } else if (arrow) {
      setSel({ kind: 'arrow', id: arrow.id })
      beginDrag({
        kind: 'move',
        id: arrow.id,
        what: 'arrow',
        ox: p.x - (arrow.x1 + arrow.x2) / 2,
        oy: p.y - (arrow.y1 + arrow.y2) / 2,
        moved: false,
      })
    } else if (bond) setSel({ kind: 'bond', id: bond.id })
    else setSel(null)
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const mol = molRef.current
    const p = toModel(e)
    if (drag.kind === 'bond') {
      beginDrag({ ...drag, to: p, moved: drag.moved || dist(p, atomAt(mol, drag.fromId) ?? p) > 6 })
      return
    }
    if (drag.kind === 'arrow') {
      beginDrag({ ...drag, to: p })
      return
    }
    const nx = p.x - drag.ox
    const ny = p.y - drag.oy
    if (drag.what === 'atom')
      commit((m) => ({ ...m, atoms: m.atoms.map((a) => (a.id === drag.id ? { ...a, x: nx, y: ny } : a)) }))
    else if (drag.what === 'label')
      commit((m) => ({ ...m, labels: m.labels.map((l) => (l.id === drag.id ? { ...l, x: nx, y: ny } : l)) }))
    else if (drag.what === 'arrow')
      commit((m) => ({
        ...m,
        arrows: m.arrows.map((a) => {
          if (a.id !== drag.id) return a
          const cx = (a.x1 + a.x2) / 2
          const cy = (a.y1 + a.y2) / 2
          return { ...a, x1: a.x1 + nx - cx, y1: a.y1 + ny - cy, x2: a.x2 + nx - cx, y2: a.y2 + ny - cy }
        }),
      }))
    beginDrag({ ...drag, moved: true })
  }

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const mol = molRef.current
    const p = toModel(e)
    if (drag.kind === 'arrow') {
      const len = dist(drag.from, p)
      const end = len < 20 ? { x: drag.from.x + 90, y: drag.from.y } : p
      commit((m) => ({
        ...m,
        arrows: [...m.arrows, { id: cid('r'), kind: arrowKind, x1: drag.from.x, y1: drag.from.y, x2: end.x, y2: end.y }],
      }))
      beginDrag(null)
      return
    }
    if (drag.kind === 'bond') {
      const from = atomAt(mol, drag.fromId)
      if (!from) {
        beginDrag(null)
        return
      }
      const target = hitAtom(mol, p, BOND * 0.45)
      if (target && target.id !== from.id) {
        commit(addBond(mol, from.id, target.id))
      } else {
        /* A click rather than a drag: continue the chain by itself. A drag:
           snap to the angle grid so a hand-drawn bond is still a real one. */
        const ang = drag.moved && dist(from, p) > 10 ? snapAngle(angleOf(from, p)) : freeAngle(mol, from)
        const [next, made] = addAtom(mol, along(from, ang))
        commit(addBond(next, from.id, made.id))
      }
      beginDrag(null)
      return
    }
    beginDrag(null)
  }

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!sel) return
        e.preventDefault()
        if (sel.kind === 'atom') commit((m) => removeAtom(m, sel.id))
        else if (sel.kind === 'bond') commit((m) => removeBond(m, sel.id))
        else if (sel.kind === 'arrow') commit((m) => ({ ...m, arrows: m.arrows.filter((a) => a.id !== sel.id) }))
        else commit((m) => ({ ...m, labels: m.labels.filter((l) => l.id !== sel.id) }))
        setSel(null)
        return
      }
      if (sel?.kind === 'bond' && /^[123]$/.test(e.key)) {
        const order = Number(e.key) as 1 | 2 | 3
        commit((m) => ({ ...m, bonds: m.bonds.map((b) => (b.id === sel.id ? { ...b, order, aromatic: false } : b)) }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, commit])

  /* ---------- editing helpers ---------- */

  const patchAtom = (id: string, over: Partial<Molecule['atoms'][number]>) =>
    commit((m) => ({ ...m, atoms: m.atoms.map((a) => (a.id === id ? { ...a, ...over } : a)) }))
  const patchBond = (id: string, over: Partial<Molecule['bonds'][number]>) =>
    commit((m) => ({ ...m, bonds: m.bonds.map((b) => (b.id === id ? { ...b, ...over } : b)) }))
  const patchArrow = (id: string, over: Partial<Molecule['arrows'][number]>) =>
    commit((m) => ({ ...m, arrows: m.arrows.map((a) => (a.id === id ? { ...a, ...over } : a)) }))
  const patchLabel = (id: string, over: Partial<Molecule['labels'][number]>) =>
    commit((m) => ({ ...m, labels: m.labels.map((l) => (l.id === id ? { ...l, ...over } : l)) }))

  /** Put the drawing back in the middle of the page. */
  const recentre = () => {
    const b = bounds(mol)
    if (!mol.atoms.length && !mol.arrows.length && !mol.labels.length) return
    const dx = figW / 2 - (b.x + b.w / 2)
    const dy = figH / 2 - (b.y + b.h / 2)
    commit((m) => ({
      atoms: m.atoms.map((a) => ({ ...a, x: a.x + dx, y: a.y + dy })),
      bonds: m.bonds,
      arrows: m.arrows.map((a) => ({ ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy })),
      labels: m.labels.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })),
    }))
  }

  const loadPreset = (id: string) => {
    if (!id) return
    const p = chemPresetById(id)
    commit(p.mol)
    /* A reaction scheme needs a wider page than a single molecule, so the
       preset says so. One that does not gets the default back rather than
       whatever the last preset happened to set — a molecule stranded in a
       reaction-sized canvas looks like the tool lost it. */
    setFigW(p.w ?? DEFAULTS.figW)
    setFigH(p.h ?? DEFAULTS.figH)
    setLonePairs(!!p.lonePairs)
    setSel(null)
    setPresetId(id)
  }

  const selAtom = sel?.kind === 'atom' ? atomAt(mol, sel.id) : undefined
  const selBond = sel?.kind === 'bond' ? mol.bonds.find((b) => b.id === sel.id) : undefined
  const selArrow = sel?.kind === 'arrow' ? mol.arrows.find((a) => a.id === sel.id) : undefined
  const selLabel = sel?.kind === 'label' ? mol.labels.find((l) => l.id === sel.id) : undefined

  const ghost =
    drag?.kind === 'bond' && drag.moved
      ? { from: atomAt(mol, drag.fromId) ?? drag.to, to: drag.to }
      : drag?.kind === 'arrow'
        ? { from: drag.from, to: drag.to }
        : null

  return (
    <div className="app">
      <div className="toolbar">
        <Text variant="heading" as="h1" className="toolbar__title">
          Chem Draw
        </Text>

        <UndoRedo history={history} />

        <div className="toolbar__group">
          {TOOLS.map((t) => (
            <Button
              key={t.id}
              variant={tool === t.id ? 'primary' : 'neutral'}
              size="sm"
              title={t.hint}
              onClick={() => setTool(t.id)}
            >
              {t.label}
            </Button>
          ))}
        </div>

        {tool === 'ring' && (
          <div className="toolbar__group">
            {[3, 4, 5, 6, 7, 8].map((n) => (
              <Button
                key={n}
                variant={ringSize === n ? 'secondary' : 'neutral'}
                size="sm"
                onClick={() => setRingSize(n)}
              >
                {n}
              </Button>
            ))}
            <Button
              variant={aromatic ? 'warning' : 'neutral'}
              size="sm"
              title="방향족 — 안쪽에 원을 그립니다"
              onClick={() => setAromatic((v) => !v)}
            >
              방향족
            </Button>
          </div>
        )}

        {tool === 'atom' && (
          <div className="toolbar__group cd-elements">
            {KNOWN_ELEMENTS.map((el) => (
              <button
                key={el}
                type="button"
                className={`cd-el${element === el ? ' is-on' : ''}`}
                onClick={() => setElement(el)}
              >
                {el}
              </button>
            ))}
          </div>
        )}

        {tool === 'arrow' && (
          <div className="toolbar__group">
            {ARROWS.map((a) => (
              <Button
                key={a.id}
                variant={arrowKind === a.id ? 'secondary' : 'neutral'}
                size="sm"
                onClick={() => setArrowKind(a.id)}
              >
                {a.label}
              </Button>
            ))}
          </div>
        )}

        <div className="toolbar__group">
          <span className="toolbar__label">예제</span>
          <select
            className="cd-preset"
            value={presetId}
            aria-label="예제 구조"
            onChange={(e) => loadPreset(e.target.value)}
          >
            <option value="">불러오기…</option>
            {[...new Set(CHEM_PRESETS.map((p) => p.group))].map((g) => (
              <optgroup key={g} label={g}>
                {CHEM_PRESETS.filter((p) => p.group === g).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <Button
          variant={lonePairs ? 'secondary' : 'neutral'}
          size="sm"
          title="비공유 전자쌍을 점으로"
          onClick={() => setLonePairs((v) => !v)}
        >
          전자쌍
        </Button>

        <Button variant="neutral" size="sm" title="그림을 가운데로" onClick={recentre}>
          가운데
        </Button>

        <div className="toolbar__group">
          <span className="toolbar__label">크기</span>
          <SharedNumField className="cd-num" integer value={figW} onCommit={(n) => setFigW(Math.max(240, n))} />
          <span className="cd-tilde">×</span>
          <SharedNumField className="cd-num" integer value={figH} onCommit={(n) => setFigH(Math.max(200, n))} />
        </div>

        <PrintBar
          widthId={widthId}
          onWidth={(id, px) => {
            setWidthId(id)
            if (px) {
              const ratio = figH / figW
              setFigW(px)
              setFigH(Math.round(px * ratio))
            }
          }}
          dpi={dpi}
          onDpi={setDpi}
          labelPt={ptOf(st.fontSize, printIn, figW)}
          pixels={pixels}
        />

        <BgPicker value={bg} onChange={setBg} />

        <div className="toolbar__spacer" />

        <Button variant="warning" size="sm" title="벡터 SVG로 저장 (⌘⇧E)" onClick={saveSvg}>
          SVG
        </Button>
        <Button variant="success" size="sm" title="PNG로 저장 (⌘E)" onClick={savePng} disabled={busy}>
          PNG 저장
        </Button>
        <Button variant="info" size="sm" title="클립보드로 복사 (⌘⇧C)" onClick={copyPng} disabled={busy}>
          복사
        </Button>
      </div>

      <div className="stage fx-insp-host" ref={stageRef}>
        <div className="fitbox" style={nat.w ? { width: nat.w * scale, height: nat.h * scale } : undefined}>
          <div
            className="shot"
            ref={shotRef}
            style={{ transform: `scale(${scale})`, ...(bgHex ? { background: bgHex } : null) }}
          >
            <ChemView
              mol={mol}
              width={figW}
              height={figH}
              st={st}
              bgHex={bgHex}
              svgRef={svgRef}
              selected={sel}
              ghost={ghost}
              lonePairs={lonePairs}
              cursor={tool === 'select' ? 'default' : 'crosshair'}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
            />
          </div>
        </div>

        {(selAtom || selBond || selArrow || selLabel) && (
          <Inspector
            title={selAtom ? '원자' : selBond ? '결합' : selArrow ? '화살표' : '글자'}
            onClose={() => setSel(null)}
          >
            {selAtom && (
              <>
                <Group label="원소">
                  <Row label="">
                    <div className="cd-elements cd-elements--panel">
                      {['C', ...KNOWN_ELEMENTS.filter((e) => e !== 'C')].map((el) => (
                        <button
                          key={el}
                          type="button"
                          className={`cd-el${(selAtom.el || 'C') === el ? ' is-on' : ''}`}
                          onClick={() => patchAtom(selAtom.id, { el: el === 'C' ? '' : el })}
                        >
                          {el}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Field label="직접">
                    <input
                      type="text"
                      value={selAtom.el}
                      placeholder="C (빈 꼭짓점)"
                      onChange={(e) => patchAtom(selAtom.id, { el: e.target.value })}
                    />
                  </Field>
                </Group>
                <Group label="전하 · 전자">
                  <Row label="전하">
                    <button type="button" className="fx-insp__btn" onClick={() => patchAtom(selAtom.id, { charge: (selAtom.charge ?? 0) - 1 })}>
                      −
                    </button>
                    <span className="cd-count">{selAtom.charge ?? 0}</span>
                    <button type="button" className="fx-insp__btn" onClick={() => patchAtom(selAtom.id, { charge: (selAtom.charge ?? 0) + 1 })}>
                      ＋
                    </button>
                  </Row>
                  <Row label="전자쌍">
                    <button type="button" className="fx-insp__btn" onClick={() => patchAtom(selAtom.id, { lone: Math.max(0, (selAtom.lone ?? 0) - 1) })}>
                      −
                    </button>
                    <span className="cd-count">{selAtom.lone ?? 0}</span>
                    <button type="button" className="fx-insp__btn" onClick={() => patchAtom(selAtom.id, { lone: (selAtom.lone ?? 0) + 1 })}>
                      ＋
                    </button>
                  </Row>
                  <Row label="수소">
                    <button
                      type="button"
                      className={`fx-insp__btn${selAtom.hHidden ? ' is-on' : ''}`}
                      onClick={() => patchAtom(selAtom.id, { hHidden: !selAtom.hHidden })}
                    >
                      숨기기
                    </button>
                    <button
                      type="button"
                      className="fx-insp__btn"
                      title="원자가로 계산하지 않고 직접 지정"
                      onClick={() =>
                        patchAtom(selAtom.id, {
                          hFixed: selAtom.hFixed === null || selAtom.hFixed === undefined ? 0 : null,
                        })
                      }
                    >
                      {selAtom.hFixed === null || selAtom.hFixed === undefined ? '직접' : '자동'}
                    </button>
                    {selAtom.hFixed !== null && selAtom.hFixed !== undefined && (
                      <SharedNumField integer value={selAtom.hFixed} onCommit={(hFixed) => patchAtom(selAtom.id, { hFixed })} />
                    )}
                  </Row>
                </Group>
                <Row label="">
                  <button type="button" className="fx-insp__btn fx-insp__btn--danger" onClick={() => { commit(removeAtom(molRef.current, selAtom.id)); setSel(null) }}>
                    삭제
                  </button>
                </Row>
              </>
            )}

            {selBond && (
              <>
                <Group label="결합">
                  <Row label="차수">
                    {[1, 2, 3].map((o) => (
                      <button
                        key={o}
                        type="button"
                        className={`fx-insp__btn${selBond.order === o && !selBond.aromatic ? ' is-on' : ''}`}
                        onClick={() => patchBond(selBond.id, { order: o as 1 | 2 | 3, aromatic: false })}
                      >
                        {o}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`fx-insp__btn${selBond.aromatic ? ' is-on' : ''}`}
                      onClick={() => patchBond(selBond.id, { aromatic: !selBond.aromatic, order: 1 })}
                    >
                      방향족
                    </button>
                  </Row>
                  <Field label="모양">
                    <select
                      value={selBond.style ?? 'plain'}
                      onChange={(e) => patchBond(selBond.id, { style: e.target.value as BondStyle })}
                    >
                      {BOND_STYLES.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Row label="">
                    <button
                      type="button"
                      className="fx-insp__btn"
                      title="쐐기와 점선의 방향을 뒤집습니다"
                      onClick={() => patchBond(selBond.id, { a: selBond.b, b: selBond.a })}
                    >
                      방향 뒤집기
                    </button>
                  </Row>
                </Group>
                <Row label="">
                  <button type="button" className="fx-insp__btn fx-insp__btn--danger" onClick={() => { commit(removeBond(molRef.current, selBond.id)); setSel(null) }}>
                    삭제
                  </button>
                </Row>
              </>
            )}

            {selArrow && (
              <>
                <Group label="화살표">
                  <Row label="종류">
                    {ARROWS.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        className={`fx-insp__btn${selArrow.kind === a.id ? ' is-on' : ''}`}
                        onClick={() => patchArrow(selArrow.id, { kind: a.id })}
                      >
                        {a.label}
                      </button>
                    ))}
                  </Row>
                  <Field label="위">
                    <input type="text" value={selArrow.above ?? ''} onChange={(e) => patchArrow(selArrow.id, { above: e.target.value || undefined })} />
                  </Field>
                  <Field label="아래">
                    <input type="text" value={selArrow.below ?? ''} onChange={(e) => patchArrow(selArrow.id, { below: e.target.value || undefined })} />
                  </Field>
                  {selArrow.kind === 'curly' && (
                    <Field label="휨">
                      <SharedNumField integer value={selArrow.bow ?? 30} onCommit={(bow) => patchArrow(selArrow.id, { bow })} />
                    </Field>
                  )}
                </Group>
                <Row label="">
                  <button type="button" className="fx-insp__btn fx-insp__btn--danger" onClick={() => { commit((m) => ({ ...m, arrows: m.arrows.filter((a) => a.id !== selArrow.id) })); setSel(null) }}>
                    삭제
                  </button>
                </Row>
              </>
            )}

            {selLabel && (
              <>
                <Group label="글자">
                  <Field label="내용">
                    <input type="text" value={selLabel.text} onChange={(e) => patchLabel(selLabel.id, { text: e.target.value })} />
                  </Field>
                  <Field label="크기">
                    <SharedNumField integer value={selLabel.size ?? Math.round(st.fontSize)} onCommit={(size) => patchLabel(selLabel.id, { size })} />
                  </Field>
                </Group>
                <Row label="">
                  <button type="button" className="fx-insp__btn fx-insp__btn--danger" onClick={() => { commit((m) => ({ ...m, labels: m.labels.filter((l) => l.id !== selLabel.id) })); setSel(null) }}>
                    삭제
                  </button>
                </Row>
              </>
            )}
          </Inspector>
        )}

        {!sel && <p className="fx-insp-tip">{TOOLS.find((t) => t.id === tool)?.hint}</p>}

        {toast && <div className="toast">{toast}</div>}
      </div>

      <div className="editor cd-sizebar">
        <span className="toolbar__label">그림 크기</span>
        <input
          type="range"
          min={0.6}
          max={2}
          step={0.05}
          value={sizeScale}
          aria-label="구조식 크기"
          onChange={(e) => setSizeScale(Number(e.target.value))}
        />
        <span className="cd-count">{sizeScale.toFixed(2)}×</span>
        <span className="toolbar__spacer" />
        <Text variant="chrome" muted>
          {`원자 ${mol.atoms.length} · 결합 ${mol.bonds.length}`}
        </Text>
      </div>

      <Text variant="chrome" muted className="hint">
        결합은 30°에 스냅됩니다 · 결합 위에 고리를 놓으면 융합 · Delete로 삭제 · 1·2·3 키로 결합 차수
      </Text>
    </div>
  )
}
