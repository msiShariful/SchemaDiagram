import { test, expect } from '@playwright/test';
import { setEditorText, STARTER_TABLE_COUNT } from './helpers';

test('ref-drag: field handle to field row appends a Ref line and draws the edge', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);
  await expect(page.locator('.edge')).toHaveCount(3);

  const postsTitleRow = page
    .locator('.table-node')
    .filter({ has: page.locator('.table-title', { hasText: 'posts' }) })
    .locator('.field-row')
    .filter({ hasText: 'title' });
  const usersNameRow = page
    .locator('.table-node')
    .filter({ has: page.locator('.table-title', { hasText: 'users' }) })
    .locator('.field-row')
    .filter({ hasText: 'username' });

  await postsTitleRow.hover(); // CSS :hover reveals the handle
  const handle = postsTitleRow.locator('.ref-handle');
  const from = (await handle.boundingBox())!;
  const to = (await usersNameRow.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // A few intermediate moves: the temp line is imperative, but the drop only
  // reads the release point — steps just make the gesture realistic.
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2);
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2);
  await page.mouse.up();

  await expect(page.locator('.cm-content')).toContainText('Ref: posts.title > users.username');
  await expect(page.locator('.edge')).toHaveCount(4); // parse debounce absorbed by the retry
});

test('edge popover: cardinality swap and delete are text edits', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.edge')).toHaveCount(3);

  // First edge = first starter ref: posts.user_id > users.id.
  const hit = page.locator('.edge-hit').first();
  const box = (await hit.boundingBox())!;
  await hit.dispatchEvent('click', { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });

  const pop = page.locator('.edge-popover');
  await expect(pop).toBeVisible();
  await expect(pop.locator('.ep-title')).toHaveText('posts.user_id > users.id');
  await expect(pop.locator('.ep-op input').nth(1)).toBeChecked(); // < > - <> order: '>' is index 1

  await pop.locator('.ep-op input').nth(0).click(); // '<'
  await expect(page.locator('.cm-content')).toContainText('Ref: posts.user_id < users.id');
  await expect(pop.locator('.ep-op input').nth(0)).toBeChecked(); // popover survives its own edit

  await pop.getByRole('button', { name: 'Delete ref' }).click();
  await expect(pop).toBeHidden();
  await expect(page.locator('.edge')).toHaveCount(2);
  await expect(page.locator('.cm-content')).not.toContainText('posts.user_id < users.id');
});

test('edge popover refuses inline-defined refs with a Reveal jump', async ({ page }) => {
  await page.goto('/');
  await setEditorText(page, 'Table users { id int }\nTable posts { user_id int [ref: > users.id] }');
  await expect(page.locator('.edge')).toHaveCount(1);

  const hit = page.locator('.edge-hit').first();
  const box = (await hit.boundingBox())!;
  await hit.dispatchEvent('click', { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });

  const pop = page.locator('.edge-popover');
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('Defined inline');
  await expect(pop.locator('.ep-op')).toHaveCount(0); // no radios, no delete
  await pop.getByRole('button', { name: 'Reveal' }).click();
  await expect(pop).toBeHidden();
  // The editor selection landed at the inline ref's token (same line).
  await expect(page.locator('.cm-activeLine')).toContainText('ref: > users.id');
});

test('highlight mode dims everything outside the 1-hop neighborhood; Escape clears', async ({ page }) => {
  await page.goto('/');
  await setEditorText(
    page,
    'Table users { id int }\nTable posts { user_id int [ref: > users.id] }\nTable isolated { id int }',
  );
  await expect(page.locator('.table-node')).toHaveCount(3);

  await page.getByRole('button', { name: 'Toggle highlight mode' }).click();
  await page
    .locator('.table-node')
    .filter({ has: page.locator('.table-title', { hasText: 'users' }) })
    .click();
  await expect(page.locator('.table-node.dimmed')).toHaveCount(1); // isolated
  await expect(page.locator('.edge.dimmed')).toHaveCount(0); // the only edge touches users

  await page.keyboard.press('Escape'); // no overlays open → last-resort clears highlight+selection
  await expect(page.locator('.table-node.dimmed')).toHaveCount(0);
});

test('quick-search: cmd/ctrl+k finds, unhides, and centers a table', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);

  // Hide comments through the views sidebar first.
  await page.locator('.views-tab').click();
  await page
    .locator('.views-table-row')
    .filter({ hasText: 'comments' })
    .getByRole('button', { name: 'Toggle visibility' })
    .click();
  await expect(page.locator('.table-node')).toHaveCount(2);

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('.qs-panel')).toBeVisible();
  await page.locator('.qs-input').fill('com');
  await page.keyboard.press('Enter');
  await expect(page.locator('.qs-panel')).toBeHidden();
  await expect(page.locator('.table-node')).toHaveCount(3); // unhidden
  await expect(
    page.locator('.table-node.focused').filter({ has: page.locator('.table-title', { hasText: 'comments' }) }),
  ).toHaveCount(1); // centered + flashing (1.5 s window, retry-absorbed)
});

test('group collapse: pill, hidden members/edges, persists across reload', async ({ page }) => {
  await page.goto('/');
  await setEditorText(
    page,
    // posts needs an id column — comments' ref targets posts.id, and the 8.3.1
    // semantic pass rejects refs to missing columns (code 4000, found at T15
    // execution). TableGroup members stay newline-separated (code 3017).
    'Table users { id int }\nTable posts {\n  id int\n  user_id int [ref: > users.id]\n}\nTable comments { post_id int [ref: > posts.id] }\nTableGroup g1 {\n  users\n  posts\n}',
  );
  await expect(page.locator('.table-node')).toHaveCount(3);
  await expect(page.locator('.edge')).toHaveCount(2);

  await page.locator('.group-collapse').click();
  await expect(page.locator('.table-node')).toHaveCount(1); // comments only
  await expect(page.locator('.edge')).toHaveCount(0); // both edges touch a collapsed member (accepted divergence)
  await expect(page.locator('.group-pill')).toBeVisible();
  await expect(page.locator('.table-group.collapsed')).toContainText('g1 (2)');

  // 1 s autosave: poll IndexedDB for the persisted collapse — no sleeps.
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
                  const rows = all.result as Array<{ collapsedGroupIds?: string[] }>;
                  resolve(JSON.stringify(rows[0]?.collapsedGroupIds ?? []));
                };
              };
            }),
        ),
      { timeout: 10_000 },
    )
    .toBe(JSON.stringify(['public.g1']));

  await page.reload();
  await expect(page.locator('.table-node')).toHaveCount(1);
  await expect(page.locator('.group-pill')).toBeVisible();

  await page.locator('.group-collapse').click(); // expand
  await expect(page.locator('.table-node')).toHaveCount(3);
  await expect(page.locator('.edge')).toHaveCount(2);
});

test('pdf menu item present; sample diagram creates the full e-commerce schema', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);

  await page.getByRole('button', { name: /export/ }).click();
  await expect(page.getByRole('button', { name: 'To PDF (print)' })).toBeEnabled();
  await page.keyboard.press('Escape'); // overlay stack closes the menu

  await page.getByRole('button', { name: /diagrams/ }).click();
  await page.getByRole('button', { name: 'New Sample Diagram' }).click();
  await expect(page.locator('.dashboard')).toBeHidden();
  await expect(page.locator('.table-node')).toHaveCount(8);
  await expect(page.locator('.group-rect')).toHaveCount(3);
});
