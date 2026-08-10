/* Two looks, one app.
 *
 * The funky look is the default and the reason the tools exist: neon fills,
 * 2px black outlines, hard shadows — an asset you drop on a slide and it reads
 * from the back of the room.
 *
 * Paper mode is the same content drawn the way a journal draws it: hairline
 * rules, no fills behind text, serif labels, a colour-vision-safe categorical
 * palette. It is a *render* mode, not a different document — every tool keeps
 * one state and paints it either way, so you can author on a slide and export
 * for a paper without redoing the work.
 *
 * The mode is app-level rather than per-tool: it answers "what am I making
 * today", which does not change when you switch from the table to the plot.
 * A saved project records it (see project.ts) so a figure reopens the way it
 * was exported. */

import { createContext, useContext } from 'react'

export type Theme = 'funky' | 'paper'

export const THEME_KEY = 'fem.theme.v1'

export const THEME_LABEL: Record<Theme, string> = {
  funky: '펑키',
  paper: '논문',
}

export const ThemeCtx = createContext<Theme>('funky')

export const useTheme = () => useContext(ThemeCtx)

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'paper' ? 'paper' : 'funky'
  } catch {
    return 'funky'
  }
}
