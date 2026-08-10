import { Button } from '@studio-baeks/funky-ui'
import type { History } from './hooks'

/* Undo/redo, in the same place in every toolbar.
 *
 * The arrows are inline SVG rather than ↶ / ↷: those code points are missing
 * from Pretendard and render as tofu boxes, which is a worse button than no
 * icon at all. */

export const UndoArrow = ({ flip }: { flip?: boolean }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
    style={flip ? { transform: 'scaleX(-1)' } : undefined}
  >
    <path
      d="M6 3 2 6.6 6 10.2"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="miter"
    />
    <path
      d="M2.6 6.6h6.6a3.6 3.6 0 0 1 0 7.2H6.2"
      stroke="currentColor"
      strokeWidth="2"
    />
  </svg>
)

export default function UndoRedo({ history }: { history: History }) {
  return (
    <div className="toolbar__group" role="group" aria-label="실행 취소 / 다시 실행">
      <Button
        variant="neutral"
        size="sm"
        title="실행 취소 (⌘Z)"
        aria-label="실행 취소"
        onClick={history.undo}
        disabled={!history.canUndo}
      >
        <UndoArrow />
      </Button>
      <Button
        variant="neutral"
        size="sm"
        title="다시 실행 (⌘⇧Z)"
        aria-label="다시 실행"
        onClick={history.redo}
        disabled={!history.canRedo}
      >
        <UndoArrow flip />
      </Button>
    </div>
  )
}
