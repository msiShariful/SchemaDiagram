import { useAppStore } from '../app/store';
import { applyTableSettings } from '../editor/editorNav';
import { HEADER_SWATCHES } from './TableSettingsPopover';
import { TABLE_WIDTH } from '../core/model/geometry';

/** dbdiagram-style quick color strip: floats above the hovered table, one
 *  click recolors the header (same text-bridge path as the settings
 *  popover — one transaction, editor history owns undo). The ⋯ button opens
 *  the full settings popover for rename/hex. Hover-transient chrome: not on
 *  the overlay stack, keeps itself alive via onKeep (linger timer in
 *  DiagramCanvas). Known ceiling, settings-popover parity: holds still
 *  during an imperative pan/drag, resyncs at commit. */
const STRIP_SWATCHES = HEADER_SWATCHES.slice(0, 8);

export function TableColorStrip({
  tableId,
  onKeep,
  onRelease,
  onOpenSettings,
}: {
  tableId: string;
  onKeep: () => void;
  onRelease: () => void;
  onOpenSettings: (id: string) => void;
}) {
  const viewport = useAppStore((s) => s.viewport);
  const pos = useAppStore((s) => s.positions[tableId]);
  const table = useAppStore((s) => s.schema.tables.find((t) => t.id === tableId));
  if (!pos || !table) return null;

  const current = table.headerColor?.toLowerCase() ?? null;
  return (
    <div
      className="color-strip"
      style={{
        left: viewport.x + pos.x * viewport.zoom,
        top: viewport.y + pos.y * viewport.zoom - 38,
        minWidth: TABLE_WIDTH * Math.min(viewport.zoom, 1),
      }}
      onPointerEnter={onKeep}
      onPointerLeave={onRelease}
    >
      {STRIP_SWATCHES.map((c) => (
        <button
          key={c}
          className={`cs-swatch${current === c.toLowerCase() ? ' active' : ''}`}
          style={{ background: c }}
          aria-label={`Set header color ${c}`}
          title={c}
          onClick={() => applyTableSettings(tableId, { headerColor: c })}
        />
      ))}
      <button
        className="cs-clear"
        aria-label="Clear header color"
        title="Clear header color"
        onClick={() => applyTableSettings(tableId, { headerColor: null })}
      >
        ✕
      </button>
      <button
        className="cs-more"
        aria-label="Table settings"
        title="Rename / custom hex"
        onClick={() => onOpenSettings(tableId)}
      >
        ⋯
      </button>
    </div>
  );
}
