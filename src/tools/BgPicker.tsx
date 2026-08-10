import { BG_HEX, BG_KEYS, BG_LABEL, type BgKey } from './bg'
import './BgPicker.css'

/* The background choice, once.
 *
 * Six tools carried an identical four-entry array and an identical row of four
 * text buttons — about 230px of toolbar each, in a row that was already
 * wrapping. Swatches say the same thing in a third of the space, and they match
 * the colour controls sitting next to them in the same toolbars.
 *
 * Transparent is drawn as a miniature of the stage's checkerboard, which is
 * what the user will see behind the figure if they pick it. */

export default function BgPicker({
  value,
  onChange,
}: {
  value: BgKey
  onChange: (key: BgKey) => void
}) {
  return (
    <div className="toolbar__group" role="group" aria-label="배경">
      <span className="toolbar__label">배경</span>
      <div className="swatches">
        {BG_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            title={BG_LABEL[key]}
            aria-label={BG_LABEL[key]}
            aria-pressed={value === key}
            className={`swatch fx-bg fx-bg--${key}${value === key ? ' swatch--active' : ''}`}
            style={BG_HEX[key] ? { background: BG_HEX[key]! } : undefined}
            onClick={() => onChange(key)}
          />
        ))}
      </div>
    </div>
  )
}
