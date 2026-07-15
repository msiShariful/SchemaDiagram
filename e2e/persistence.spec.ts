import { test, expect } from '@playwright/test';
import { setEditorText, STARTER_TABLE_COUNT } from './helpers';

const SOLO = 'Table solo {\n  id integer [pk]\n}\n';

function translateOf(transform: string): { x: number; y: number } {
  const m = /translate\((-?[\d.]+), (-?[\d.]+)\)/.exec(transform);
  if (!m) throw new Error(`unexpected transform: ${transform}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** Drag the (single) table's header by an off-grid delta; returns nothing —
 *  callers assert on the resulting transform. */
async function dragSoloBy(page: import('@playwright/test').Page, dx: number, dy: number) {
  const node = page.locator('.table-node');
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 10); // header row
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + 10 + dy, { steps: 8 });
  await page.mouse.up();
}

test('drag snaps to the grid and canvas undo restores the position', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);
  // One table → zero alignment candidates → snapPosition always grid-snaps,
  // which makes the % 16 assertion deterministic (no alignment-vs-grid race).
  await setEditorText(page, SOLO);
  await expect(page.locator('.table-node')).toHaveCount(1);

  const node = page.locator('.table-node');
  const before = (await node.getAttribute('transform'))!;
  await dragSoloBy(page, 203, 157); // deliberately off-grid delta

  await expect(node).not.toHaveAttribute('transform', before);
  const after = translateOf((await node.getAttribute('transform'))!);
  expect(after.x % 16).toBe(0); // GRID_SIZE snap (src/canvas/snap.ts)
  expect(after.y % 16).toBe(0);

  await page.keyboard.press('ControlOrMeta+z'); // canvas pane focused (click landed on canvas)
  await expect(node).toHaveAttribute('transform', before);
});

test('reload restores text, dragged position and diagram', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);
  await setEditorText(page, SOLO);
  await expect(page.locator('.table-node')).toHaveCount(1);
  await dragSoloBy(page, 160, 96);
  const dragged = (await page.locator('.table-node').getAttribute('transform'))!;
  const { x, y } = translateOf(dragged);

  // Poll IndexedDB until the 1 s debounced autosave has persisted BOTH the
  // text and the dragged position — deterministic, no sleeps.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<string>((resolve) => {
              const req = indexedDB.open('schemadiagram');
              req.onsuccess = () => {
                const db = req.result;
                const all = db.transaction('diagrams').objectStore('diagrams').getAll();
                all.onsuccess = () => {
                  db.close();
                  const rows = all.result as Array<{
                    dbml: string;
                    positions: Record<string, { x: number; y: number }>;
                  }>;
                  const row = rows.find((r) => r.dbml.includes('Table solo'));
                  resolve(JSON.stringify(row?.positions['public.solo'] ?? null));
                };
              };
            }),
        ),
      { timeout: 10_000 },
    )
    .toBe(JSON.stringify({ x, y }));

  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Table solo');
  await expect(page.locator('.table-node')).toHaveCount(1);
  await expect(page.locator('.table-node')).toHaveAttribute('transform', dragged);
});

test('snapshot restore round-trips non-destructively', async ({ page }) => {
  const snapshotCount = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const req = indexedDB.open('schemadiagram');
          req.onsuccess = () => {
            const db = req.result;
            const all = db.transaction('snapshots').objectStore('snapshots').getAll();
            all.onsuccess = () => {
              db.close();
              resolve(all.result.length);
            };
          };
        }),
    );

  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);
  // Await the STARTER snapshot BEFORE editing: bootstrap's putDiagram writes
  // no snapshot, and scheduleAutosave clears + re-arms on every state change
  // — an edit landing first would cancel the starter autosave and only ONE
  // snapshot would ever exist (deterministically, on any machine speed).
  await expect.poll(snapshotCount, { timeout: 10_000 }).toBe(1);

  await setEditorText(page, SOLO);
  await expect(page.locator('.table-node')).toHaveCount(1);
  await expect.poll(snapshotCount, { timeout: 10_000 }).toBe(2); // + the clean SOLO edit

  // The panel fetches on open — both rows are guaranteed present by now.
  await page.getByRole('button', { name: /history/ }).click();
  await expect(page.locator('.history-panel li')).toHaveCount(2);

  // Restore the OLDEST snapshot (the starter text) …
  await page.locator('.history-panel li').last().getByRole('button', { name: 'restore' }).click();
  await expect(page.locator('.cm-content')).toContainText('Table users');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);

  // … then restore the NEWEST row (the SOLO edit) — proving the restore
  // destroyed nothing and History round-trips.
  await page.locator('.history-panel li').first().getByRole('button', { name: 'restore' }).click();
  await expect(page.locator('.cm-content')).toContainText('Table solo');
  await expect(page.locator('.table-node')).toHaveCount(1);
});

test('theme toggle persists across reload and is applied before React boots', async ({ page }) => {
  // Record what the pre-React inline script (index.html, Task 5) stamped by
  // DOMContentLoaded — React's useEffect stamp runs after paint, so a 'dark'
  // value here proves the FOUC guard did it.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      (window as unknown as { __themeAtDomReady?: string }).__themeAtDomReady =
        document.documentElement.dataset.theme ?? 'unset';
    });
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(
    await page.evaluate(
      () => (window as unknown as { __themeAtDomReady?: string }).__themeAtDomReady,
    ),
  ).toBe('dark');
});
