/* Small SVG pieces shared by every renderer. */

import type { ReactNode } from 'react'
import { UI_ONLY } from '../figure'
import type { TickMark } from './scale'

/** A tick label, with the superscript a log or exponent tick carries.
 *
 *  ⚠️ The superscript is a `dy`-shifted tspan, not `baseline-shift`. Illustrator
 *  and Inkscape ignore baseline-shift on import and drop the exponent onto the
 *  baseline, which turns 10⁻⁴ into 10-4. */
export function TickLabel({
  t,
  x,
  y,
  anchor = 'middle',
  size,
  fill,
  font,
  weight,
  angle,
}: {
  t: TickMark
  x: number
  y: number
  anchor?: 'start' | 'middle' | 'end'
  size: number
  fill: string
  font: string
  weight?: number
  angle?: number
}) {
  const body = t.sup ? (
    <>
      {t.label}
      <tspan fontSize={size * 0.72} dy={-size * 0.42}>
        {t.sup}
      </tspan>
    </>
  ) : (
    t.label
  )
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontSize={size}
      fill={fill}
      fontFamily={font}
      fontWeight={weight}
      transform={angle ? `rotate(${angle} ${x} ${y})` : undefined}
    >
      {body}
    </text>
  )
}

/** Editor chrome — a selection ring, a hit target. Carries the attribute that
 *  strips it from an exported file. */
export const Ui = ({ children }: { children: ReactNode }) => (
  <g {...{ [UI_ONLY]: '1' }}>{children}</g>
)

export const SELECT_INK = '#7828c8'
