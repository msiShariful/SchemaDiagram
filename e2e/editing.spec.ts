import { test, expect } from '@playwright/test';
import { setEditorText, STARTER_TABLE_COUNT } from './helpers';

const TWO_TABLES = `Table customers {
  id integer [pk]
  name varchar
}

Table orders {
  id integer [pk]
  customer_id integer
}

Ref: orders.customer_id > customers.id
`;

test('typing DBML renders tables and edges on the canvas', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);

  await setEditorText(page, TWO_TABLES);

  await expect(page.locator('.table-node')).toHaveCount(2);
  await expect(page.locator('.table-title').filter({ hasText: 'customers' })).toBeVisible();
  await expect(page.locator('.edge')).toHaveCount(1);
  await expect(page.locator('.statusbar .status-ok')).toBeVisible();
});

test('broken syntax keeps the last good diagram and shows the stale badge', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);
  await setEditorText(page, TWO_TABLES);
  await expect(page.locator('.table-node')).toHaveCount(2);

  await setEditorText(page, 'Table broken {\n  id integer');

  await expect(page.locator('.badge.stale')).toBeVisible();
  await expect(page.locator('.table-node')).toHaveCount(2); // never a blank canvas
  await expect(page.locator('.statusbar .status-errors')).toBeVisible();

  // fixing the text clears the badge again
  await setEditorText(page, TWO_TABLES);
  await expect(page.locator('.badge.stale')).toBeHidden();
  await expect(page.locator('.statusbar .status-ok')).toBeVisible();
});
