/* What catches a tool that cannot render what it was given.
 *
 * A tool's saved state is not necessarily something this app wrote. A project
 * file is plain JSON, hand-editable, and `llms.txt` exists to invite an
 * assistant to author one — so a payload that is the right shape only in
 * places is a normal input here, not a corrupt-file edge case.
 *
 * Without a boundary the cost of that is total and sticky: a throw during
 * render unmounts the whole tree (sidebar included, so no other tool can be
 * reached), and because the payload is already in localStorage, reloading
 * replays the same crash. The only way out is the devtools console, which is
 * not a recovery path anyone should need.
 *
 * So the failure is contained to the tool, and the offer is the one thing that
 * actually fixes it: clear that tool's slot. `useStored` filters the obvious
 * shape mismatches first; this is for what gets through. */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** changes when the mounted tool changes — clears a stale error */
  resetKey: string
  toolLabel: string
  /** wipe the tool's saved state and remount it */
  onClear: () => void
  children: ReactNode
}

interface State {
  error: Error | null
  /** the resetKey the current error belongs to */
  key: string
}

export default class ToolBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  /* Switching tools (or loading a project) has to clear the error, or the
     fallback would outlive the thing that failed. */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.key ? null : { error: null, key: props.resetKey }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[funky-esset-maker] ${this.props.toolLabel} 렌더 실패`, error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="fem__crash" role="alert">
        <div className="fem__crash-box">
          <h2>이 도구를 열 수 없습니다</h2>
          <p className="fem__crash-note">
            {this.props.toolLabel}에 저장된 내용이 이 도구가 아는 형태가 아닙니다.
            붙여넣거나 불러온 JSON의 항목 하나가 어긋났을 때 생깁니다 — 지우고 새로
            시작해도 다른 도구의 작업은 그대로 남습니다.
          </p>
          <pre className="fem__crash-why">{error.message}</pre>
          <div className="fem__crash-row">
            <button
              type="button"
              className="fem__action"
              onClick={() => this.setState({ error: null })}
            >
              다시 시도
            </button>
            <button
              type="button"
              className="fem__action fem__action--go"
              onClick={this.props.onClear}
            >
              저장된 내용 지우고 새로 시작
            </button>
          </div>
        </div>
      </div>
    )
  }
}
