import { Component, type ReactNode } from 'react';
import { useAppStore } from './store';
import { downloadText } from './export/download';
import { safeFilename } from './export/exportCss';

interface State {
  error: Error | null;
}

/** React error boundary around the canvas pane (spec §9): a canvas crash
 *  must never take the editor with it. The DBML lives in the store/editor
 *  and is untouched by a render crash — the fallback offers a one-click
 *  .dbml download (in-memory only, works with storage unavailable) and a
 *  re-render button. "Re-render" clears the error; since the children were
 *  unmounted while the fallback showed, React mounts a fresh DiagramCanvas
 *  (fresh refs and gesture ledgers) — if the underlying state still
 *  crashes it, the boundary simply catches again. */
export class CanvasErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="canvas-crash">
        <h3>The diagram canvas crashed</h3>
        <p>
          Your DBML is intact and the editor on the left still works.
          Download a copy, then re-render the canvas.
        </p>
        <pre className="canvas-crash-detail">{this.state.error.message}</pre>
        <div className="canvas-crash-actions">
          <button
            onClick={() => {
              const s = useAppStore.getState();
              downloadText(s.source, `${safeFilename(s.diagramName)}.dbml`);
            }}
          >
            Download your work (.dbml)
          </button>
          <button className="primary" onClick={() => this.setState({ error: null })}>
            Re-render canvas
          </button>
        </div>
      </div>
    );
  }
}
