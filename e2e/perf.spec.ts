import { test, expect } from '@playwright/test';
import { makePerfFixture, PERF_TABLE_COUNT } from '../src/core/perf/fixture';

// Spec §10 "performance guard", not a micro-benchmark: budgets are
// deliberately generous so CI never flakes, while regressions this guard
// exists for (parse on the main thread, per-keystroke re-parse, React
// rendering per pan tick) overshoot them by an order of magnitude.
test('120-table fixture renders inside the cold budget and pans without long-task pileup', async ({ page }) => {
  test.slow(); // 3x timeout: this spec deliberately renders 120 tables

  // Fixture-discovered: the 150-ref chain topology (Task 4) places every
  // table directly right of its chain predecessor (placeNewTables always
  // finds that slot free first), so the 120-table bbox is ~33,540 x 312 —
  // one row, extreme aspect ratio. At the default ~1280px viewport, fitting
  // that needs zoom ~0.04, below MIN_ZOOM (0.1, src/canvas/viewport.ts), so
  // zoom-to-fit clamps and culling drops the tables outside the clamped
  // view. A wide viewport keeps the fit-zoom above the floor (unclamped),
  // restoring the "fit -> all 120 mounted" assumption this spec relies on.
  await page.setViewportSize({ width: 4000, height: 1200 });
  await page.goto('/');
  await expect(page.locator('.table-node').first()).toBeVisible(); // app booted (starter parsed)

  const fixture = makePerfFixture();
  await page.evaluate((dbml) => {
    performance.mark('perf:edit');
    // Dev-only store hook (src/main.tsx): the same entry point a keystroke
    // uses (setSource → 300 ms debounce → worker parse → applyParse).
    (window as unknown as { __appStore: { getState(): { setSource(s: string): void } } })
      .__appStore.getState()
      .setSource(dbml);
  }, fixture);

  await page.waitForFunction(
    (n) =>
      (window as unknown as { __appStore: { getState(): { schema: { tables: unknown[] } } } })
        .__appStore.getState().schema.tables.length === n,
    PERF_TABLE_COUNT,
    { timeout: 15_000 },
  );
  const parseToRender = await page.evaluate(async () => {
    // Double rAF: by the second frame the store commit has rendered AND painted.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    performance.mark('perf:rendered');
    return performance.measure('perf:parse-to-render', 'perf:edit', 'perf:rendered').duration;
  });
  // Budget: <5 s cold (locally ~1 s; see file header for rationale). Spec §6
  // asks for sub-second edit-to-render on a laptop — CI asserts the order of
  // magnitude, the browser walkthrough (Task 11) eyeballs the real feel.
  expect(parseToRender).toBeLessThan(5000);

  // Zoom-to-fit: culling now keeps all 120 tables in view → all mounted.
  await page.getByRole('button', { name: 'fit' }).click();
  await expect(page.locator('.table-node')).toHaveCount(PERF_TABLE_COUNT);

  // Pan smoke: middle-button drag across the scene, starting over a table
  // (pan-from-anywhere). Pan bypasses React — a long-task pileup here means
  // the perf contract broke.
  await page.evaluate(() => {
    (window as unknown as { __longTasks: number }).__longTasks = 0;
    new PerformanceObserver((list) => {
      (window as unknown as { __longTasks: number }).__longTasks += list.getEntries().length;
    }).observe({ entryTypes: ['longtask'] });
  });
  const box = (await page.locator('svg.diagram-canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(cx + i * 12, cy + (i % 5) * 8);
  }
  await page.mouse.up({ button: 'middle' });
  const longTasks = await page.evaluate(
    () => (window as unknown as { __longTasks: number }).__longTasks,
  );
  // Ceiling 5: an incidental GC pause registers 1-2 entries; a React-per-
  // pan-tick regression registers dozens. Discriminating and CI-safe.
  expect(longTasks).toBeLessThanOrEqual(5);
});
