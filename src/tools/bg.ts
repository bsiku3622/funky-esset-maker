/* The background choice, shared by the six tools that offer one.
 *
 * Split from BgPicker.tsx because a file that exports a component and a
 * constant loses its Fast Refresh boundary — the same reason cores/palette.ts
 * exists next to Chart.tsx. */

export type BgKey = 'transparent' | 'cream' | 'white' | 'dark'

/** null means "leave it transparent" — the export path checks for it. */
export const BG_HEX: Record<BgKey, string | null> = {
  transparent: null,
  cream: '#fff5d1',
  white: '#ffffff',
  dark: '#1e1e22',
}

export const BG_LABEL: Record<BgKey, string> = {
  transparent: '투명',
  cream: '크림',
  white: '흰색',
  dark: '어두움',
}

export const BG_KEYS = Object.keys(BG_HEX) as BgKey[]
