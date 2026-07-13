import { defineConfig, devices } from '@playwright/test';

// Chromium-only by design: the spec §10 golden flows are app logic, not
// engine-compat testing, and one engine keeps CI fast. workers: 1 +
// fullyParallel: false keep the shared dev server and the perf spec
// deterministic (the perf budget must not compete for CPU with sibling
// tests). Each test still gets a fresh browser context → fresh IndexedDB.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // --strictPort: if something else already squats on 5173, Vite must fail
    // fast instead of silently moving to 5174 while Playwright tests the
    // stranger's server on 5173.
    command: 'npm run dev -- --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    // Ceiling, not a wait: zero cost on a healthy machine. Cold-start Vite
    // dep pre-bundling (@dbml/core is huge) on a fresh CI runner is the one
    // startup-shaped failure mode a retry re-suffers most expensively.
    timeout: 120_000,
  },
});
