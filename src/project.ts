/* Project files — one format for every tool.
 *
 * A saved project is the tool's own persisted state (exactly what it keeps in
 * localStorage) wrapped in an envelope that says which tool it belongs to. That
 * is what makes "open" a single command: you drop any .json on any tool and the
 * app switches to the one that owns it, instead of you having to remember which
 * editor made which file.
 *
 * Reusing the localStorage shape as the payload is deliberate. It means saving
 * needs nothing from the tool — the app reads the key the tool already writes —
 * and loading is just writing that key back and remounting. No tool has to grow
 * an import/export path of its own, and none can drift out of sync with one. */

import type { Theme } from './theme'

export const APP_ID = 'funky-esset-maker'
/** envelope version — bump only when the wrapper changes, not the payloads */
export const FORMAT = 1

export type ToolId =
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
  | 'hwpmath'
  | 'chem'
  | 'qr'

export interface ProjectFile {
  app: typeof APP_ID
  format: number
  /** which tool owns `data` */
  tool: ToolId
  /** ISO 8601, for the reader's benefit — nothing depends on it */
  savedAt: string
  /** free-text name; falls back to the tool's label when absent */
  name?: string
  /** which look it was authored in. Optional and additive: a file without it
   *  opens in whatever mode the app is already in, which is what every project
   *  saved before paper mode existed should do. */
  theme?: Theme
  /** the tool's persisted state, verbatim */
  data: unknown
}

/** Where each tool keeps its state. These strings are a compatibility surface:
 *  changing one orphans every project file and every browser's saved work. */
export const STORE_KEYS: Record<ToolId, string> = {
  highlighter: 'highlighter.v1',
  latex: 'lateximager.v1',
  tabler: 'tabler.v1',
  dsviz: 'dsviz.v1',
  grapher: 'grapher:v1',
  aifig: 'fem.aifig.v1',
  cartesian: 'fem.cartesian.v3',
  chart: 'fem.chart.v1',
  numline: 'fem.numline.v1',
  truth: 'fem.truth.v1',
  hwpmath: 'fem.hwpmath.v1',
  chem: 'fem.chem.v1',
  qr: 'fem.qr.v1',
}

export const TOOL_IDS = Object.keys(STORE_KEYS) as ToolId[]

const isToolId = (v: unknown): v is ToolId =>
  typeof v === 'string' && (TOOL_IDS as string[]).includes(v)

/* ---------- reading ---------- */

export type ParseResult =
  | { ok: true; project: ProjectFile }
  | { ok: false; error: string }

/** Parse a dropped/opened file's text into a project.
 *
 *  `fallbackTool` accepts a bare payload — AI Figure Maker shipped raw figure
 *  JSON before this envelope existed, and those files should still open. It is
 *  only consulted when the JSON is an object that is clearly not an envelope. */
export function parseProject(text: string, fallbackTool?: ToolId): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'JSON을 읽을 수 없습니다' }
  }
  if (typeof raw !== 'object' || raw === null)
    return { ok: false, error: '프로젝트 파일이 아닙니다' }

  const obj = raw as Record<string, unknown>

  if (obj.app === APP_ID) {
    if (!isToolId(obj.tool))
      return { ok: false, error: `모르는 도구입니다: ${String(obj.tool)}` }
    if (typeof obj.format === 'number' && obj.format > FORMAT)
      return {
        ok: false,
        error: '더 새로운 버전에서 저장된 파일입니다 — 앱을 새로고침해 주세요',
      }
    return {
      ok: true,
      project: {
        app: APP_ID,
        format: typeof obj.format === 'number' ? obj.format : FORMAT,
        tool: obj.tool,
        savedAt: typeof obj.savedAt === 'string' ? obj.savedAt : '',
        name: typeof obj.name === 'string' ? obj.name : undefined,
        theme: obj.theme === 'paper' || obj.theme === 'funky' ? obj.theme : undefined,
        data: obj.data,
      },
    }
  }

  // pre-envelope file: treat the whole object as the payload
  if (fallbackTool)
    return {
      ok: true,
      project: {
        app: APP_ID,
        format: FORMAT,
        tool: fallbackTool,
        savedAt: '',
        data: obj,
      },
    }

  return { ok: false, error: 'Funky Esset Maker 프로젝트 파일이 아닙니다' }
}

/* ---------- writing ---------- */

/** Wrap whatever the tool has in localStorage right now. Returns null when the
 *  tool has never saved anything — there is nothing to export yet. */
export function buildProject(
  tool: ToolId,
  opts: { name?: string; theme?: Theme } = {},
): ProjectFile | null {
  let data: unknown
  try {
    const raw = localStorage.getItem(STORE_KEYS[tool])
    if (raw === null) return null
    data = JSON.parse(raw)
  } catch {
    return null
  }
  return {
    app: APP_ID,
    format: FORMAT,
    tool,
    savedAt: new Date().toISOString(),
    ...(opts.name ? { name: opts.name } : null),
    ...(opts.theme ? { theme: opts.theme } : null),
    data,
  }
}

/** Write a loaded project into the tool's slot. The caller remounts the tool so
 *  it re-reads the slot on mount. */
export function applyProject(project: ProjectFile): boolean {
  try {
    localStorage.setItem(STORE_KEYS[project.tool], JSON.stringify(project.data))
    return true
  } catch {
    return false
  }
}

/* ---------- files ---------- */

export function downloadProject(project: ProjectFile, filename: string) {
  const blob = new Blob([JSON.stringify(project, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Open the system file picker and resolve with the chosen file's text. */
export function pickJsonFile(): Promise<{ text: string; name: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    // Safari fires no event when the picker is dismissed, so this promise can
    // stay pending — harmless, the element is dropped with the closure.
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      resolve({ text: await file.text(), name: file.name })
    }
    input.click()
  })
}
