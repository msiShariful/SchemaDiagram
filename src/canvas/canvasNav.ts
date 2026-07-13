/** Registered-handle bridge into the live DiagramCanvas — the same pattern
 *  editorNav uses for the editor (single registered instance, callers no-op
 *  when nothing is mounted). Feature D's sidebar uses it to center a table. */
export interface CanvasHandle {
  centerOnTable(id: string): void;
}

let current: CanvasHandle | null = null;

export function registerCanvasHandle(h: CanvasHandle | null): void {
  current = h;
}

export function centerOnTable(id: string): void {
  current?.centerOnTable(id);
}
