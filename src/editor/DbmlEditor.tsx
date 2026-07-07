import { useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { setDiagnostics } from '@codemirror/lint';
import { dbmlLanguage } from './dbmlLanguage';
import { errorToDiagnostic } from './diagnostics';
import { useAppStore } from '../app/store';

export function DbmlEditor() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const view = new EditorView({
      doc: useAppStore.getState().source,
      parent: hostRef.current!,
      extensions: [
        basicSetup,
        dbmlLanguage,
        EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'ui-monospace, monospace' } }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            useAppStore.getState().setSource(update.state.doc.toString());
          }
        }),
      ],
    });
    viewRef.current = view;

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
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  return <div ref={hostRef} style={{ height: '100%', overflow: 'hidden' }} />;
}
