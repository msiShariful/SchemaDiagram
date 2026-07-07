export function App() {
  return (
    <div className="app-shell">
      <header className="toolbar">
        <span className="brand">DBDraft</span>
      </header>
      <main className="workspace">
        <section className="editor-pane">editor</section>
        <div className="divider" />
        <section className="canvas-pane">canvas</section>
      </main>
    </div>
  );
}
