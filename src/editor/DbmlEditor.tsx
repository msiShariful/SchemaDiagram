import { useEffect, useRef } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { setDiagnostics } from '@codemirror/lint';
import { dbmlLanguage } from './dbmlLanguage';
import { errorToDiagnostic } from './diagnostics';
import { createDbmlCompletion } from './completion';
import { registerEditorView, applyFormat } from './editorNav';
import { buildTableRanges, tableAtPos } from './sourceMap';
import { useAppStore } from '../app/store';

export function DbmlEditor() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    // References `view` only inside the callback, which runs after `view` is
    // assigned below — safe despite the temporal-looking ordering.
    const trackFocus = EditorView.updateListener.of((update) => {
      if (!update.selectionSet && !update.docChanged) return;
      if (focusTimer) clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        const pos = view.state.selection.main.head;
        const range = tableAtPos(buildTableRanges(view.state.doc.toString()), pos);
        useAppStore.getState().setEditorFocusTable(range?.tableId ?? null);
      }, 150);
    });

    const view = new EditorView({
      doc: useAppStore.getState().source,
      parent: hostRef.current!,
      extensions: [
        basicSetup,
        dbmlLanguage,
        dbmlLanguage.data.of({
          autocomplete: createDbmlCompletion(() => useAppStore.getState().schema),
        }),
        keymap.of([{ key: 'Mod-Shift-f', run: () => applyFormat() }]),
        EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'ui-monospace, monospace' } }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            useAppStore.getState().setSource(update.state.doc.toString());
          }
        }),
        trackFocus,
      ],
    });
    viewRef.current = view;
    registerEditorView(view);

    const unsubErrors = useAppStore.subscribe(
      (s) => s.errors,
      (errors) => {
        const diags = errors.map((e) => errorToDiagnostic(view.state.doc, e));
        view.dispatch(setDiagnostics(view.state, diags));
      },
      // Seed squiggles for errors already in the store when the editor mounts.
      { fireImmediately: true },
    );
    const unsubSource = useAppStore.subscribe(
      (s) => s.source,
      (source) => {
        // External replacement (diagram switch). Skip if the view already has this text.
        if (view.state.doc.toString() !== source) {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
        }
      },
    );
    return () => {
      unsubErrors();
      unsubSource();
      if (focusTimer) clearTimeout(focusTimer);
      registerEditorView(null);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  return <div ref={hostRef} style={{ height: '100%', overflow: 'hidden' }} />;
}
