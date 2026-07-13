import { useState } from 'react';
import { useAppStore } from './store';
import { renameDiagram } from './usePersistence';
import { DiagramDashboard } from './DiagramDashboard';

export function DiagramManager() {
  const diagramName = useAppStore((s) => s.diagramName);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);

  return (
    <div className="diagram-manager">
      {editingName ? (
        <input
          className="name-input"
          autoFocus
          defaultValue={diagramName}
          onBlur={(e) => {
            void renameDiagram(e.target.value);
            setEditingName(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      ) : (
        <button className="name-button" onClick={() => setEditingName(true)} title="Rename">
          {diagramName} ✎
        </button>
      )}
      {/* CLICK-open by design (documented in the plan): Feature C replaces the
          dropdown with a full-height overlay, and hover-opening something
          that steals the whole screen is hostile. useHoverMenu stays the
          shared behavior for dropdown-shaped menus (Export, History). */}
      <button onClick={() => setDashboardOpen(true)}>▼ diagrams</button>
      {dashboardOpen && <DiagramDashboard onClose={() => setDashboardOpen(false)} />}
    </div>
  );
}
