/* A number input you can actually type in.
 *
 * Binding a number straight to an <input> fights the user: "-" and "1." and ""
 * are all unparseable mid-typing, so a controlled numeric value snaps them away
 * as they type. This keeps the raw text locally and only commits on blur/Enter,
 * reverting to the last good value if what was typed isn't a number.
 *
 * The class name is a prop because each tool's CSS is scoped to itself. */

import { useState } from 'react'

export interface NumFieldProps {
  value: number
  onCommit: (n: number) => void
  /** tool-scoped class, e.g. 'nl-num'. Omitted inside the shared Inspector,
   *  which styles its own inputs. */
  className?: string
  /** integers reject '1.5' rather than truncating it */
  integer?: boolean
  width?: string
}

export default function NumField({
  value,
  onCommit,
  className,
  integer = false,
  width,
}: NumFieldProps) {
  const [text, setText] = useState(String(value))

  // Re-sync when the committed value changes underneath us (auto-fit, reset).
  // Adjusting during render rather than in an effect keeps it to a single pass
  // and never paints the stale text.
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setText(String(value))
  }

  const commit = () => {
    const n = integer ? parseInt(text, 10) : parseFloat(text)
    if (Number.isFinite(n)) onCommit(n)
    else setText(String(value))
  }

  return (
    <input
      className={className}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      style={width ? { width } : undefined}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}
