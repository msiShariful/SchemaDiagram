import { test, expect } from '@playwright/test';
import { STARTER_TABLE_COUNT } from './helpers';

test('export menu opens on hover and closes after the pointer leaves', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);

  await page.getByRole('button', { name: /export/ }).hover();
  // 100 ms open delay — the auto-retrying expect absorbs it.
  await expect(page.locator('.export-menu .menu-list')).toBeVisible();
  await expect(page.getByRole('button', { name: 'SQL — Oracle' })).toBeVisible();

  // Leave the menu root entirely (the brand sits far left; page.hover jumps
  // the mouse, so no other hover menu opens in passing).
  await page.locator('.brand').hover();
  // 250 ms close grace — again absorbed by the retrying expect.
  await expect(page.locator('.export-menu .menu-list')).toBeHidden();
});

test('dashboard: create, search, rename, delete', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);

  await page.getByRole('button', { name: /diagrams/ }).click();
  await expect(page.locator('.dash-row')).toHaveCount(1);
  await expect(page.locator('.dash-row .dash-modified')).toContainText('Today at'); // relative dates live

  // Create: switches to the new diagram and closes the overlay.
  await page.getByRole('button', { name: 'New Diagram' }).click();
  await expect(page.locator('.dashboard')).toBeHidden();
  await page.getByRole('button', { name: /diagrams/ }).click();
  await expect(page.locator('.dash-row')).toHaveCount(2);

  // Rename the newest row (first — list is sorted by updatedAt desc).
  const first = page.locator('.dash-row').first();
  await first.getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('button', { name: 'Rename' }).click();
  await first.locator('input').fill('Renamed via dashboard');
  await first.locator('input').press('Enter');
  await expect(page.locator('.dash-row').filter({ hasText: 'Renamed via dashboard' })).toHaveCount(1);

  // Search filters by name.
  await page.locator('.dash-search').fill('Renamed');
  await expect(page.locator('.dash-row')).toHaveCount(1);
  await page.locator('.dash-search').fill('');
  await expect(page.locator('.dash-row')).toHaveCount(2);

  // Delete the OTHER (non-current) row, with the two-step confirm.
  const other = page.locator('.dash-row').filter({ hasText: 'Untitled' }).first();
  await other.getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await other.getByRole('button', { name: 'confirm ✓' }).click();
  await expect(page.locator('.dash-row')).toHaveCount(1);
});

test('visibility: eye toggle hides table + edges, persists across reload, All restores', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(3);
  await expect(page.locator('.edge')).toHaveCount(3);

  await page.locator('.views-tab').click();
  await expect(page.locator('.views-panel')).toBeVisible();
  await expect(page.locator('.views-schema')).toContainText('3/3');

  // Hide `comments` — two of the three starter refs touch it.
  await page
    .locator('.views-table-row')
    .filter({ hasText: 'comments' })
    .getByRole('button', { name: 'Toggle visibility' })
    .click();
  await expect(page.locator('.table-node')).toHaveCount(2);
  await expect(page.locator('.edge')).toHaveCount(1);
  await expect(page.locator('.views-schema')).toContainText('2/3');

  // Await the 1 s debounced autosave by polling IndexedDB for the exact
  // persisted value — deterministic, no sleeps.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<string>((resolve) => {
              const req = indexedDB.open('dbdraft');
              req.onsuccess = () => {
                const db = req.result;
                const all = db.transaction('diagrams').objectStore('diagrams').getAll();
                all.onsuccess = () => {
                  db.close();
                  const rows = all.result as Array<{ hiddenTableIds?: string[] }>;
                  resolve(JSON.stringify(rows[0]?.hiddenTableIds ?? []));
                };
              };
            }),
        ),
      { timeout: 10_000 },
    )
    .toBe(JSON.stringify(['public.comments']));

  await page.reload();
  await expect(page.locator('.table-node')).toHaveCount(2); // hidden state survived
  await expect(page.locator('.edge')).toHaveCount(1);

  await page.locator('.views-tab').click(); // sidebar collapse is session state — reopen
  await page.getByRole('button', { name: 'All' }).click();
  await expect(page.locator('.table-node')).toHaveCount(3);
  await expect(page.locator('.edge')).toHaveCount(3);
});

test('table settings popover writes headerColor into the DBML and repaints the header', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(3);

  const users = page.locator('.table-node').filter({
    has: page.locator('.table-title', { hasText: 'users' }),
  });
  await users.hover(); // CSS :hover reveals the gear
  await users.locator('.table-gear').click();
  await expect(page.locator('.table-settings')).toBeVisible();

  await page.locator('.swatch[data-color="#e91e63"]').click();

  // The popover routed a TEXT edit through editorNav — the DBML changed…
  await expect(page.locator('.cm-content')).toContainText('Table users [headerColor: #e91e63]');
  // …and the parse pipeline repainted the header fill (~300 ms debounce,
  // absorbed by the retrying expect).
  await expect(users.locator('.table-header')).toHaveAttribute('fill', '#e91e63');
});
