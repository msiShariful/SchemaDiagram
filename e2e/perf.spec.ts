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
  // one row, extreme aspect ratio. Fit-zoom stays pinned at MIN_ZOOM (0.1,
  // src/canvas/viewport.ts) at ANY viewport size for a scene this wide (the
  // SVG pane never gets the ~3,434px it would need to clear the floor).
  // What the wide viewport actually changes is the culling margin:
  // visibleWorldRect (src/canvas/culling.ts) spans 2 x viewW / zoom world
  // px — proportional to raw viewport pixel width, independent of the
  // clamp. At 4000px window width the cull rect is ~49,560 world px, wider
  // than the 33,540px scene, so all 120 tables stay mounted after fit.
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

  // Pan smoke: middle-button drag across the scene, starting at the scene
  // center (pan-from-anywhere path — target-independent). Pan bypasses
  // React — a long-task pileup here means the perf contract broke.
  await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number; __longTaskObs: PerformanceObserver };
    w.__longTasks = 0;
    w.__longTaskObs = new PerformanceObserver((list) => {
      w.__longTasks += list.getEntries().length;
    });
    w.__longTaskObs.observe({ entryTypes: ['longtask'] });
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
  const longTasks = await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number; __longTaskObs: PerformanceObserver };
    w.__longTaskObs.disconnect();
    return w.__longTasks;
  });
  // Ceiling 5: an incidental GC pause registers 1-2 entries; a React-per-
  // pan-tick regression registers dozens. Discriminating and CI-safe.
  expect(longTasks).toBeLessThanOrEqual(5);
});
